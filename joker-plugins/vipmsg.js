// Marten-XD: vipmsg / vipmsgtag — random amount Payment Request
// .vipmsg <groupJid> <message>
// .vipmsgtag <groupJid> <message>   ← hidden tag + payment request

import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import { commandPrivileged, isGroup } from "../core/helpers.js";

function randomAmount() {
  // Random amount every time (US$12 – US$999)
  return Math.floor(Math.random() * 988) + 12;
}

function parseTargetJid(raw) {
  if (!raw) return null;
  let j = String(raw).trim();
  if (j.includes("@g.us") || j.includes("@s.whatsapp.net")) return j;
  const digits = j.replace(/\D/g, "");
  if (digits.length >= 15) return `${digits}@g.us`;
  if (digits.length >= 8 && digits.length <= 15) return `${digits}@s.whatsapp.net`;
  return j;
}

function buildPaymentProto(noteText, amount, mentions = null) {
  const amount1000 = String(amount * 1000);

  const noteMessage = {
    extendedTextMessage: {
      text: noteText || "‎"
    }
  };

  if (mentions && mentions.length) {
    noteMessage.extendedTextMessage.contextInfo = {
      mentionedJid: mentions
    };
  }

  // Exact structure from real CRM of the payment card
  return {
    requestPaymentMessage: {
      currencyCodeIso4217: "USD",
      amount1000: amount1000,
      requestFrom: "0@s.whatsapp.net",
      noteMessage,
      expiryTimestamp: "0",
      amount: {
        value: amount1000,
        offset: 1000,
        currencyCode: "USD"
      }
    }
  };
}

export default {
  name: "vipmsg",
  aliases: ["vipmsg", "vipmsgtag"],
  order: 6450,
  legacy: true,

  match(__ctx) {
    return ["vipmsg", "vipmsgtag"].includes(__ctx.cmd);
  },

  async run(__ctx) {
    const { sock, msg, cmd, args, send } = __ctx;

    if (!commandPrivileged(sock, msg, send)) {
      return { __done: true, value: true };
    }

    if (args.length < 2) {
      await send(
`💳 *VIPMSG Usage*

.vipmsg <groupJid> <message>
.vipmsgtag <groupJid> <message>

Examples:
.vipmsg 1203630xxxxx@g.us Hello VIP
.vipmsgtag 1203630xxxxx@g.us Special offer

Amount is random every time (USD).`
      );
      return { __done: true, value: true };
    }

    const targetJid = parseTargetJid(args[0]);
    const noteText = args.slice(1).join(" ").trim() || "‎";
    const isTag = cmd === "vipmsgtag";
    const amount = randomAmount();

    if (!targetJid) {
      await send("❌ Invalid group/user JID.");
      return { __done: true, value: true };
    }

    try {
      let mentions = null;

      if (isTag) {
        if (!isGroup(targetJid)) {
          await send("❌ .vipmsgtag only works on groups.");
          return { __done: true, value: true };
        }
        const meta = await sock.groupMetadata(targetJid);
        mentions = meta.participants.map((p) => p.id);
      }

      const content = buildPaymentProto(noteText, amount, mentions);

      // Use generateWAMessageFromContent + relayMessage
      // (direct sendMessage causes "Invalid media type" on this Baileys build)
      const waMsg = generateWAMessageFromContent(targetJid, content, {
        userJid: sock.user?.id
      });

      await sock.relayMessage(targetJid, waMsg.message, {
        messageId: waMsg.key.id
      });

      await send(
        `✅ *VIPMSG sent*\n` +
        `Target: ${targetJid}\n` +
        `Amount: US$${amount}\n` +
        `Type: ${isTag ? "Hidden Tag + Payment" : "Payment only"}`
      );
    } catch (e) {
      console.error("[vipmsg]", e);
      await send(`❌ Failed: ${e.message || e}`);
    }

    return { __done: true, value: true };
  }
};
