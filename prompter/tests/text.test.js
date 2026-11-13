import test from "node:test";
import assert from "node:assert/strict";
import { speak, speakPhrase, parseScript, numberWords } from "../js/text.js";

test("numbers read the way people say them", () => {
  assert.deepEqual(speak("77"), ["seventy", "seven"]);
  assert.deepEqual(speak("100"), ["one", "hundred"]);
  assert.deepEqual(speak("5,000"), ["five", "thousand"]);
  assert.deepEqual(speak("2026"), ["twenty", "twenty", "six"]);
  assert.deepEqual(speak("2005"), ["two", "thousand", "five"]);
  assert.deepEqual(speak("42%"), ["forty", "two", "percent"]);
  assert.deepEqual(speak("$5,000"), ["five", "thousand", "dollars"]);
  assert.deepEqual(numberWords(0), ["zero"]);
});

test("times, dates and ordinals", () => {
  assert.deepEqual(speak("6:30"), ["six", "thirty"]);
  assert.deepEqual(speak("6:00"), ["six"]);
  assert.deepEqual(speak("6:05"), ["six", "oh", "five"]);
  assert.deepEqual(speak("p.m."), ["p", "m"]);
  assert.deepEqual(speak("16th"), ["sixteenth"]);
  assert.deepEqual(speak("23rd"), ["twenty", "third"]);
  assert.deepEqual(speakPhrase("November 23, through Friday"), ["november", "twenty", "third", "through", "friday"]);
  assert.deepEqual(speakPhrase("high of 74 degrees"), ["high", "of", "seventy", "four", "degrees"]);
});

test("names, acronyms and punctuation", () => {
  assert.deepEqual(speak("RedWolves!"), ["red", "wolves"]);
  assert.deepEqual(speak("ISD"), ["i", "s", "d"]);
  assert.deepEqual(speak("Here's"), ["here's"]);
  assert.deepEqual(speak("Here’s"), ["here's"]);
  assert.deepEqual(speak("co-op"), ["co", "op"]);
  assert.deepEqual(speak("&"), ["and"]);
  assert.deepEqual(speak("—"), []);
  assert.deepEqual(speakPhrase("isd", { acronyms: new Set(["isd"]) }), ["i", "s", "d"]);
});

test("script parsing separates tags, cues, notes and spoken words", () => {
  const s = parseScript(`[BOTH]
Hello RedWolves, I'm Sam.

[CUE INTRO SEQUENCE]

[ANCHOR 1]
The show is at 6:30. [VERIFY: location]
Second line.`);
  assert.deepEqual(s.items.map((i) => i.type), ["tag", "para", "cue", "tag", "para"]);
  assert.deepEqual(s.tokens.map((t) => t.t), ["hello", "red", "wolves", "i'm", "sam", "the", "show", "is", "at", "six", "thirty", "second", "line"]);
  const note = s.words.find((w) => w.note);
  assert.equal(note.text, "[VERIFY: location]");
  assert.ok(s.cueBefore.has(5), "the first word after the cue is marked");
});
