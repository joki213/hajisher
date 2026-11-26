// Joker plugin: bs2handler — handles botstyle2 list / button / carousel responses
// Button IDs:
//   bs2_menu_<categoryId>          → send that category's commands
//   bs2_song_audio_<videoId>       → audio
//   bs2_song_video_<videoId>       → video
//   bs2_song_adoc_<videoId>        → audio as a document
//   bs2_song_vdoc_<videoId>        → video as a document
//   bs2_song_voice_<videoId>       → voice note
import yts from "yt-search";
import {
  getCategoryCommands,
  getBotStyle,
  apiErr,
  fetchYtAudioBuffer,
  fetchYtVideoBuffer,
  bufferToVoice,
  sendAudioResult,
  isYtUrl
} from "../core/helpers.js";

export default {
  name: "bs2handler",
  aliases: [],
  order: 50, // run early
  legacy: true,
  match(__ctx) {
    const t = String(__ctx.raw || __ctx.body || __ctx.cmd || "").trim();
    return t.startsWith("bs2_menu_") || t.startsWith("bs2_song_");
  },
  async run(__ctx) {
    const { sock, msg, jid, send, react } = __ctx;
    const id = String(__ctx.raw || __ctx.body || "").trim();

    // ---------- MENU CATEGORY ----------
    if (id.startsWith("bs2_menu_")) {
      const catId = id.replace("bs2_menu_", "").trim();
      const body = getCategoryCommands(msg, sock, catId);
      await send(body);
      return { __done: true, value: true };
    }

    // ---------- SONG / VIDEO BUTTONS ----------
    if (id.startsWith("bs2_song_")) {
      // bs2_song_audio_VIDEOID | bs2_song_video_VIDEOID | bs2_song_doc_VIDEOID
      const parts = id.split("_");
      // ["bs2","song","audio","VIDEOID"] or videoId may contain underscores rarely
      if (parts.length < 4) {
        await send("❌ Invalid button data.");
        return { __done: true, value: true };
      }
      const action = parts[2]; // audio | video | doc
      const videoId = parts.slice(3).join("_");
      if (!videoId || videoId.length < 6) {
        await send("❌ Invalid video id.");
        return { __done: true, value: true };
      }
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      try {
        await react("⬇️");

        const safeName = (t, fb) => String(t || fb).replace(/[^\w\s-]/gi, "").trim().slice(0, 60) || fb;
        const getTitle = async () => {
          try {
            const r = await yts({ videoId });
            return r?.title || "song";
          } catch {
            return "song";
          }
        };

        if (action === "audio" || action === "adoc" || action === "doc") {
          const title = await getTitle();
          const mp3 = await fetchYtAudioBuffer(url);
          if (action === "audio") {
            await sendAudioResult(sock, jid, msg, mp3, title);
          } else {
            await sock.sendMessage(jid, {
              document: mp3,
              mimetype: "audio/mpeg",
              fileName: `${safeName(title, "song")}.mp3`
            }, { quoted: msg });
          }
        } else if (action === "voice") {
          const mp3 = await fetchYtAudioBuffer(url);
          const v = await bufferToVoice(mp3);
          await sock.sendMessage(jid, { audio: v.buf, mimetype: v.mimetype, ptt: true }, { quoted: msg });
        } else if (action === "video" || action === "vdoc") {
          const data = await fetchYtVideoBuffer(url);
          const finalTitle = data.title || "Video";
          if (action === "video") {
            await sock.sendMessage(jid, {
              video: data.buf,
              mimetype: "video/mp4",
              caption: `✅ *${finalTitle}*\n\n🃏 *Marten-XD*`
            }, { quoted: msg });
          } else {
            await sock.sendMessage(jid, {
              document: data.buf,
              mimetype: "video/mp4",
              fileName: `${safeName(finalTitle, "video")}.mp4`
            }, { quoted: msg });
          }
        } else {
          await send("❌ Unknown action.");
          return { __done: true, value: true };
        }

        await react("✅");
      } catch (e) {
        await react("❌");
        await send(`❌ ${apiErr(e)}`);
      }
      return { __done: true, value: true };
    }

    return { __done: true, value: true };
  }
};
