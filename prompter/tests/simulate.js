// Simulated reader + recognizer, used to test and tune the aligner.
//
// A "reader" says the script's words (optionally skipping a sentence,
// re-reading one, or ad-libbing). A "recognizer" turns that into the kind of
// stream Vosk produces: partial results that grow word by word, with wrong
// words, missed words, extra words and half-finished last words, then a
// final result at each pause. The aligner sees only the recognizer output.
// We compare its position to where the reader really is.

import { parseScript } from "../js/text.js";
import { Aligner } from "../js/align.js";

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENERAL = ["the", "a", "and", "to", "of", "that", "it", "is", "was", "for", "on", "they", "with",
  "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not", "what", "all", "were",
  "we", "when", "your", "can", "said", "there", "use", "an", "each", "which", "she", "do", "how",
  "their", "if", "will", "up", "other", "about", "out", "many", "then", "them", "these", "so", "some",
  "her", "would", "make", "like", "him", "into", "time", "has", "look", "two", "more", "write", "go"];
const FILLERS = ["uh", "um", "so", "okay", "the", "and"];
const ADLIB = ["oh", "sorry", "let", "me", "try", "that", "again", "um", "okay", "so", "yeah", "you", "know"];

/**
 * Build what the reader actually says: [{t, truth}] where truth is the
 * script position after this word (or null for words not in the script).
 */
export function readerPlan(tokens, scenario, r) {
  const said = [];
  const n = tokens.length;
  // Sentence boundaries: tokens after which the display word ended with . ! ?
  let i = 0;
  const skipAt = scenario.skip ? Math.floor(n * 0.35) : -1;
  const rereadAt = scenario.reread ? Math.floor(n * 0.6) : -1;
  const adlibAt = scenario.adlib ? Math.floor(n * 0.5) : -1;
  let skipped = false, reread = false, adlibbed = false;
  while (i < n) {
    if (!skipped && i === skipAt) { i += scenario.skip; skipped = true; continue; }
    if (!adlibbed && i === adlibAt) {
      for (let k = 0; k < 8; k++) said.push({ t: ADLIB[Math.floor(r() * ADLIB.length)], truth: null });
      adlibbed = true;
    }
    said.push({ t: tokens[i], truth: i + 1 });
    if (!reread && i === rereadAt) {
      reread = true;
      const back = scenario.reread;
      for (let k = i - back + 1; k <= i; k++) said.push({ t: tokens[k], truth: k + 1 });
    }
    i++;
  }
  return said;
}

/** Turn said words into recognizer events: [{heard:[...tokens], truth}] */
export function recognizerEvents(said, vocab, noise, r) {
  const events = [];
  const finals = [];
  let utter = [];
  let truth = 0;
  let untilPause = 4 + Math.floor(r() * 10);
  const emit = (partialCut) => {
    const cur = utter.slice();
    if (partialCut && cur.length) {
      const last = cur[cur.length - 1];
      if (last.length > 3) cur[cur.length - 1] = last.slice(0, Math.max(2, Math.ceil(last.length * 0.6)));
    }
    events.push({ heard: [...finals.slice(-20), ...cur], total: finals.length + cur.length, truth });
  };
  for (const w of said) {
    if (w.truth !== null) truth = w.truth;
    const x = r();
    if (x < noise.del) { /* recognizer missed it */ }
    else if (x < noise.del + noise.sub) utter.push(vocab[Math.floor(r() * vocab.length)]);
    else utter.push(w.t);
    if (r() < noise.ins) utter.push(FILLERS[Math.floor(r() * FILLERS.length)]);
    // Partial results arrive roughly every word or two.
    if (r() < 0.7) emit(r() < noise.cut);
    if (--untilPause <= 0) {
      finals.push(...utter);
      utter = [];
      emit(false);
      untilPause = 4 + Math.floor(r() * 10);
    }
  }
  finals.push(...utter);
  utter = [];
  emit(false);
  return events;
}

/** Run one scenario; returns tracking stats. */
export function simulate(scriptText, { seed = 1, noise, scenario = {}, grammar = false, alignerOpts } = {}) {
  const r = rng(seed);
  const { tokens } = parseScript(scriptText);
  const words = tokens.map((t) => t.t);
  const vocab = grammar ? [...new Set(words)] : GENERAL;
  const said = readerPlan(words, scenario, r);
  const events = recognizerEvents(said, vocab, noise, r);
  const al = new Aligner(words, alignerOpts);
  let ahead = 0, maxAhead = 0, lagSum = 0, lagN = 0, maxLag = 0;
  const lags = [];
  let truthMax = 0;
  for (const e of events) {
    const pos = al.update(e.heard, e.total);
    // "Ahead" is measured against the furthest point the reader has reached:
    // holding still while someone re-reads a line is correct, not an error.
    truthMax = Math.max(truthMax, e.truth);
    const err = pos - (pos > e.truth ? truthMax : e.truth);
    if (err > 1) { ahead++; maxAhead = Math.max(maxAhead, err); }
    const lag = Math.max(0, -err);
    lags.push(lag); lagSum += lag; lagN++; maxLag = Math.max(maxLag, lag);
  }
  lags.sort((a, b) => a - b);
  return {
    events: events.length,
    finalPos: al.pos,
    total: words.length,
    aheadEvents: ahead,
    maxAhead,
    meanLag: lagSum / Math.max(1, lagN),
    p90Lag: lags[Math.floor(lags.length * 0.9)] || 0,
    maxLag,
  };
}
