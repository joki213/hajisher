// Joker plugin: song  — commands: song, ytmp3, music
// Always classic direct first-result download (botstyle1 style)
// Carousel / multi-result is now handled by .yt / .youtube
import {
  apiErr,
  fetchYtAudioBuffer,
  resolveYtQuery,
  sendAudioResult
} from "../core/helpers.js";

export default {
  name: "song",
  aliases: ["song", "ytmp3", "music"],
  order: 9339,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["song", "ytmp3", "music"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, jid, send, react } = __ctx;
    const list = [...args];
    let asDoc = false;
    if (/^(doc|document)$/i.test(list[list.length - 1] || "")) {
      asDoc = true;
      list.pop();
    }
    const q = list.join(" ").trim();
    if (!q) {
      await send(`❌ Usage: \`.${cmd} <name or YouTube link>\` (add \`doc\` at the end for document)`);
      return { __done: true, value: true };
    }

    // Classic direct download (always — no botstyle check)
    try {
      await react("⬇️");
      const { url, title } = await resolveYtQuery(q);
      // Download, verify it is real audio and convert to a clean MP3 (plays everywhere)
      const mp3 = await fetchYtAudioBuffer(url);
      if (asDoc) {
        await sock.sendMessage(jid, {
          document: mp3,
          mimetype: "audio/mpeg",
          fileName: `${String(title).replace(/[^\w\s-]/gi, "").slice(0, 60) || "song"}.mp3`
        }, { quoted: msg });
      } else {
        await sendAudioResult(sock, jid, msg, mp3, title);
      }
      await react("✅");
    } catch (e) {
      await react("❌");
      await send(`❌ ${apiErr(e)}`);
    }
    return { __done: true, value: true };
  }
};
