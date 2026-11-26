// Joker plugin: seeweb — .seeweb <link>
// Shows a website INSIDE the WhatsApp chat (view only). No upload, no download, no forms, no scripts.
// Works best on simple / static pages. Owner / Sudo only.
import { commandPrivileged, extractUrl, getQuotedMsg, getText } from "../core/helpers.js";
import { sendEmbeddedHtml } from "./_richgame.js";
import { renderPage } from "./_seeweb_lib.js";

const busy = new Set();

function normalizeInput(s) {
  let t = String(s || "").trim();
  if (!t) return "";
  const m = extractUrl(t);
  if (m) return m;
  const first = t.split(/\s+/)[0];
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([\/?#]\S*)?$/i.test(first)) return "https://" + first;
  return "";
}

export default {
  name: "seeweb",
  aliases: ["seeweb"],
  order: 6910,
  async run(ctx) {
    const { sock, msg, jid, body, prefix, send, react } = ctx;
    if (!commandPrivileged(sock, msg, send)) return true;

    let target = normalizeInput(String(body || "").replace(/^\S+[ \t]*/, ""));
    if (!target) {
      const q = getQuotedMsg(msg);
      if (q) target = normalizeInput(getText(q));
    }
    if (!target) {
      await send(`🌐 *SEEWEB*\n\nView a website inside WhatsApp (view only, uploads/downloads disabled).\n\n*${prefix}seeweb <link>*\nEx: ${prefix}seeweb example.com\n\n_Simple / static pages work best. JavaScript-heavy apps will not work._`);
      return true;
    }
    const key = `${jid}`;
    if (busy.has(key)) { await send("⏳ The previous page is still loading."); return true; }
    busy.add(key);
    try {
      await react("⏳");
      const page = await renderPage(target);
      await sendEmbeddedHtml({ sock, jid, html: page.html, title: page.host, buttonTitle: page.host });
      await react("✅");
      console.log(`[seeweb] ${page.host} → ${(page.bytes / 1024).toFixed(1)} KB ${page.note}`);
    } catch (e) {
      console.error("[seeweb]", e?.message || e);
      await react("❌");
      await send(`❌ *SEEWEB failed:* ${String(e?.message || e).slice(0, 200)}\n\n_This error can also appear if this WhatsApp version does not support embedded HTML._`);
    } finally {
      busy.delete(key);
    }
    return true;
  }
};
