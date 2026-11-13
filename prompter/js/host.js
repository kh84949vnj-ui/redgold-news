// Where this copy of the prompter is running:
//   "pages"  GitHub Pages (the normal site)
//   "claude" the claude.ai copy (build-claude.mjs)
//   "gas"    the Google Apps Script web app (build-gas.mjs)
const meta = typeof document !== "undefined" && document.querySelector('meta[name="rgn-host"]');
export const host = (meta && meta.content)
  || (typeof window !== "undefined" && window.google && window.google.script ? "gas" : "pages");

/** Call a function in the Apps Script project (gas/Code.gs). */
export function gasCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
}
