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

export function build() {
  const html = read("index.html");
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"))
    .replace(/<script[^>]*><\/script>\n?/g, "").trim();
  const js = bundle("app.js").replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html lang="en">
<head>
<!-- Built by prompter/build-gas.mjs from index.html, css/ and js/. Don't edit by hand. -->
<meta charset="utf-8">
<meta name="rgn-host" content="gas">
<meta name="rgn-view" content="%%VIEW%%">
<meta name="rgn-exec" content="%%EXEC%%">
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
