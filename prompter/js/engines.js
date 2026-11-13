// Speech engines. Both report the same things to the app:
//   onWords(text, isFinal)   recognized text so far for the current phrase
//   onLevel(level)           microphone level 0..1 (for the meter and pauses)
//   onState(state, detail)   "loading" | "listening" | "stopped" | "error"
//
// VoskEngine runs entirely on this device (WebAssembly). No audio leaves it.
// WebSpeechEngine uses the browser's built-in recognizer. In Safari and
// Chrome that may send audio to Apple or Google, so it is opt-in.

import { host, gasCall } from "./host.js";

const MODEL_FILE = "vosk-model-small-en-us-0.15.tar.gz";
// On Apps Script the page can't load files from its own server, so the
// library comes from jsDelivr and the model from GitHub's raw file server
// (a different address from github.io). If the school network blocks those
// too, both come through the Apps Script server instead.
const RAW_MODEL = "https://raw.githubusercontent.com/kh84949vnj-ui/redgold-news/main/prompter/models/" + MODEL_FILE;
const VOSK_CDN = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js";
const MODEL_URL = host === "gas" ? RAW_MODEL : new URL("../models/" + MODEL_FILE, import.meta.url).href;

function addScript(attrs) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    Object.assign(s, attrs);
    s.onload = resolve;
    s.onerror = () => reject(new Error("load failed"));
    document.head.appendChild(s);
  });
}

async function ensureVosk() {
  if (window.Vosk) return;
  if (host !== "gas") throw new Error("The speech library didn't load.");
  try { await addScript({ src: VOSK_CDN }); } catch (e) { /* try the server */ }
  if (window.Vosk) return;
  const code = await gasCall("getVosk");
  await addScript({ src: URL.createObjectURL(new Blob([code], { type: "text/javascript" })) });
  if (!window.Vosk) throw new Error("The speech library didn't load.");
}

/** The model through the Apps Script server, in pieces (it is 40 MB). */
async function modelViaServer(onProgress) {
  const size = await gasCall("getModelSize");
  const step = 4 * 1024 * 1024;
  const parts = [];
  for (let at = 0; at < size; at += step) {
    if (onProgress) onProgress(Math.round((at / size) * 100));
    const b64 = await gasCall("getModelChunk", at, Math.min(step, size - at));
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    parts.push(bytes);
  }
  return URL.createObjectURL(new Blob(parts, { type: "application/gzip" }));
}

let modelPromise = null;
function loadModel(onProgress) {
  if (!modelPromise) {
    modelPromise = (async () => {
      await ensureVosk();
      try {
        return await window.Vosk.createModel(MODEL_URL);
      } catch (e) {
        if (host !== "gas") throw e;
        return window.Vosk.createModel(await modelViaServer(onProgress));
      }
    })();
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

async function openMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    video: false,
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

export class VoskEngine {
  constructor(handlers) {
    this.h = handlers;
    this.label = "On this device (Vosk)";
    this.private = true;
  }

  /** words: the script's vocabulary, used to limit recognition (null = open). */
  async start({ words = null, deviceId = null } = {}) {
    this.h.onState("loading", "Loading the speech model (about 40 MB, first time only)…");
    const model = await loadModel((pct) => this.h.onState("loading", `Loading the speech model through Google (${pct}%)…`));
    this.stream = await openMic(deviceId);
    if (this.h.onMic) this.h.onMic();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const grammar = words && words.length ? JSON.stringify([...words, "[unk]"]) : undefined;
    this.rec = new model.KaldiRecognizer(this.ctx.sampleRate, grammar);
    this.rec.on("partialresult", (m) => this.h.onWords(m.result.partial || "", false));
    this.rec.on("result", (m) => this.h.onWords(m.result.text || "", true));
    this.rec.on("error", (m) => this.h.onState("error", m.error || "Recognizer error"));
    this.src = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is old but is the one audio tap that works the same in
    // Safari on Mac, iPad and iPhone. 2048 frames is ~43 ms at 48 kHz.
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => {
      const buf = e.inputBuffer;
      this.h.onLevel(rms(buf.getChannelData(0)));
      try { this.rec.acceptWaveform(buf); } catch (err) { /* dropped chunk */ }
    };
    this.src.connect(this.node);
    // Some browsers only run the processor when it's connected to the output.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.node.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    this.h.onState("listening", "Listening on this device. No audio leaves it.");
  }

  stop() {
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.src && this.src.disconnect(); } catch (e) {}
    try { this.rec && this.rec.remove && this.rec.remove(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.node = this.src = this.rec = this.stream = this.ctx = null;
    this.h.onState("stopped", "");
  }
}

export class WebSpeechEngine {
  constructor(handlers) {
    this.h = handlers;
    this.label = "Browser speech (Safari/Chrome)";
    this.private = false;
  }

  static available() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async start({ deviceId = null } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("This browser has no built-in speech recognition.");
    this.on = true;
    // A level meter needs its own mic tap; if the browser refuses a second
    // one, the meter just stays flat.
    try {
      this.stream = await openMic(deviceId);
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 1024;
      src.connect(this.an);
      const buf = new Float32Array(this.an.fftSize);
      const tick = () => {
        if (!this.on) return;
        this.an.getFloatTimeDomainData(buf);
        this.h.onLevel(rms(buf));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { /* meter unavailable */ }

    const begin = () => {
      const r = new SR();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      let finalCount = 0;
      r.onresult = (e) => {
        // Report each result once as final, and the newest unfinished one as partial.
        for (let i = finalCount; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) { this.h.onWords(res[0].transcript, true); finalCount = i + 1; }
          else { this.h.onWords(res[0].transcript, false); break; }
        }
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          this.on = false;
          this.h.onState("error", "Speech recognition was blocked. Check the browser's microphone permission.");
        }
      };
      // Browsers end recognition after silence; restart while we're on.
      r.onend = () => { if (this.on) setTimeout(() => this.on && begin(), 150); };
      r.start();
      this.r = r;
    };
    begin();
    this.h.onState("listening", "Listening with the browser's speech service. Audio may be sent to Apple or Google.");
  }

  stop() {
    this.on = false;
    try { this.r && this.r.abort(); } catch (e) {}
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.r = this.stream = this.ctx = null;
    this.h.onState("stopped", "");
  }
}

// On claude.ai the page can't open the microphone itself. The platform's
// dictation listens instead and hands the page text (it uses Anthropic's
// speech service, so audio does leave the device). Chrome only.
export const onClaude = host === "claude";
let dictation = null;
if (onClaude && window.claude && window.claude.use) {
  window.claude.use("dictation").then((d) => { dictation = d; }).catch(() => {});
}

export class DictationEngine {
  constructor(handlers) {
    this.h = handlers;
    this.label = "claude.ai dictation";
    this.private = false;
  }

  static available() { return !!dictation; }

  /** Must run straight from the click: start() is called before any await. */
  start() {
    const d = dictation;
    if (!d) return Promise.reject(new Error("Voice following here needs Chrome. You can still scroll by hand."));
    // No microphone level here: treat each new word as "speaking now".
    const bump = () => { this.h.onLevel(0.2); clearTimeout(this.quiet); this.quiet = setTimeout(() => this.h.onLevel(0), 300); };
    // onWords wants the words of the current phrase; finals arrive as pieces.
    let phrase = "";
    this.off = [
      d.onPartial(({ text }) => { if (text) { bump(); this.h.onWords((phrase + " " + text).trim(), false); } }),
      d.onFinal(({ text }) => { bump(); phrase = (phrase + " " + text).trim(); this.h.onWords(phrase, true); phrase = ""; }),
      d.onState(({ state, reason }) => {
        if (state === "listening") this.h.onState("listening", "Listening with claude.ai dictation.");
        else if (state === "idle" && reason && reason !== "stopped") {
          const why = reason === "not_granted" ? "Dictation is turned off for this page. Turn it on in the page's Permissions menu."
            : reason === "hidden" ? "Listening stopped because the page was hidden. Press Listen again."
            : reason === "viewer_stopped" ? "Listening stopped." : "Dictation stopped (" + reason + "). Press Listen again.";
          this.h.onState("error", why);
        }
      }),
    ];
    this.h.onState("loading", "Starting dictation…");
    const p = d.start({ language: "en" });
    return p.catch((e) => {
      this.cleanup();
      const m = e && e.code === "not_granted" ? "Dictation was not allowed for this page."
        : e && e.code === "unavailable" ? "Dictation isn't available here. Use Chrome, or scroll by hand."
        : "Couldn't start dictation" + (e && e.code ? " (" + e.code + ")" : "") + ".";
      throw new Error(m);
    });
  }

  cleanup() {
    (this.off || []).forEach((u) => { try { u(); } catch (e) {} });
    this.off = null;
    clearTimeout(this.quiet);
  }

  stop() {
    this.cleanup();
    if (dictation) dictation.stop().catch(() => {});
    this.h.onState("stopped", "");
  }
}
