// Builds the claude.ai copy of the prompter (for networks that block
// github.io). Usage: node build-claude.mjs <out-dir>
// The page differs only by a <meta name="rgn-host" content="claude"> tag:
// voice following uses claude.ai dictation instead of the on-device model,
// so the speech model and Vosk library are left out.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2];
if (!out) { console.error("usage: node build-claude.mjs <out-dir>"); process.exit(1); }

const html = fs.readFileSync(path.join(here, "index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"))
  .replace(/<script src="vendor\/vosk\.js"><\/script>\n?/, "");
const page = `<title>RGN Prompter</title>
<meta name="rgn-host" content="claude">
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="css/prompter.css">
${body.trim()}
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "js"), { recursive: true });
fs.mkdirSync(path.join(out, "css"), { recursive: true });
fs.mkdirSync(path.join(out, "scripts"), { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), page);
fs.copyFileSync(path.join(here, "css/prompter.css"), path.join(out, "css/prompter.css"));
fs.copyFileSync(path.join(here, "scripts/current.json"), path.join(out, "scripts/current.json"));
for (const f of fs.readdirSync(path.join(here, "js"))) fs.copyFileSync(path.join(here, "js", f), path.join(out, "js", f));
console.log("built", out);
