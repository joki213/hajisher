// Joker plugin: htmode  — commands: htmode, hidetagmode
// Pure edit only (send mode removed - use .tag for that)
import { commandPrivileged } from "../core/helpers.js";

export default {
  name: "htmode",
  aliases: ["htmode","hidetagmode"],
  order: 7929,
  legacy: true,
  match(__ctx) {
    const { cmd } = __ctx;
    return (["htmode", "hidetagmode"].includes(cmd));
  },
  async run(__ctx) {
    const { sock, msg, prefix, send } = __ctx;
    if (!commandPrivileged(sock, msg, send)) return { __done: true, value: (true) };
    await send(`🙈 *HIDETAG MODE*: *edit*\n\nEdit mode is always active.\nThe command message itself is edited with the text + mentions.\nNo empty/ghost message is sent.\n\nTo send a new message instead (send style), use \`.tag\`.`);
    return { __done: true, value: (true) };
  }
};
