// Sound Sticker plugin
// Commands: .ssound  .ssticker
//
// Flow A (two-step, silent):
//   1. Reply to a sticker  with .ssound / .ssticker  → bot stays silent, waits
//   2. Reply to a voice/audio with .ssound / .ssticker → bot sends the sound sticker
//   (order can be reversed: audio first, then sticker)
//
// Flow B (one-step):
//   Put .ssound or .ssticker in a video caption → bot makes sound sticker from that video
//
// Audio part can be a voice note, a normal audio / song / mp3 file, or an audio document.
// Pack name & author = same as normal .s sticker command (STICKER_PACK_NAME / AUTHOR),
// also re-stamped on an existing sticker.
// After the sound sticker is sent (or fails) BOTH stored parts are deleted, so nothing mixes into the next one.
// Errors are short one-liners — never a full code / stack.
// No Pack|Author argument. No reactions. No text replies on step 1.

import { downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import { randomBytes } from "crypto";
import {
  getQuotedMsg,
  unwrapMessage,
  makeSticker,
  addStickerExif,
  bufferToVoice,
  shortErr,
  STICKER_PACK_NAME,
  STICKER_PACK_AUTHOR
} from "../core/helpers.js";
import { proto } from "../baileys/WAProto/index.js";
import { prepareWAMessageMedia, generateWAMessageFromContent } from "../baileys/lib/Utils/messages.js";

// Pending parts per chat + sender: { stickerBuf?, audioBuf?, ts }
const pending = new Map();
const PENDING_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_AUDIO_SECONDS = 60;      // longer audio is trimmed to this length

function pendKey(msg, jid) {
  const who = msg?.key?.participant || msg?.participant || (msg?.key?.fromMe ? "me" : jid);
  return `${jid}|${who}`;
}

function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - (v.ts || 0) > PENDING_TTL) pending.delete(k);
  }
}

function getPending(key) {
  purgeExpired();
  return pending.get(key) || null;
}

function setPending(key, part) {
  const cur = getPending(key) || { ts: Date.now() };
  Object.assign(cur, part, { ts: Date.now() });
  pending.set(key, cur);
}

/** Delete BOTH stored parts (sticker + audio) for this chat/sender. */
function clearPending(key) {
  const cur = pending.get(key);
  if (cur) {
    cur.stickerBuf = null;
    cur.audioBuf = null;
  }
  pending.delete(key);
}

/** Any audio (voice, mp3, m4a, ogg, wav, audio document, video) → small opus voice-note audio. */
async function toSoundAudio(buf) {
  const v = await bufferToVoice(buf, { maxSeconds: MAX_AUDIO_SECONDS, bitrate: "48k" });
  if (!v?.buf || v.buf.length < 100) throw new Error("No usable audio found");
  if (v.buf.length > 1.5 * 1024 * 1024) throw new Error("Audio is too large");
  return v.buf;
}

export default {
  name: "soundsticker",
  aliases: ["ssound", "ssticker", "sstickr"],
  order: 9160,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["ssound", "ssticker", "sstickr"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, jid, send } = __ctx;
    const key = pendKey(msg, jid);
    const dlOpts = { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage };

    // --- Flow B: command in video caption ---
    const ownMsg = msg?.message || {};
    const ownInner = unwrapMessage(ownMsg);
    const ownVid = ownInner.videoMessage || ownMsg.videoMessage;
    if (ownVid) {
      try {
        const dlTarget = { key: msg.key, message: { videoMessage: ownVid } };
        const visualBuf = await downloadMediaMessage(dlTarget, "buffer", {}, dlOpts);
        if (!visualBuf || visualBuf.length < 100) throw new Error("Video download failed");

        let audioBuf;
        try {
          audioBuf = await toSoundAudio(visualBuf);
        } catch {
          await send("❌ No usable audio found in this video.");
          return { __done: true, value: true };
        }

        const stickerBuf = await makeSticker(visualBuf, true, STICKER_PACK_NAME, STICKER_PACK_AUTHOR);
        await sendSoundSticker(sock, jid, msg, stickerBuf, audioBuf);
      } catch (e) {
        console.error("[ssound video]", e?.message || e);
        await send(`❌ Sound sticker failed: ${shortErr(e)}`);
      } finally {
        clearPending(key);
      }
      return { __done: true, value: true };
    }

    // --- Flow A: reply-based two-step ---
    const quoted = getQuotedMsg(msg);
    if (!quoted) {
      // No reply and not a video caption → ignore silently (no text, no react)
      return { __done: true, value: true };
    }

    const rawMsg = quoted.message || {};
    const inner = unwrapMessage(rawMsg);
    const stkMsg = inner.stickerMessage || rawMsg.stickerMessage;
    const audMsg = inner.audioMessage || rawMsg.audioMessage; // voice note OR normal audio / song
    const imgMsg = inner.imageMessage || rawMsg.imageMessage;
    const vidMsg = inner.videoMessage || rawMsg.videoMessage;
    const docMsg = inner.documentMessage || rawMsg.documentMessage;
    const docMime = String(docMsg?.mimetype || "").toLowerCase();
    const isAudioDoc = !!docMsg && (
      /^audio\//i.test(docMime) ||
      /\.(mp3|m4a|aac|ogg|opus|oga|wav|flac|amr|wma|mka)$/i.test(docMsg.fileName || "")
    );

    try {
      // Sticker or image/video → sticker part
      if (stkMsg || imgMsg || vidMsg) {
        const dlTarget = {
          key: quoted.key || msg.key,
          message: Object.keys(inner).length ? inner : rawMsg
        };
        const visualBuf = await downloadMediaMessage(dlTarget, "buffer", {}, dlOpts);
        if (!visualBuf || visualBuf.length < 50) throw new Error("Media download failed");

        let stickerBuf;
        if (stkMsg) {
          // Existing sticker: replace its pack name / author with the normal .s ones
          try { stickerBuf = addStickerExif(visualBuf, STICKER_PACK_NAME, STICKER_PACK_AUTHOR); }
          catch { stickerBuf = visualBuf; }
        } else {
          stickerBuf = await makeSticker(visualBuf, !!vidMsg, STICKER_PACK_NAME, STICKER_PACK_AUTHOR);
        }

        const pend = getPending(key);
        if (pend?.audioBuf) {
          // Second half ready → send, then wipe everything
          const audioBuf = pend.audioBuf;
          try { await sendSoundSticker(sock, jid, msg, stickerBuf, audioBuf); }
          finally { clearPending(key); }
        } else {
          // First half → silent wait
          setPending(key, { stickerBuf });
        }
        return { __done: true, value: true };
      }

      // Voice / audio / song / audio file → audio part
      if (audMsg || isAudioDoc) {
        const dlTarget = {
          key: quoted.key || msg.key,
          message: audMsg ? { audioMessage: audMsg } : { documentMessage: docMsg }
        };
        const rawAudio = await downloadMediaMessage(dlTarget, "buffer", {}, dlOpts);
        if (!rawAudio || rawAudio.length < 100) throw new Error("Audio download failed");
        const audioBuf = await toSoundAudio(rawAudio); // any format → small opus audio

        const pend = getPending(key);
        if (pend?.stickerBuf) {
          const stickerBuf = pend.stickerBuf;
          try { await sendSoundSticker(sock, jid, msg, stickerBuf, audioBuf); }
          finally { clearPending(key); }
        } else {
          setPending(key, { audioBuf });
        }
        return { __done: true, value: true };
      }

      // Replied to something else → silent
      return { __done: true, value: true };
    } catch (e) {
      console.error("[ssound]", e?.message || e);
      // Short one-line error only, and start fresh (nothing left over to mix into the next sticker)
      clearPending(key);
      await send(`❌ Sound sticker failed: ${shortErr(e)}`);
    }
    return { __done: true, value: true };
  }
};

async function sendSoundSticker(sock, jid, quotedMsg, stickerBuf, audioBuf) {
  const options = {
    logger: pino({ level: "silent" }),
    upload: sock.waUploadToServer
  };

  const stickerMedia = await prepareWAMessageMedia({ sticker: stickerBuf }, options);
  const sMsg = stickerMedia.stickerMessage;
  if (!sMsg) throw new Error("Failed to prepare sticker media");

  let audioMedia;
  try {
    audioMedia = await prepareWAMessageMedia(
      { audio: audioBuf, ptt: true, mimetype: "audio/ogg; codecs=opus" },
      options
    );
  } catch {
    audioMedia = await prepareWAMessageMedia({ audio: audioBuf, ptt: false }, options);
  }
  const aMsg = audioMedia.audioMessage;
  if (!aMsg) throw new Error("Failed to prepare audio media");

  const stickerWithSound = proto.Message.StickerMessage.create({
    url: sMsg.url,
    fileSha256: sMsg.fileSha256,
    fileEncSha256: sMsg.fileEncSha256,
    mediaKey: sMsg.mediaKey,
    mimetype: sMsg.mimetype || "image/webp",
    height: sMsg.height || 512,
    width: sMsg.width || 512,
    directPath: sMsg.directPath,
    fileLength: sMsg.fileLength,
    mediaKeyTimestamp: sMsg.mediaKeyTimestamp,
    isAnimated: true,
    stickerSentTs: Date.now(),
    audioMessage: {
      url: aMsg.url,
      mimetype: aMsg.mimetype || "audio/ogg; codecs=opus",
      fileSha256: aMsg.fileSha256,
      fileEncSha256: aMsg.fileEncSha256,
      fileLength: aMsg.fileLength,
      seconds: aMsg.seconds || 5,
      ptt: true,
      mediaKey: aMsg.mediaKey,
      directPath: aMsg.directPath,
      mediaKeyTimestamp: aMsg.mediaKeyTimestamp
    }
  });

  const payload = {
    stickerMessage: stickerWithSound,
    messageContextInfo: { messageSecret: randomBytes(32) }
  };

  const fullMsg = generateWAMessageFromContent(jid, payload, {
    userJid: sock.user?.id,
    quoted: quotedMsg
  });

  await sock.relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id });
}
