// Joker plugin: botstyle  — commands: botstyle, botstyle1, botstyle2
// Still available but no longer required for song/yt carousel.
// .song = classic download
// .yt / .youtube = carousel results
// .menu2 = interactive menu
import { getBotStyle, setBotStyle, isPrivileged } from "../core/helpers.js";

export default {
  name: "botstyle",
  aliases: ["botstyle", "botstyle1", "botstyle2", "setstyle"],
  order: 120,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["botstyle", "botstyle1", "botstyle2", "setstyle"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, cmd, args, send } = __ctx;

    if (!isPrivileged(sock, msg)) {
      await send("❌ Only *owner / sudo / developer* can change bot style.");
      return { __done: true, value: true };
    }

    const current = getBotStyle(sock);
    let target = null;

    if (cmd === "botstyle1") target = 1;
    else if (cmd === "botstyle2") target = 2;
    else if (args[0]) {
      const a = String(args[0]).toLowerCase();
      if (a === "1" || a === "style1" || a === "classic" || a === "text") target = 1;
      else if (a === "2" || a === "style2" || a === "button" || a === "buttons") target = 2;
    }

    if (target === null) {
      await send(
        `🎨 *Bot Style*\n\n` +
        `Current: *botstyle${current}*\n\n` +
        `• \`.botstyle1\` — classic text + image menu\n` +
        `• \`.botstyle2\` — button / list style for .menu\n\n` +
        `*Note (v3.3.1):*\n` +
        `• \`.song\` always does direct download\n` +
        `• \`.yt / .youtube\` always shows carousel results\n` +
        `• \`.menu2\` always shows interactive menu\n` +
        `_Style switch is now optional._`
      );
      return { __done: true, value: true };
    }

    const applied = setBotStyle(sock, target);
    await send(
      `✅ Bot style set to *botstyle${applied}*\n\n` +
      (applied === 2
        ? `• \`.menu\` → category list buttons\n`
        : `• Classic text menu restored\n`) +
      `\n_Tip: Use \`.yt\` for carousel & \`.menu2\` for interactive menu anytime._`
    );
    return { __done: true, value: true };
  }
};
