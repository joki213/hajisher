// Marten-XD plugin: setbotname
import { commandPrivileged, sf, writeJson } from "../core/helpers.js";

export default {
  name: "setbotname",
  aliases: ["setbotname"],
  order: 6243,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (cmd === "setbotname");
  },
  async run(__ctx) {
    const { sock, msg, args, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: true };
    const name = args.join(" ").trim();
    if (!name) {
      await send("❌ Usage: .setbotname New Name");
      return { __done: true, value: true };
    }
    try {
      writeJson(sf(sock, "bot-name.json"), { name });
      await send(`✅ Bot name changed to *${name}*`);
    } catch (e) {
      await send(`❌ Failed: ${e.message || e}`);
    }
    return { __done: true, value: true };
  }
};
