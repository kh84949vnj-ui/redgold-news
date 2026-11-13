import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitScript, joinScript, nameBlocks, todos } from "../js/segments.js";

const sample = readFileSync(new URL("./fixtures/sample-script.txt", import.meta.url), "utf8");

test("splits the weekly script into the rundown blocks", () => {
  const blocks = nameBlocks(splitScript(sample));
  assert.deepEqual(blocks.map((b) => b.name), [
    "Anchor open", "Intro Sequence", "News block", "Bumper", "Weather", "Bumper",
    "Student Voices", "Student voices notes", "Menu", "Anchor close", "Outro",
  ]);
});

test("join gives back an equivalent script", () => {
  const again = joinScript(splitScript(sample));
  assert.deepEqual(splitScript(again), splitScript(sample));
});

test("a script without cues is one block", () => {
  const b = nameBlocks(splitScript("Just some lines\nto read."));
  assert.equal(b.length, 1);
  assert.equal(b[0].type, "text");
});

test("finds things to fill in", () => {
  const t = todos(splitScript("[BOTH]\nHello, I'm [ANCHOR 1] and I'm [ANCHOR 2].\n\n[ANCHOR 1]\nShowcase at 6:30. [VERIFY: location]\n[ADD CAMPUS STORY: something]"));
  assert.deepEqual(t.map((x) => x.kind), ["NAME", "NAME", "VERIFY", "ADD"]);
});
