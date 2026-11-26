// Marten-XD: .chvideo <channel jid> <video name or link>
// Link: YouTube / Facebook / Instagram / TikTok. A plain name is searched on YouTube.
import { apiErr, commandPrivileged } from "../core/helpers.js";
import { CH_POST_ERROR, fetchVideoBuffer, resolveChannelTarget } from "./_chlib.js";

export default {
  name: "chvideo",
  aliases: ["chvideo"],
  order: 5903,
  async run(ctx) {
    const { sock, msg, prefix, args, send, react } = ctx;
    if (!commandPrivileged(sock, msg, send)) return true;
    const p = prefix || ".";
    const query = args.slice(1).join(" ").trim();
    if (!args[0] || !query) {
      await send(
        `🎬 *Channel Video*\n\n*${p}chvideo <channel jid> <video name or link>*\n\n` +
        `• Link: YouTube, Facebook, Instagram or TikTok\n` +
        `• A name is searched on YouTube\n` +
        `• Posted to the channel as a video`
      );
      return true;
    }
    try {
      await react("⬇️");
      const chJid = await resolveChannelTarget(sock, args[0]);
      if (!chJid) {
        await react("❌");
        await send("❌ That is not a valid channel JID, link or invite code.");
        return true;
      }
      const { buf, title } = await fetchVideoBuffer(query);
      try {
        await sock.sendMessage(chJid, { video: buf, mimetype: "video/mp4", caption: title ? `🎬 ${title}` : "" });
      } catch {
        console.error("[chvideo] post failed");
        await react("❌");
        await send(CH_POST_ERROR);
        return true;
      }
      await react("✅");
      await send(`✅ Video posted to channel\n${chJid}`);
    } catch (e) {
      console.error("[chvideo] failed");
      await react("❌");
      await send(`❌ ${apiErr(e)}`);
    }
    return true;
  }
};
