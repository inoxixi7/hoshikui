// Level design search: generates random groove networks inside the shared relic,
// runs the solver on each, and keeps candidates that meet each level's intent.
// Usage: npx tsx scripts/design-levels.ts <levelIndex> [tries] [seed]
// Prints a ready-to-paste level body. Final data still has to pass verify-levels.

import type { CrackDef, EdgeDef, LevelDef, Mat3, Vec3 } from '../src/puzzle/types';
import { BASE_PLANES, VEINS, veinsFor } from '../src/levels/relic';
import { plane, supportDistance, vertsFromPlanes, isFaceNormal } from '../src/puzzle/geometry';
import { analyzeLevel } from '../src/puzzle/solver';
import { IDENTITY, VIEW_DIR, actionLabel, allOrientations, applyAction, facingStar, initialState, orientKey, rollPath, computeLit } from '../src/puzzle/rules';
import { dot } from '../src/puzzle/math';

const [li = '0', triesArg = '20000', seedArg = '1'] = process.argv.slice(2);
const L = Number(li);
let seed = Number(seedArg) >>> 0 || 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const S = 0.3;
const lattice: Vec3[] = [];
for (const x of [-S, 0, S]) for (const y of [-S, 0, S]) for (const z of [-S, 0, S]) lattice.push([x, y, z]);
const key = (p: Vec3) => p.map((c) => Math.round(c / S)).join(',');
const adj = (p: Vec3): Vec3[] =>
  lattice.filter((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < S * 1.01 && key(q) !== key(p));

interface Spec {
  range: [number, number];
  cracks: number;
  needVeins: boolean;
  needLight: boolean;
  heart: boolean;
  nodes: [number, number];
}
const SPECS: Spec[] = [
  { range: [2, 3], cracks: 0, needVeins: false, needLight: false, heart: false, nodes: [5, 7] },
  { range: [3, 5], cracks: 1, needVeins: false, needLight: true, heart: false, nodes: [5, 8] },
  { range: [3, 5], cracks: 0, needVeins: true, needLight: false, heart: false, nodes: [5, 8] },
  { range: [5, 7], cracks: 1, needVeins: true, needLight: true, heart: false, nodes: [6, 9] },
  { range: [6, 9], cracks: Number(process.env.CRACKS ?? 1), needVeins: true, needLight: false, heart: true, nodes: [7, 11] },
];
const spec = SPECS[L];
const orients = allOrientations();
const allVeinPts = VEINS.flatMap((v) => v.points);

function build(): { level: LevelDef; planes: typeof BASE_PLANES } | null {
  const n = spec.nodes[0] + Math.floor(rnd() * (spec.nodes[1] - spec.nodes[0] + 1));
  const chosen: Vec3[] = [pick(lattice)];
  const edges: [number, number][] = [];
  while (chosen.length < n) {
    const from = Math.floor(rnd() * chosen.length);
    const cand = adj(chosen[from]).filter((q) => !chosen.some((c) => key(c) === key(q)));
    if (!cand.length) {
      if (rnd() < 0.02) return null;
      continue;
    }
    chosen.push(pick(cand));
    edges.push([from, chosen.length - 1]);
  }
  // A few extra loops.
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++) {
      const isAdj = adj(chosen[i]).some((q) => key(q) === key(chosen[j]));
      if (isAdj && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i)) && rnd() < 0.15) edges.push([i, j]);
    }
  const ids = chosen.map((_, i) => (i === 0 ? 's' : `n${i}`));
  const coreIdx = 1 + Math.floor(rnd() * (chosen.length - 1));
  ids[coreIdx] = 'core';
  const edgeDefs: EdgeDef[] = edges.map(([a, b]) => ({ a: ids[a], b: ids[b] }));

  const planes = [...BASE_PLANES];
  const cracks: CrackDef[] = [];
  const targets = spec.heart ? (spec.cracks === 1 ? ['heart'] : ['sun', 'heart']) : ['sun', 'sun2'];
  for (let c = 0; c < spec.cracks; c++) {
    const m = pick(orients);
    const nrm = facingStar(m);
    if (dot(nrm, VIEW_DIR) < 0.05) return null; // keep cracks on faces seen at the start
    const pts = vertsFromPlanes(planes);
    const d = supportDistance(pts, nrm) - 0.14;
    if (allVeinPts.some((p) => dot(p, nrm) > d - 0.01)) return null;
    planes.push(plane(nrm, d));
    const t = targets[c];
    if (t === 'heart') {
      // Light reaching the core: entering the core needs it.
      const e = edgeDefs.filter((x) => x.a === 'core' || x.b === 'core');
      if (!e.length) return null;
      e.forEach((x) => (x.hidden = 'heart'));
      cracks.push({ id: 'heart', normal: nrm, lights: 'heart', target: chosen[coreIdx] });
    } else {
      const cand = edgeDefs.filter((x) => !x.hidden && x.a !== 'core' && x.b !== 'core');
      if (!cand.length) return null;
      const e = pick(cand);
      e.hidden = t;
      const pa = chosen[ids.indexOf(e.a)], pb = chosen[ids.indexOf(e.b)];
      cracks.push({ id: `c${c + 1}`, normal: nrm, lights: t, target: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2] });
    }
  }
  const hull = vertsFromPlanes(planes);
  const faces = (['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const).filter((a) => {
    const v: Vec3 = { px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1] }[a] as Vec3;
    return isFaceNormal(hull, v);
  });
  const level: LevelDef = {
    id: `l${L + 1}`,
    hullPoints: hull,
    stableFaces: [...faces],
    nodes: chosen.map((p, i) => ({ id: ids[i], pos: p })),
    edges: edgeDefs,
    veins: veinsFor(L),
    cracks,
    start: { orient: IDENTITY, dropletNode: 's' },
    goal: { dropletNode: 'core', litTargets: spec.heart ? ['heart'] : undefined },
    expectedMinMoves: spec.range,
  };
  return { level, planes };
}

function solvable(level: LevelDef): boolean {
  return analyzeLevel(level).minMoves !== null;
}

let best: { score: number; level: LevelDef; sol: string; planes: typeof BASE_PLANES } | null = null;
const tries = Number(triesArg);
for (let t = 0; t < tries; t++) {
  const b = build();
  if (!b) continue;
  const { level } = b;
  const s0 = level.start;
  if (rollPath(level, s0.orient ?? IDENTITY, s0.dropletNode, computeLit(level, s0.orient ?? IDENTITY)).length > 1) continue;
  const a = analyzeLevel(level);
  if (a.minMoves === null || a.minMoves < spec.range[0] || a.minMoves > spec.range[1]) continue;
  if (a.deadEnds.length || a.initialWon) continue;
  if (spec.needVeins && solvable({ ...level, veins: [] })) continue;
  if (spec.needLight && solvable({ ...level, edges: level.edges.filter((e) => !e.hidden || e.hidden === 'heart') })) continue;
  if (!spec.needVeins && level.veins.length && !solvable({ ...level, veins: [] })) continue; // veins optional here
  // Score: droplet moves on most steps; first moves feel alive; a moderate state space.
  const init = initialState(level);
  let moving = 0;
  let st = init;
  for (const act of a.solution ?? []) {
    const r = applyAction(level, st, act);
    if (!r.ok) break;
    if (r.path.length > 1) moving++;
    st = r.state;
  }
  const firstMoves = (['px', 'nx', 'pz', 'nz'] as const).filter((d) => {
    const r = applyAction(level, init, { type: 'topple', dir: d });
    return r.ok && r.path.length > 1;
  }).length;
  if (L === 0 && firstMoves < 3) continue;
  const orientCount = new Set((a.solution ?? []).map(() => 0)).size;
  void orientCount;
  const score = moving / (a.minMoves || 1) + firstMoves * 0.15 + level.nodes.length * 0.03 + a.minMoves * 0.05 - Math.abs(a.reachable - 60) / 400;
  if (!best || score > best.score) {
    best = { score, level, sol: (a.solution ?? []).map(actionLabel).join(' '), planes: b.planes };
  }
}
if (!best) {
  console.log('no candidate found');
  process.exit(1);
}
const lv = best.level;
const a = analyzeLevel(lv);
console.log(`// score ${best.score.toFixed(3)}  min ${a.minMoves}  reach ${a.reachable}  solution: ${best.sol}`);
console.log(
  JSON.stringify(
    {
      nodes: lv.nodes,
      edges: lv.edges,
      cracks: lv.cracks.map((c) => ({ ...c, normal: c.normal.map((x) => +x.toFixed(5)), orientFor: orients.find((m) => dot(facingStar(m), c.normal) > 0.9999)?.join(',') })),
      faces: lv.stableFaces,
      crackDepth: best.planes.slice(BASE_PLANES.length).map((p) => +p.d.toFixed(4)),
    },
    null,
    0,
  ),
);
void orientKey;
void ({} as Mat3);
