import test from "node:test";
import assert from "node:assert/strict";
import { Motion, Pace, Spring } from "../js/motion.js";

test("pace settles on the reader's speed", () => {
  const p = new Pace();
  for (let t = 0; t <= 10; t += 0.5) p.add(Math.round(t * 3.5), t);
  assert.ok(Math.abs(p.rate - 3.5) < 0.4, `rate ${p.rate}`);
});

test("estimate moves between updates but only a little past the last match", () => {
  const m = new Motion({ maxLead: 3 });
  m.setSpeaking(true, 0);
  m.confirm(10, 0);
  const a = m.estimate(0.5);
  assert.ok(a > 10 && a < 13, `estimate ${a}`);
  assert.ok(m.estimate(10) <= 13, "never more than maxLead past the confirmed spot");
});

test("stops when the reader stops talking", () => {
  const m = new Motion();
  m.confirm(20, 0);
  m.setSpeaking(false, 0);
  assert.equal(m.estimate(5), 20);
});

test("never predicts past a cue card", () => {
  const m = new Motion({ maxLead: 5 });
  m.setSpeaking(true, 0);
  m.confirm(48, 0);
  m.setLimit(50);
  assert.equal(m.estimate(10), 50);
});

test("small backward corrections hold still instead of sliding back", () => {
  const m = new Motion({ maxLead: 3 });
  m.setSpeaking(true, 0);
  m.confirm(10, 0);
  const before = m.estimate(1); // ~12.6
  m.setSpeaking(false, 1);
  m.confirm(11, 1.1);           // reader was actually a bit behind
  assert.equal(m.estimate(1.2), before, "holds");
  m.confirm(3, 2);              // a real re-read
  assert.equal(m.estimate(2.1), 3, "goes back for a real re-read");
});

test("spring settles without overshoot", () => {
  const s = new Spring(7);
  let max = 0;
  for (let i = 0; i < 120; i++) max = Math.max(max, s.step(100, 1 / 60));
  assert.ok(max <= 100.5, `overshoot ${max}`);
  assert.ok(s.x > 97, `settled at ${s.x}`);
});
