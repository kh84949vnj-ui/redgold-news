// Everything the prompter remembers lives in this browser only (scripts,
// names, settings). Nothing here is sent anywhere.
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem("rgn-prompter-" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  },
  set(k, v) {
    try { localStorage.setItem("rgn-prompter-" + k, JSON.stringify(v)); } catch (e) { /* private mode: not saved */ }
  },
};
