// RGN Prompter app: wires speech -> aligner -> motion -> stage.
import { parseScript, speakPhrase } from "./text.js";
import { Aligner } from "./align.js";
import { Motion, Spring } from "./motion.js";
import { Stage } from "./render.js";
import { VoskEngine, WebSpeechEngine, DictationEngine, onClaude } from "./engines.js";
import { Editor } from "./editor.js";
import { deriveDoc, oneAnchor, fillNames } from "./segments.js";
import { boardPanel } from "./board-panel.js";
import { store } from "./store.js";
import { host, viaGoogle, gasCall } from "./host.js";

const $ = (id) => document.getElementById(id);
// Apps Script passes ?view= in a meta tag (the page runs in a Google frame).
const metaView = document.querySelector('meta[name="rgn-view"]');
const TALENT = new URLSearchParams(location.search).get("view") === "talent" || (metaView && metaView.content === "talent");
if (TALENT) document.body.classList.add("talent");
// iPads and phones can't drive a second screen, so Sidecar-only controls hide.
const TOUCH = /iPad|iPhone|Android/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (TOUCH) document.body.classList.add("touch");

// ------------------------------------------------------------------ settings
const DEFAULT_SETTINGS = { size: 56, width: 30, eye: 33, speed: 4, mirror: false, caps: false, dim: true,
  engine: "vosk", grammar: true, mic: "", notes: false };
let settings = { ...DEFAULT_SETTINGS, ...store.get("settings", {}) };
// Who's on air, kept on this device only (never published).
const getNames = () => ({ a1: "", a2: "", wx: "", mn: "", ...store.get("names", {}) });

// ------------------------------------------------------------------ state
const stageEl = $("stage");
const stage = new Stage(stageEl);
let editor = null;            // created below (operator page only)
let board = null;             // school board panel (News rundown)
let doc = null;               // "news" | "weather" | "menu" | "custom" (null on the start page)
let stageStale = false;       // editor changed since the stage was last built
const spring = new Spring(7);
let script = null, aligner = null;
const motion = new Motion();
let mode = "voice";          // "voice" | "manual"
let paused = false;          // Space toggles
let manualPos = 0;
let engine = null, listening = false;
let finals = [], partial = [], finalsTotal = 0, heardTotal = 0, lastWordsAt = -10, lastMoveAt = -10;
let levelAvg = 0, noiseFloor = 0.01, loudAt = -10;
let cueStarts = [];          // sorted token indexes that follow a cue card
const chan = "BroadcastChannel" in window ? new BroadcastChannel("rgn-prompter") : null;
let remotePos = 0;           // talent view: position from the operator
let lastShown = "";          // the text the stage is showing (names filled in)

// Exposed for testing and troubleshooting from the console.
window.RGN = { get pos() { return aligner ? aligner.pos : 0; }, get shown() { return motion.shown; }, log: [] };

// ------------------------------------------------------------------ settings UI
function applySettings() {
  const r = document.documentElement.style;
  r.setProperty("--size", settings.size + "px");
  r.setProperty("--width", settings.width + "ch");
  r.setProperty("--eye", settings.eye + "%");
  stageEl.classList.toggle("mirror", !!settings.mirror);
  stageEl.classList.toggle("caps", !!settings.caps);
  if (!TALENT) {
    $("setSize").value = settings.size; $("outSize").textContent = settings.size + "px";
    $("setWidth").value = settings.width; $("outWidth").textContent = settings.width + "ch";
    $("setEye").value = settings.eye; $("outEye").textContent = settings.eye + "%";
    $("setSpeed").value = settings.speed; $("outSpeed").textContent = settings.speed;
    $("speedLabel").textContent = "Speed " + settings.speed;
    $("setMirror").checked = !!settings.mirror;
    $("setCaps").checked = !!settings.caps;
    $("setDim").checked = !!settings.dim;
    $("setNotes").checked = !!settings.notes;
    $("setEngine").value = settings.engine;
    $("setGrammar").checked = !!settings.grammar;
    $("setGrammar").disabled = settings.engine !== "vosk";
  }
  if (!settings.dim) stage.dim(0, false);
  requestAnimationFrame(() => stage.layout());
}
function saveSettings() {
  store.set("settings", settings);
  applySettings();
  if (chan && !TALENT) chan.postMessage({ type: "settings", settings });
}

// ------------------------------------------------------------------ script
function loadScript(text, { keepPos = false, fromEditor = false } = {}) {
  if (editor && !fromEditor) editor.setText(text || "");
  stageStale = false;
  // The prompter shows real names and (unless asked) no notes; the saved
  // script keeps its placeholders.
  const shown = TALENT ? (text || "") : fillNames(text || "", getNames());
  lastShown = shown;
  script = parseScript(shown);
  aligner = new Aligner(script.tokens.map((t) => t.t));
  cueStarts = [...script.cueBefore].sort((a, b) => a - b);
  stage.render(script, { onWordClick: TALENT ? null : jumpToWord, hideNotes: !settings.notes });
  $("empty") && ($("empty").hidden = script.tokens.length > 0);
  const p = keepPos ? Math.min(motion.pos, script.tokens.length) : 0;
  aligner.setPosition(p, heardTotal);
  motion.jump(p, now());
  manualPos = p;
  spring.snap(targetOffset(p));
  if (!TALENT) {
    if (doc) store.set("script-" + doc, text);
    if (chan) chan.postMessage({ type: "script", text: shown });
  }
}

function cueLimit(pos) {
  for (const c of cueStarts) if (c >= pos) return c;
  return script ? script.tokens.length : Infinity;
}

function jumpToWord(wi) {
  const w = script.words[wi];
  if (!w) return;
  setPosition(w.tokenStart);
}

function setPosition(p) {
  p = Math.max(0, Math.min(script.tokens.length, p));
  aligner.setPosition(p, heardTotal);
  motion.jump(p, now());
  motion.setLimit(cueLimit(p));
  manualPos = p;
  lastMoveAt = now();
}

// ------------------------------------------------------------------ speech
function now() { return performance.now() / 1000; }

const handlers = {
  onMic() { window.RGN.micAt = now(); },
  onWords(text, isFinal) {
    const toks = speakPhrase(text, { acronyms: script ? script.acronyms : null });
    if (isFinal) {
      finals.push(...toks); finalsTotal += toks.length; partial = [];
      if (finals.length > 200) finals = finals.slice(-60);
    } else partial = toks;
    if (toks.length) lastWordsAt = now();
    heardTotal = finalsTotal + partial.length;
    const heard = finals.slice(-20).concat(partial);
    $("heard") && ($("heard").textContent = heard.slice(-14).join(" "));
    if (!script || mode !== "voice" || paused) return;
    const before = aligner.pos;
    const p = aligner.update(heard, heardTotal);
    if (p !== before) {
      const t = now();
      motion.confirm(p, t);
      motion.setLimit(cueLimit(p));
      lastMoveAt = t;
      window.RGN.log.push({ t, pos: p, heard: heard.slice(-6).join(" ") });
    }
  },
  onLevel(level) {
    levelAvg = levelAvg * 0.6 + level * 0.4;
    // Track the room's noise floor slowly; speech is well above it.
    noiseFloor = levelAvg < noiseFloor ? noiseFloor * 0.9 + levelAvg * 0.1 : noiseFloor * 0.999 + levelAvg * 0.001;
    if (levelAvg > Math.max(0.01, noiseFloor * 2.5)) loudAt = now();
  },
  onState(state, detail) {
    if (state === "error") { setPill("error", "Mic problem"); setStatus(detail); listening = false; updateListenButton(); }
    else if (state === "loading") { setPill("loading", "Loading…"); setStatus(detail); }
    else if (state === "listening") { setStatus(detail); }
  },
};

async function startListening() {
  if (listening) return;
  if (mode === "manual") setMode("voice");
  if (!script || !script.tokens.length) { openScriptDialog(); return; }
  const useWeb = settings.engine === "web" && WebSpeechEngine.available();
  engine = onClaude ? new DictationEngine(handlers) : useWeb ? new WebSpeechEngine(handlers) : new VoskEngine(handlers);
  listening = true;
  updateListenButton();
  try {
    const words = settings.grammar && !useWeb && !onClaude ? [...new Set(script.tokens.map((t) => t.t))] : null;
    await engine.start({ words, deviceId: settings.mic || null });
    fillMicList();
  } catch (err) {
    listening = false;
    updateListenButton();
    setPill("error", "Mic problem");
    setStatus(friendlyError(err));
    try { engine.stop(); } catch (e) {}
    engine = null;
  }
}

function stopListening() {
  if (engine) engine.stop();
  engine = null;
  listening = false;
  partial = [];
  updateListenButton();
  setPill("idle", "Not listening");
}

function friendlyError(err) {
  const m = String(err && (err.message || err.name) || err);
  if (/NotAllowed|denied|Permission/i.test(m)) return "The microphone is blocked. Allow it in the browser's site settings, then try again.";
  if (/NotFound|Requested device/i.test(m)) return "No microphone found. Plug one in or pick another in Settings.";
  if (/secure|https/i.test(m)) return "The microphone only works on an https address.";
  return "Couldn't start listening: " + m;
}

async function fillMicList() {
  try {
    const sel = $("setMic");
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    sel.replaceChildren(new Option("Default microphone", ""), ...devs.map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
    sel.value = settings.mic || "";
  } catch (e) {}
}

// ------------------------------------------------------------------ status
function setPill(state, text) { const p = $("pill"); if (!p) return; p.dataset.state = state; p.textContent = text; }
function setStatus(text) { const s = $("status"); if (s) s.textContent = text || ""; }
function updateListenButton() {
  const b = $("btnListen");
  if (!b) return;
  b.textContent = listening ? "Stop listening" : "Start listening";
  b.classList.toggle("primary", !listening);
  document.body.classList.toggle("listening", listening);
}

let playShown = null;
function updatePlayButton() {
  const playing = mode === "manual" && !paused;
  if (playing === playShown) return;
  playShown = playing;
  const b = $("btnPlay");
  b.textContent = playing ? "❚❚ Pause" : "▶ Play";
  b.classList.toggle("primary", playing);
  b.setAttribute("aria-pressed", String(playing));
}

function updateStatus(t) {
  if (TALENT) return;
  const m = $("meter");
  if (m) m.style.width = Math.min(100, Math.round(levelAvg * 900)) + "%";
  updatePlayButton();
  if (!listening) {
    const want = mode === "manual" ? (paused ? "Paused" : "Steady scroll") : "Not listening";
    if ($("pill").textContent !== want) setPill("idle", want);
    return;
  }
  if ($("pill").dataset.state === "error") return;
  if (mode === "manual") setPill("idle", paused ? "Paused" : "Steady scroll");
  else if (paused) setPill("idle", "Paused (Space)");
  else if (t - lastMoveAt < 2.5) setPill("following", "Following");
  else if (t - lastWordsAt < 2) setPill("holding", "Listening, not sure where");
  else setPill("idle", "Waiting for speech");
}

// ------------------------------------------------------------------ frame loop
function targetOffset(p) {
  const eye = stageEl.clientHeight * (settings.eye / 100);
  const line = parseFloat(getComputedStyle(stage.text).lineHeight) || settings.size * 1.32;
  return stage.yFor(p) - eye + line * 0.5;
}

let lastFrame = now(), lastSend = 0;
function frame() {
  const t = now();
  const dt = t - lastFrame;
  lastFrame = t;
  let p = 0;
  if (script) {
    if (TALENT) p = remotePos;
    else if (mode === "manual") {
      if (!paused) manualPos = Math.min(script.tokens.length, manualPos + dt * (0.6 + settings.speed * 0.4));
      p = manualPos;
    } else {
      const speaking = !paused && (t - lastWordsAt < 0.9 || t - loudAt < 0.4);
      motion.setSpeaking(speaking, t);
      p = motion.estimate(t);
    }
    const y = spring.step(targetOffset(p), dt);
    stage.text.style.transform = `translate3d(0, ${-y.toFixed(1)}px, 0)`;
    stage.dim(p, settings.dim);
    if (chan && !TALENT && t - lastSend > 1 / 30) { chan.postMessage({ type: "pos", p }); lastSend = t; }
  }
  updateStatus(t);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ talent sync
if (chan) {
  chan.onmessage = (e) => {
    const m = e.data || {};
    if (TALENT) {
      if (m.type === "script") loadScript(m.text);
      else if (m.type === "settings") {
        const notesChanged = !!m.settings.notes !== !!settings.notes;
        settings = { ...settings, ...m.settings };
        applySettings();
        if (notesChanged) loadScript(lastShown, { keepPos: true });
      }
      else if (m.type === "pos") remotePos = m.p;
    } else if (m.type === "hello") {
      chan.postMessage({ type: "settings", settings });
      chan.postMessage({ type: "script", text: lastShown });
    }
  };
}

// ------------------------------------------------------------------ controls
function openScriptDialog() {
  $("scriptText").value = editor ? editor.getText().trim() : "";
  $("btnWeekly").hidden = !(doc && DOCS[doc].draft);
  $("dlgScript").showModal();
}

function toggleFullscreen() {
  const el = document.documentElement;
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => document.body.classList.toggle("solo"));
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else document.body.classList.toggle("solo");
}

function setMode(m) {
  mode = m;
  if (!TALENT) {
    $("modeVoice").setAttribute("aria-pressed", String(m === "voice"));
    $("modeManual").setAttribute("aria-pressed", String(m === "manual"));
  }
  const p = m === "manual" ? motion.shown : manualPos;
  if (script) setPosition(Math.round(p));
}

function step(dir) {
  if (!script) return;
  const cur = mode === "manual" ? manualPos : motion.shown;
  setPosition(stage.lineStep(cur, dir));
}

document.addEventListener("keydown", (e) => {
  if (e.target.closest("textarea, input, select, dialog")) return;
  if (!TALENT && document.body.dataset.view !== "prompt") return;
  const k = e.key;
  if (k === " " || k === "Spacebar") { e.preventDefault(); paused = !paused; }
  else if (k === "ArrowDown" || k === "PageDown" || k === "ArrowRight") { e.preventDefault(); step(1); }
  else if (k === "ArrowUp" || k === "PageUp" || k === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (k === "Home") { e.preventDefault(); setPosition(0); }
  else if (k === "m" || k === "M") { settings.mirror = !settings.mirror; saveSettings(); }
  else if (k === "+" || k === "=") { settings.size = Math.min(120, settings.size + 4); saveSettings(); }
  else if (k === "-" || k === "_") { settings.size = Math.max(28, settings.size - 4); saveSettings(); }
  else if (k === "f" || k === "F") toggleFullscreen();
});

if (TALENT) {
  stageEl.addEventListener("dblclick", toggleFullscreen);
} else {
  $("btnListen").onclick = () => (listening ? stopListening() : startListening());
  // Steady scroll without a microphone: Play/Pause and speed.
  $("btnPlay").onclick = () => {
    if (mode === "manual" && !paused) { paused = true; return; }
    if (listening) stopListening();
    if (mode !== "manual") setMode("manual");
    paused = false;
  };
  const nudge = (d) => { settings.speed = Math.max(1, Math.min(10, settings.speed + d)); saveSettings(); };
  $("btnSlower").onclick = () => nudge(-1);
  $("btnFaster").onclick = () => nudge(1);
  $("modeVoice").onclick = () => setMode("voice");
  $("modeManual").onclick = () => setMode("manual");
  $("btnPaste").onclick = openScriptDialog;
  // One or two anchors (News rundown). An untouched draft simply reloads in
  // the new setup; an edited script is converted to one anchor keeping the
  // edits (going back to two needs the draft, since names and lines differ).
  $("twoAnchors").onchange = (e) => {
    anchors = e.target.checked ? 2 : 1;
    store.set("anchors", anchors);
    const meta = getMeta();
    const text = (store.get("script-" + doc, "") || "").trim();
    if (published && (!text || meta.source === "published")) {
      usePublished();
      note(anchors === 1 ? "Switched to one anchor." : "Switched to two anchors.");
    } else if (anchors === 1) {
      loadScript(oneAnchor(editor.getText()));
      onEdited(editor.getText());
      note("Switched to one anchor. Your edits are kept.");
    } else {
      note("Your edited script still has one anchor. Click “Start over from this week's draft” for the two-anchor version.");
    }
    refreshDocUI();
  };
  $("viewEdit").onclick = () => setView("edit");
  $("viewPrompt").onclick = () => setView("prompt");
  $("btnCopy").onclick = async () => {
    const b = $("btnCopy");
    try { await navigator.clipboard.writeText(fillNames(editor.getText(), getNames())); b.textContent = "Copied"; }
    catch (e) { b.textContent = "Copy blocked; use Download"; }
    setTimeout(() => { b.textContent = "Copy for Google Doc"; }, 2000);
  };
  $("btnDownload").onclick = () => {
    const meta = getMeta();
    const blob = new Blob([fillNames(editor.getText(), getNames())], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `RGN ${DOCS[doc].title}${meta.label ? " " + meta.label.replace(/,/g, "") : ""}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  // Starting over throws away edits on this device, so it asks twice.
  let resetArmed = null;
  $("btnReset").onclick = async () => {
    const b = $("btnReset");
    const label = DOCS[doc].draft ? "Start over from this week's draft" : "Clear";
    if (!resetArmed) {
      b.textContent = DOCS[doc].draft ? "Click again to replace your edits" : "Click again to clear";
      resetArmed = setTimeout(() => { resetArmed = null; b.textContent = label; }, 4000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    b.textContent = label;
    if (!DOCS[doc].draft) { loadScript(""); setMeta({}); note("Cleared."); refreshDocUI(); return; }
    const pub = await fetchPublished();
    if (pub) { published = pub; usePublished(); note("Started over from this week's draft."); }
    else note("This week's draft isn't published yet.");
  };
  $("btnFull").onclick = toggleFullscreen;
  const execMeta = document.querySelector('meta[name="rgn-exec"]');
  const talentUrl = (execMeta && execMeta.content ? execMeta.content : location.pathname) + "?view=talent";
  // In the Apps Script window, the talent screen is a copy of this page.
  let selfHtml = null;
  if (host === "gaswin") fetch(location.href).then((r) => r.text()).then((t) => { selfHtml = t; }).catch(() => {});
  $("btnTalent").onclick = () => {
    const url = host === "gaswin" && selfHtml
      ? URL.createObjectURL(new Blob([selfHtml.replace('name="rgn-view" content=""', 'name="rgn-view" content="talent"')], { type: "text/html" }))
      : talentUrl;
    window.open(url, "rgn-talent", "popup,width=1024,height=768");
  };
  $("btnSettings").onclick = () => {
    const p = $("panel");
    p.hidden = !p.hidden;
    $("btnSettings").setAttribute("aria-expanded", String(!p.hidden));
  };
  $("dlgScript").addEventListener("close", () => {
    if ($("dlgScript").returnValue === "ok") {
      loadScript($("scriptText").value);
      setMeta({ source: "manual" });
      refreshDocUI();
    }
  });
  $("btnWeekly").onclick = async () => {
    const pub = await fetchPublished();
    if (pub) { published = pub; $("dlgScript").close("cancel"); usePublished(); }
    else $("weeklyNote").textContent = "This week's script isn't published yet.";
  };
  // Newer draft banner: load it, or keep this version (asked again only when
  // another, newer draft comes out).
  $("draftLoad").onclick = async () => {
    const pub = await fetchPublished();
    if (pub) { published = pub; usePublished(); note(`Loaded the draft from ${pub.generated_label}.`); }
  };
  $("draftKeep").onclick = () => {
    setMeta({ ...getMeta(), dismissed: published && published.generated });
    refreshDocUI();
  };
  $("openEdit").onclick = () => setView("edit");
  // On claude.ai the draft is updated by asking Claude, not by this button.
  if (onClaude) document.querySelectorAll(".update-btn").forEach((b) => { b.hidden = true; });
  $("btnUpdate").onclick = requestUpdate;
  $("btnUpdate2").onclick = requestUpdate;
  // Who's on air
  const nameIds = { a1: "nameA1", a2: "nameA2", wx: "nameWx", mn: "nameMn" };
  for (const [k, id] of Object.entries(nameIds)) {
    $(id).value = getNames()[k] || "";
    $(id).addEventListener("input", (e) => {
      store.set("names", { ...getNames(), [k]: e.target.value.trim() });
      stageStale = true;
      editor.refresh();
      updateOpenBar();
    });
  }
  $("editor").addEventListener("need-names", () => {
    const box = $("names");
    box.classList.add("flash");
    setTimeout(() => box.classList.remove("flash"), 1200);
    const empty = [...box.querySelectorAll("label:not([hidden]) input")].find((i) => !i.value.trim());
    (empty || box.querySelector("input")).focus();
  });
  // Close the More menu after choosing something.
  $("moreMenu").addEventListener("click", (e) => { if (e.target.closest("button") && e.target.id !== "btnReset") $("moreMenu").open = false; });
  $("scriptFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (f) $("scriptText").value = await f.text();
  };
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && doc) { loadScript(await f.text()); setMeta({ source: "manual" }); refreshDocUI(); }
  });
  // iPad alone: in "solo" mode the controls hide; tap the top edge to show them.
  stageEl.addEventListener("click", (e) => {
    if (document.body.classList.contains("solo") && e.clientY < 80) document.body.classList.toggle("show-chrome");
  });
  const bind = (id, key, num = true) => {
    $(id).addEventListener("input", (e) => {
      const el = e.target;
      settings[key] = el.type === "checkbox" ? el.checked : num ? Number(el.value) : el.value;
      saveSettings();
    });
  };
  bind("setSize", "size"); bind("setWidth", "width"); bind("setEye", "eye"); bind("setSpeed", "speed");
  bind("setMirror", "mirror"); bind("setCaps", "caps"); bind("setDim", "dim"); bind("setNotes", "notes");
  $("setNotes").addEventListener("input", () => { if (editor && doc) loadScript(editor.getText(), { keepPos: true, fromEditor: true }); });
  bind("setEngine", "engine", false); bind("setGrammar", "grammar"); bind("setMic", "mic", false);
  if (!WebSpeechEngine.available()) $("setEngine").querySelector('option[value="web"]').disabled = true;
}

window.addEventListener("resize", () => stage.layout());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => stage.layout());

// ------------------------------------------------------------------ the four scripts
// The start page offers four scripts, each saved separately on this device:
//   news     the anchors' rundown, drafted weekly (weather and menu become cue cards)
//   weather  the forecast read, drafted weekly
//   menu     the week's breakfast and lunch, drafted weekly
//   custom   blank, for anything else
// News, weather and menu come from the weekly prep run (scripts/current.json). A
// newer draft loads by itself unless someone edited; then a button offers it.
const DOCS = {
  news: { title: "News rundown", draft: true },
  weather: { title: "Weather", draft: true },
  menu: { title: "Menu", draft: true },
  custom: { title: "Custom", draft: false },
};
let published = null;
let anchors = store.get("anchors", 2); // News rundown: 1 or 2 anchors (remembered)

/** This week's draft for a script, in the chosen anchor setup. */
function deriveFor(d) {
  const t = deriveDoc(d, published.text);
  return d === "news" && anchors === 1 ? oneAnchor(t) : t;
}

// On Apps Script the draft comes from the server; if that call fails or
// hangs, use the copy built into the page (updated with each weekly run).
async function draftViaGoogle() {
  const built = window.RGN_DRAFT || null;
  try {
    const live = await Promise.race([
      gasCall("getDraft").then((t) => JSON.parse(t)),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    if (!built || (live && live.generated && live.generated >= (built.generated || ""))) return live;
  } catch (e) { /* use the built-in copy */ }
  return built;
}

async function fetchPublished() {
  try {
    let d;
    if (viaGoogle) d = await draftViaGoogle();
    else {
      const r = await fetch("scripts/current.json", { cache: "no-store" });
      if (!r.ok) return null;
      d = await r.json();
    }
    return d && typeof d.text === "string" && d.text.trim() ? d : null;
  } catch (e) { return null; }
}
function getMeta(d = doc) { return store.get("meta-" + d, {}); }
function setMeta(m, d = doc) { store.set("meta-" + d, m); }
function note(text) { const n = $("edNote"); if (n) n.textContent = text || ""; }

// "Update this week's draft": opens the GitHub page that runs the weekly
// update (click "Run workflow" there), then watches for the new draft for a
// few minutes so it shows up here without reloading.
const UPDATE_URL = "https://github.com/kh84949vnj-ui/redgold-news/actions/workflows/weekly.yml";
let watchTimer = null;
function updateNote(text) {
  $("updateNote").textContent = text || "";
  if (text) note(text);
}
function requestUpdate() {
  window.open(UPDATE_URL, "_blank", "noopener");
  const before = published && published.generated;
  const until = Date.now() + 6 * 60 * 1000;
  updateNote("On GitHub, sign in (the Red Gold News account), then click “Run workflow”. The new draft shows up here in about 2 minutes.");
  clearInterval(watchTimer);
  watchTimer = setInterval(async () => {
    const pub = await fetchPublished();
    if (pub && pub.generated !== before) {
      clearInterval(watchTimer);
      published = pub;
      if (doc) reconcile(); else refreshDocUI();
      updateNote(`Updated: draft from ${pub.generated_label}.`);
    } else if (Date.now() > until) {
      clearInterval(watchTimer);
      updateNote("No new draft yet. Check that the run finished on GitHub, then reload this page.");
    }
  }, 20000);
}

/** Load this week's draft into the current script (news or weather). */
function usePublished() {
  if (!published || !doc || !DOCS[doc].draft) return;
  const text = deriveFor(doc);
  loadScript(text);
  const meta = { source: "published", base: text, generated: published.generated, label: published.episode_label };
  // Board items picked on the Story Desk are already in the news draft; show them checked.
  if (doc === "news") meta.board = { ...(published.board_picks || {}) };
  setMeta(meta);
  refreshDocUI();
}

/** On opening a script, bring in a newer draft if nobody has edited. */
function reconcile() {
  if (!published || !doc || !DOCS[doc].draft) return refreshDocUI();
  const meta = getMeta();
  const text = deriveFor(doc);
  const local = (store.get("script-" + doc, "") || "").trim();
  if (meta.base === text) {
    if (meta.generated !== published.generated) setMeta({ ...meta, generated: published.generated });
  } else if ((!local || meta.source === "published") && !listening) {
    usePublished();
    if (local) note(`Loaded the newer draft (updated ${published.generated_label}).`);
  }
  refreshDocUI();
}

function onEdited(text) {
  if (!doc) return;
  store.set("script-" + doc, text);
  const meta = getMeta();
  if (meta.source === "published") setMeta({ ...meta, source: "edited" });
  stageStale = true;
  refreshDocUI();
}

function docStatus(d) {
  const meta = getMeta(d);
  const text = (store.get("script-" + d, "") || "").trim();
  if (d === "custom") {
    const words = (text.replace(/\[[^\]]*\]/g, " ").match(/\S+/g) || []).length;
    return text ? `${words} words saved` : "Empty";
  }
  if (!text) return published ? `Draft ready for ${published.episode_label}` : "No draft published yet";
  const stale = published && meta.base !== deriveFor(d);
  if (meta.source === "edited") return `Edited${meta.label ? " · " + meta.label : ""}${stale ? " · newer draft available" : ""}`;
  if (meta.source === "manual") return "Pasted script";
  return `Ready · ${meta.label || ""}`;
}

function refreshDocUI() {
  if (TALENT) return;
  $("homeEp").textContent = published ? `This week: episode of ${published.episode_label}.` : "";
  $("stNews").textContent = docStatus("news");
  $("stWeather").textContent = docStatus("weather");
  $("stMenu").textContent = docStatus("menu");
  $("stCustom").textContent = docStatus("custom");
  if (!doc) { $("docLabel").textContent = ""; $("epLabel").textContent = ""; $("draftBanner").hidden = true; return; }
  const meta = getMeta();
  $("docLabel").textContent = DOCS[doc].title;
  $("epLabel").textContent = meta.label ? meta.label + (meta.source === "edited" ? " (edited)" : "") : meta.source === "manual" ? "Pasted" : "";
  $("edTitle").textContent = DOCS[doc].title + (meta.label ? ` · ${meta.label}` : "");
  // Which names this script needs.
  const solo = doc === "weather" || doc === "menu";
  const mentions = (re) => re.test(editor.getText());
  $("nameA1Row").hidden = solo;
  $("nameA2Row").hidden = solo || (doc === "news" && anchors === 1);
  $("nameWxRow").hidden = doc === "menu" || (doc === "news" && !mentions(/\[WEATHER REPORTER\]/i));
  $("nameMnRow").hidden = doc === "weather" || (doc !== "menu" && !mentions(/\[MENU REPORTER\]/i));
  $("btnReset").textContent = DOCS[doc].draft ? "Start over from this week's draft" : "Clear";
  board.render();
  $("anchorsOpt").hidden = doc !== "news";
  $("twoAnchors").checked = anchors === 2;
  const newer = !!(DOCS[doc].draft && published && meta.base !== deriveFor(doc) &&
    (store.get("script-" + doc, "") || "").trim() && meta.dismissed !== published.generated);
  $("draftBanner").hidden = !newer;
  if (newer) {
    $("draftText").textContent = `A newer ${DOCS[doc].title.toLowerCase()} draft is ready (updated ${published.generated_label}).` +
      (meta.source === "edited" || meta.source === "manual" ? " Loading it replaces your edits." : "");
  }
  updateOpenBar();
}

/** In Prompt: a heads-up when the script still has things to fill in. */
function updateOpenBar() {
  if (TALENT || !editor) return;
  const items = doc ? editor.openItems() : [];
  const bar = $("openBar");
  bar.hidden = !items.length || document.body.dataset.view !== "prompt";
  if (!items.length) return;
  const names = items.map((t) => (t.kind === "NAME" ? `name for ${t.text.toLowerCase()}` : t.text.split(":")[0].toLowerCase()));
  $("openText").textContent = `${items.length} thing${items.length === 1 ? "" : "s"} still open: ${[...new Set(names)].slice(0, 3).join(", ")}${items.length > 3 ? "…" : ""}`;
}

function setView(v) {
  if (TALENT) return;
  document.body.dataset.view = v;
  if (doc) store.set("view-" + doc, v);
  $("viewEdit").setAttribute("aria-pressed", String(v === "edit"));
  $("viewPrompt").setAttribute("aria-pressed", String(v === "prompt"));
  if (v === "prompt") {
    if (stageStale) loadScript(editor.getText(), { keepPos: true, fromEditor: true });
    requestAnimationFrame(() => { stage.layout(); spring.snap(targetOffset(mode === "manual" ? manualPos : motion.shown)); });
  }
  updateOpenBar();
}

/** Route: "" = start page, "#news" / "#weather" / "#menu" / "#custom" = that script. */
function route() {
  const want = location.hash.replace("#", "");
  const next = DOCS[want] ? want : null;
  if (next !== doc && listening) stopListening();
  if (!next) {
    doc = null;
    document.body.dataset.view = "home";
    note("");
    refreshDocUI();
    return;
  }
  if (next !== doc) {
    doc = next;
    note("");
    loadScript(store.get("script-" + doc, ""));
    reconcile();
  }
  setView(store.get("view-" + doc, "edit"));
}

// ------------------------------------------------------------------ start
applySettings();
if (TALENT) {
  loadScript("");
  if (chan) chan.postMessage({ type: "hello" });
} else {
  editor = new Editor($("editor"), { onChange: onEdited, names: getNames });
  board = boardPanel({
    box: $("boardPick"),
    meetings: () => (doc === "news" && published && published.board) || [],
    picked: () => getMeta().board || {},
    setPicked: (picked) => setMeta({ ...getMeta(), board: picked }),
    editor,
    oneAnchor: () => anchors === 1,
    note,
    changed: refreshDocUI,
  });
  setPill("idle", "Not listening");
  window.addEventListener("hashchange", route);
  route();
  fetchPublished().then((pub) => {
    published = pub;
    if (doc) reconcile(); else refreshDocUI();
  });
}
requestAnimationFrame(frame);

if (host === "pages" && "serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// If the site can't be reached, the offline copy loads silently. Say so, so
// nobody thinks the old draft is the newest one. (A URL with a fresh query
// string is never in the offline cache, so it fails when the site is down.)
async function checkOnline() {
  let ok = false;
  try { ok = (await fetch("scripts/current.json?check=" + Date.now(), { cache: "no-store" })).ok; } catch (e) {}
  $("offBar").hidden = ok;
}
if (host === "pages" && location.protocol === "https:") {
  checkOnline();
  setInterval(checkOnline, 60 * 1000);
}
