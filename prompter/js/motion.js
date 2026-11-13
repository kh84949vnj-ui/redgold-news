// Motion: turns the aligner's jumpy position into smooth movement.
//
// The recognizer reports in bursts, and scrolling straight to each new
// position would jerk the text around. Instead:
//   1. We measure the reader's pace (words per second) from recent moves.
//   2. Between updates we keep advancing at that pace, but only a few words
//      past the last confirmed position, never past a cue card, and only
//      while the reader is actually talking.
//   3. The screen follows that estimate with a critically damped spring, so
//      it eases in and out without overshooting.
// When a confirmed position lands behind the estimate (we predicted a bit too
// far), the display holds still until the reader catches up instead of
// sliding backward, unless it's a real re-read (several words back).

export class Pace {
  constructor({ initial = 2.6, min = 1.2, max = 4.8, window = 6 } = {}) {
    this.rate = initial;           // spoken tokens per second
    this.min = min; this.max = max; this.window = window;
    this.hist = [];                // [{t, pos}]
  }
  add(pos, t) {
    this.hist.push({ t, pos });
    while (this.hist.length > 2 && t - this.hist[0].t > this.window) this.hist.shift();
    const a = this.hist[0], b = this.hist[this.hist.length - 1];
    const dt = b.t - a.t, dp = b.pos - a.pos;
    if (dt >= 1.5 && dp > 0) {
      const r = Math.min(this.max, Math.max(this.min, dp / dt));
      this.rate += (r - this.rate) * 0.5;
    }
  }
  reset() { this.hist = []; }
}

export class Motion {
  constructor({ maxLead = 2, backHold = 3 } = {}) {
    this.pace = new Pace();
    this.maxLead = maxLead;   // furthest the estimate may run past the confirmed position
    this.backHold = backHold; // a backward correction smaller than this is held, not shown
    this.pos = 0;             // last confirmed position (tokens)
    this.posTime = 0;
    this.limit = Infinity;    // don't predict past this token (next cue)
    this.speaking = false;
    this.speakingSince = 0;
    this.shown = 0;           // what we last returned
  }

  /** The aligner confirmed a new position. */
  confirm(pos, t) {
    if (pos !== this.pos) {
      if (pos < this.pos) this.pace.reset();
      this.pace.add(pos, t);
      this.pos = pos;
      this.posTime = t;
      if (pos < this.shown - this.backHold) this.shown = pos; // real re-read: go back
    }
  }

  /** Jump without measuring pace (manual nudge, new script). */
  jump(pos, t) {
    this.pos = pos; this.posTime = t; this.shown = pos; this.pace.reset();
  }

  setSpeaking(on, t) {
    if (on && !this.speaking) this.speakingSince = t;
    this.speaking = on;
  }

  setLimit(limit) { this.limit = limit; }

  /** The position to display at time t (fractional tokens). */
  estimate(t) {
    let p = this.pos;
    if (this.speaking) {
      const since = Math.max(0, t - Math.max(this.posTime, this.speakingSince));
      p += Math.min(this.maxLead, this.pace.rate * since);
    }
    p = Math.min(p, Math.max(this.pos, this.limit));
    // Never slide backward for small corrections; wait for the reader.
    if (p < this.shown && this.shown - p <= this.backHold) p = this.shown;
    this.shown = p;
    return p;
  }
}

/** Critically damped spring, for scroll offsets in pixels. */
export class Spring {
  constructor(omega = 7) { this.omega = omega; this.x = 0; this.v = 0; }
  snap(x) { this.x = x; this.v = 0; }
  step(target, dt) {
    dt = Math.min(dt, 0.05);
    const w = this.omega;
    const a = w * w * (target - this.x) - 2 * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
