// Joker plugin: tvt  — send text as View Once
// Usage:
//   .tvt                 → reply to a text message → re-send it as view-once in same chat
//   .tvt <jid/number>    → reply to a text → send as view-once to that jid
//   .tvt <jid> <text>    → send custom text as view-once to jid (no reply needed)
// Aliases: tvt, toviewonetext, viewoncetext, votext

import { commandPrivileged, getQuotedMsg, jidNumber, privacyOwnerJid } from "../core/helpers.js";

function normalizeTarget(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // already a jid?
  if (s.includes("@")) return s;
  // strip non-digits
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits + "@s.whatsapp.net";
}

export default {
  name: "tvt",
  aliases: ["tvt", "toviewonetext", "viewoncetext", "votext"],
  order: 6350,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["tvt", "toviewonetext", "viewoncetext", "votext"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, jid, args, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };

    const quoted = getQuotedMsg(msg);

    // Resolve text to send
    let textToSend = "";
    let targetJid = jid; // default: same chat

    if (args.length >= 2) {
      // .tvt <jid> <text...>
      const maybeJid = normalizeTarget(args[0]);
      if (maybeJid) {
        targetJid = maybeJid;
        textToSend = args.slice(1).join(" ").trim();
      } else {
        textToSend = args.join(" ").trim();
      }
    } else if (args.length === 1) {
      // either .tvt <jid>  (with reply)  or  .tvt <text>
      const maybeJid = normalizeTarget(args[0]);
      if (maybeJid && quoted) {
        targetJid = maybeJid;
      } else {
        textToSend = args[0];
      }
    }

    // If still no text, try quoted message
    if (!textToSend && quoted) {
      const qm = quoted.message || {};
      textToSend =
        qm.conversation ||
        qm.extendedTextMessage?.text ||
        qm.imageMessage?.caption ||
        qm.videoMessage?.caption ||
        "";
    }

    if (!textToSend || !String(textToSend).trim()) {
      await send(
        "❌ Usage:\n" +
        "• Reply to any text → `.tvt` (sends as view-once here)\n" +
        "• Reply to text → `.tvt 923xxxxxxxxx` (sends view-once to that number)\n" +
        "• `.tvt 923xxxxxxxxx Hello secret` (send custom text as view-once)"
      );
      return { __done: true, value: true };
    }

    textToSend = String(textToSend).trim();

    try {
      // Force newest WhatsApp text view-once format (Nov 2026+)
      // 1st try: viewOnceMessageV2Extension + extendedTextMessage.viewOnce
      await sock.sendMessage(targetJid, {
        viewOnceMessageV2Extension: {
          message: {
            extendedTextMessage: {
              text: textToSend,
              viewOnce: true
            }
          }
        }
      });

      const where = targetJid === jid ? "this chat" : targetJid;
      await send(`✅ View-once text sent to ${where}`);
    } catch (e) {
      try {
        // 2nd try: viewOnceMessageV2
        await sock.sendMessage(targetJid, {
          viewOnceMessageV2: {
            message: {
              extendedTextMessage: {
                text: textToSend,
                viewOnce: true
              }
            }
          }
        });
        const where = targetJid === jid ? "this chat" : targetJid;
        await send(`✅ View-once text sent to ${where} (v2)`);
      } catch (e2) {
        try {
          // 3rd try: simple viewOnce flag (older Baileys)
          await sock.sendMessage(targetJid, {
            text: textToSend,
            viewOnce: true
          });
          const where = targetJid === jid ? "this chat" : targetJid;
          await send(`✅ View-once text sent to ${where} (simple)`);
        } catch (e3) {
          await send(`❌ Failed to send view-once text:\n${e3.message || e3}`);
        }
      }
    }

    return { __done: true, value: true };
  }
};
