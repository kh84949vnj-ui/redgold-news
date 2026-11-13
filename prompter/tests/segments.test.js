import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitScript, joinScript, nameBlocks, todos, deriveDoc } from "../js/segments.js";

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

test("news and weather scripts come out of the weekly draft", () => {
  const news = deriveDoc("news", sample);
  const weather = deriveDoc("weather", sample);
  assert.ok(news.includes("[CUE WEATHER]"));
  assert.ok(!/high of/i.test(news), "no forecast text in the news rundown");
  assert.ok(weather.startsWith("[WEATHER]"));
  assert.ok(/high of/i.test(weather));
  assert.ok(!/CUE/.test(weather));
  const names = nameBlocks(splitScript(news)).map((b) => b.name);
  assert.ok(names.includes("Weather") && names.includes("Anchor close"));
});

test("a script with no cues is not called the anchor open", () => {
  assert.equal(nameBlocks(splitScript("Welcome to Student Voices."))[0].name, "Script");
});

test("one anchor: tags, handoffs and the second intro are rewritten", async () => {
  const { oneAnchor } = await import("../js/segments.js");
  const two = `[ANCHOR 1]
Hey, RedWolves! I'm [ANCHOR 1].

[ANCHOR 2]
And I'm [ANCHOR 2]. It's a busy week.

[CUE INTRO SEQUENCE]

[ANCHOR 1]
First up, Wednesday is a big day.

[ANCHOR 2]
Thanks, [ANCHOR 1]. Then on Thursday, it's a show.

[BOTH]
See you next week!`;
  const one = oneAnchor(two);
  assert.ok(!/ANCHOR 2|BOTH|Thanks,/.test(one), one);
  assert.match(one, /Hey, RedWolves! I'm \[ANCHOR 1\]\.\n\nIt's a busy week\./);
  assert.match(one, /First up, Wednesday is a big day\.\n\nThen on Thursday/);
  // Each run under one speaker has a single tag.
  assert.equal((one.split("[CUE INTRO SEQUENCE]")[1].match(/\[ANCHOR 1\]/g) || []).length, 1);
  assert.equal(oneAnchor("[BOTH]\nHello RedWolves, I'm [ANCHOR 1] and I'm [ANCHOR 2]."), "[ANCHOR 1]\nHello RedWolves, I'm [ANCHOR 1].");
});

test("names fill in: tags stay tags, inline placeholders become the name", async () => {
  const { fillNames } = await import("../js/segments.js");
  const s = "[ANCHOR 1]\nHey, RedWolves! I'm [ANCHOR 1].\n\n[ANCHOR 2]\nThanks, [ANCHOR 1]. Up next, [WEATHER REPORTER].";
  assert.equal(fillNames(s, { a1: "Sam", a2: "Alex", wx: "Jo" }),
    "[Sam]\nHey, RedWolves! I'm Sam.\n\n[Alex]\nThanks, Sam. Up next, Jo.");
  assert.equal(fillNames(s, { a1: "Sam" }).includes("[ANCHOR 2]"), true, "blank names keep placeholders");
});

test("the menu read is its own script and a cue card in the rundown", () => {
  const draft = sample.replace("[CUE MENU]", "[MENU]\nHey, RedWolves! I'm [MENU REPORTER], and here's what's on the menu this week.\nOn Monday, breakfast is Kolache. For lunch, it's Pizza with Wings, plus Garden Salad.\nEnjoy your meals, RedWolves!");
  const news = deriveDoc("news", draft);
  const menu = deriveDoc("menu", draft);
  assert.ok(news.includes("[CUE MENU]"));
  assert.ok(!/Kolache/.test(news), "no menu text in the news rundown");
  assert.ok(menu.startsWith("[MENU]") && /Kolache/.test(menu) && !/CUE/.test(menu));
  assert.equal(deriveDoc("menu", sample), "", "no menu block, no menu script");
  const names = nameBlocks(splitScript(draft)).map((b) => b.name);
  assert.ok(names.includes("Menu") && names.includes("Anchor close"));
});

test("the menu reporter's name fills in", async () => {
  const { fillNames } = await import("../js/segments.js");
  assert.equal(fillNames("I'm [MENU REPORTER].", { mn: "Jo" }), "I'm Jo.");
  assert.deepEqual(todos(splitScript("I'm [MENU REPORTER].")).map((t) => t.kind), ["NAME"]);
});
