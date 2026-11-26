// Joker plugin: tostatus  — commands: tostatus, statuspost, poststatus
// Same sticker logic as gstatus: animated → video, static → image.
// Posts ONLY to personal status@broadcast (never dumps converted media in chat).
import pino from "pino";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import {
  buildSendContent,
  commandPrivileged,
  getQuotedMsg,
  stickerToImageBuffer,
  stickerToVideo,
  unwrapMessage
} from "../core/helpers.js";

function isAnimatedWebP(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return false;
  return buf.includes(Buffer.from("ANIM")) || buf.includes(Buffer.from("ANMF"));
}

export default {
  name: "tostatus",
  aliases: ["tostatus", "statuspost", "poststatus"],
  order: 8240,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["tostatus", "statuspost", "poststatus"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, args, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };

    try {
      const quoted = getQuotedMsg(msg);
      let content = null;
      const textArgs = [...args];

      // Sticker reply → convert, post only to status
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
            console.error("[tostatus-sticker]", e?.message || e);
            await send("❌ Sticker convert fail: " + (e?.message || e));
            return { __done: true, value: true };
          }
        }
      }

      if (!content && quoted) {
        try {
          content = await buildSendContent(sock, quoted);
          if (content?.sticker) {
            const buf = content.sticker;
            if (isAnimatedWebP(buf)) {
              content = { video: await stickerToVideo(buf), mimetype: "video/mp4" };
            } else {
              content = { image: await stickerToImageBuffer(buf) };
            }
          }
        } catch (e) {
          console.error("[tostatus-build]", e?.message || e);
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
          "📌 *Personal Status Usage:*\n\n" +
            "• `.tostatus Hello world` — text\n" +
            "• Reply image/video/sticker + `.tostatus`\n" +
            "• Animated sticker → auto video status\n" +
            "• Static sticker → auto image status\n\n" +
            "Aliases: `.statuspost`  `.poststatus`"
        );
        return { __done: true, value: true };
      }

      await sock.sendMessage("status@broadcast", content);
      await send("✅ Status posted successfully.");
    } catch (e) {
      console.error("[tostatus]", e?.message || e);
      await send("❌ Failed to post Status.\n" + (e?.message || "Unknown error"));
    }
    return { __done: true, value: true };
  }
};
