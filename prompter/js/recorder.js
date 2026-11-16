// Audio takes recorded while prompting. Kept in memory on this device until
// saved; nothing is uploaded.
import { acquireMic, releaseMic } from "./mic.js";

// AAC in .m4a first: it opens everywhere (QuickTime, Canva, video editors). Then
// whatever the browser has (Chrome without AAC gives Opus in .webm).
const TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4;codecs=aac", "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function canRecord() {
  return typeof window !== "undefined" && "MediaRecorder" in window &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function pickType() {
  return TYPES.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || "";
}

export function extFor(type) {
  return /mp4|aac/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
}

export class Recorder {
  constructor() { this.rec = null; this.startedAt = 0; }

  get recording() { return !!this.rec; }

  /** Seconds recorded so far. */
  elapsed() { return this.rec ? (performance.now() - this.startedAt) / 1000 : 0; }

  async start(deviceId) {
    if (this.rec) return;
    const stream = await acquireMic(deviceId);
    const type = pickType();
    try {
      this.rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128000 } : undefined);
    } catch (e) {
      releaseMic();
      throw e;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000); // a chunk every second, so a crash loses at most a second
    this.startedAt = performance.now();
  }

  /** -> {blob, seconds, type} */
  stop() {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    const seconds = this.elapsed();
    this.rec = null;
    return new Promise((resolve) => {
      rec.onstop = () => {
        releaseMic();
        const type = rec.mimeType || (this.chunks[0] && this.chunks[0].type) || "audio/webm";
        resolve({ blob: new Blob(this.chunks, { type }), seconds, type });
      };
      try { rec.stop(); } catch (e) { releaseMic(); resolve(null); }
    });
  }
}
