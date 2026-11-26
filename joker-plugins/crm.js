// Marten-XD: crm — deep message / bot-command structure reveal
import { commandPrivileged, getQuotedMsg, unwrapMessage } from "../core/helpers.js";

function brief(v, max = 200) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return `<Buffer ${v.length}b>`;
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…" : v;
  return v;
}

function extractLayers(message) {
  const layers = [];
  let m = message || {};
  for (let i = 0; i < 8; i++) {
    const keys = Object.keys(m || {});
    if (!keys.length) break;
    layers.push(keys.join(", "));
    if (m.viewOnceMessageV2Extension?.message) { m = m.viewOnceMessageV2Extension.message; continue; }
    if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
    if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
    if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
    if (m.documentWithCaptionMessage?.message) { m = m.documentWithCaptionMessage.message; continue; }
    if (m.templateMessage?.hydratedTemplate) { m = m.templateMessage.hydratedTemplate; continue; }
    break;
  }
  return { layers, inner: m };
}

function pickCtx(inner) {
  return (
    inner?.extendedTextMessage?.contextInfo ||
    inner?.imageMessage?.contextInfo ||
    inner?.videoMessage?.contextInfo ||
    inner?.audioMessage?.contextInfo ||
    inner?.documentMessage?.contextInfo ||
    inner?.stickerMessage?.contextInfo ||
    inner?.buttonsMessage?.contextInfo ||
    inner?.templateMessage?.contextInfo ||
    null
  );
}

function pickText(inner) {
  return (
    inner?.conversation ||
    inner?.extendedTextMessage?.text ||
    inner?.imageMessage?.caption ||
    inner?.videoMessage?.caption ||
    inner?.documentMessage?.caption ||
    inner?.buttonsResponseMessage?.selectedDisplayText ||
    inner?.listResponseMessage?.title ||
    ""
  );
}

function guessHowSent(outer, inner, ctx) {
  const tips = [];
  if (outer?.viewOnceMessageV2Extension || outer?.viewOnceMessageV2 || outer?.viewOnceMessage)
    tips.push("viewOnce wrapper");
  if (outer?.ephemeralMessage) tips.push("ephemeral wrapper");
  if (ctx?.groupMentions?.length) tips.push("groupMentions (clickable group name)");
  if (ctx?.mentionedJid?.length) tips.push(`mentionedJid x${ctx.mentionedJid.length} (hidetag/tag)`);
  if (ctx?.isForwarded || ctx?.forwardingScore) tips.push(`forwarded score=${ctx.forwardingScore || 1}`);
  if (ctx?.externalAdReply) tips.push("externalAdReply (fake link preview)");
  if (ctx?.forwardedNewsletterMessageInfo) tips.push("channel/newsletter forward");
  if (inner?.templateMessage || outer?.templateMessage) tips.push("templateMessage");
  if (inner?.buttonsMessage || inner?.interactiveMessage) tips.push("buttons/interactive");
  if (inner?.reactionMessage) tips.push("reaction");
  if (!tips.length) tips.push("plain message");
  return tips;
}

function safeDump(obj) {
  const seen = new WeakSet();
  let s = JSON.stringify(
    obj,
    (k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (Buffer.isBuffer(v)) return `<Buffer ${v.length}b>`;
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
        if (["jpegThumbnail", "waveform", "scansSidecar"].includes(k)) return `<${k}>`;
        if (k === "messageKeys" || k === "chainKey") return undefined;
      }
      return v;
    },
    2
  );
  if (s.length > 3200) s = s.slice(0, 3200) + "\n… (truncated)";
  return s;
}

export default {
  name: "crm",
  aliases: ["crm", "cmdreveal", "msgcode", "revealcmd", "getcode"],
  order: 6400,
  legacy: true,
  match(__ctx) {
    return ["crm", "cmdreveal", "msgcode", "revealcmd", "getcode"].includes(__ctx.cmd);
  },
  async run(__ctx) {
    const { sock, msg, jid, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };

    const quoted = getQuotedMsg(msg);
    if (!quoted) {
      await send("❌ Reply to a message with `.crm`");
      return { __done: true, value: true };
    }

    try {
      const outer = quoted.message || {};
      const { layers, inner } = extractLayers(outer);
      const ctx = pickCtx(inner) || pickCtx(outer);
      const text = pickText(inner) || pickText(outer);
      const how = guessHowSent(outer, inner, ctx);

      // Rebuild a likely "send" skeleton other bots used
      const skeleton = {
        text: text || undefined,
        mentions: ctx?.mentionedJid || undefined,
        contextInfo: ctx
          ? {
              mentionedJid: ctx.mentionedJid || undefined,
              groupMentions: ctx.groupMentions || undefined,
              isForwarded: ctx.isForwarded || undefined,
              forwardingScore: ctx.forwardingScore || undefined,
              externalAdReply: ctx.externalAdReply
                ? {
                    title: ctx.externalAdReply.title,
                    body: ctx.externalAdReply.body,
                    sourceUrl: ctx.externalAdReply.sourceUrl,
                    mediaType: ctx.externalAdReply.mediaType
                  }
                : undefined
            }
          : undefined
      };

      const lines = [
        `🔍 *CRM — Deep Reveal*`,
        ``,
        `*How it was built:*`,
        ...how.map((h) => `• ${h}`),
        ``,
        `*Wrapper layers:*`,
        ...layers.map((l, i) => `${i + 1}. ${l}`),
        ``,
        `*Visible text:*`,
        text ? brief(text, 400) : "(none)",
        ``,
        `*groupMentions:*`,
        ctx?.groupMentions ? JSON.stringify(ctx.groupMentions, null, 2) : "none",
        ``,
        `*mentionedJid count:* ${ctx?.mentionedJid?.length || 0}`,
        ``,
        `*Likely send payload:*`,
        "```json",
        safeDump(skeleton),
        "```",
        ``,
        `*Full message JSON:*`,
        "```json",
        safeDump({ key: quoted.key, pushName: quoted.pushName, message: outer }),
        "```"
      ];

      await send(lines.join("\n"));
    } catch (e) {
      await send(`❌ CRM failed: ${e.message || e}`);
    }
    return { __done: true, value: true };
  }
};
