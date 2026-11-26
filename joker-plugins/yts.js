// Joker plugin: yts — now redirected to youtube.js (kept for compatibility)
// Actual logic lives in youtube.js (aliases include yts)
export default {
  name: "yts-legacy",
  aliases: [],
  order: 9999,
  legacy: true,
  match() { return false; },
  async run() { return { __done: false }; }
};
