// Red Gold News prompter as a Google Apps Script web app.
// For school networks that block github.io: this runs on Google's servers,
// which fetch the prompter and this week's draft from GitHub, so the school
// filter never sees github.io. Paste this whole file into Code.gs of a new
// Apps Script project, then Deploy > New deployment > Web app.
// The prompter itself updates on its own: nothing to re-paste.

const REPO = "https://raw.githubusercontent.com/kh84949vnj-ui/redgold-news/main/prompter/";
const MODEL = REPO + "models/vosk-model-small-en-us-0.15.tar.gz";

function doGet(e) {
  const view = e && e.parameter && e.parameter.view === "talent" ? "talent" : "";
  const html = fetch_("gas/App.html").getContentText()
    .replace("%%VIEW%%", view)
    .replace("%%EXEC%%", ScriptApp.getService().getUrl());
  return HtmlService.createHtmlOutput(html)
    .setTitle("RGN Prompter")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, viewport-fit=cover")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called from the page.
function getDraft() { return fetch_("scripts/current.json").getContentText(); }
function getVosk() { return fetch_("vendor/vosk.js").getContentText(); }

function getModelSize() {
  const r = fetch_(MODEL, { headers: { Range: "bytes=0-0" } });
  const range = String(r.getHeaders()["Content-Range"] || r.getHeaders()["content-range"] || "");
  const total = Number(range.split("/")[1]);
  if (!total) throw new Error("Couldn't read the speech model size.");
  return total;
}

function getModelChunk(start, size) {
  const r = fetch_(MODEL, { headers: { Range: "bytes=" + start + "-" + (start + size - 1) } });
  return Utilities.base64Encode(r.getContent());
}

function fetch_(pathOrUrl, opts) {
  const url = /^https:/.test(pathOrUrl) ? pathOrUrl : REPO + pathOrUrl;
  const r = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opts || {}));
  const code = r.getResponseCode();
  if (code !== 200 && code !== 206) throw new Error("GitHub answered " + code + " for " + url);
  return r;
}
