// Marten-XD: hidetagpremium — silent tag-all + clickable group name (groupMentions)
import { isAdmin, isGroup, isPrivileged } from "../core/helpers.js";

export default {
  name: "hidetagpremium",
  aliases: ["hidetagpremium", "hidetagpre", "htpre", "htp", "premiumhidetag"],
  order: 7919,
  legacy: true,
  match(__ctx) {
    return ["hidetagpremium", "hidetagpre", "htpre", "htp", "premiumhidetag"].includes(__ctx.cmd);
  },
  async run(__ctx) {
    const { sock, msg, body, jid, send } = __ctx;
    if (!isGroup(jid)) {
      await send("❌ Group only.");
      return { __done: true, value: true };
    }

    const meta = await sock.groupMetadata(jid).catch(() => null);
    if (!meta) {
      await send("❌ Could not load group.");
      return { __done: true, value: true };
    }

    const sender = msg.key.participant || msg.key.remoteJid;
    if (!isAdmin(meta, sender) && !isPrivileged(sock, msg)) {
      await send("❌ Admins only.");
      return { __done: true, value: true };
    }

    const members = (meta.participants || []).map((p) => p.id).filter(Boolean);
    const subject = meta.subject || "Group";
    const extraText = String(body || "").replace(/^\S+\s*/, "").trim() || "‎";

    // Delete command (best effort)
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}

    const groupMention = { groupJid: jid, groupSubject: subject };

    // WhatsApp renders clickable group name when text contains @<groupJid>
    // and contextInfo.groupMentions maps it to the subject.
    const payloads = [
      // Format A — full group jid in text (most reliable for clickable link)
      {
        text: `@${jid} ${extraText}`.trim(),
        mentions: members,
        contextInfo: {
          mentionedJid: members,
          groupMentions: [groupMention]
        }
      },
      // Format B — subject after @ with groupMentions only
      {
        text: `@${subject} ${extraText}`.trim(),
        mentions: members,
        contextInfo: {
          mentionedJid: members,
          groupMentions: [groupMention]
        }
      },
      // Format C — relay-style extendedTextMessage
      {
        extendedTextMessage: {
          text: `@${jid} ${extraText}`.trim(),
          contextInfo: {
            mentionedJid: members,
            groupMentions: [groupMention]
          }
        }
      }
    ];

    let lastErr = null;
    for (const content of payloads) {
      try {
        if (content.extendedTextMessage) {
          await sock.relayMessage(jid, content, { messageId: undefined });
        } else {
          await sock.sendMessage(jid, content);
        }
        return { __done: true, value: true };
      } catch (e) {
        lastErr = e;
      }
    }

    // Last fallback: normal hidetag text
    try {
      await sock.sendMessage(jid, { text: `${subject}\n${extraText}`, mentions: members });
    } catch (e) {
      await send(`❌ Hidetag premium failed: ${(lastErr || e).message || lastErr || e}`);
    }
    return { __done: true, value: true };
  }
};
