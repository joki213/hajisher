// Joker plugin: rools  — commands: rools, rules, allanti
// (extracted from routes/pairing.js line 8858; behaviour unchanged + remote jid support)
import { commandPrivileged, isGroup, readJson, sf, writeJson } from "../core/helpers.js";

export default {
  name: "rools",
  aliases: ["rools","rules","allanti"],
  order: 8858,
  legacy: true, // falls through to later plugins unless run() returns { __done }
  match(__ctx) {
    const { cmd } = __ctx;
    return (["rools", "rules", "allanti"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, msg, args, jid, send } = __ctx;
    const { parseAntiMode, setAntiCfg, resolveGroupTarget } = __ctx.locals;

    // Support remote group control: .rools warn 120363...@g.us  (from DM or any chat)
    const resolved = resolveGroupTarget(args);
    if (!resolved) {
      await send("❌ Group only.\n\nRemote usage (from DM):\n.rools warn 120363xxxxxxxx@g.us\n.rools delete <groupjid>\n.rools off <groupjid>");
      return { __done: true, value: (true) };
    }
    const { targetJid, restArgs } = resolved;

    // Only owner / sudo / developer can control remote groups (or any group from outside)
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: (true) };

    const v = parseAntiMode(restArgs);
    if (!v) {
      await send(
        `Usage (in group):\n.rools warn | delete | kick | off\n\n` +
        `Remote (from DM / any chat):\n.rools warn 120363xxxxxxxx@g.us\n.rools delete <groupjid>\n.rools off <groupjid>`
      );
      return { __done: true, value: (true) };
    }

    const files = [
      "antilink.json",
      "antisticker.json",
      "antivoice.json",
      "antipicture.json",
      "antivideo.json",
      "antitext.json",
      "antitag.json",
      "agm.json",
      "antichannel.json"
    ].map(f => sf(sock, f));

    for (const f of files) setAntiCfg(f, targetJid, v);

    const agsFile = sf(sock, "antigroupstatus.json");
    const agsCfg = readJson(agsFile, {});
    agsCfg[targetJid] = { enabled: v !== "off", action: v === "off" ? "warn" : v };
    writeJson(agsFile, agsCfg);

    const where = isGroup(jid) && targetJid === jid ? "this group" : targetJid;
    await send(`✅ All anti tools → *${v}*  (${where})`);
    return { __done: true, value: (true) };
  }
};
