// Script parsing and word normalization for the voice-following prompter.
//
// The script uses the weekly Google Doc format:
//   [ANCHOR 1]            speaker tag (shown, never matched)
//   [CUE INTRO SEQUENCE]  cue card (shown, never matched; scrolling waits here)
//   Text lines            what the anchors read
//   ... [VERIFY: ...]     inline brackets inside a line are notes, not read
//
// Every spoken word becomes one or more "tokens" in the form a recognizer
// would hear them: "77" -> "seventy seven", "6:30" -> "six thirty",
// "RedWolves" -> "red wolves", "ISD" -> "i s d". The aligner matches heard
// words against this token list.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
const MONTHS = new Set(["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
  "sep", "sept", "oct", "nov", "dec"]);

export function numberWords(n) {
  if (!Number.isFinite(n) || n < 0) return [];
  n = Math.floor(n);
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  if (n < 1000) {
    const rest = n % 100;
    return [ONES[Math.floor(n / 100)], "hundred", ...(rest ? numberWords(rest) : [])];
  }
  if (n < 1000000) {
    const rest = n % 1000;
    return [...numberWords(Math.floor(n / 1000)), "thousand", ...(rest ? numberWords(rest) : [])];
  }
  const rest = n % 1000000;
  return [...numberWords(Math.floor(n / 1000000)), "million", ...(rest ? numberWords(rest) : [])];
}

export function ordinalWords(n) {
  const w = numberWords(n);
  const last = w[w.length - 1];
  let o;
  if (ORD[last]) o = ORD[last];
  else if (last.endsWith("y")) o = last.slice(0, -1) + "ieth";
  else o = last + "th";
  return [...w.slice(0, -1), o];
}

// How a four-digit year is usually read: 2026 -> "twenty twenty six".
function yearWords(n) {
  if (n >= 2000 && n <= 2009) return numberWords(n);
  const hi = Math.floor(n / 100), lo = n % 100;
  if (lo === 0) return [...numberWords(hi), "hundred"];
  return [...numberWords(hi), ...(lo < 10 ? ["oh", ONES[lo]] : numberWords(lo))];
}

const SYMBOLS = { "&": ["and"], "%": ["percent"], "+": ["plus"], "@": ["at"], "#": ["number"] };

/**
 * Turn one written word into spoken tokens.
 * ctx.prev is the previous written word (lowercase, letters only), used to
 * read "November 23" as "november twenty third".
 * ctx.acronyms is a Set of lowercase acronyms from the script, so a heard
 * "isd" is spelled out the same way the script's "ISD" was.
 */
export function speak(word, ctx = {}) {
  let w = String(word).replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  w = w.replace(/^[^\w$&%#@+]+|[^\w%&+]+$/g, ""); // strip outer punctuation
  if (!w) return [];
  if (SYMBOLS[w]) return SYMBOLS[w];

  // Money: $5,000 -> five thousand dollars
  let m = w.match(/^\$(\d[\d,]*)(?:\.(\d\d))?$/);
  if (m) {
    const out = [...numberWords(parseInt(m[1].replace(/,/g, ""), 10)), "dollars"];
    if (m[2] && m[2] !== "00") out.push("and", ...numberWords(parseInt(m[2], 10)), "cents");
    return out;
  }
  // Percent: 42% -> forty two percent
  m = w.match(/^(\d[\d,]*)%$/);
  if (m) return [...numberWords(parseInt(m[1].replace(/,/g, ""), 10)), "percent"];
  // Time: 6:30 -> six thirty, 6:00 -> six, 6:05 -> six oh five
  m = w.match(/^(\d{1,2}):(\d\d)$/);
  if (m) {
    const h = numberWords(parseInt(m[1], 10)), mm = parseInt(m[2], 10);
    if (mm === 0) return h;
    return mm < 10 ? [...h, "oh", ONES[mm]] : [...h, ...numberWords(mm)];
  }
  // Ordinals: 16th -> sixteenth
  m = w.match(/^(\d+)(st|nd|rd|th)$/i);
  if (m) return ordinalWords(parseInt(m[1], 10));
  // a.m. / p.m.
  if (/^[ap]\.?m\.?$/i.test(w)) return [w[0].toLowerCase(), "m"];
  // Plain numbers
  m = w.match(/^\d[\d,]*$/);
  if (m) {
    const n = parseInt(w.replace(/,/g, ""), 10);
    if (!w.includes(",") && w.length === 4 && n >= 1100 && n <= 2099) return yearWords(n);
    if (ctx.prev && MONTHS.has(ctx.prev) && n >= 1 && n <= 31) return ordinalWords(n);
    return numberWords(n);
  }
  // Mixed like 3pm, 10am
  m = w.match(/^(\d{1,2})([ap])\.?m\.?$/i);
  if (m) return [...numberWords(parseInt(m[1], 10)), m[2].toLowerCase(), "m"];

  // Words joined by hyphens, slashes or dots: co-op, K-12, U.S.
  if (/[-/–—]/.test(w)) return w.split(/[-/–—]+/).flatMap((p) => speak(p, ctx));
  if (/^([a-z]\.){2,}[a-z]?$/i.test(w)) return w.replace(/\./g, "").toLowerCase().split("");

  // Acronyms: ISD, RGN, UIL -> letters. Known script acronyms also apply to heard words.
  if (/^[A-Z]{2,5}s?$/.test(w) && !/^[AI]$/.test(w)) {
    const letters = w.replace(/s$/, "").toLowerCase().split("");
    return letters;
  }
  const low = w.toLowerCase();
  if (ctx.acronyms && ctx.acronyms.has(low)) return low.split("");

  // CamelCase: RedWolves -> red wolves
  if (/[a-z][A-Z]/.test(w)) return w.split(/(?<=[a-z])(?=[A-Z])/).flatMap((p) => speak(p, ctx));

  // Letters and digits stuck together (K12) -> split
  if (/\d/.test(w) && /[a-z]/i.test(w)) return w.split(/(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/i).flatMap((p) => speak(p, ctx));

  return [low.replace(/[^a-z']/g, "").replace(/^'+|'+$/g, "")].filter(Boolean);
}

/** Normalize a heard phrase from a recognizer into tokens. */
export function speakPhrase(text, ctx = {}) {
  const out = [];
  let prev = "";
  for (const raw of String(text).split(/\s+/)) {
    if (!raw) continue;
    const toks = speak(raw, { ...ctx, prev });
    out.push(...toks);
    prev = raw.toLowerCase().replace(/[^a-z]/g, "");
  }
  return out;
}

const CUE_RE = /^(cue|roll|vo|sot|package|pkg|break|bumper)\b/i;

/**
 * Parse a script into display items and the flat token list the aligner uses.
 *
 * Returns {
 *   items:  [{type:"tag"|"cue"|"para", text, words?:[{text, note, tokens:[start,end)}]}],
 *   tokens: [{t, word, item}]   // t = spoken token, word = index into words[]
 *   words:  [{text, note, item, tokenStart, tokenEnd}]
 *   cueBefore: Set of token indexes that start right after a cue card
 *   acronyms: Set
 * }
 */
export function parseScript(text) {
  const items = [], tokens = [], words = [];
  const cueBefore = new Set();
  const acronyms = new Set();
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");

  // Collect acronyms first so heard words can be spelled the same way.
  for (const m of String(text).matchAll(/\b[A-Z]{2,5}\b/g)) acronyms.add(m[0].toLowerCase());
  for (const a of ["a", "i", "am", "pm"]) acronyms.delete(a);

  let para = null;
  let pendingCue = false;
  const endPara = () => { para = null; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { endPara(); continue; }
    const whole = line.match(/^\[(.+)\]$/);
    if (whole && !line.slice(1, -1).includes("[")) {
      endPara();
      const inner = whole[1].trim();
      if (CUE_RE.test(inner)) {
        items.push({ type: "cue", text: inner });
        pendingCue = true;
      } else if (/^(verify|add|note|todo)\b/i.test(inner) || inner.split(/\s+/).length > 5) {
        items.push({ type: "note", text: inner });
      } else {
        items.push({ type: "tag", text: inner });
      }
      continue;
    }
    if (!para) {
      para = { type: "para", words: [] };
      items.push(para);
    } else {
      para.words.push({ text: "\n", note: true, br: true, tokenStart: tokens.length, tokenEnd: tokens.length });
    }
    const itemIndex = items.length - 1;
    // Split into words, keeping inline [notes] as single non-spoken chunks.
    const parts = line.split(/(\[[^\]]*\])/).filter((p) => p !== "");
    let prev = "";
    for (const part of parts) {
      if (/^\[[^\]]*\]$/.test(part)) {
        const wi = words.length;
        const w = { text: part, note: true, item: itemIndex, tokenStart: tokens.length, tokenEnd: tokens.length };
        words.push(w); para.words.push(w);
        continue;
      }
      // Punctuation right after an inline note ("[ANCHOR 2]. Welcome") stays
      // with the note so it isn't shown as a word of its own.
      const lead = part.match(/^[.,;:!?]+/);
      if (lead && words.length && words[words.length - 1].note) {
        words[words.length - 1].text += lead[0];
      }
      const rest = lead ? part.slice(lead[0].length) : part;
      for (const wtext of rest.split(/\s+/).filter(Boolean)) {
        const toks = speak(wtext, { prev, acronyms });
        const w = { text: wtext, note: false, item: itemIndex, tokenStart: tokens.length, tokenEnd: tokens.length + toks.length };
        const wi = words.length;
        if (toks.length && pendingCue) { cueBefore.add(tokens.length); pendingCue = false; }
        for (const t of toks) tokens.push({ t, word: wi, item: itemIndex });
        words.push(w); para.words.push(w);
        prev = wtext.toLowerCase().replace(/[^a-z]/g, "");
      }
    }
  }
  return { items, tokens, words, cueBefore, acronyms };
}
