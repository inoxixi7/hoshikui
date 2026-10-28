// Level design search: generates random groove networks inside the shared cube,
// runs the solver on each, and keeps the candidate that best meets the level's intent.
// Usage: npx tsx scripts/design-levels.ts <levelIndex> [tries] [seed] [--write]
// With --write the winner is written to src/levels/level<N>.ts. Final data must
// still pass `npm run verify-levels`.

import { writeFileSync } from 'node:fs';
import type { Axis, CrackDef, EdgeDef, LevelDef, Vec3 } from '../src/puzzle/types';
import { BASE_PLANES, veinsFor } from '../src/levels/relic';
import { vertsFromPlanes } from '../src/puzzle/geometry';
import { analyzeLevel } from '../src/puzzle/solver';
import { AXES, IDENTITY, actionLabel, allOrientations, applyAction, computeLit, initialState, rollPath } from '../src/puzzle/rules';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WRITE = process.argv.includes('--write');
const [li = '0', triesArg = '20000', seedArg = '1'] = args;
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
  title: string;
  comment: string;
  range: [number, number];
  cracks: number;
  needVeins: boolean;
  needLight: boolean;
  heart: boolean;
  nodes: [number, number];
}
const SPECS: Spec[] = [
  { title: '翻转', comment: 'Only turning. Every way the cube is turned sends the droplet somewhere;\n// one sequence of downs leads into the core.', range: [2, 3], cracks: 0, needVeins: false, needLight: false, heart: false, nodes: [6, 9] },
  { title: '星光', comment: 'A sealed channel opens only while its cracked face looks at the star.\n// The turn that lets the light in is not the turn that finishes.', range: [3, 5], cracks: 1, needVeins: false, needLight: true, heart: false, nodes: [7, 11] },
  { title: '错视', comment: 'The first lit vein runs along the outside of the cube. Turn the cube until a\n// vein end and a groove line up on screen — the droplet crosses there.', range: [3, 5], cracks: 0, needVeins: true, needLight: false, heart: false, nodes: [7, 11] },
  { title: '光与错视', comment: 'Starlight and a lined-up vein, both needed, in the right order.', range: [5, 7], cracks: 1, needVeins: true, needLight: true, heart: false, nodes: [8, 13] },
  { title: '吞星', comment: 'Light an inner channel, cross on a vein, and enter the core only while\n// the star shines on it.', range: [6, 9], cracks: 2, needVeins: true, needLight: true, heart: true, nodes: [9, 14] },
];
const spec = SPECS[L];
const FACES: Axis[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const hull = vertsFromPlanes(BASE_PLANES);

function build(): LevelDef | null {
  const n = spec.nodes[0] + Math.floor(rnd() * (spec.nodes[1] - spec.nodes[0] + 1));
  const chosen: Vec3[] = [pick(lattice)];
  const edges: [number, number][] = [];
  let guard = 0;
  while (chosen.length < n) {
    if (++guard > 500) return null;
    const from = Math.floor(rnd() * chosen.length);
    const cand = adj(chosen[from]).filter((q) => !chosen.some((c) => key(c) === key(q)));
    if (!cand.length) continue;
    chosen.push(pick(cand));
    edges.push([from, chosen.length - 1]);
  }
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++) {
      const isAdj = adj(chosen[i]).some((q) => key(q) === key(chosen[j]));
      if (isAdj && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i)) && rnd() < 0.12) edges.push([i, j]);
    }
  const ids = chosen.map((_, i) => (i === 0 ? 's' : `n${i}`));
  const coreIdx = 1 + Math.floor(rnd() * (chosen.length - 1));
  ids[coreIdx] = 'core';
  const edgeDefs: EdgeDef[] = edges.map(([a, b]) => ({ a: ids[a], b: ids[b] }));
  const mid = (a: string, b: string): Vec3 => {
    const pa = chosen[ids.indexOf(a)], pb = chosen[ids.indexOf(b)];
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  };

  const cracks: CrackDef[] = [];
  const used = new Set<Axis>();
  const targets = spec.heart ? (spec.cracks === 1 ? ['heart'] : ['sun', 'heart']) : ['sun', 'sun2'];
  for (let c = 0; c < spec.cracks; c++) {
    const face = pick(FACES.filter((f) => !used.has(f)));
    used.add(face);
    const t = targets[c];
    if (t === 'heart') {
      const e = edgeDefs.filter((x) => x.a === 'core' || x.b === 'core');
      if (!e.length) return null;
      e.forEach((x) => (x.hidden = 'heart'));
      cracks.push({ id: 'heart', normal: AXES[face], lights: 'heart', target: chosen[coreIdx] });
    } else {
      const cand = edgeDefs.filter((x) => !x.hidden && x.a !== 'core' && x.b !== 'core');
      if (!cand.length) return null;
      const e = pick(cand);
      e.hidden = t;
      cracks.push({ id: `c${c + 1}`, normal: AXES[face], lights: t, target: mid(e.a, e.b) });
    }
  }
  return {
    id: `l${L + 1}`,
    hullPoints: hull,
    stableFaces: [...FACES],
    nodes: chosen.map((p, i) => ({ id: ids[i], pos: p })),
    edges: edgeDefs,
    veins: veinsFor(L),
    cracks,
    start: { orient: IDENTITY, dropletNode: 's' },
    goal: { dropletNode: 'core', litTargets: spec.heart ? ['heart'] : undefined },
    expectedMinMoves: spec.range,
  };
}

const solvable = (level: LevelDef) => analyzeLevel(level).minMoves !== null;

let best: { score: number; level: LevelDef; sol: string; min: number; reach: number } | null = null;
const tries = Number(triesArg);
for (let t = 0; t < tries; t++) {
  const level = build();
  if (!level) continue;
  if (rollPath(level, IDENTITY, 's', computeLit(level, IDENTITY)).length > 1) continue;
  const a = analyzeLevel(level);
  if (a.minMoves === null || a.minMoves < spec.range[0] || a.minMoves > spec.range[1]) continue;
  if (a.deadEnds.length || a.initialWon) continue;
  if (spec.needVeins && solvable({ ...level, veins: [] })) continue;
  // The vein earned in the previous level must be the one that matters.
  const newest = level.veins[level.veins.length - 1];
  if (spec.needVeins && newest && solvable({ ...level, veins: level.veins.filter((v) => v !== newest) })) continue;
  if (spec.needLight && solvable({ ...level, edges: level.edges.filter((e) => !e.hidden) })) continue;
  if (!spec.needVeins && level.veins.length && !solvable({ ...level, veins: [] })) continue;
  // Prefer: the droplet moves on every step, many first moves do something, and the
  // solution is not reachable by blind luck (few distinct winning first moves).
  const init = initialState(level);
  let moving = 0;
  let st = init;
  for (const act of a.solution ?? []) {
    const r = applyAction(level, st, act);
    if (!r.ok) break;
    if (r.path.length > 1) moving++;
    st = r.state;
  }
  const score = moving / a.minMoves + a.minMoves * 0.12 + level.nodes.length * 0.02 - Math.abs(a.reachable - 120) / 800;
  if (!best || score > best.score) best = { score, level, sol: (a.solution ?? []).map(actionLabel).join(' '), min: a.minMoves, reach: a.reachable };
}
if (!best) {
  console.log(`l${L + 1}: no candidate found`);
  process.exit(1);
}
console.log(`l${L + 1}: score ${best.score.toFixed(3)}  min ${best.min}  reach ${best.reach}  solution: ${best.sol}`);

if (WRITE) {
  const lv = best.level;
  const fmt = (v: Vec3) => `[${v.map((x) => +x.toFixed(4)).join(', ')}]`;
  const axisName = (v: Vec3) => FACES.find((f) => AXES[f].every((c, i) => c === v[i])) as Axis;
  const out = [
    `// Level ${L + 1} — ${spec.title}. ${spec.comment}`,
    `// Generated by scripts/design-levels.ts ${L} ${triesArg} ${seedArg}; checked by verify-levels.`,
    "import type { LevelDef } from '../puzzle/types';",
    "import { vertsFromPlanes } from '../puzzle/geometry';",
    lv.cracks.length ? "import { AXES } from '../puzzle/rules';" : null,
    "import { BASE_PLANES, veinsFor } from './relic';",
    '',
    `export const level${L + 1}: LevelDef = {`,
    `  id: 'l${L + 1}',`,
    '  hullPoints: vertsFromPlanes(BASE_PLANES),',
    "  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],",
    '  nodes: [',
    ...lv.nodes.map((n) => `    { id: '${n.id}', pos: ${fmt(n.pos)} },`),
    '  ],',
    '  edges: [',
    ...lv.edges.map((e) => `    { a: '${e.a}', b: '${e.b}'${e.hidden ? `, hidden: '${e.hidden}'` : ''} },`),
    '  ],',
    `  veins: veinsFor(${L}),`,
    lv.cracks.length
      ? ['  cracks: [', ...lv.cracks.map((c) => `    { id: '${c.id}', normal: AXES.${axisName(c.normal)}, lights: '${c.lights}', target: ${fmt(c.target as Vec3)} },`), '  ],'].join('\n')
      : '  cracks: [],',
    "  start: { dropletNode: 's' },",
    `  goal: { dropletNode: 'core'${spec.heart ? ", litTargets: ['heart']" : ''} },`,
    `  expectedMinMoves: [${spec.range[0]}, ${spec.range[1]}],`,
    '};',
    '',
  ].filter((l) => l !== null);
  writeFileSync(`src/levels/level${L + 1}.ts`, out.join('\n') + '\n');
  console.log(`wrote src/levels/level${L + 1}.ts`);
}
void allOrientations;
