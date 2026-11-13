// Aligner benchmark: node tests/bench.js [seeds]
// Prints how well the prompter tracks a reader across scenarios and noise
// levels. "ahead" counts moments the prompter ran ahead of the reader (the
// failure that matters most); lag is how many words it trails behind.
import { readFileSync } from "node:fs";
import { simulate } from "./simulate.js";

const script = readFileSync(new URL("./fixtures/sample-script.txt", import.meta.url), "utf8");
const SEEDS = Number(process.argv[2] || 40);

export const NOISE = {
  clean: { sub: 0.03, del: 0.03, ins: 0.01, cut: 0.2 },
  typical: { sub: 0.12, del: 0.08, ins: 0.03, cut: 0.35 },
  noisy: { sub: 0.25, del: 0.12, ins: 0.06, cut: 0.5 },
};
export const SCENARIOS = {
  "straight read": {},
  "skip a sentence": { skip: 14 },
  "skip a paragraph": { skip: 35 },
  "re-read a line": { reread: 8 },
  "ad-lib": { adlib: true },
};

export function bench(alignerOpts, seeds = SEEDS, quiet = false) {
  const rows = [];
  for (const grammar of [false, true]) {
    for (const [nName, noise] of Object.entries(NOISE)) {
      for (const [sName, scenario] of Object.entries(SCENARIOS)) {
        let ahead = 0, aheadRuns = 0, maxAhead = 0, meanLag = 0, p90 = 0, finished = 0;
        for (let s = 1; s <= seeds; s++) {
          const r = simulate(script, { seed: s * 7919, noise, scenario, grammar, alignerOpts });
          ahead += r.aheadEvents; if (r.aheadEvents) aheadRuns++;
          maxAhead = Math.max(maxAhead, r.maxAhead);
          meanLag += r.meanLag / seeds; p90 += r.p90Lag / seeds;
          if (r.total - r.finalPos <= 3) finished++;
        }
        rows.push({ grammar, noise: nName, scenario: sName, aheadRuns, maxAhead, meanLag, p90, finished, seeds });
      }
    }
  }
  if (!quiet) {
    console.log("grammar  noise    scenario           runs-ahead  max-ahead  mean-lag  p90-lag  reached-end");
    for (const r of rows) {
      console.log(
        `${(r.grammar ? "on" : "off").padEnd(8)} ${r.noise.padEnd(8)} ${r.scenario.padEnd(18)} ` +
        `${String(r.aheadRuns + "/" + r.seeds).padStart(10)} ${String(r.maxAhead).padStart(10)} ` +
        `${r.meanLag.toFixed(1).padStart(9)} ${r.p90.toFixed(1).padStart(8)} ${String(r.finished + "/" + r.seeds).padStart(12)}`,
      );
    }
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) bench();
