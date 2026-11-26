// Marten-XD plugin: alive2
import { formatUptime, getMode, getPrefix, readJson, sf } from "../core/helpers.js";
import os from "os";

export default {
  name: "alive2",
  aliases: ["alive2","status2","a2"],
  order: 7566,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (["alive2", "status2", "a2"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, send } = __ctx;
    const up = formatUptime(process.uptime() * 1000);
    const mode = getMode(sock);
    const botName = readJson(sf(sock, "bot-name.json"), { name: "" }).name || sock.user?.name || "Marten-XD";
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const load = os.loadavg()[0].toFixed(2);
    await send(
`*🃏 ${botName} Live Status*

✦ Status   : Online ✅
✦ Uptime   : ${up}
✦ Mode     : ${mode}
✦ Prefix   : ${getPrefix(sock) === "" ? "none" : getPrefix(sock)}
✦ RAM      : ${rss} MB
✦ Load     : ${load}
✦ Version  : v3.2.6`
    );
    return { __done: true, value: true };
  }
};
