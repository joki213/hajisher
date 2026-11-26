// Joker plugin: antilink  — commands: antilink
// (extracted from routes/pairing.js line 8009; + remote jid support)
import { commandPrivileged, isAdmin, isBotAdmin, isGroup, readJson, sf } from "../core/helpers.js";

export default {
  name: "antilink",
  aliases: ["antilink"],
  order: 8009,
  legacy: true, // falls through to later plugins unless run() returns { __done }
  match(__ctx) {
    const { cmd } = __ctx;
    return (cmd === "antilink");
  },
  async run(__ctx) {
    const { sock, msg, args, jid, send } = __ctx;
    const { parseAntiMode, setAntiCfg, resolveGroupTarget } = __ctx.locals;

    const resolved = resolveGroupTarget(args);
    if (!resolved) {
      await send("❌ Group only.\n\nRemote: .antilink warn 120363xxxxxxxx@g.us");
      return { __done: true, value: (true) };
    }
    const { targetJid, restArgs } = resolved;

    // In-group: admin or privileged. Remote: privileged only.
    const isRemote = !(isGroup(jid) && targetJid === jid);
    if (isRemote) {
      if (!commandPrivileged(sock, msg, send)) return { __done: true, value: (true) };
    } else {
      if (!commandPrivileged(sock, msg, send) && !(await (async () => {
        try {
          const meta = await sock.groupMetadata(targetJid);
      // Bot must be admin for this command
      if (meta && !isBotAdmin(meta, sock) && !isPrivileged(sock, msg)) {
        await send("Make me admin First to execute this command");
        return { __done: true, value: true };
      }

          return isAdmin(meta, msg.key.participant || msg.key.remoteJid);
        } catch { return false; }
      })())) {
        await send("❌ Admins only.");
        return { __done: true, value: (true) };
      }
    }

    const v = parseAntiMode(restArgs);
    const cfg = readJson(sf(sock, "antilink.json"), {});
    if (!v) {
      await send(
        `🔗 *ANTILINK*\nCurrent: *${cfg[targetJid] || "off"}*\n\n` +
        `Usage:\n.antilink warn\n.antilink delete\n.antilink kick\n.antilink off\n\n` +
        `Remote:\n.antilink warn 120363xxxxxxxx@g.us`
      );
      return { __done: true, value: (true) };
    }
    const nv = setAntiCfg(sf(sock, "antilink.json"), targetJid, v);
    const where = isRemote ? targetJid : "this group";
    await send(`🔗 *ANTILINK*\n✅ Switched to *${nv}*  (${where})`);
    return { __done: true, value: (true) };
  }
};
