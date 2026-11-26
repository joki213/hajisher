// Marten-XD: DMG — Disappear Messages in Group
// Usage:
//   .dmg 30s | .dmg 5m | .dmg 1h | .dmg 24h | .dmg 7d | .dmg 90d
//   .dmg off | .dmg 0 | .dmg unlimited
// Aliases: dmg, disappear, disappearing, dismsg

import { isAdmin, isBotAdmin, isGroup, isPrivileged } from "../core/helpers.js";

function parseDuration(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return { error: "missing" };
  if (["off", "0", "disable", "unlimited", "none", "stop"].includes(s)) {
    return { seconds: 0, label: "OFF (unlimited / no disappear)" };
  }
  // pure number = seconds
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n < 30 && n !== 0) return { error: "Minimum is 30 seconds (or off)" };
    return { seconds: n, label: formatLabel(n) };
  }
  const m = s.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (!m) return { error: "bad format" };
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  let sec = 0;
  if (u.startsWith("s")) sec = n;
  else if (u.startsWith("m")) sec = n * 60;
  else if (u.startsWith("h")) sec = n * 3600;
  else if (u.startsWith("d")) sec = n * 86400;
  if (sec !== 0 && sec < 30) return { error: "Minimum is 30 seconds (or off)" };
  // soft max 1 year
  if (sec > 365 * 86400) return { error: "Max is 365 days" };
  return { seconds: sec, label: formatLabel(sec) };
}

function formatLabel(sec) {
  if (!sec) return "OFF";
  if (sec < 60) return `${sec} second(s)`;
  if (sec < 3600) return `${Math.round(sec / 60)} minute(s)`;
  if (sec < 86400) return `${Math.round(sec / 3600)} hour(s)`;
  return `${Math.round(sec / 86400)} day(s)`;
}

export default {
  name: "dmg",
  aliases: ["dmg", "disappear", "disappearing", "dismsg", "ephemeral"],
  order: 8020,
  legacy: true,
  match(__ctx) {
    return ["dmg", "disappear", "disappearing", "dismsg", "ephemeral"].includes(__ctx.cmd);
  },
  async run(__ctx) {
    const { sock, msg, args, jid, send } = __ctx;
    if (!isGroup(jid)) {
      await send("❌ Group only.");
      return { __done: true, value: true };
    }

    const meta = await sock.groupMetadata(jid).catch(() => null);
    if (!meta) {
      await send("❌ Could not load group.");
      return { __done: true, value: true };
    }

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!isAdmin(meta, sender) && !isPrivileged(sock, msg)) {
      await send("❌ Admins only.");
      return { __done: true, value: true };
    }

    // Prefer accurate detection; still attempt API (WA returns error if bot isn't admin)
    if (!isBotAdmin(meta, sock) && !isPrivileged(sock, msg)) {
      await send("Make me admin First to execute this command");
      return { __done: true, value: true };
    }

    if (!args[0]) {
      const cur = meta.ephemeralDuration || 0;
      await send(
        `⏱️ *DMG — Disappear Messages*\n` +
        `Current: *${cur ? formatLabel(cur) : "OFF"}*\n\n` +
        `Usage:\n` +
        `• .dmg 30s\n` +
        `• .dmg 5m\n` +
        `• .dmg 1h\n` +
        `• .dmg 24h\n` +
        `• .dmg 7d\n` +
        `• .dmg off`
      );
      return { __done: true, value: true };
    }

    const parsed = parseDuration(args.join(""));
    if (parsed.error === "missing" || parsed.error === "bad format") {
      await send("❌ Usage: .dmg 30s | 5m | 1h | 24h | 7d | off");
      return { __done: true, value: true };
    }
    if (parsed.error) {
      await send(`❌ ${parsed.error}`);
      return { __done: true, value: true };
    }

    try {
      // Baileys: groupToggleEphemeral(jid, seconds) — 0 turns off
      if (typeof sock.groupToggleEphemeral === "function") {
        await sock.groupToggleEphemeral(jid, parsed.seconds);
      } else {
        // Fallback message-style toggle used by some builds
        await sock.sendMessage(jid, { disappearingMessagesInChat: parsed.seconds });
      }

      if (parsed.seconds === 0) {
        await send("✅ Disappearing messages *OFF* — messages will not auto-delete.");
      } else {
        await send(`✅ Disappearing messages *ON*\nNew messages will disappear after *${parsed.label}*.`);
      }
    } catch (e) {
      await send(`❌ Failed: ${e.message || e}\n(Bot must be admin; some durations may be blocked by WhatsApp)`);
    }

    return { __done: true, value: true };
  }
};
