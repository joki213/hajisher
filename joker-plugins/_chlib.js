// Shared helpers for the channel commands (.ftc / .fwd, .chsong, .chvideo).
// Files starting with "_" are not loaded as plugins.
import axios from "axios";
import yts from "yt-search";
import {
  AXIOS_DL,
  downloadUrlBuffer,
  fetchYtAudioBuffer,
  fetchYtVideoBuffer,
  isYtUrl,
  parseChannelInput,
  resolveChannelInfo,
  resolveFacebook,
  resolveInstagram
} from "../core/helpers.js";

export const CH_POST_ERROR =
  "❌ Could not post to that channel. Make sure this account is an owner/admin of the channel and the JID is correct.";

/** Turn a channel JID / invite link / invite code into a channel JID. */
export async function resolveChannelTarget(sock, raw) {
  const input = parseChannelInput(raw);
  if (input.jid) return input.jid;
  if (input.code) {
    const r = await resolveChannelInfo(sock, { code: input.code });
    if (r?.jid) return r.jid;
  }
  return "";
}

const isTikTok = (u) => /tiktok\.com/i.test(u);
const isInsta = (u) => /instagram\.com|instagr\.am/i.test(u);
const isFb = (u) => /facebook\.com|fb\.watch|fb\.com/i.test(u);
const isLink = (u) => /^https?:\/\//i.test(u);

async function tiktokVideoUrl(url) {
  const { data } = await axios.get(`https://api-faa.my.id/faa/tiktok?url=${encodeURIComponent(url)}`, AXIOS_DL);
  const r = data?.result;
  const v = r?.alternatives?.hd || r?.alternatives?.sd || r?.video || r?.play || r?.url;
  if (!data?.status || !v) throw new Error("source unavailable");
  return { url: v, title: r?.title || "" };
}

/** Direct video link for any supported platform link. */
async function platformVideoUrl(link) {
  if (isTikTok(link)) return tiktokVideoUrl(link);
  if (isInsta(link)) {
    const items = await resolveInstagram(link);
    const it = items.find((x) => x.type === "video") || items[0];
    if (!it?.url) throw new Error("source unavailable");
    return { url: it.url, title: "" };
  }
  if (isFb(link)) return { url: await resolveFacebook(link), title: "" };
  throw new Error("unsupported link");
}

/** Name -> first YouTube result URL. Links are returned as they are. */
async function toSource(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("empty query");
  if (isLink(q)) {
    if (isYtUrl(q)) return { platform: "yt", url: q };
    if (isTikTok(q) || isInsta(q) || isFb(q)) return { platform: "other", url: q };
    throw new Error("unsupported link");
  }
  const r = await yts(q);
  const v = r?.videos?.[0];
  if (!v) throw new Error("no results");
  return { platform: "yt", url: v.url, title: v.title || "" };
}

/** Audio (any container) as a Buffer, for turning into a voice note. */
export async function fetchAudioBuffer(query) {
  const src = await toSource(query);
  if (src.platform === "yt") {
    const buf = await fetchYtAudioBuffer(src.url);
    return { buf, title: src.title || "" };
  }
  const v = await platformVideoUrl(src.url); // video file; ffmpeg strips the video when making the voice note
  const buf = await downloadUrlBuffer(v.url, 120000);
  return { buf, title: v.title || "" };
}

/** Video (mp4) as a Buffer. */
export async function fetchVideoBuffer(query) {
  const src = await toSource(query);
  if (src.platform === "yt") {
    const d = await fetchYtVideoBuffer(src.url);
    return { buf: d.buf, title: d.title || src.title || "" };
  }
  const v = await platformVideoUrl(src.url);
  const buf = await downloadUrlBuffer(v.url, 180000);
  return { buf, title: v.title || "" };
}
