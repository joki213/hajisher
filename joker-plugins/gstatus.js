// Joker plugin: gstatus  — commands: gstatus, togroupstatus, togstatus
// Sticker-aware: animated sticker → video status, static sticker → image status.
// Converted media is posted ONLY as group status (never as a normal chat message).
import pino from "pino";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import {
  buildSendContent,
  commandPrivileged,
  getQuotedMsg,
  isGroup,
  stickerToImageBuffer,
  stickerToVideo,
  unwrapMessage
} from "../core/helpers.js";

function isAnimatedWebP(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return false;
  return buf.includes(Buffer.from("ANIM")) || buf.includes(Buffer.from("ANMF"));
}

async function postGroupStatus(sock, targetJid, content) {
  if (typeof sock.sendGroupStatus === "function") {
    await sock.sendGroupStatus(targetJid, content);
    return;
  }
  // Baileys path: groupStatus:true wraps as groupStatusMessageV2 + isGroupStatus
  await sock.sendMessage(targetJid, { ...content, groupStatus: true });
}

export default {
  name: "gstatus",
  aliases: ["gstatus", "togroupstatus", "togstatus"],
  order: 8239,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["gstatus", "togroupstatus", "togstatus"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, args, jid, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };

    try {
      let targetJid = null;
      let textArgs = [...args];

      const a0 = args[0] ? String(args[0]).trim() : "";
      if (a0 && (/@g\.us$/i.test(a0) || /^\d{10,}(-\d+)?@?g?\.?u?s?$/i.test(a0) || /^\d{15,}(-\d+)?$/.test(a0))) {
        const rawJ = a0.replace(/@g\.us$/i, "").replace(/@$/, "");
        if (/^\d{10,}(-\d+)?$/.test(rawJ)) {
          targetJid = `${rawJ}@g.us`;
          textArgs = args.slice(1);
        }
      }
      if (!targetJid && isGroup(jid)) {
        targetJid = jid;
      }

      if (!targetJid || !String(targetJid).endsWith("@g.us")) {
        await send(
          "📌 *Group Status Usage:*\n\n" +
            "• `.togstatus Hello world` — text (group ke andar)\n" +
            "• `.togstatus 120363xxx@g.us Hello` — text (bahar se)\n" +
            "• Reply image/video/sticker + `.togstatus` — media\n" +
            "• Animated sticker → auto video status\n" +
            "• Static sticker → auto image status\n\n" +
            "Aliases: `.gstatus`  `.togroupstatus`"
        );
        return { __done: true, value: true };
      }

      const quoted = getQuotedMsg(msg);
      let content = null;

      // Sticker reply → convert before posting (never send converted media to chat)
      if (quoted) {
        const inner = unwrapMessage(quoted.message || {}) || {};
        const stickerNode = inner.stickerMessage || quoted.message?.stickerMessage;
        if (stickerNode) {
          try {
            const dlTarget = {
              key: quoted.key,
              message: Object.keys(inner).length ? inner : quoted.message
            };
            const buf = await downloadMediaMessage(dlTarget, "buffer", {}, {
              logger: pino({ level: "silent" }),
              reuploadRequest: sock.updateMediaMessage
            });
            if (!buf || buf.length < 50) throw new Error("Sticker download failed");

            const animated =
              !!stickerNode.isAnimated ||
              !!stickerNode.isLottie ||
              isAnimatedWebP(buf);

            if (animated) {
              const videoBuf = await stickerToVideo(buf);
              if (!videoBuf || videoBuf.length < 200) throw new Error("Animated sticker → video failed");
              content = { video: videoBuf, mimetype: "video/mp4" };
            } else {
              const imgBuf = await stickerToImageBuffer(buf);
              if (!imgBuf || imgBuf.length < 50) throw new Error("Static sticker → image failed");
              content = { image: imgBuf };
            }
          } catch (e) {
            console.error("[gstatus-sticker]", e?.message || e);
            await send("❌ Sticker convert fail: " + (e?.message || e));
            return { __done: true, value: true };
          }
        }
      }

      // Other media / text via buildSendContent
      if (!content && quoted) {
        try {
          content = await buildSendContent(sock, quoted);
          // Never post raw sticker as group status — convert if somehow still sticker
          if (content?.sticker) {
            const buf = content.sticker;
            if (isAnimatedWebP(buf)) {
              content = { video: await stickerToVideo(buf), mimetype: "video/mp4" };
            } else {
              content = { image: await stickerToImageBuffer(buf) };
            }
          }
        } catch (e) {
          console.error("[gstatus-build]", e?.message || e);
        }
      }

      if (!content) {
        const directText = textArgs.join(" ").trim();
        if (directText) content = { text: directText };
      }

      if (!content && quoted) {
        const txt =
          quoted.message?.conversation ||
          quoted.message?.extendedTextMessage?.text ||
          quoted.message?.imageMessage?.caption ||
          quoted.message?.videoMessage?.caption ||
          "";
        if (txt) content = { text: txt };
      }

      if (!content) {
        await send(
          "❌ Text, image, video, sticker or audio is required.\n\n" +
            "Examples:\n" +
            "• `.togstatus Hello world`\n" +
            "• Reply photo/sticker + `.togstatus`"
        );
        return { __done: true, value: true };
      }

      // Post ONLY as group status — no chat media spam
      await postGroupStatus(sock, targetJid, content);
      await send("✅ Group Status posted successfully.");
    } catch (e) {
      console.error("[gstatus]", e?.message || e);
      await send(
        "❌ Failed to post Group Status.\n" +
          (e?.message || "Unknown error") +
          "\n\n• Make sure you are an admin of the target group."
      );
    }
    return { __done: true, value: true };
  }
};
