// Marten-XD plugin: chatbot
import { commandPrivileged, readJson, sf, writeJson } from "../core/helpers.js";

export default {
  name: "chatbot",
  aliases: ["chatbot"],
  order: 9316,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (cmd === "chatbot");
  },
  async run(__ctx) {
    const { sock, msg, args, jid, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };
    const v = String(args[0] || "").toLowerCase();
    const cfg = readJson(sf(sock, "aichatbot.json"), {});
    if (v === "on") {
      cfg[jid] = true;
      writeJson(sf(sock, "aichatbot.json"), cfg);
      await send("✅ AI chatbot *ON* for this chat.");
      return { __done: true, value: true };
    }
    if (v === "off") {
      delete cfg[jid];
      writeJson(sf(sock, "aichatbot.json"), cfg);
      await send("✅ AI chatbot *OFF* for this chat.");
      return { __done: true, value: true };
    }
    await send(`🤖 Chatbot: *${cfg[jid] ? "ON" : "OFF"}*`);
    return { __done: true, value: true };
  }
};
