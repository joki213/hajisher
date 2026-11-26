// Joker plugin: menu2 — always shows interactive (old botstyle2) menu
import { sendMenuStyle2, menuText } from "../core/helpers.js";

export default {
  name: "menu2",
  aliases: ["menu2", "m2"],
  order: 7539,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return ["menu2", "m2"].includes(cmd);
  },
  async run(__ctx) {
    const { sock, msg, send } = __ctx;
    try {
      await sendMenuStyle2(sock, msg, send);
    } catch (e) {
      console.error("[menu2]", e.message || e);
      await send(menuText(msg, sock));
    }
    return { __done: true, value: true };
  }
};
