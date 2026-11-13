// RGN Prompter app: wires speech -> aligner -> motion -> stage.
import { parseScript, speakPhrase } from "./text.js";
import { Aligner } from "./align.js";
import { Motion, Spring } from "./motion.js";
import { Stage } from "./render.js";
import { VoskEngine, WebSpeechEngine } from "./engines.js";

const $ = (id) => document.getElementById(id);
const TALENT = new URLSearchParams(location.search).get("view") === "talent";
if (TALENT) document.body.classList.add("talent");

// ------------------------------------------------------------------ settings
const DEFAULT_SETTINGS = { size: 56, width: 30, eye: 33, speed: 4, mirror: false, caps: false, dim: true,
  engine: "vosk", grammar: true, mic: "" };
const store = {
  get(k, d) { try { const v = localStorage.getItem("rgn-prompter-" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("rgn-prompter-" + k, JSON.stringify(v)); } catch (e) {} },
};
let settings = { ...DEFAULT_SETTINGS, ...store.get("settings", {}) };

// ------------------------------------------------------------------ state
const stageEl = $("stage");
const stage = new Stage(stageEl);
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
    $("setMirror").checked = !!settings.mirror;
    $("setCaps").checked = !!settings.caps;
    $("setDim").checked = !!settings.dim;
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
function loadScript(text, { keepPos = false } = {}) {
  script = parseScript(text || "");
  aligner = new Aligner(script.tokens.map((t) => t.t));
  cueStarts = [...script.cueBefore].sort((a, b) => a - b);
  stage.render(script, { onWordClick: TALENT ? null : jumpToWord });
  $("empty") && ($("empty").hidden = script.tokens.length > 0);
  const p = keepPos ? Math.min(motion.pos, script.tokens.length) : 0;
  aligner.setPosition(p, heardTotal);
  motion.jump(p, now());
  manualPos = p;
  spring.snap(targetOffset(p));
  if (!TALENT) {
    store.set("script", text);
    if (chan) chan.postMessage({ type: "script", text });
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
  if (!script || !script.tokens.length) { openScriptDialog(); return; }
  const useWeb = settings.engine === "web" && WebSpeechEngine.available();
  engine = useWeb ? new WebSpeechEngine(handlers) : new VoskEngine(handlers);
  listening = true;
  updateListenButton();
  try {
    const words = settings.grammar && !useWeb ? [...new Set(script.tokens.map((t) => t.t))] : null;
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
}

function updateStatus(t) {
  if (TALENT) return;
  const m = $("meter");
  if (m) m.style.width = Math.min(100, Math.round(levelAvg * 900)) + "%";
  if (!listening) return;
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
      else if (m.type === "settings") { settings = { ...settings, ...m.settings }; applySettings(); }
      else if (m.type === "pos") remotePos = m.p;
    } else if (m.type === "hello") {
      chan.postMessage({ type: "settings", settings });
      chan.postMessage({ type: "script", text: store.get("script", "") });
    }
  };
}

// ------------------------------------------------------------------ controls
function openScriptDialog() {
  $("scriptText").value = store.get("script", "");
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
  $("modeVoice").onclick = () => setMode("voice");
  $("modeManual").onclick = () => setMode("manual");
  $("btnScript").onclick = openScriptDialog;
  $("btnFull").onclick = toggleFullscreen;
  $("btnTalent").onclick = () => window.open(location.pathname + "?view=talent", "rgn-talent", "popup,width=1024,height=768");
  $("btnSettings").onclick = () => {
    const p = $("panel");
    p.hidden = !p.hidden;
    $("btnSettings").setAttribute("aria-expanded", String(!p.hidden));
  };
  $("dlgScript").addEventListener("close", () => {
    if ($("dlgScript").returnValue === "ok") {
      loadScript($("scriptText").value);
      store.set("script-meta", { source: "manual" });
      showPublished();
    }
  });
  $("btnWeekly").onclick = async () => {
    const pub = await fetchPublished();
    if (pub) { $("dlgScript").close("cancel"); usePublished(pub); }
    else $("weeklyNote").textContent = "This week's script isn't published yet.";
  };
  $("btnNewScript").onclick = async () => { const pub = await fetchPublished(); if (pub) usePublished(pub); };
  $("scriptFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (f) $("scriptText").value = await f.text();
  };
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { loadScript(await f.text()); store.set("script-meta", { source: "manual" }); showPublished(); }
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
  bind("setMirror", "mirror"); bind("setCaps", "caps"); bind("setDim", "dim");
  bind("setEngine", "engine", false); bind("setGrammar", "grammar"); bind("setMic", "mic", false);
  if (!WebSpeechEngine.available()) $("setEngine").querySelector('option[value="web"]').disabled = true;
}

window.addEventListener("resize", () => stage.layout());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => stage.layout());

// ------------------------------------------------------------------ weekly script
// The weekly prep run publishes the episode script next to the prompter
// (scripts/current.json). It loads automatically unless someone pasted their
// own script; then a button offers the new one instead of overwriting.
let published = null;
async function fetchPublished() {
  try {
    const r = await fetch("scripts/current.json", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return d && typeof d.text === "string" && d.text.trim() ? d : null;
  } catch (e) { return null; }
}
function usePublished(pub) {
  loadScript(pub.text);
  store.set("script-meta", { source: "published", generated: pub.generated, label: pub.episode_label });
  showPublished();
  setStatus(`Loaded the script for ${pub.episode_label} (updated ${pub.generated_label}).`);
}
function showPublished() {
  if (TALENT) return;
  const meta = store.get("script-meta", {});
  const ep = $("epLabel");
  ep.textContent = meta.source === "published" ? meta.label : meta.source === "manual" ? "Pasted script" : "";
  const btn = $("btnNewScript");
  const isNewer = published && !(meta.source === "published" && meta.generated === published.generated);
  btn.hidden = !isNewer;
  if (isNewer) btn.textContent = `Load the script for ${published.episode_label}`;
}

// ------------------------------------------------------------------ start
applySettings();
if (TALENT) {
  loadScript("");
  if (chan) chan.postMessage({ type: "hello" });
} else {
  loadScript(store.get("script", ""));
  setPill("idle", "Not listening");
  fetchPublished().then((pub) => {
    published = pub;
    const meta = store.get("script-meta", {});
    const hasLocal = !!(store.get("script", "") || "").trim();
    if (pub && (!hasLocal || meta.source !== "manual") && meta.generated !== pub.generated && !listening) usePublished(pub);
    else showPublished();
  });
}
requestAnimationFrame(frame);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
