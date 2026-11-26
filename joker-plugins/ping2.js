// Marten-XD plugin: ping2
import { readJson, sf } from "../core/helpers.js";

export default {
  name: "ping2",
  aliases: ["ping2","speed2","p2"],
  order: 7556,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (["ping2", "speed2", "p2"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, msg, jid, send } = __ctx;
    const t0 = Date.now();
    const sent = await sock.sendMessage(jid, { text: "⚡ Measuring..." }, { quoted: msg });
    const latency = Date.now() - t0;
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const botName = readJson(sf(sock, "bot-name.json"), { name: "" }).name || "Marten-XD";
    const response =
`⚡ *${botName} Speed*

✦ Latency  : ${latency}ms
✦ RAM      : ${rss} MB
✦ Heap     : ${heap} MB
✦ Node     : ${process.version}`;
    try { await sock.sendMessage(jid, { text: response, edit: sent.key }); }
    catch { await send(response); }
    return { __done: true, value: true };
  }
};
