// Renders a parsed script into the prompter stage and maps word positions to
// scroll offsets. Used by both the operator preview and the talent screen.

// Notes that are instructions to the team, not part of what's said. Name
// placeholders like [ANCHOR 2] are NOT hidden: they mark where a name goes.
const HIDEABLE = /^\[\s*(verify|add|flagged|simplify|note|todo)\b/i;

export class Stage {
  /**
   * @param {HTMLElement} root  element with .stage-text inside
   */
  constructor(root) {
    this.root = root;
    this.text = root.querySelector(".stage-text");
    this.wordEls = [];
    this.lines = [];
    this.cueEls = new Map(); // token index that follows the cue -> cue element
    this.dimmedTo = 0;
  }

  render(script, { onWordClick, hideNotes = false } = {}) {
    this.script = script;
    const frag = document.createDocumentFragment();
    this.wordEls = new Array(script.words.length);
    this.cueEls.clear();
    let pendingCue = null;
    for (const item of script.items) {
      if (item.type === "tag") {
        const d = document.createElement("div");
        d.className = "tag";
        d.textContent = item.text;
        frag.appendChild(d);
      } else if (item.type === "cue") {
        const d = document.createElement("div");
        d.className = "cue";
        d.textContent = "▶ " + item.text.toUpperCase();
        frag.appendChild(d);
        pendingCue = d;
      } else if (item.type === "note") {
        if (hideNotes && HIDEABLE.test("[" + item.text)) continue;
        const d = document.createElement("div");
        d.className = "note";
        d.textContent = item.text;
        frag.appendChild(d);
      } else {
        const p = document.createElement("p");
        for (const w of item.words) {
          if (w.br) { p.appendChild(document.createElement("br")); continue; }
          if (w.note && hideNotes && HIDEABLE.test(w.text)) continue;
          const span = document.createElement("span");
          span.className = w.note ? "w note" : "w";
          span.textContent = w.text;
          const wi = script.words.indexOf(w);
          span.dataset.w = wi;
          this.wordEls[wi] = span;
          if (pendingCue && !w.note && w.tokenEnd > w.tokenStart) {
            this.cueEls.set(w.tokenStart, pendingCue);
            pendingCue = null;
          }
          p.appendChild(span);
          p.appendChild(document.createTextNode(" "));
        }
        frag.appendChild(p);
      }
    }
    const end = document.createElement("div");
    end.className = "end";
    end.textContent = "END OF SHOW";
    frag.appendChild(end);
    this.endEl = end;
    if (pendingCue) this.cueEls.set(script.tokens.length, pendingCue);
    this.text.replaceChildren(frag);
    this.dimmedTo = 0;
    if (onWordClick) {
      this.text.onclick = (e) => {
        const el = e.target.closest(".w");
        if (el) onWordClick(Number(el.dataset.w));
      };
    }
    this.layout();
  }

  /** Recompute where each line sits. Call after render, resize or font change. */
  layout() {
    const s = this.script;
    if (!s) return;
    const lines = [];
    let cur = null;
    for (let wi = 0; wi < s.words.length; wi++) {
      const w = s.words[wi];
      const el = this.wordEls[wi];
      if (!el || w.note || w.tokenEnd === w.tokenStart) continue;
      const top = el.offsetTop;
      if (!cur || Math.abs(top - cur.top) > 2) {
        cur = { top, height: el.offsetHeight, t0: w.tokenStart, t1: w.tokenEnd };
        lines.push(cur);
      } else {
        cur.t1 = w.tokenEnd;
      }
    }
    // Where the eye moves after each line: the next line, or a cue card that
    // sits in between (the prompter parks on the card during the package).
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1];
      const cue = next ? this.cueEls.get(next.t0) : this.cueEls.get(s.tokens.length);
      lines[i].cueTop = cue ? cue.offsetTop : null;
      lines[i].nextTop = cue ? cue.offsetTop : next ? next.top : this.endEl.offsetTop;
    }
    this.lines = lines;
  }

  /** Vertical position (px, within the text) of fractional token position p. */
  yFor(p) {
    const L = this.lines;
    if (!L.length) return 0;
    if (p <= L[0].t0) return L[0].top;
    // Binary search for the line containing token floor(p).
    let lo = 0, hi = L.length - 1;
    const k = Math.floor(p);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (L[mid].t0 <= k) lo = mid; else hi = mid - 1;
    }
    const line = L[lo];
    // Parked exactly at the start of a block that follows a cue: show the cue.
    const prev = L[lo - 1];
    if (p === line.t0 && prev && prev.cueTop !== null) return prev.cueTop;
    const span = Math.max(1, line.t1 - line.t0);
    const frac = Math.min(1, Math.max(0, (p - line.t0) / span));
    return line.top + frac * (line.nextTop - line.top);
  }

  /** Dim words already read (talent preference). */
  dim(p, on) {
    const s = this.script;
    if (!s) return;
    const upto = on ? Math.floor(p) : 0;
    if (upto === this.dimmedTo) return;
    const lo = Math.min(upto, this.dimmedTo), hi = Math.max(upto, this.dimmedTo);
    for (let t = lo; t < hi && t < s.tokens.length; t++) {
      const el = this.wordEls[s.tokens[t].word];
      if (el) el.classList.toggle("read", t < upto);
    }
    this.dimmedTo = upto;
  }

  /** Index of the first token on the line after/before the one holding p. */
  lineStep(p, dir) {
    const L = this.lines;
    if (!L.length) return 0;
    let i = L.findIndex((l) => l.t1 > Math.floor(p));
    if (i < 0) i = L.length - 1;
    const j = Math.max(0, Math.min(L.length - 1, i + dir));
    return L[j].t0;
  }
}
