// Where this copy of the prompter is running:
//   "pages"   GitHub Pages (the normal site)
//   "claude"  the claude.ai copy (build-claude.mjs)
//   "gas"     inside the Google Apps Script page (build-gas.mjs)
//   "gaswin"  the window the Apps Script page opens. Google's page doesn't
//             let its frame use the microphone; a window it opens can. Calls
//             to the Apps Script server go through the Google tab (opener).
const meta = typeof document !== "undefined" && document.querySelector('meta[name="rgn-host"]');
export const host = (meta && meta.content)
  || (typeof window !== "undefined" && window.google && window.google.script ? "gas" : "pages");
export const viaGoogle = host === "gas" || host === "gaswin";

let seq = 0;
const waiting = new Map();
if (host === "gaswin") {
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.rgnReply === undefined || e.origin !== location.origin) return;
    const w = waiting.get(m.rgnReply);
    if (!w) return;
    waiting.delete(m.rgnReply);
    if (m.ok) w.resolve(m.value); else w.reject(new Error(m.value));
  });
}

/** Call a function in the Apps Script project (gas/Code.gs). */
export function gasCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    const g = window.google && window.google.script && window.google.script.run;
    if (g) { g.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args); return; }
    const o = window.opener;
    if (!o) { reject(new Error("The Google tab that opened this window was closed.")); return; }
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    try { o.postMessage({ rgnCall: true, id, fn, args }, location.origin); }
    catch (e) { waiting.delete(id); reject(e); return; }
    setTimeout(() => { if (waiting.delete(id)) reject(new Error("No answer from the Google tab.")); }, 120000);
  });
}
