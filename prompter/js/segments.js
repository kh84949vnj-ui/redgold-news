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
      else if (!wholeLine && /^anchor\s*\d/i.test(inner)) kind = "NAME";
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
