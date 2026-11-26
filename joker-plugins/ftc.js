// Marten-XD: .ftc / .fwd <channel jid> — reply to any message to post it to a channel.
//   image / video / sticker / document / text -> posted as they are
//   audio / voice note                        -> converted to a voice note first
import pino from "pino";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { apiErr, bufferToVoice, commandPrivileged, getQuotedMsg, unwrapMessage } from "../core/helpers.js";
import { CH_POST_ERROR, resolveChannelTarget } from "./_chlib.js";

export default {
  name: "ftc",
  aliases: ["ftc", "fwd"],
  order: 5901,
  async run(ctx) {
    const { sock, msg, prefix, args, send, react } = ctx;
    if (!commandPrivileged(sock, msg, send)) return true;
    const p = prefix || ".";

    const q = getQuotedMsg(msg);
    if (!q?.message || !args.length) {
      await send(
        `📤 *Forward to Channel*\n\n` +
        `Reply to any message (text, photo, video, audio, document, sticker) with:\n` +
        `*${p}ftc <channel jid>*  or  *${p}fwd <channel jid>*\n\n` +
        `• Audio is converted to a voice note before posting.\n` +
        `• Anything after the JID is used as the caption.\n` +
        `• Get a JID with *${p}chjid* or *${p}chaneljid*.`
      );
      return true;
    }

    try {
      await react("📤");
      const chJid = await resolveChannelTarget(sock, args[0]);
      if (!chJid) {
        await react("❌");
        await send("❌ That is not a valid channel JID, link or invite code.");
        return true;
      }
      const captionArg = args.slice(1).join(" ").trim();
      const m = unwrapMessage(q.message);
      const dl = () => downloadMediaMessage({ key: q.key, message: m }, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });

      let content = null;
      if (m.imageMessage) {
        content = { image: await dl(), caption: captionArg || m.imageMessage.caption || "" };
      } else if (m.videoMessage) {
        content = { video: await dl(), mimetype: "video/mp4", caption: captionArg || m.videoMessage.caption || "" };
      } else if (m.audioMessage) {
        const raw = await dl();
        try {
          const v = await bufferToVoice(raw);
          content = { audio: v.buf, mimetype: v.mimetype, ptt: true };
        } catch {
          content = { audio: raw, mimetype: "audio/mpeg", ptt: true };
        }
      } else if (m.stickerMessage) {
        content = { sticker: await dl() };
      } else if (m.documentMessage) {
        content = {
          document: await dl(),
          mimetype: m.documentMessage.mimetype || "application/octet-stream",
          fileName: m.documentMessage.fileName || "file",
          caption: captionArg || m.documentMessage.caption || ""
        };
      } else {
        const text = captionArg || m.conversation || m.extendedTextMessage?.text || "";
        if (!text) {
          await react("❌");
          await send("❌ This message type cannot be forwarded to a channel.");
          return true;
        }
        content = { text };
      }

      try {
        await sock.sendMessage(chJid, content);
      } catch (e) {
        console.error("[ftc] post failed");
        await react("❌");
        await send(CH_POST_ERROR);
        return true;
      }
      await react("✅");
      await send(`✅ Posted to channel\n${chJid}`);
    } catch (e) {
      console.error("[ftc] failed");
      await react("❌");
      await send(`❌ ${apiErr(e)}`);
    }
    return true;
  }
};
