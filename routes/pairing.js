// Marten-XD — pairing, sessions and the web pairing routes ONLY.
// Commands live in /joker-plugins, event handling in /core.
import express from "express";
import makeWASocket, { fetchLatestWaWebVersion, delay, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, DisconnectReason } from "@whiskeysockets/baileys";
import path from "path";
import fs from "fs";
import pino from "pino";
import { MAX_SESSIONS, activeSessions, addShareChild, getShareMeta, installHideMyBot, jidNumber, listSessionNumbers, removeShareChild, sessionAuthDir, sessionDataDir, setShareMeta, wipeSessionData } from "../core/helpers.js";
import { attachEvents } from "../core/events.js";

export const router = express.Router();

/**
 * WhatsApp rejects linking from an outdated client version: the code is still generated but the phone
 * says it is wrong / "couldn't link device". So we always use the CURRENT WhatsApp Web version.
 * Order: WA_VERSION env (e.g. "2,3000,1044015310") -> live fetch (cached 30 min) -> library default.
 */
export let _waVersionCache = { at: 0, version: null };
export async function getWaVersion() {
  try {
    const env = String(process.env.WA_VERSION || "").split(/[ ,.]+/).map(Number).filter(n => Number.isFinite(n));
    if (env.length === 3) return env;
  } catch {}
  if (_waVersionCache.version && Date.now() - _waVersionCache.at < 30 * 60 * 1000) return _waVersionCache.version;
  try {
    const r = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8000) });
    if (r?.isLatest && Array.isArray(r.version) && r.version.length === 3) {
      _waVersionCache = { at: Date.now(), version: r.version };
      console.log(`[Marten-XD] WhatsApp Web version: ${r.version.join(".")}`);
      return r.version;
    }
    console.log("[Marten-XD] Could not fetch latest WhatsApp version, using built-in default.", r?.error?.message || "");
  } catch (e) {
    console.log("[Marten-XD] Version fetch failed, using built-in default:", e?.message || e);
  }
  return _waVersionCache.version || undefined; // undefined -> library default
}

// ==================== PAIRING (MULTI-TENANT) ====================
/**
 * Start or restore a WhatsApp session for a phone number.
 * Each number gets isolated auth + data (settings, bans, anti tools, sudo).
 */
export async function startSession(number, { res = null, isRestore = false, onPairingCode = null, onConnected = null, shareFromKing = null } = {}) {
  const num = String(number || "").replace(/\D/g, "");
  if (!num || num.length < 8 || num.length > 15) {
    if (res && !res.headersSent) res.status(400).json({ error: "Invalid phone number" });
    return null;
  }

  // Already online?
  if (activeSessions.has(num)) {
    const existing = activeSessions.get(num);
    if (existing?.sock?.user) {
      if (res && !res.headersSent) {
        res.json({
          success: true,
          alreadyConnected: true,
          bot: "Marten-XD",
          number: num,
          message: "This number is already connected on this server."
        });
      }
      if (typeof onPairingCode === "function") {
        await onPairingCode(null, { alreadyConnected: true, number: num });
      }
      return existing.sock;
    }
  }

  // Max concurrent sessions (RAM safety)
  if (!activeSessions.has(num) && activeSessions.size >= MAX_SESSIONS) {
    const msg = `Server session limit reached (max ${MAX_SESSIONS}). Stop an existing session first.`;
    console.log(`[Marten-XD] ${msg}`);
    if (res && !res.headersSent) {
      res.status(429).json({ success: false, error: msg, max: MAX_SESSIONS, active: activeSessions.size });
    }
    if (typeof onPairingCode === "function") await onPairingCode(null, { error: msg });
    return null;
  }

  const authDir = sessionAuthDir(num);
  sessionDataDir(num); // ensure data folder exists

  // A fresh pairing request must not leave an older, never-linked socket running for the same number.
  // (Two live sockets overwrite each other's keys -> the code on screen no longer matches -> WhatsApp rejects it.)
  if (!isRestore) {
    const stale = activeSessions.get(num);
    if (stale?.sock && !stale.sock.user) {
      try { stale.sock.__manualDisconnect = true; stale.sock.end?.(undefined); } catch {}
      activeSessions.delete(num);
      await delay(500);
    }
    // Never-linked leftovers (previous failed attempt) must start from clean keys
    try {
      const credsFile = path.join(authDir, "creds.json");
      if (fs.existsSync(credsFile)) {
        const c = JSON.parse(fs.readFileSync(credsFile, "utf8"));
        if (!c.registered) fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // Portal pair = bot king; /connect from king = child
  if (!isRestore) {
    if (shareFromKing) {
      addShareChild(shareFromKing, num);
    } else {
      const existingMeta = getShareMeta(num);
      // Keep child role if already marked; otherwise portal pair = king
      if (existingMeta.role !== "child") {
        setShareMeta(num, { role: "king", parent: null, children: existingMeta.children || [] });
      }
    }
  }

  let state, saveCreds;
  ({ state, saveCreds } = await useMultiFileAuthState(authDir));

  let pairingCodeSent = false;
  let reconnecting = false;
  let failStreak = 0;        // consecutive reconnects without a successful "open"
  let badSessionStreak = 0;  // consecutive "bad session" closes

  // Reconnect with back-off and NEVER give up silently (the old code stopped forever after one failed restart)
  async function scheduleReconnect(statusCode) {
    if (reconnecting) return;
    reconnecting = true;
    try {
      for (;;) {
        const wait = (statusCode === DisconnectReason.restartRequired && failStreak === 0)
          ? 1000
          : Math.min(30000, 2000 * 2 ** Math.min(failStreak, 4));
        failStreak++;
        await delay(wait);
        try {
          waVersion = (await getWaVersion()) || waVersion;
          await startSocket();
          break;
        } catch (e) {
          console.error(`[Marten-XD] Reconnect failed (${num}) — retrying:`, e?.message || e);
          statusCode = undefined;
        }
      }
    } finally {
      reconnecting = false;
    }
  }

  let waVersion = await getWaVersion();

  async function startSocket() {
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      version: waVersion,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 90000,
      retryRequestDelayMs: 350,
      // Zain parity: Ubuntu/Chrome only while pairing; after registration run as Android/Chrome
      browser: state.creds?.registered ? Browsers.android("Chrome") : Browsers.ubuntu("Chrome")
    });

    sock.__botNumber = num;
    installHideMyBot(sock);
    sock.__welcomeSent = isRestore ? true : false; // no spam on server restart restore

    sock.ev.on("creds.update", saveCreds);
    attachEvents(sock);

    activeSessions.set(num, { sock, number: num, authDir, dataDir: sessionDataDir(num), startedAt: Date.now() });

    if (!isRestore && !pairingCodeSent && !state.creds.registered) {
      await delay(2500); // let the WebSocket + Noise handshake finish before asking for a code
      try {
        let code;
        let lastErr;
        for (let attempt = 1; attempt <= 3 && !code; attempt++) {
          try {
            code = await sock.requestPairingCode(num);
          } catch (err) {
            lastErr = err;
            console.log(`[Marten-XD] Pairing code attempt ${attempt}/3 failed: ${err?.message || err}`);
            if (attempt < 3) await delay(2000);
          }
        }
        if (!code) throw lastErr || new Error("No pairing code");
        pairingCodeSent = true;
        if (res && !res.headersSent) {
          res.json({
            success: true,
            bot: "Marten-XD Multi-Tenant",
            number: num,
            code,
            message: "WhatsApp > Linked devices > Link a device > Link with phone number. Each number has isolated settings."
          });
        }
        if (typeof onPairingCode === "function") {
          await onPairingCode(code, { number: num });
        }
        console.log(`[Marten-XD] Pairing code for ${num}`);
      } catch (e) {
        if (res && !res.headersSent) {
          res.status(500).json({ success: false, error: "Pairing code failed", detail: String(e.message || e) });
        }
        if (typeof onPairingCode === "function") {
          await onPairingCode(null, { error: String(e.message || e), number: num });
        }
      }
    } else if (!isRestore && state.creds.registered) {
      if (res && !res.headersSent) {
        res.json({
          success: true,
          bot: "Marten-XD Multi-Tenant",
          number: num,
          alreadyRegistered: true,
          message: "Session exists — reconnecting this number."
        });
      }
      if (typeof onPairingCode === "function") {
        await onPairingCode(null, { alreadyRegistered: true, number: num });
      }
    }

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        failStreak = 0;
        badSessionStreak = 0;
        sock.__botNumber = jidNumber(sock.user?.id) || num;
        activeSessions.set(num, { sock, number: sock.__botNumber || num, authDir, dataDir: sessionDataDir(num), startedAt: Date.now() });
        console.log(`[Marten-XD] Session online: ${sock.__botNumber || num}`);
        if (typeof onConnected === "function" && !sock.__shareConnectedNotified) {
          sock.__shareConnectedNotified = true;
          try { await onConnected({ number: sock.__botNumber || num }); } catch {}
        }
        return;
      }
      if (connection !== "close") return;
      sock.__dead = true;
      try { if (sock.__presenceInterval) { clearInterval(sock.__presenceInterval); sock.__presenceInterval = null; } } catch {}
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      // Manual /disconnect must never enter the automatic reconnect loop.
      if (sock.__manualDisconnect) {
        activeSessions.delete(num);
        return;
      }
      console.log(`[Marten-XD] Session closed: ${num} | ${statusCode} | ${lastDisconnect?.error?.message || ""}`);

      // Real logout (device removed from WhatsApp) — wipe, user must pair again
      if ([DisconnectReason.loggedOut, DisconnectReason.multideviceMismatch].includes(statusCode)) {
        activeSessions.delete(num);
        try {
          if (statusCode === DisconnectReason.loggedOut) {
            const parent = getShareMeta(num).parent;
            wipeSessionData(num);
            if (parent) removeShareChild(parent, num);
            console.log(`[Marten-XD] Logged out — full data wiped for ${num}`);
          } else if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
          }
        } catch {}
        return;
      }

      // "Bad session" is often temporary — do NOT delete the login on the first error (that forced a re-pair).
      // Only wipe after many failures in a row.
      if (statusCode === DisconnectReason.badSession) {
        badSessionStreak++;
        if (badSessionStreak >= 6) {
          activeSessions.delete(num);
          try { if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true }); } catch {}
          console.log(`[Marten-XD] Bad session ${badSessionStreak}x in a row — auth wiped for ${num}. Pair again.`);
          return;
        }
      }

      // Same login opened somewhere else (another server / old copy still running).
      // Reconnecting here would make both copies kick each other forever, so stop and keep the files.
      if (statusCode === DisconnectReason.connectionReplaced) {
        activeSessions.delete(num);
        console.log(`[Marten-XD] ${num}: this session was opened in ANOTHER place (440). Stop the other copy, then restart this bot.`);
        return;
      }

      // Pairing socket died BEFORE the phone linked it: the code shown to the user is dead now
      // (WhatsApp ties it to that exact connection). Do not silently reconnect with a dead code.
      if (!isRestore && !state.creds.registered && statusCode !== DisconnectReason.restartRequired) {
        activeSessions.delete(num);
        try { fs.rmSync(authDir, { recursive: true, force: true }); } catch {}
        console.log(`[Marten-XD] Pairing connection closed before linking (${statusCode}). Request a NEW code.`);
        return;
      }

      scheduleReconnect(statusCode).catch((e) => console.error(`[Marten-XD] scheduleReconnect (${num}):`, e?.message || e));
    });

    return sock;
  }

  return await startSocket();
}

/** Restore all previously paired sessions after server restart */
export async function restoreAllSessions() {
  const nums = listSessionNumbers();
  console.log(`[Marten-XD] Restoring ${nums.length} session(s)...`);
  for (const num of nums) {
    try {
      await startSession(num, { isRestore: true });
      await delay(1500);
    } catch (e) {
      console.error(`[Marten-XD] Restore failed for ${num}:`, e.message);
    }
  }
}

router.get("/", async (req, res) => {
  const number = String(req.query.number || "").replace(/\D/g, "");
  if (!number) return res.status(400).json({ error: "Missing number", example: "/pair?number=923XXXXXXXXX" });
  if (number.length < 8 || number.length > 15) return res.status(400).json({ error: "Invalid phone number" });

  try {
    await startSession(number, { res, isRestore: false });
  } catch (err) {
    console.error("[pairing]", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Pairing unavailable", detail: String(err.message || err) });
    }
  }
});

/** List active multi-tenant sessions */
router.get("/sessions", (_req, res) => {
  const list = [...activeSessions.entries()].map(([num, s]) => ({
    number: num,
    online: !!(s.sock?.user),
    dataDir: s.dataDir
  }));
  res.json({ count: list.length, sessions: list });
});

// Auto-restore on boot (slight delay so server can bind port)
setTimeout(() => {
  restoreAllSessions().catch(e => console.error("[restore]", e.message));
}, 2500);

export default router;
