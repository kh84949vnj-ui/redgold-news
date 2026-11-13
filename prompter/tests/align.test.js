import test from "node:test";
import assert from "node:assert/strict";
import { similarity, Aligner } from "../js/align.js";
import { bench } from "./bench.js";

test("word similarity", () => {
  assert.equal(similarity("wolves", "wolves"), 1);
  assert.ok(similarity("wolfs", "wolves") >= 0.5, "sound-alike");
  assert.ok(similarity("conju", "conjunto") >= 0.5, "cut-off partial word");
  assert.equal(similarity("this", "that's"), 0, "short words must not collide");
  assert.equal(similarity("the", "them"), 0);
  assert.equal(similarity("what", "that"), 0);
});

test("follows a clean read word by word", () => {
  const s = "hello red wolves here's what you need to know this wednesday".split(" ");
  const a = new Aligner(s);
  const heard = [];
  for (let i = 0; i < s.length; i++) {
    heard.push(s[i]);
    a.update(heard, heard.length);
  }
  assert.equal(a.pos, s.length);
});

test("a stray common word never pulls it ahead", () => {
  const s = "the board meets wednesday and the showcase is thursday night and friday is".split(" ");
  const a = new Aligner(s);
  a.update(["the", "board", "meets"], 3);
  assert.equal(a.pos, 3);
  a.update(["the", "board", "meets", "is"], 4);
  assert.equal(a.pos, 3, "'is' alone must not jump to a later 'is'");
});

// Simulated reads of the sample script (see tests/simulate.js).
test("benchmark: never runs ahead in clean or typical conditions", () => {
  const rows = bench(undefined, 12, true);
  for (const r of rows) {
    const label = `${r.grammar ? "grammar" : "free"} / ${r.noise} / ${r.scenario}`;
    if (r.noise === "noisy") {
      assert.ok(r.maxAhead <= 6, `${label}: ran ${r.maxAhead} words ahead`);
      continue;
    }
    const allowed = r.scenario === "re-read a line" ? 4 : 1;
    assert.ok(r.maxAhead <= allowed, `${label}: ran ${r.maxAhead} words ahead`);
    // Catching up after a skip adds lag while it confirms the new spot.
    const lagLimit = r.scenario.startsWith("skip") ? 4.5 : 3;
    assert.ok(r.meanLag < lagLimit, `${label}: mean lag ${r.meanLag.toFixed(1)} words`);
    assert.ok(r.finished >= r.seeds - 2, `${label}: reached the end ${r.finished}/${r.seeds}`);
  }
});
