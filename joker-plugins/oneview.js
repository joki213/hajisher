// Joker plugin: oneview — VIEW ONCE send tools (VIP = owner only)
//
//   .oneviewtagmedia | .otmedia  — reply media / view-once (or send media with this as caption)
//                                   → resent as VIEW ONCE + hidden tag-all
//                                   .otmedia            → this chat
//                                   .otmedia <jid>      → that chat (group / user jid / lid / number)
//   .oneviewtexttag  | .ott      — reply a text (or `.ott <text>`) → VIEW ONCE text + hidden tag-all
//                                   original text + command are deleted (same chat)
//                                   .ott <jid>          (reply)   → send to that chat
//                                   .ott <jid> <text>             → send to that chat
//   .oneviewtext     | .ot       — same as .ott but WITHOUT tag
//
// Set ONEVIEW_KEEP_ORIGINAL=1 in the environment to stop the bot deleting the replied text.
import {
  buildQuotedContent,
  commandOwnerOnly,
  findQuotedDeep,
  isViewOncePayload,
  jidNumber,
  mcKey,
  messageCache,
  openViewOnce,
  unwrapMessage
} from "../core/helpers.js";

const MODES = {
  oneviewtagmedia: { kind: "media", tag: true },
  otmedia: { kind: "media", tag: true },
  oneviewtexttag: { kind: "text", tag: true },
  ott: { kind: "text", tag: true },
  oneviewtext: { kind: "text", tag: false },
  ot: { kind: "text", tag: false }
};

/** group jid / user jid / lid / plain number → normalized jid, else null */
function parseTarget(tok) {
  const t = String(tok || "").trim();
  if (!t) return null;
  if (/^[\d-]+@g\.us$/i.test(t)) return t.toLowerCase();
  if (/^\d+(:\d+)?@s\.whatsapp\.net$/i.test(t)) return t.replace(/:\d+@/, "@").toLowerCase();
  if (/^\d+(:\d+)?@lid$/i.test(t)) return t.replace(/:\d+@/, "@").toLowerCase();
  if (/^\+?\d{7,15}$/.test(t)) return `${t.replace(/\D/g, "")}@s.whatsapp.net`;
  return null;
}

function quotedText(q) {
  const m = unwrapMessage(q?.message || {});
  return String(m.conversation || m.extendedTextMessage?.text || "").trim();
}

function hasMedia(message) {
  const m = unwrapMessage(message || {});
  return !!(m.imageMessage || m.videoMessage || m.audioMessage);
}

async function groupMembers(sock, gjid) {
  try {
    const meta = await sock.groupMetadata(gjid);
    const list = (meta?.participants || []).map((p) => p.id).filter(Boolean);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** Download the replied media (view-once or normal) as a sendable payload. */
async function getMediaContent(sock, src) {
  let c = null;
  if (isViewOncePayload(src.message)) {
    c = await openViewOnce(sock, src).catch(() => null);
    if (!c) {
      const cached = messageCache.get(mcKey(sock, src.key?.id));
      c = cached?.prebuilt || null;
    }
  }
  if (!c) {
    const r = await buildQuotedContent(sock, src).catch(() => ({ content: null }));
    c = r?.content || null;
  }
  if (!c) c = await openViewOnce(sock, src).catch(() => null);
  return c;
}

/** Make a delete-key that WhatsApp accepts (own messages need fromMe:true). */
function deleteKey(sock, key) {
  const k = { ...key };
  const mine = new Set([jidNumber(sock.user?.id), jidNumber(sock.user?.lid)].filter(Boolean));
  if (k.participant && mine.has(jidNumber(k.participant))) k.fromMe = true;
  return k;
}

const USAGE = (p, cmd) => {
  if (MODES[cmd].kind === "media") {
    return (
`👁️ *ONE VIEW TAG MEDIA* (${p}oneviewtagmedia / ${p}otmedia)

Reply a picture / video / voice / view-once with:
• ${p}otmedia — resend here as view-once + hidden tag-all
• ${p}otmedia <jid> — send there (group jid, user jid, @lid or number)

_VIP: owner only_`
    );
  }
  const tag = MODES[cmd].tag;
  const full = tag ? `${p}oneviewtexttag / ${p}ott` : `${p}oneviewtext / ${p}ot`;
  const c = tag ? `${p}ott` : `${p}ot`;
  return (
`👁️ *ONE VIEW TEXT${tag ? " TAG" : ""}* (${full})

• Reply a text with ${c} — view-once text${tag ? " + hidden tag-all" : ""}, original + command deleted
• ${c} <text> — send this text as view-once
• ${c} <jid> — (reply) send there
• ${c} <jid> <text> — send there

_jid = group jid, user jid, @lid or number${tag ? " (tag works in groups only)" : ""}_
_VIP: owner only_`
  );
};

export default {
  name: "oneview",
  aliases: Object.keys(MODES),
  order: 6350,
  match(ctx) {
    return Object.prototype.hasOwnProperty.call(MODES, ctx.cmd);
  },
  async run(ctx) {
    const { sock, msg, jid, send, body, cmd } = ctx;
    const mode = MODES[cmd];
    const prefix = ctx.prefix === "" ? "." : (ctx.prefix || ".");

    // VIP = owner only (sudo is NOT enough)
    if (!commandOwnerOnly(sock, msg, send)) return true;

    // ----- parse: [jid] [text...] -----
    let rest = String(body || "").replace(/^\S+\s*/, "");
    let target = jid;
    let remote = false;
    const firstTok = rest.split(/\s+/)[0] || "";
    const parsed = parseTarget(firstTok);
    if (parsed) {
      target = parsed;
      remote = parsed !== jid;
      rest = rest.slice(firstTok.length).trim();
    }
    const quoted = findQuotedDeep(msg);
    const isGroupTarget = target.endsWith("@g.us");

    // ----- hidden tag list -----
    let members = null;
    if (mode.tag && isGroupTarget) {
      members = await groupMembers(sock, target);
      if (!members) {
        await send("❌ Could not read that group. Make sure the bot is a member of it.");
        return true;
      }
    }

    const deleteCommand = async () => {
      try { await sock.sendMessage(jid, { delete: deleteKey(sock, msg.key) }); } catch {}
    };
    const done = async (extra = "") => {
      if (remote) {
        await send(`✅ Sent as view-once to ${target}${extra}`);
      } else {
        await deleteCommand(); // same chat → silent, no trace
      }
      return true;
    };

    // ==================== MEDIA ====================
    if (mode.kind === "media") {
      let src = null;
      if (quoted) src = quoted;
      else if (hasMedia(msg.message)) src = msg; // media sent with the command as caption
      if (!src) {
        await send(USAGE(prefix, cmd));
        return true;
      }
      if (quoted && !hasMedia(quoted.message) && !isViewOncePayload(quoted.message)) {
        const qt = quotedText(quoted);
        await send(qt
          ? `❌ That is a text message — use *${prefix}ott* (with tag) or *${prefix}ot* (no tag).`
          : "❌ View-once works only for picture / video / voice.");
        return true;
      }
      let content;
      try {
        content = await getMediaContent(sock, src);
      } catch (e) {
        await send(`❌ Could not download that media: ${e?.message || e}`);
        return true;
      }
      if (!content || !(content.image || content.video || content.audio)) {
        await send("❌ Could not open that media (or it is not a picture / video / voice).");
        return true;
      }
      content.viewOnce = true;
      if (members) content.mentions = members;
      try {
        await sock.sendMessage(target, content);
      } catch (e) {
        await send(`❌ Send failed: ${e?.message || e}`);
        return true;
      }
      return await done(members ? " (+ hidden tag-all)" : "");
    }

    // ==================== TEXT ====================
    let text = "";
    let replacing = false; // true → the replied text is the source and gets deleted
    if (quoted) {
      const qt = quotedText(quoted);
      if (qt) { text = qt; replacing = true; }
      else if (rest) text = rest;
      else if (hasMedia(quoted.message) || isViewOncePayload(quoted.message)) {
        await send(`❌ That is media — use *${prefix}otmedia*.`);
        return true;
      }
    } else {
      text = rest;
    }
    if (!text) {
      await send(USAGE(prefix, cmd));
      return true;
    }

    const content = { text, viewOnce: true };
    if (members) content.mentions = members;
    try {
      await sock.sendMessage(target, content);
    } catch (e) {
      // nothing deleted if the send failed — the original text is safe
      await send(`❌ Send failed: ${e?.message || e}`);
      return true;
    }

    // delete the replied original only AFTER the view-once text was sent, and only when replacing in place
    if (replacing && !remote && process.env.ONEVIEW_KEEP_ORIGINAL !== "1") {
      try { await sock.sendMessage(jid, { delete: deleteKey(sock, quoted.key) }); } catch {}
    }
    return await done(members ? " (+ hidden tag-all)" : "");
  }
};
