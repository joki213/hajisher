// Joker plugin: video  — commands: video, ytmp4
// (extracted from routes/pairing.js line 9357; behaviour unchanged)
import yts from "yt-search";
import { fetchYtVideoBuffer, getYtMeta, isYtUrl, sendMedia, shortErr } from "../core/helpers.js";

export default {
  name: "video",
  aliases: ["video","ytmp4"],
  order: 9357,
  legacy: true, // falls through to later plugins unless run() returns { __done }
  match(__ctx) {
    const { cmd } = __ctx;
    return (["video", "ytmp4"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, jid, send, react } = __ctx;
    const list = [...args];
    let asDoc = false;
    if (/^(doc|document)$/i.test(list[list.length - 1] || "")) { asDoc = true; list.pop(); }
    const q = list.join(" ").trim();
    if (!q) {
      await send(`❌ Usage: .${cmd} <name or YouTube link> (add doc at the end for document)`);
      return { __done: true, value: (true) };
    }
    try {
      await react("⬇️");
      let url = q, title = "", channel = "", duration = "", views = "", ago = "", thumb = "";
      if (!isYtUrl(q)) {
        const r = await yts(q);
        if (!r?.videos?.length) throw new Error("No results found");
        const v = r.videos[0];
        url = v.url;
        title = v.title || "";
        channel = v.author?.name || "";
        duration = v.timestamp || "";
        views = v.views ? (typeof v.views.toLocaleString === "function" ? v.views.toLocaleString() : String(v.views)) : "";
        ago = v.ago || "";
        thumb = v.thumbnail || "";
      }
      // Link given: read real title / channel / duration from YouTube
      if (isYtUrl(q)) {
        const m = await getYtMeta(q).catch(() => null);
        if (m) {
          url = m.url || url;
          title = m.title || title;
          channel = m.channel || channel;
          duration = m.duration || duration;
          views = m.views || views;
          ago = m.ago || ago;
        }
      }
      // Download + check it is real media + make it WhatsApp-playable (H.264/AAC MP4)
      const data = await fetchYtVideoBuffer(url);
      const finalTitle = data.title || title || "Video";
      const qualityLine = data.quality ? `\n🎬 *Quality:* ${data.quality}` : "";
      const meta = [
        duration ? `⏱️ *Duration:* ${duration}` : "",
        views ? `👁️ *Views:* ${views}` : "",
        ago ? `📅 *Uploaded:* ${ago}` : "",
        channel ? `📺 *Channel:* ${channel}` : ""
      ].filter(Boolean).join("\n");
      const cap =
        `✅ *Video ready!*\n\n🎬 *${finalTitle}*${qualityLine}` +
        (meta ? `\n${meta}` : "") +
        `\n\n🃏 *Marten-XD*`;
      const safeName = `${String(finalTitle).replace(/[^\w\s-]/gi, "").trim().slice(0, 60) || "video"}.mp4`;
      await sendMedia(
        sock,
        jid,
        asDoc ? "document" : "video",
        null,
        {
          buffer: data.buf,
          ...(asDoc ? { mimetype: "video/mp4" } : {}),
          caption: cap,
          fileName: safeName
        },
        msg
      );
      await react("✅");
    } catch (e) {
      await react("❌");
      await send(`❌ Video failed: ${shortErr(e)}\nTry again later or another query.`);
    }
    return { __done: true, value: (true) };
  
  }
};
