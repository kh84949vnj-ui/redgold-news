// Split a script into rundown blocks for the editor, and join it back.
//
// A script in the weekly doc format is text broken up by cue lines:
//   anchor open / [CUE INTRO SEQUENCE] / news / [CUE BUMPER] / [WEATHER] ... /
//   [CUE BUMPER] / [CUE STUDENT VOICES] / [CUE MENU] / close / [CUE OUTRO]
// Each run of text between cue lines is one editable block; each cue line is a
// fixed block. Joining the blocks gives back the same script text.

const CUE_LINE = /^\s*\[\s*(cue|roll)\b[^\]]*\]\s*$/i;

/** -> [{type:"text", text} | {type:"cue", text}] in order */
export function splitScript(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let buf = [];
  const flush = () => {
    const t = buf.join("\n").replace(/^\n+|\n+$/g, "");
    if (t.trim()) out.push({ type: "text", text: t });
    buf = [];
  };
  for (const line of lines) {
    if (CUE_LINE.test(line)) {
      flush();
      out.push({ type: "cue", text: line.trim().slice(1, -1).trim() });
    } else buf.push(line);
  }
  flush();
  return out;
}

export function joinScript(blocks) {
  return blocks
    .map((b) => (b.type === "cue" ? `[${b.text}]` : b.text.replace(/^\n+|\n+$/g, "")))
    .filter((s) => s.trim())
    .join("\n\n") + "\n";
}

/** Friendly names for blocks, based on where they sit relative to the cues. */
export function nameBlocks(blocks) {
  let seenIntro = false, seenMenu = false, firstText = true, newsNamed = false, lastCue = "";
  return blocks.map((b) => {
    if (b.type === "cue") {
      const t = b.text.toUpperCase();
      lastCue = t;
      if (t.includes("INTRO")) seenIntro = true;
      if (t.includes("MENU")) seenMenu = true;
      return { ...b, name: titleCase(b.text.replace(/^(cue|roll)\s*/i, "")) || "Cue" };
    }
    let name = "Script";
    if (/^\s*\[WEATHER\]/i.test(b.text)) name = "Weather";
    else if (lastCue.includes("VOICES") && !seenMenu) name = "Student voices notes";
    else if (seenMenu) name = "Anchor close";
    else if (firstText && !seenIntro && blocks.some((x) => x.type === "cue")) name = "Anchor open";
    else if (seenIntro && !newsNamed) { name = "News block"; newsNamed = true; }
    firstText = false;
    return { ...b, name };
  });
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\(Voiceover\)/i, "(voiceover)");
}

/** Things still to fill in: inline [ANCHOR 1] placeholders, [VERIFY …], [ADD …], [FLAGGED …]. */
export function todos(blocks) {
  const out = [];
  blocks.forEach((b, bi) => {
    if (b.type !== "text") return;
    for (const m of b.text.matchAll(/\[([^\]]+)\]/g)) {
      const inner = m[1].trim();
      const lineStart = b.text.lastIndexOf("\n", m.index) + 1;
      const lineEnd = b.text.indexOf("\n", m.index);
      const line = b.text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
      const wholeLine = line === m[0];
      let kind = null;
      if (/^(verify|add|flagged)\b/i.test(inner)) kind = inner.split(/[:\s]/)[0].toUpperCase();
      else if (!wholeLine && /^(anchor\s*\d|weather reporter)$/i.test(inner)) kind = "NAME";
      if (kind) out.push({ block: bi, index: m.index, length: m[0].length, kind, text: inner });
    }
  });
  return out;
}

/**
 * The scripts the landing page offers, carved out of the weekly draft:
 *   news:    the anchors' rundown; the weather read becomes a [CUE WEATHER] card
 *            because the weather reporter reads it separately
 *   weather: just the weather read
 */
export function deriveDoc(doc, draftText) {
  const blocks = splitScript(draftText);
  const isWeather = (b) => b.type === "text" && /^\s*\[WEATHER\]/i.test(b.text);
  if (doc === "weather") {
    const w = blocks.find(isWeather);
    return w ? w.text.replace(/^\n+|\n+$/g, "") + "\n" : "";
  }
  if (doc === "news") {
    return joinScript(blocks.map((b) => (isWeather(b) ? { type: "cue", text: "CUE WEATHER" } : b)));
  }
  return "";
}

/**
 * Rewrite a two-anchor script for one anchor: [ANCHOR 2] and [BOTH] parts go
 * to [ANCHOR 1], handoffs between anchors ("Thanks, [ANCHOR 1].") and the
 * second introduction ("And I'm [ANCHOR 2].") are dropped, and a speaker tag
 * that repeats the one before it is removed so the read flows.
 */
export function oneAnchor(text) {
  let t = String(text || "");
  t = t.replace(/^[ \t]*\[(BOTH|ANCHOR[ \t]*2)\][ \t]*$/gim, "[ANCHOR 1]");
  t = t.replace(/(Thanks|That's right|Thank you),?[ \t]*\[ANCHOR[ \t]*\d\][.!][ \t]*/gi, "");
  t = t.replace(/And I'm \[ANCHOR[ \t]*2\][.!][ \t]*/g, "");      // "And I'm [ANCHOR 2]. It's..."
  t = t.replace(/[ \t]*and I'm \[ANCHOR[ \t]*2\]/g, "");          // "I'm [ANCHOR 1] and I'm [ANCHOR 2]."
  // Drop speaker tags that repeat the previous speaker.
  const lines = t.split("\n");
  const out = [];
  let speaker = null;
  for (const line of lines) {
    const tag = line.trim().match(/^\[(ANCHOR\s*\d|BOTH)\]$/i);
    if (tag) {
      const who = tag[1].toUpperCase().replace(/\s+/g, " ");
      if (who === speaker) continue;
      speaker = who;
    } else if (/^\s*\[(cue|roll)\b/i.test(line) || /^\s*\[WEATHER\]/i.test(line)) {
      speaker = null; // a cue or segment change resets the speaker
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Put real names in place of [ANCHOR 1], [ANCHOR 2] and [WEATHER REPORTER]
 * for the prompter and copies. A placeholder on its own line is a speaker tag
 * and stays a tag ("[Sam]"); inside a sentence it becomes the name.
 * Names left blank keep their placeholder.
 */
export function fillNames(text, names = {}) {
  const map = [["ANCHOR\\s*1", names.a1], ["ANCHOR\\s*2", names.a2], ["WEATHER REPORTER", names.wx]];
  let t = String(text || "");
  for (const [pat, name] of map) {
    const n = String(name || "").trim().replace(/[[\]]/g, "");
    if (!n) continue;
    t = t.replace(new RegExp(`^([ \\t]*)\\[${pat}\\]([ \\t]*)$`, "gim"), `$1[${n}]$2`);
    t = t.replace(new RegExp(`\\[${pat}\\]`, "gi"), n);
  }
  return t;
}
