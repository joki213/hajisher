// Live Photo plugin
// Commands: .livepic  .photolive  .livephoto  .motionphoto  .motionpic
// Reply to an image or video → sends a REAL WhatsApp Live Photo
// (still image + paired motion video, shows the live/play icon in the corner).
// If WhatsApp rejects the paired message, falls back to a Motion Photo JPEG.

import { downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import sharp from "sharp";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  FFMPEG_PATH,
  execAsync,
  getQuotedMsg,
  shortErr,
  unwrapMessage
} from "../core/helpers.js";
import { proto } from "../baileys/WAProto/index.js";
import { prepareWAMessageMedia, generateWAMessageFromContent } from "../baileys/lib/Utils/messages.js";

function buildMotionPhotoXmp(videoLength) {
  // Minimal Google / Samsung compatible XMP for Motion Photo
  const xmp = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
    GCamera:MotionPhoto="1"
    GCamera:MotionPhotoVersion="1"
    GCamera:MotionPhotoPresentationTimestampUs="0"
    GCamera:MicroVideo="1"
    GCamera:MicroVideoVersion="1"
    GCamera:MicroVideoOffset="${videoLength}"
    GCamera:MicroVideoPresentationTimestampUs="0">
   <Container:Directory>
    <rdf:Seq>
     <rdf:li rdf:parseType="Resource">
      <Container:Item
       Item:Mime="image/jpeg"
       Item:Semantic="Primary"
       Item:Length="0"
       Item:Padding="0"/>
     </rdf:li>
     <rdf:li rdf:parseType="Resource">
      <Container:Item
       Item:Mime="video/mp4"
       Item:Semantic="MotionPhoto"
       Item:Length="${videoLength}"
       Item:Padding="0"/>
     </rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  return Buffer.from(xmp, "utf8");
}

function insertXmpIntoJpeg(jpegBuf, xmpBuf) {
  // Insert APP1 XMP segment after SOI (FFD8)
  if (jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) {
    throw new Error("Not a valid JPEG");
  }
  const header = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "utf8");
  const segmentData = Buffer.concat([header, xmpBuf]);
  const len = segmentData.length + 2;
  const app1 = Buffer.alloc(4 + segmentData.length);
  app1[0] = 0xff;
  app1[1] = 0xe1; // APP1
  app1[2] = (len >> 8) & 0xff;
  app1[3] = len & 0xff;
  segmentData.copy(app1, 4);

  // Place after SOI
  return Buffer.concat([jpegBuf.subarray(0, 2), app1, jpegBuf.subarray(2)]);
}

/** Parse "Duration" and "WxH" of a video file with ffmpeg (no ffprobe needed). */
async function probeVideo(file) {
  let info = "";
  try { await execAsync(`"${FFMPEG_PATH}" -hide_banner -i "${file}"`, { timeout: 20000 }); }
  catch (e) { info = String(e?.stderr || e?.message || ""); }
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  const sz = /Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(info);
  return {
    seconds: d ? Math.max(1, Math.round(Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]))) : 3,
    width: sz ? Number(sz[1]) : 720,
    height: sz ? Number(sz[2]) : 720
  };
}

/**
 * Send a REAL WhatsApp Live Photo: the still image (pairedMediaType = MOTION_PHOTO_PARENT) with its short video
 * attached as the associated child message (pairedMediaType = MOTION_PHOTO_CHILD). WhatsApp shows the
 * live/play icon in the corner and plays the motion when the photo is pressed.
 */
async function sendLivePhoto(sock, jid, quotedMsg, jpegBuf, mp4Buf, dims) {
  const options = { logger: pino({ level: "silent" }), upload: sock.waUploadToServer };
  const PM = proto.ContextInfo.PairedMediaType;

  let thumb;
  try { thumb = await sharp(jpegBuf).resize(100, 100, { fit: "inside" }).jpeg({ quality: 60 }).toBuffer(); } catch {}

  const imgPrep = await prepareWAMessageMedia({
    image: jpegBuf,
    mimetype: "image/jpeg",
    width: dims.width,
    height: dims.height,
    ...(thumb ? { jpegThumbnail: thumb } : {}),
    contextInfo: { pairedMediaType: PM.MOTION_PHOTO_PARENT }
  }, options);

  const vidPrep = await prepareWAMessageMedia({
    video: mp4Buf,
    mimetype: "video/mp4",
    width: dims.width,
    height: dims.height,
    seconds: dims.seconds,
    gifPlayback: false,
    ...(thumb ? { jpegThumbnail: thumb } : {}),
    motionPhotoPresentationOffsetMs: 0,
    contextInfo: { pairedMediaType: PM.MOTION_PHOTO_CHILD }
  }, options);

  if (!imgPrep.imageMessage || !vidPrep.videoMessage) throw new Error("Failed to prepare live photo");

  const content = {
    imageMessage: imgPrep.imageMessage,
    associatedChildMessage: { message: { videoMessage: vidPrep.videoMessage } },
    messageContextInfo: { messageSecret: randomBytes(32) }
  };
  const full = generateWAMessageFromContent(jid, content, {
    userJid: sock.user?.id,
    quoted: quotedMsg
  });
  await sock.relayMessage(jid, full.message, { messageId: full.key.id });
}

export default {
  name: "photolive",
  aliases: ["photolive", "livephoto", "motionphoto", "livepic", "motionpic"],
  order: 9165,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["photolive", "livephoto", "motionphoto", "livepic", "motionpic"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, jid, send, react } = __ctx;
    const quoted = getQuotedMsg(msg);
    const target = quoted || msg;
    const rawMsg = target?.message || {};
    const inner = unwrapMessage(rawMsg);

    const imgMsg = inner.imageMessage || rawMsg.imageMessage;
    const vidMsg = inner.videoMessage || rawMsg.videoMessage;
    const docMsg = inner.documentMessage || rawMsg.documentMessage;
    const docMime = String(docMsg?.mimetype || "").toLowerCase();

    const hasImg = !!imgMsg;
    const hasVid = !!vidMsg;
    const hasDocMedia = !!(
      docMsg &&
      (/image\//i.test(docMime) ||
        /video\//i.test(docMime) ||
        /\.(gif|png|jpe?g|webp|mp4|webm|mov)$/i.test(docMsg.fileName || ""))
    );

    if (!hasImg && !hasVid && !hasDocMedia) {
      await send(
        "Live Photo\n\n" +
        "Reply to an *image* or *video* with `.livepic`\n\n" +
        "Creates a real WhatsApp Live Photo (photo + short motion) with the play icon."
      );
      return { __done: true, value: true };
    }

    const tmpDir = os.tmpdir();
    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const inFile = path.join(tmpDir, `lp_in_${id}`);
    const stillJpg = path.join(tmpDir, `lp_still_${id}.jpg`);
    const shortMp4 = path.join(tmpDir, `lp_vid_${id}.mp4`);
    const outMotion = path.join(tmpDir, `lp_motion_${id}.jpg`);

    try {
      await react("📸");

      const dlTarget = {
        key: target.key || msg.key,
        message: Object.keys(inner).length ? inner : rawMsg
      };
      const buf = await downloadMediaMessage(dlTarget, "buffer", {}, {
        logger: pino({ level: "silent" }),
        reuploadRequest: sock.updateMediaMessage
      });
      if (!buf || buf.length < 100) throw new Error("Media download failed");

      const isVideo = hasVid || /video\//i.test(docMime) || /\.(mp4|webm|mov|gif)$/i.test(docMsg?.fileName || "");
      const inputPath = inFile + (isVideo ? ".mp4" : ".jpg");
      fs.writeFileSync(inputPath, buf);

      const MAX_SIDE = 720;
      if (isVideo) {
        // Motion = first 3 seconds (even dimensions, H.264/AAC), still = first frame of that same clip
        await execAsync(
          `"${FFMPEG_PATH}" -y -i "${inputPath}" -t 3 -vf "scale='if(gt(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_SIDE},ih))',format=yuv420p" ` +
          `-c:v libx264 -preset veryfast -crf 24 -c:a aac -b:a 96k -movflags +faststart "${shortMp4}"`,
          { timeout: 90000, maxBuffer: 10 * 1024 * 1024 }
        );
        await execAsync(
          `"${FFMPEG_PATH}" -y -i "${shortMp4}" -frames:v 1 -q:v 2 "${stillJpg}"`,
          { timeout: 30000 }
        );
      } else {
        // Photo: still = the photo itself, motion = gentle 2.5s zoom with the same size / shape
        const meta = await sharp(buf).rotate().metadata();
        const iw = meta.width || 720, ih = meta.height || 720;
        const k = MAX_SIDE / Math.max(iw, ih);
        const W = Math.max(2, Math.round((iw * k) / 2) * 2);
        const H = Math.max(2, Math.round((ih * k) / 2) * 2);
        await sharp(buf).rotate().resize(W, H, { fit: "fill" }).jpeg({ quality: 92 }).toFile(stillJpg);
        await execAsync(
          `"${FFMPEG_PATH}" -y -loop 1 -framerate 30 -i "${stillJpg}" -t 2.5 ` +
          `-vf "scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0015,1.12)':d=75:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,format=yuv420p" ` +
          `-c:v libx264 -preset veryfast -crf 22 -an -movflags +faststart "${shortMp4}"`,
          { timeout: 90000, maxBuffer: 10 * 1024 * 1024 }
        );
      }

      if (!fs.existsSync(stillJpg) || !fs.existsSync(shortMp4)) {
        throw new Error("Could not create the live photo");
      }

      const jpegBuf = fs.readFileSync(stillJpg);
      const videoBuf = fs.readFileSync(shortMp4);
      const dims = await probeVideo(shortMp4);

      try {
        // Real WhatsApp Live Photo (photo + paired motion video)
        await sendLivePhoto(sock, jid, msg, jpegBuf, videoBuf, dims);
      } catch (liveErr) {
        console.warn("[livepic] live photo send failed, using motion-photo file:", shortErr(liveErr));
        // Fallback: Google-style Motion Photo JPEG (still + embedded video)
        const xmp = buildMotionPhotoXmp(videoBuf.length);
        const motionBuf = Buffer.concat([insertXmpIntoJpeg(jpegBuf, xmp), videoBuf]);
        fs.writeFileSync(outMotion, motionBuf);
        await sock.sendMessage(jid, { image: motionBuf, mimetype: "image/jpeg", caption: "" }, { quoted: msg });
      }

      await react("✅");
    } catch (e) {
      console.error("[livepic]", e?.message || e);
      await react("❌");
      await send(`❌ Live photo failed: ${shortErr(e)}`);
    } finally {
      for (const f of [inFile + ".jpg", inFile + ".mp4", stillJpg, shortMp4, outMotion]) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
    }
    return { __done: true, value: true };
  }
};
