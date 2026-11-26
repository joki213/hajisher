// Marten-XD: .chsong <channel jid> <song name or link>
// Link: YouTube / Facebook / Instagram / TikTok. A plain name is searched on YouTube.
// The audio is converted to a voice note and posted to the channel.
import { apiErr, bufferToVoice, commandPrivileged } from "../core/helpers.js";
import { CH_POST_ERROR, fetchAudioBuffer, resolveChannelTarget } from "./_chlib.js";

export default {
  name: "chsong",
  aliases: ["chsong"],
  order: 5902,
  async run(ctx) {
    const { sock, msg, prefix, args, send, react } = ctx;
    if (!commandPrivileged(sock, msg, send)) return true;
    const p = prefix || ".";
    const query = args.slice(1).join(" ").trim();
    if (!args[0] || !query) {
      await send(
        `🎵 *Channel Song*\n\n*${p}chsong <channel jid> <song name or link>*\n\n` +
        `• Link: YouTube, Facebook, Instagram or TikTok\n` +
        `• A name is searched on YouTube\n` +
        `• Posted to the channel as a voice note`
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
      const { buf } = await fetchAudioBuffer(query);
      let content;
      try {
        const v = await bufferToVoice(buf);
        content = { audio: v.buf, mimetype: v.mimetype, ptt: true };
      } catch {
        content = { audio: buf, mimetype: "audio/mpeg", ptt: true };
      }
      try {
        await sock.sendMessage(chJid, content);
      } catch {
        console.error("[chsong] post failed");
        await react("❌");
        await send(CH_POST_ERROR);
        return true;
      }
      await react("✅");
      await send(`✅ Song posted to channel as a voice note\n${chJid}`);
    } catch (e) {
      console.error("[chsong] failed");
      await react("❌");
      await send(`❌ ${apiErr(e)}`);
    }
    return true;
  }
};
