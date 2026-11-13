// Aligner: keeps track of where the reader is in the script.
//
// Each time the recognizer reports words, the last few heard words are
// matched against a window of the script around the current position using
// local sequence alignment (Smith-Waterman). Words count as matching when
// they are equal, sound alike, or one is a cut-off start of the other
// (recognizers often report half a word before it's finished).
//
// The position only moves when the evidence is strong:
//   - normal forward moves need 2+ matched words in order
//   - jumps far ahead (a skipped sentence) need 4+ matched words
//   - moving backward (a re-read) needs 4+ matched words
//   - if the best match is ambiguous (the same phrase twice), it stays put
// Being AHEAD of the reader is the worst failure (the line scrolls away), so
// every rule leans toward holding still.

// ------------------------------------------------------------------ similarity

function phoneticKey(w) {
  let s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s.replace(/^kn/, "n").replace(/^wr/, "r").replace(/^wh/, "w").replace(/^x/, "s")
    .replace(/ph/g, "f").replace(/ck/g, "k").replace(/q/g, "k").replace(/x/g, "ks")
    .replace(/dg/g, "j").replace(/gh/g, "").replace(/th/g, "t").replace(/sh/g, "s")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/z/g, "s").replace(/v/g, "f")
    .replace(/ie?s$|es$/, "s").replace(/y$/, "i");
  const first = s[0];
  const rest = s.slice(1).replace(/[aeiouyhw]/g, "");
  return (first + rest).replace(/(.)\1+/g, "$1");
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const keyCache = new Map();
function key(w) {
  let k = keyCache.get(w);
  if (k === undefined) { k = phoneticKey(w); keyCache.set(w, k); }
  return k;
}

// Very common short words are weak evidence on their own.
const STOP = new Set(["a", "an", "the", "and", "of", "to", "in", "on", "at", "is", "it", "for", "with",
  "i", "we", "you", "be", "are", "this", "that", "our", "your", "s", "m", "p", "them", "they", "then",
  "than", "there", "their", "these", "those", "what", "was", "were", "has", "have", "had", "his", "her",
  "him", "she", "he", "its", "it's", "here", "from", "but", "not", "all", "can", "will", "just", "one",
  "about", "more", "so", "or", "as", "by", "if", "up", "out", "do", "did", "my", "me", "us", "no", "yes",
  "day", "week", "make", "sure", "also", "be", "been", "who", "how", "when", "where", "which", "i'm",
  "we're", "you're", "that's", "it's", "here's", "let's"]);

const simCache = new Map();

/** Similarity of a heard word to a script word, 0..1 (cached). */
export function similarity(heard, script) {
  if (heard === script) return 1;
  const k = heard + "\u0000" + script;
  let v = simCache.get(k);
  if (v === undefined) {
    v = rawSimilarity(heard, script);
    if (simCache.size > 200000) simCache.clear();
    simCache.set(k, v);
  }
  return v;
}

function rawSimilarity(heard, script) {
  if (!heard || !script) return 0;
  const kh = key(heard), ks = key(script);
  // Sound-alike: same consonant skeleton, long enough that it means something
  // ("wolves"/"wolfs" yes, "this"/"that's" no).
  if (kh && kh === ks && kh.length >= 3 && Math.abs(heard.length - script.length) <= 2) return 0.8;
  const short = heard.length <= script.length ? heard : script;
  const long = short === heard ? script : heard;
  // A cut-off word ("conju" for "conjunto"), or a plural/ending difference.
  if (short.length >= 4 && long.startsWith(short)) return short === heard ? 0.65 : 0.55;
  const d = lev(heard, script);
  const len = Math.max(heard.length, script.length);
  // Close spelling: one letter off for 5-7 letter words, two for longer ones.
  if (Math.min(heard.length, script.length) >= 5 && (d <= 1 || (len >= 8 && d <= 2))) return 0.55;
  return 0;
}

// ------------------------------------------------------------------ aligner

export const DEFAULTS = {
  heardWindow: 10,     // how many recent heard tokens to align
  behind: 14,          // how far back from the position to search
  ahead: 70,           // how far ahead to search
  matchMin: 0.5,       // similarity below this is a mismatch
  mismatch: -0.9,
  gapHeard: -0.7,      // heard a word that isn't in the script (ad-lib, noise)
  gapScript: -0.6,     // script word not heard (recognizer missed it)
  stopWeight: 0.8,     // match weight for very common words (vs 2 for others)
  farTokens: 16,       // a forward move beyond this counts as a jump
  farRun: 4,           // unbroken matched words needed for a jump...
  farContent: 2,       // ...of which this many are not common words
  backRun: 4,          // same for moving backward (a re-read)
  backContent: 2,
  midRun: 3,           // a move past `freeAhead` (but not a jump) needs this run
  aheadPenalty: 0.15,  // score lost per word beyond `freeAhead` from the expected spot
  freeAhead: 6,
  backPenalty: 0.15,
  ambiguityGap: 0.8,   // if a different spot scores within this, stay put
};

export class Aligner {
  /**
   * @param {string[]} tokens   the script's spoken tokens, in order
   * @param {object} opts       overrides for DEFAULTS
   */
  constructor(tokens, opts = {}) {
    this.s = tokens;
    this.o = { ...DEFAULTS, ...opts };
    this.pos = 0;            // index of the next token the reader will say
    this.lastMove = null;    // {from, to, score, run} for the status display
    this.heardAtMove = 0;    // heard-word counter when the position last moved
    this.pending = null;     // a jump waiting for a second update to confirm it
  }

  setPosition(p, heardTotal = this.heardAtMove) {
    this.pos = Math.max(0, Math.min(this.s.length, Math.round(p)));
    this.heardAtMove = heardTotal;
  }

  /**
   * Feed the recent heard tokens (most recent last). Returns the new position
   * (unchanged if the evidence wasn't strong enough).
   *
   * heardTotal is a running count of every word heard so far. If the
   * prompter hasn't moved while the reader kept talking, the reader is
   * probably further along than the last confident match, so catching up to
   * them is judged from that expected spot instead of treated as a big jump.
   */
  update(heard, heardTotal = null) {
    const o = this.o;
    const H = heard.slice(-o.heardWindow).filter((w) => w);
    if (H.length === 0) return this.pos;
    const drift = heardTotal === null ? 0
      : Math.min(o.farTokens * 3, Math.max(0, Math.round((heardTotal - this.heardAtMove) * 0.8)));
    const expected = this.pos + drift;
    const lo = Math.max(0, this.pos - o.behind);
    const hi = Math.min(this.s.length, expected + o.ahead);
    const W = this.s.slice(lo, hi);
    const n = H.length, m = W.length;
    if (!m) return this.pos;

    // DP: score[i][j] best local alignment ending at heard i, script j.
    // R = length of the unbroken run of matches (heard and script both
    // consecutive) ending exactly at (i, j); K = how many of those are not
    // common words. The run at the end is the evidence for where the reader is.
    const S = new Float64Array((n + 1) * (m + 1));
    const R = new Int16Array((n + 1) * (m + 1));
    const K = new Int16Array((n + 1) * (m + 1));
    const idx = (i, j) => i * (m + 1) + j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const w = W[j - 1];
        const sim = similarity(H[i - 1], w);
        const isMatch = sim >= o.matchMin;
        const stop = STOP.has(w) || w.length <= 2;
        const weight = isMatch ? sim * (stop ? o.stopWeight : 2) : o.mismatch;
        const diag = S[idx(i - 1, j - 1)] + weight;
        const up = S[idx(i - 1, j)] + o.gapHeard;
        const left = S[idx(i, j - 1)] + o.gapScript;
        let best = 0, run = 0, content = 0;
        if (diag > best) {
          best = diag;
          if (isMatch) {
            run = R[idx(i - 1, j - 1)] + 1;
            content = (run > 1 ? K[idx(i - 1, j - 1)] : 0) + (stop ? 0 : 1);
          }
        }
        if (up > best) { best = up; run = 0; content = 0; }
        if (left > best) { best = left; run = 0; content = 0; }
        S[idx(i, j)] = best;
        R[idx(i, j)] = run;
        K[idx(i, j)] = content;
      }
    }

    // Candidates end on a run of matches covering the newest heard word (or
    // the one before it, since the newest is often half a word).
    const cands = [];
    for (const [i, pen] of [[n, 0], [n - 1, 0.6]]) {
      if (i < 1) continue;
      for (let j = 1; j <= m; j++) {
        const run = R[idx(i, j)], content = K[idx(i, j)];
        // Need 2+ matched words in a row including a meaningful one, or 3+
        // common words in a row. "and a" alone proves nothing.
        if (run < 2 || (run < 3 && content < 1)) continue;
        const sc = S[idx(i, j)] - pen;
        if (sc <= 0) continue;
        const newPos = lo + j; // next token after the matched one
        const d = newPos - this.pos;
        // Anywhere between the last position and where the reader probably is
        // now costs nothing; beyond that, or behind, costs per word.
        const beyond = newPos - expected - o.freeAhead;
        const adj = sc - (d < 0 ? o.backPenalty * -d : beyond > 0 ? o.aheadPenalty * beyond : 0);
        cands.push({ newPos, score: sc, run, content, adj });
      }
    }
    if (!cands.length) return this.pos;
    cands.sort((a, b) => b.adj - a.adj);
    const best = cands[0];
    const delta = best.newPos - this.pos;
    if (delta === 0 || (delta < 0 && delta >= -2)) return this.pos;

    // Ambiguity: a different spot almost as good (the same phrase twice) and
    // we'd be moving far -> hold until the reader says something unique.
    const rival = cands.find((c) => Math.abs(c.newPos - best.newPos) > 6 && c.adj > best.adj - o.ambiguityGap);
    if (rival && Math.abs(delta) > o.freeAhead) return this.pos;

    if (delta < 0 && !(best.run >= o.backRun && best.content >= o.backContent)) return this.pos;
    // The further past where the reader probably is, the more proof needed.
    const past = best.newPos - expected;
    if (past > o.farTokens && !(best.run >= o.farRun && best.content >= o.farContent)) return this.pos;
    if (past > o.freeAhead && !(best.run >= o.midRun && best.content >= 1)) return this.pos;

    // Jumps (past the expected spot, or backward) must be confirmed by the
    // next update pointing at the same place. One wrong word lining up with a
    // repeated phrase never survives a second look.
    if (past > o.freeAhead || delta < 0) {
      const p = this.pending;
      if (!(p && Math.abs(p.newPos - best.newPos) <= 3 && p.heard !== H.join(" "))) {
        this.pending = { newPos: best.newPos, heard: H.join(" ") };
        return this.pos;
      }
    }
    this.pending = null;

    this.lastMove = { from: this.pos, to: best.newPos, score: best.score, run: best.run };
    this.pos = best.newPos;
    if (heardTotal !== null) this.heardAtMove = heardTotal;
    return this.pos;
  }
}
