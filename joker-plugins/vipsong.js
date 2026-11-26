// Marten-XD: .vipsong <name or YouTube link>
// One message: real WhatsApp audio + a song card on top (thumbnail, title, channel).
import yts from "yt-search";
import axios from "axios";
import {
  resolveYtQuery,
  fetchYtAudioBuffer,
  getYtMeta,
  keithSearchYts,
  isYtUrl,
  cleanErr,
  apiErr
} from "../core/helpers.js";

// Console-safe error text: no URLs, no provider names.
function safe(e) {
  return cleanErr(e).replace(/https?:\/\/\S+/gi, "[link]");
}

async function getThumbBuffer(url) {
  if (!url) return null;
  try {
    const r = await axios.get(url, { responseType: "arraybuffer", timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    const b = Buffer.from(r.data);
    return b.length > 1000 ? b : null;
  } catch {
    return null;
  }
}

export default {
  name: "vipsong",
  aliases: ["vipsong"],
  order: 1222,
  async run(ctx) {
    const { sock, msg, jid, args, send, react } = ctx;
    const q = args.join(" ").trim();
    if (!q) {
      await send("🎵 *VIP Song*\n\n`.vipsong <song name>`\n`.vipsong <youtube link>`\n\n_One message: audio + song card._");
      return true;
    }
    try {
      if (react) await react("🎵");

      // 1) metadata
      let info = { title: "Track", channel: "YouTube", duration: "", thumb: "", url: q };
      if (!isYtUrl(q)) {
        try {
          const r = await yts(q);
          if (r?.videos?.length) {
            const v = r.videos[0];
            info = { title: v.title || "Track", channel: v.author?.name || "YouTube", duration: v.timestamp || "", thumb: v.thumbnail || "", url: v.url };
          } else {
            const s = await keithSearchYts(q);
            info = { ...info, title: s.title || "Track", duration: s.duration || "", thumb: s.thumbnail || "", url: s.videoUrl };
          }
        } catch {
          const rs = await resolveYtQuery(q);
          info.title = rs.title; info.url = rs.url;
        }
      } else {
        const rs = await resolveYtQuery(q);
        info.title = rs.title || "Track"; info.url = rs.url;
        const m = await getYtMeta(q).catch(() => null);
        if (m) {
          info.title = m.title || info.title;
          info.channel = m.channel || info.channel;
          info.duration = m.duration || info.duration;
          info.thumb = m.thumb || info.thumb;
        }
      }

      // 2) real MP3 (downloaded, verified and converted) + thumbnail
      const [buf, thumbBuf] = await Promise.all([fetchYtAudioBuffer(info.url), getThumbBuffer(info.thumb)]);
      const fileName = `${String(info.title).replace(/[^\w\s-]/gi, "").slice(0, 50) || "vipsong"}.mp3`;
      const link = String(info.url).startsWith("http") ? info.url : "https://youtube.com";

      const adReply = {
        title: `🎵 ${String(info.title).slice(0, 90)}`,
        body: `${info.channel}${info.duration ? " • " + info.duration : ""} • VIP SONG`,
        mediaType: 1,
        url: link,
        renderLargerThumbnail: true,
        showAdAttribution: false,
        ...(thumbBuf ? { thumbnail: thumbBuf } : {})
      };

      const attempts = [
        ["audio+card", () => sock.sendMessage(jid, { audio: buf, mimetype: "audio/mpeg", fileName, ptt: false, contextInfo: { externalAdReply: adReply } }, { quoted: msg })],
        ["audio", () => sock.sendMessage(jid, { audio: buf, mimetype: "audio/mpeg", fileName, ptt: false }, { quoted: msg })],
        ["document", () => sock.sendMessage(jid, { document: buf, mimetype: "audio/mpeg", fileName }, { quoted: msg })]
      ];

      let sent = false;
      for (const [label, fn] of attempts) {
        try {
          await fn();
          sent = true;
          break;
        } catch (e) {
          console.error(`[vipsong] send (${label}) failed:`, safe(e));
        }
      }
      if (!sent) throw Object.assign(new Error("send failed"), { sendFailed: true });
      if (react) await react("✅");
    } catch (e) {
      console.error("[vipsong] failed:", safe(e));
      if (react) await react("❌");
      await send(e?.sendFailed ? "❌ Could not send the audio. Please try again." : `❌ ${apiErr(e)}`);
    }
    return true;
  }
};
