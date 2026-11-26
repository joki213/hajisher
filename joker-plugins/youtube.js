// Joker plugin: youtube / yt  — carousel search results (old botstyle2 song style)
// Usage: .yt <query>          → default 5 results
//         .yt <amount> <query> → 1..30 results
// Buttons: AUDIO / VIDEO / AUDIO DOC / VIDEO DOC / VOICE / COPY LINK
import yts from "yt-search";
import axios from "axios";
import {
  apiErr
} from "../core/helpers.js";

function extractVideoId(urlOrId) {
  if (!urlOrId) return "";
  const s = String(urlOrId);
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return "";
}

function formatViews(v) {
  if (v == null) return "N/A";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

const thumbCache = new Map();
async function getThumbBuffer(url) {
  if (!url) return null;
  if (thumbCache.has(url)) return thumbCache.get(url);
  try {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const b = Buffer.from(r.data);
    if (b.length > 1000) {
      if (thumbCache.size > 100) thumbCache.delete(thumbCache.keys().next().value);
      thumbCache.set(url, b);
      return b;
    }
  } catch {}
  return null;
}

async function fetchThumb(v, vid) {
  const urls = [v.thumbnail, v.image, vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "", vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : ""].filter(Boolean);
  for (const u of urls) {
    const b = await getThumbBuffer(u);
    if (b) return b;
  }
  return null;
}

// WhatsApp only renders interactive/carousel messages when the stanza carries this <biz> node.
const BIZ_NODE = {
  tag: "biz",
  attrs: {},
  content: [
    {
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }]
    }
  ]
};

async function sendSongCarousel(sock, jid, msg, videos, query, limit) {
  const top = videos.slice(0, limit);
  const thumbs = await Promise.all(top.map((v) => fetchThumb(v, extractVideoId(v.videoId || v.url) || v.videoId || "")));

  const cards = [];
  top.forEach((v, i) => {
    const vid = extractVideoId(v.videoId || v.url) || v.videoId || "";
    if (!vid || !thumbs[i]) return;
    const title = String(v.title || "Unknown").slice(0, 80);
    const author = v.author?.name || v.author?.url || "Unknown";
    const duration = v.timestamp || v.duration?.timestamp || "N/A";
    const views = formatViews(v.views);
    const ago = v.ago || "N/A";

    cards.push({
      image: thumbs[i],
      title: title.slice(0, 60),
      caption:
        `🎤 *ARTIST:* ${author}\n` +
        `🎵 *TITLE:* ${title}\n` +
        `⏱️ *DURATION:* ${duration}\n` +
        `👁️ *VIEWS:* ${views}\n` +
        `📅 *PUBLISHED:* ${ago}\n` +
        `🔗 *LINK:* https://youtu.be/${vid}`,
      footer: "Marten-XD • yt",
      nativeFlow: [
        { id: `bs2_song_audio_${vid}`, text: "🎧 AUDIO" },
        { id: `bs2_song_video_${vid}`, text: "🎬 VIDEO" },
        { id: `bs2_song_adoc_${vid}`, text: "📄 AUDIO DOCUMENT" },
        { id: `bs2_song_vdoc_${vid}`, text: "📁 VIDEO DOCUMENT" },
        { id: `bs2_song_voice_${vid}`, text: "🎙️ VOICE NOTE" },
        { copy: `https://youtu.be/${vid}`, text: "📋 COPY LINK" }
      ]
    });
  });

  if (!cards.length) throw new Error("No cards built (thumbnails failed)");

  await sock.sendMessage(
    jid,
    {
      text: `🔎 *Results for:* ${query}\n_Showing ${cards.length} result(s) — swipe & tap a button_`,
      footer: "Marten-XD • .yt",
      cards
    },
    { quoted: msg, additionalNodes: [BIZ_NODE] }
  );
}

export default {
  name: "youtube",
  aliases: ["youtube", "yt", "yts"],
  order: 9340,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["youtube", "yt", "yts"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, jid, send, react } = __ctx;
    let list = [...args];
    let amount = 5; // default

    // Parse optional amount: .yt 10 query here
    if (list.length >= 2 && /^\d+$/.test(list[0])) {
      amount = Math.min(30, Math.max(1, parseInt(list[0], 10)));
      list = list.slice(1);
    }

    const q = list.join(" ").trim();
    if (!q) {
      await send(
        `❌ Usage:\n` +
        `• \`.yt <search>\` — default 5 results\n` +
        `• \`.yt <amount> <search>\` — 1 to 30 results\n\n` +
        `_Example: .yt 10 lo-fi beats_`
      );
      return { __done: true, value: true };
    }

    try {
      await react("🔎");
      const r = await yts(q);
      const videos = r?.videos || [];
      if (!videos.length) {
        await send("❌ No results found.");
        await react("❌");
        return { __done: true, value: true };
      }
      await sendSongCarousel(sock, jid, msg, videos, q, amount);
      await react("✅");
    } catch (e) {
      console.error("[yt/youtube]", e?.message || e);
      await react("❌");
      // Fallback to simple text list
      try {
        const r = await yts(q);
        const videos = (r?.videos || []).slice(0, amount);
        if (!videos.length) {
          await send("❌ No results found.");
          return { __done: true, value: true };
        }
        let t = `📽️ *YouTube Search*\n🔎 ${q}\n\n`;
        videos.forEach((v, i) => {
          t += `*${i + 1}.* ${v.title}\n📺 ${v.author?.name || ""}\n⏱ ${v.timestamp} | 👀 ${v.views?.toLocaleString?.() || v.views}\n🔗 ${v.url}\n\n`;
        });
        t += `_Use .song <name/link> for direct audio download_`;
        await send(t);
      } catch (e2) {
        await send(`❌ ${apiErr(e2)}`);
      }
    }
    return { __done: true, value: true };
  }
};
