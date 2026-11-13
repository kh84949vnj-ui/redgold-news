// Builds gas/App.html: the whole prompter as one HTML file for the Google
// Apps Script web app (gas/Code.gs fetches it from GitHub on each visit).
// Usage: node build-gas.mjs            writes gas/App.html
//        node build-gas.mjs --check    exits 1 if gas/App.html is out of date
// The JS modules are wrapped one per function and joined in import order;
// keep imports simple (`import { a, b } from "./x.js"`).
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(here, p), "utf8");

function bundle(entry) {
  const order = [], seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read("js/" + file).matchAll(/^import \{[^}]*\} from "\.\/([\w-]+\.js)";$/gm)) visit(m[1]);
    order.push(file);
  };
  visit(entry);
  const id = (f) => "__" + f.replace(/\W/g, "_");
  return order.map((file) => {
    let src = read("js/" + file);
    if (/^import (?!\{)/m.test(src) || /\bimport\(/.test(src)) throw new Error(file + ": unsupported import");
    src = src.replace(/^import \{([^}]*)\} from "\.\/([\w-]+\.js)";$/gm, (_, names, dep) => `const {${names}} = ${id(dep)};`);
    const names = [];
    src = src.replace(/^export (async function|function|class|const|let) (\w+)/gm, (_, kw, n) => { names.push(n); return `${kw} ${n}`; });
    if (/^export /m.test(src)) throw new Error(file + ": unsupported export");
    src = src.replace(/import\.meta\.url/g, "location.href");
    return `const ${id(file)} = (() => {\n${src}\nreturn { ${names.join(", ")} };\n})();`;
  }).join("\n\n");
}

// The page Google shows is only a launcher: Google's frame isn't allowed to
// use the microphone, but a window it opens is. The launcher opens the app
// in its own window and answers that window's calls to the Apps Script
// server. "Use it here" runs the app in Google's frame instead (no voice).
const LAUNCHER_JS = `(function () {
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ""; };
  var view = meta("rgn-view") === "talent" ? "talent" : "";
  var app = window.RGN_APP.replace("__VIEW__", view).replace("__EXEC__", meta("rgn-exec"));
  var msg = document.getElementById("launchMsg");
  document.getElementById("launchOpen").onclick = function () {
    var w = window.open(URL.createObjectURL(new Blob([app], { type: "text/html" })), "_blank");
    msg.textContent = w
      ? "The prompter is open in a new window or tab. Keep this tab open while you use it: it brings in the weekly draft."
      : "The browser blocked the new window. Allow pop-ups for this site, then press the button again.";
  };
  document.getElementById("launchHere").onclick = function () {
    var html = app.replace('name="rgn-host" content="gaswin"', 'name="rgn-host" content="gas"');
    document.open(); document.write(html); document.close();
  };
  var allowed = { getDraft: 1, getVosk: 1, getModelSize: 1, getModelChunk: 1 };
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || !m.rgnCall || e.origin !== location.origin || !e.source) return;
    var reply = function (ok, value) { e.source.postMessage({ rgnReply: m.id, ok: ok, value: value }, location.origin); };
    if (!allowed[m.fn]) { reply(false, "Unknown call"); return; }
    var run = google.script.run
      .withSuccessHandler(function (v) { reply(true, v); })
      .withFailureHandler(function (err) { reply(false, String((err && err.message) || err)); });
    run[m.fn].apply(run, m.args || []);
  });
})();`;

const LAUNCHER_CSS = `
  body { margin: 0; background: #0b0a09; color: #f3efe6; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .launch { max-width: 560px; margin: 0 auto; padding: 48px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px)); }
  .launch .brand { font-weight: 800; letter-spacing: .02em; }
  .launch .brand span { color: #e7b53c; }
  .launch h1 { font-size: 30px; line-height: 1.2; margin: 24px 0 8px; text-wrap: balance; }
  .launch p { color: #bdb6a8; margin: 0 0 20px; }
  .launch button { font: inherit; font-weight: 700; border-radius: 10px; padding: 14px 20px; cursor: pointer; }
  #launchOpen { background: #e7b53c; color: #1a1405; border: 0; font-size: 18px; }
  #launchHere { background: transparent; color: #f3efe6; border: 1px solid #4a443b; margin-top: 12px; }
  #launchMsg { color: #e7b53c; min-height: 1.5em; margin-top: 16px; }
  .launch small { display: block; color: #8d877b; margin-top: 28px; }
  button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
`;

function appPage() {
  const html = read("index.html");
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"))
    .replace(/<script[^>]*><\/script>\n?/g, "").trim();
  const js = bundle("app.js").replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>RGN Prompter</title>
<meta name="rgn-host" content="gaswin">
<meta name="rgn-view" content="__VIEW__">
<meta name="rgn-exec" content="__EXEC__">
<style>
${read("css/prompter.css").trim()}
</style>
</head>
<body>
${body}
<script>
"use strict";
${js}
</script>
</body>
</html>
`;
}

export function build() {
  // The app goes in as a JS string; "</" is escaped so it can't end the script.
  const app = JSON.stringify(appPage()).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
<!-- Built by prompter/build-gas.mjs from index.html, css/ and js/. Don't edit by hand. -->
<meta charset="utf-8">
<meta name="rgn-host" content="gas">
<meta name="rgn-view" content="%%VIEW%%">
<meta name="rgn-exec" content="%%EXEC%%">
<style>${LAUNCHER_CSS}</style>
</head>
<body>
<main class="launch">
  <div class="brand">RGN <span>Prompter</span></div>
  <h1>Red Gold News teleprompter</h1>
  <p>The prompter opens in its own window so it can use the microphone to follow your voice.</p>
  <button type="button" id="launchOpen">Open the prompter</button><br>
  <button type="button" id="launchHere">Use it here instead (no voice following)</button>
  <div id="launchMsg" role="status"></div>
  <small>Scripts and names you type stay on this device.</small>
</main>
<script>
window.RGN_APP = ${app};
${LAUNCHER_JS}
</script>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, "build-gas.mjs")) {
  const out = path.join(here, "gas/App.html");
  const html = build();
  if (process.argv.includes("--check")) {
    const ok = fs.existsSync(out) && fs.readFileSync(out, "utf8") === html;
    if (!ok) { console.error("gas/App.html is out of date: run node build-gas.mjs"); process.exit(1); }
  } else {
    fs.writeFileSync(out, html);
    console.log("wrote", out, Math.round(html.length / 1024) + " KB");
  }
}
