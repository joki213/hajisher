// Marten-XD plugin: setprefix
import { botNumberFromSock, getPrefix, isPrivileged, setPrefix } from "../core/helpers.js";

export default {
  name: "setprefix",
  aliases: ["setprefix","prefix","changeprefix"],
  order: 7175,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (["setprefix", "prefix", "changeprefix"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, msg, args, send } = __ctx;
    if (!isPrivileged(sock, msg)) {
      await send("❌ Owner/Sudo only.");
      return { __done: true, value: true };
    }

    if (!args[0]) {
      const cur = getPrefix(sock);
      await send(`*Current Prefix:* ${cur === "" ? "none" : cur}`);
      return { __done: true, value: true };
    }

    const input = args[0];
    if (input.toLowerCase() === "none") {
      setPrefix(sock, "");
      await send("✅ Prefix removed");
      return { __done: true, value: true };
    }

    setPrefix(sock, input);
    await send(`✅ Prefix changed to *${input}*`);
    return { __done: true, value: true };
  }
};
