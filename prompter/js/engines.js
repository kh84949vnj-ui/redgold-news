// Speech engines. Both report the same things to the app:
//   onWords(text, isFinal)   recognized text so far for the current phrase
//   onLevel(level)           microphone level 0..1 (for the meter and pauses)
//   onState(state, detail)   "loading" | "listening" | "stopped" | "error"
//
// VoskEngine runs entirely on this device (WebAssembly). No audio leaves it.
// WebSpeechEngine uses the browser's built-in recognizer. In Safari and
// Chrome that may send audio to Apple or Google, so it is opt-in.

const MODEL_URL = new URL("../models/vosk-model-small-en-us-0.15.tar.gz", import.meta.url).href;

let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    if (!window.Vosk) return Promise.reject(new Error("The speech library didn't load."));
    modelPromise = window.Vosk.createModel(MODEL_URL);
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
    const model = await loadModel();
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
