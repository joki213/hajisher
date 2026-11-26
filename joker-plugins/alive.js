// Marten-XD plugin: alive
import { formatUptime, getMode, getPrefix, readJson, sf } from "../core/helpers.js";

export default {
  name: "alive",
  aliases: ["alive","runtime","uptime","up","a"],
  order: 7565,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (["alive", "runtime", "uptime", "up", "a"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, send } = __ctx;
    const up = formatUptime(process.uptime() * 1000);
    const mode = getMode(sock);
    const botName = readJson(sf(sock, "bot-name.json"), { name: "" }).name || sock.user?.name || "Marten-XD";
    await send(
`*🃏 ${botName} v3.2.6 is Alive*

✦ Status   : Online ✅
✦ Uptime   : ${up}
✦ Mode     : ${mode}
✦ Prefix   : ${getPrefix(sock) === "" ? "none" : getPrefix(sock)}
✦ Version  : v3.2.6`
    );
    return { __done: true, value: true };
  }
};
