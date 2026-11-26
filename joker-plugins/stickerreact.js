// Joker plugin: stickerreact — manage favorite stickers for reactions
// Commands:
//   .stickerreact on/off   (alias sr)
//   .addstickertoreact     (alias astr)  — reply to sticker
//   .liststickerreact      (alias lsr)
//   .delstickerreact       (alias dsr)   — reply to sticker
//   .stickerreact auto     — random react from list on messages (when enabled)
import fs from "fs";
import path from "path";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import {
  getQuotedMsg,
  shortErr,
  unwrapMessage,
  DATA_DIR,
  sf,
  readJson,
  writeJson,
  isPrivileged
} from "../core/helpers.js";

function getStickerReactFile(sock) {
  return sock ? sf(sock, "stickerreact.json") : path.join(DATA_DIR, "stickerreact.json");
}

function defaultConfig() {
  return {
    enabled: false,
    auto: false,
    stickers: [] // array of { id, webpBase64 or path, addedAt }
  };
}

function getConfig(sock) {
  const file = getStickerReactFile(sock);
  const c = readJson(file, {});
  return { ...defaultConfig(), ...c, stickers: Array.isArray(c.stickers) ? c.stickers : [] };
}

function saveConfig(cfg, sock) {
  writeJson(getStickerReactFile(sock), cfg);
}

export default {
  name: "stickerreact",
  aliases: ["stickerreact", "sr", "addstickertoreact", "astr", "liststickerreact", "lsr", "delstickerreact", "dsr"],
  order: 140,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["stickerreact", "sr", "addstickertoreact", "astr", "liststickerreact", "lsr", "delstickerreact", "dsr"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, jid, send, react } = __ctx;
    const cfg = getConfig(sock);
    const sub = (args[0] || "").toLowerCase();

    // .stickerreact on/off / auto
    if (cmd === "stickerreact" || cmd === "sr") {
      if (sub === "on") {
        cfg.enabled = true;
        saveConfig(cfg, sock);
        await send("✅ Sticker react *enabled*.");
        return { __done: true, value: true };
      }
      if (sub === "off") {
        cfg.enabled = false;
        cfg.auto = false;
        saveConfig(cfg, sock);
        await send("✅ Sticker react *disabled*.");
        return { __done: true, value: true };
      }
      if (sub === "auto") {
        if (!cfg.stickers.length) {
          await send("❌ Favorite sticker list is empty. Add stickers first with `.astr` (reply to a sticker).");
          return { __done: true, value: true };
        }
        cfg.auto = !cfg.auto;
        cfg.enabled = true;
        saveConfig(cfg, sock);
        await send(cfg.auto
          ? "✅ *Auto sticker react* ON — random favorite sticker will be used for reactions."
          : "✅ *Auto sticker react* OFF.");
        return { __done: true, value: true };
      }
      // status
      await send(
        `🎨 *Sticker React*\n\n` +
        `Status: ${cfg.enabled ? "✅ ON" : "❌ OFF"}\n` +
        `Auto: ${cfg.auto ? "✅ ON" : "❌ OFF"}\n` +
        `Stickers in list: *${cfg.stickers.length}*\n\n` +
        `• \`.sr on/off\` — enable/disable\n` +
        `• \`.sr auto\` — toggle random auto react\n` +
        `• \`.astr\` — reply to sticker to add\n` +
        `• \`.lsr\` — list stickers\n` +
        `• \`.dsr\` — reply to sticker to remove`
      );
      return { __done: true, value: true };
    }

    // .addstickertoreact / .astr
    if (cmd === "addstickertoreact" || cmd === "astr") {
      const quoted = getQuotedMsg(msg);
      const target = quoted || msg;
      const rawMsg = target?.message || {};
      const inner = unwrapMessage(rawMsg);
      const stkMsg = inner.stickerMessage || rawMsg.stickerMessage;
      if (!stkMsg) {
        await send("❌ Reply to a *sticker* with `.astr` to add it to the react list.");
        return { __done: true, value: true };
      }
      try {
        await react("⏳");
        const dlTarget = {
          key: target.key || msg.key,
          message: Object.keys(inner).length ? inner : rawMsg
        };
        const buf = await downloadMediaMessage(dlTarget, "buffer", {}, {
          logger: pino({ level: "silent" }),
          reuploadRequest: sock.updateMediaMessage
        });
        if (!buf || buf.length < 50) throw new Error("Empty sticker buffer");

        // Store as base64 (keep list small)
        const b64 = buf.toString("base64");
        const id = `stk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // Avoid duplicates by simple size+hash check (first 32 bytes)
        const sig = buf.slice(0, 32).toString("hex");
        if (cfg.stickers.some(s => s.sig === sig)) {
          await send("⚠️ This sticker is already in the list.");
          await react("⚠️");
          return { __done: true, value: true };
        }
        cfg.stickers.push({ id, sig, b64, addedAt: Date.now() });
        // Keep max 30 stickers
        if (cfg.stickers.length > 30) cfg.stickers = cfg.stickers.slice(-30);
        saveConfig(cfg, sock);
        await send(`✅ Sticker added to react list.\nTotal: *${cfg.stickers.length}*`);
        await react("✅");
      } catch (e) {
        console.error("[astr]", e?.message || e);
        await react("❌");
        await send(`❌ Failed to add sticker: ${shortErr(e)}`);
      }
      return { __done: true, value: true };
    }

    // .liststickerreact / .lsr
    if (cmd === "liststickerreact" || cmd === "lsr") {
      if (!cfg.stickers.length) {
        await send("📭 Favorite sticker list is *empty*.\nReply to a sticker with `.astr` to add.");
        return { __done: true, value: true };
      }
      await send(`📋 *Sticker React List*\nTotal: *${cfg.stickers.length}*\n\n_Sending stickers one by one..._`);
      for (let i = 0; i < cfg.stickers.length; i++) {
        try {
          const s = cfg.stickers[i];
          const buf = Buffer.from(s.b64, "base64");
          await sock.sendMessage(jid, {
            sticker: buf,
            caption: `#${i + 1}  id:${s.id.slice(-8)}`
          }, { quoted: msg });
        } catch (e) {
          console.error("[lsr]", e?.message || e);
        }
      }
      return { __done: true, value: true };
    }

    // .delstickerreact / .dsr
    if (cmd === "delstickerreact" || cmd === "dsr") {
      const quoted = getQuotedMsg(msg);
      const target = quoted || msg;
      const rawMsg = target?.message || {};
      const inner = unwrapMessage(rawMsg);
      const stkMsg = inner.stickerMessage || rawMsg.stickerMessage;
      if (!stkMsg) {
        await send("❌ Reply to a *sticker* (from the list) with `.dsr` to remove it.");
        return { __done: true, value: true };
      }
      try {
        await react("⏳");
        const dlTarget = {
          key: target.key || msg.key,
          message: Object.keys(inner).length ? inner : rawMsg
        };
        const buf = await downloadMediaMessage(dlTarget, "buffer", {}, {
          logger: pino({ level: "silent" }),
          reuploadRequest: sock.updateMediaMessage
        });
        if (!buf || buf.length < 50) throw new Error("Empty buffer");
        const sig = buf.slice(0, 32).toString("hex");
        const before = cfg.stickers.length;
        cfg.stickers = cfg.stickers.filter(s => s.sig !== sig);
        if (cfg.stickers.length === before) {
          await send("⚠️ This sticker was not found in the list.");
          await react("⚠️");
        } else {
          saveConfig(cfg, sock);
          await send(`✅ Sticker removed.\nRemaining: *${cfg.stickers.length}*`);
          await react("✅");
        }
      } catch (e) {
        await react("❌");
        await send(`❌ Failed: ${shortErr(e)}`);
      }
      return { __done: true, value: true };
    }

    return { __done: true, value: true };
  }
};
