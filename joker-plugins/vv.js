// Marten-XD plugin: vv — open view-once (media + text)
import { commandPrivileged, getQuotedMsg, isViewOncePayload, openViewOnce, messageCache, mcKey } from "../core/helpers.js";

export default {
  name: "vv",
  aliases: ["vv", "viewonce", "view"],
  order: 6332,
  legacy: true,
  match(__ctx) {
    return ["vv", "viewonce", "view"].includes(__ctx.cmd);
  },
  async run(__ctx) {
    const { sock, msg, jid, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };
    const quoted = getQuotedMsg(msg);
    if (!quoted) {
      await send("❌ Reply to a view-once message.");
      return { __done: true, value: true };
    }
    try {
      // 1) Prefer cache (antiviewonce may have already extracted)
      const qid = quoted.key?.id || quoted.message?.key?.id;
      let content = null;
      if (qid) {
        const cached = messageCache.get(mcKey(sock, qid));
        if (cached?.prebuilt) content = cached.prebuilt;
      }
      // 2) openViewOnce (media + text)
      if (!content) content = await openViewOnce(sock, quoted);
      // 3) Direct text extract if still missing
      if (!content) {
        const m = quoted.message || {};
        const inner =
          m.viewOnceMessageV2Extension?.message ||
          m.viewOnceMessageV2?.message ||
          m.viewOnceMessage?.message ||
          m.ephemeralMessage?.message ||
          m;
        const txt = inner?.conversation || inner?.extendedTextMessage?.text || "";
        if (txt) content = { text: txt };
      }
      if (!content) {
        await send("❌ Could not open that view-once.");
        return { __done: true, value: true };
      }
      await sock.sendMessage(jid, content, { quoted: msg });
    } catch (e) {
      await send(`❌ VV failed: ${e.message || e}`);
    }
    return { __done: true, value: true };
  }
};
