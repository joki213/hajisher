// Joker plugin: link  — commands: link, glink, invite
// Sends group invite link with native Copy button
import { isGroup } from "../core/helpers.js";

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

export default {
  name: "link",
  aliases: ["link", "glink", "invite"],
  order: 7938,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["link", "glink", "invite"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, jid, msg, send } = __ctx;
    if (!isGroup(jid)) {
      await send("❌ Group only.");
      return { __done: true, value: true };
    }
    try {
      const code = await sock.groupInviteCode(jid);
      const url = `https://chat.whatsapp.com/${code}`;

      // Try interactive message with copy button
      try {
        await sock.sendMessage(
          jid,
          {
            text: `🔗 *Group Invite Link*\n\n${url}`,
            footer: "Marten-XD",
            nativeFlow: [
              { copy: url, text: "📋 COPY LINK" }
            ]
          },
          { quoted: msg, additionalNodes: [BIZ_NODE] }
        );
      } catch (e) {
        // Fallback plain text
        await send(`🔗 ${url}\n\n_Copy the link above_`);
      }
    } catch (e) {
      await send(`❌ Bot must be admin. ${e.message || ""}`);
    }
    return { __done: true, value: true };
  }
};
