// Marten-XD plugin: welcome2 — image card welcome
import { isAdmin, isGroup, isPrivileged, readJson, sf, writeJson } from "../core/helpers.js";

export default {
  name: "welcome2",
  aliases: ["welcome2", "setwelcome2", "welcomecard"],
  order: 6004,
  legacy: true,
  match(__ctx) {
    return ["welcome2", "setwelcome2", "welcomecard"].includes(__ctx.cmd);
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, jid, send } = __ctx;
    if (!isGroup(jid)) { await send("❌ Group only."); return { __done: true, value: true }; }
    const meta = await sock.groupMetadata(jid).catch(() => null);
    const sender = msg.key.participant || msg.key.remoteJid;
    if (!isPrivileged(sock, msg) && !(meta && isAdmin(meta, sender))) {
      await send("❌ Admins only.");
      return { __done: true, value: true };
    }
    const cfgFile = sf(sock, "welcome2.json");
    const cfg = readJson(cfgFile, {});
    const sub = (args[0] || "").toLowerCase();

    if (cmd === "setwelcome2") {
      const text = args.join(" ").trim();
      if (!text) { await send("❌ Usage: .setwelcome2 Welcome {@user} to {group}!"); return { __done: true, value: true }; }
      cfg[jid] = { ...(typeof cfg[jid] === "object" ? cfg[jid] : {}), enabled: true, caption: text };
      writeJson(cfgFile, cfg);
      await send("✅ Welcome2 caption saved.");
      return { __done: true, value: true };
    }

    if (sub === "on" || sub === "enable" || sub === "1") {
      cfg[jid] = { ...(typeof cfg[jid] === "object" ? cfg[jid] : {}), enabled: true };
      writeJson(cfgFile, cfg);
      await send("✅ Welcome2 *ON*");
      return { __done: true, value: true };
    }
    if (sub === "off" || sub === "disable" || sub === "0") {
      if (cfg[jid] && typeof cfg[jid] === "object") cfg[jid].enabled = false;
      writeJson(cfgFile, cfg);
      await send("✅ Welcome2 *OFF*");
      return { __done: true, value: true };
    }
    if (sub === "test") {
      await send("⏳ Generating...");
      try {
        const { generateWelcomeCard, getProfileImageBuffer, jidNumber } = await import("../core/helpers.js");
        const pJid = sender;
        const pNum = jidNumber(pJid);
        const name = msg.pushName || pNum || "Member";
        const groupName = meta?.subject || "Group";
        const count = meta?.participants?.length || 0;
        const dp = await getProfileImageBuffer(sock, pJid);
        const card = await generateWelcomeCard({ dpBuffer: dp, userName: name, groupName, memberCount: count, mode: "welcome" });
        const caption = (typeof cfg[jid] === "object" && cfg[jid]?.caption) || `Welcome @${pNum} to *${groupName}*! 🎉`;
        await sock.sendMessage(jid, { image: card, caption, mentions: [pJid] });
      } catch (e) { await send(`❌ ${e.message || e}`); }
      return { __done: true, value: true };
    }
    const enabled = typeof cfg[jid] === "object" && cfg[jid]?.enabled;
    await send(`🖼️ Welcome2: *${enabled ? "ON" : "OFF"}*\n.welcome2 on|off|test`);
    return { __done: true, value: true };
  }
};
