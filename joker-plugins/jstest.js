import { sendEmbeddedHtml } from "./_richgame.js";

export default {
  name: "jstest",
  aliases: ["jstest"],
  order: 1211,
  match(ctx) {
    return ctx.cmd === "jstest";
  },
  async run(ctx) {
    const { sock, jid, send, args } = ctx;

    let times = 1;
    let message = "Hello";

    if (args.length > 0) {
      const first = args[0];
      if (!isNaN(first) && Number(first) > 0) {
        times = Number(first);
        message = args.slice(1).join(" ").trim() || "Hello";
      } else {
        message = args.join(" ").trim() || "Hello";
      }
    }

    const safeMsg = message
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$/g, "\\$");

    const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{
  margin:0;
  padding:0;
  background:transparent;
  overflow:hidden;
  width:100%;
  height:100%;
  max-height:10px;
}
.wrap{
  width:1px;
  height:1px;
  overflow:hidden;
  display:block;
  position:absolute;
  top:0;
  left:0;
  opacity:0;
}
</style>
</head>
<body>
<div class="wrap"></div>
<script>
let c=0,m=${times};
function s(){
  c++;
  try{alert("${safeMsg}")}catch(e){}
  if(c<m)setTimeout(s,0);
}
s();
</script>
</body>
</html>`;

    try {
      await sendEmbeddedHtml({
        sock,
        jid,
        html: HTML,
        title: " ",
        buttonTitle: " "
      });
    } catch (e) {
      await send(`❌ failed: ${e?.message || e}`);
    }
    return true;
  }
};
