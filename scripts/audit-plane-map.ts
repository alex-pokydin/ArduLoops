import { EDGES, NODES, auditModeGraph, edgeLiveIn, nodesLiveIn } from "../src/plane/cascade.ts";
import type { Sample } from "../src/mav/types.ts";

const ground = {
  alt: 0.4,
  params: { GROUND_STEER_ALT: 5 },
} as Sample;
const air = { ...ground, alt: 40 };

const modes = [
  "MANUAL",
  "FBWA",
  "AUTOTUNE",
  "TRAINING",
  "STABILIZE",
  "ACRO",
  "FBWB",
  "CRUISE",
  "AUTO",
  "LOITER",
  "RTL",
  "GUIDED",
  "TAKEOFF",
  "CIRCLE",
  "ALL",
  "?",
  "",
];

const issues: string[] = [];
for (const mode of modes) {
  for (const s of [undefined, ground, air] as const) {
    const tag = !s ? "nos" : s.alt < 5 ? "gnd" : "air";
    issues.push(...auditModeGraph(mode, s).map((x) => `${tag} ${x}`));
    const live = nodesLiveIn(mode, s);
    for (const n of NODES) {
      if (!live.has(n.id)) continue;
      const inn = EDGES.filter((e) => e.to === n.id && edgeLiveIn(e, mode, live));
      const out = EDGES.filter((e) => e.from === n.id && edgeLiveIn(e, mode, live));
      if (!inn.length && !out.length && n.id !== "ahrs") {
        issues.push(`${tag} ${mode}: ${n.id} live but isolated`);
      }
    }
  }
}

if (issues.length) {
  console.log("FAIL", issues.length);
  for (const x of issues) console.log(" ", x);
  process.exit(1);
}
console.log(`ok ${modes.length} modes × 3 samples, ${NODES.length} nodes`);
