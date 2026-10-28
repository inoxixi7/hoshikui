// Runs the BFS solver over every level and checks the design contract.
// Exits non-zero if any check fails.

import { LEVELS } from '../src/levels';
import { VEINS } from '../src/levels/relic';
import type { LevelDef } from '../src/puzzle/types';
import { analyzeLevel } from '../src/puzzle/solver';
import { AXES, IDENTITY, actionLabel, allNodes, allOrientations, computeLit, isStable, rollPath } from '../src/puzzle/rules';
import { isFaceNormal } from '../src/puzzle/geometry';
import { dot } from '../src/puzzle/math';

type Check = { name: string; pass: boolean; detail: string };

/** What each level must teach: which mechanics the solution cannot do without. */
const INTENT: { light: boolean; veins: boolean }[] = [
  { light: false, veins: false },
  { light: true, veins: false },
  { light: false, veins: true },
  { light: true, veins: true },
  { light: true, veins: true },
];

function structureIssues(level: LevelDef, index: number): string[] {
  const issues: string[] = [];
  const nodes = new Set(allNodes(level).map((n) => n.id));
  if (nodes.size !== allNodes(level).length) issues.push('duplicate node ids');
  const targets = new Set(level.cracks.map((c) => c.lights));
  for (const e of level.edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) issues.push(`edge ${e.a}-${e.b}: unknown node`);
    if (e.hidden && !targets.has(e.hidden)) issues.push(`edge ${e.a}-${e.b}: no crack lights ${e.hidden}`);
  }
  if (!nodes.has(level.start.dropletNode)) issues.push('start node unknown');
  if (!nodes.has(level.goal.dropletNode)) issues.push('goal node unknown');
  (level.goal.litTargets ?? []).forEach((t) => targets.has(t) || issues.push(`goal target ${t} never lit`));
  // Veins: exactly the ones earned by the levels before this one.
  const expect = VEINS.slice(0, index).map((v) => v.id).join(',');
  if (level.veins.map((v) => v.id).join(',') !== expect) issues.push(`veins should be [${expect}]`);
  return issues;
}

function geometryIssues(level: LevelDef): string[] {
  const issues: string[] = [];
  const pts = level.hullPoints;
  for (const f of level.stableFaces) if (!isFaceNormal(pts, AXES[f])) issues.push(`stable face ${f} is not a hull face`);
  for (const c of level.cracks) if (!isFaceNormal(pts, c.normal)) issues.push(`crack ${c.id}: not a hull face`);
  // Every vein point must sit on the hull surface (no crack facet may cut it away).
  for (const v of VEINS)
    for (const p of v.points) {
      const outside = level.hullPoints.length && Math.max(...pts.map((q) => dot(q, p))) < dot(p, p) - 1e-3;
      if (outside) issues.push(`vein ${v.id} point cut away`);
    }
  // Each crack must be lightable in some orientation the relic can rest in.
  for (const c of level.cracks) {
    const ok = allOrientations().some((m) => isStable(level, m) && computeLit({ ...level, cracks: [c] }, m).length > 0);
    if (!ok) issues.push(`crack ${c.id} can never face the star`);
  }
  const orient = level.start.orient ?? IDENTITY;
  if (!isStable(level, orient)) issues.push('start orientation is not stable');
  if (rollPath(level, orient, level.start.dropletNode, computeLit(level, orient)).length > 1) issues.push('droplet not at rest at start');
  return [...new Set(issues)];
}

function needs(level: LevelDef, index: number): string[] {
  const issues: string[] = [];
  const solvable = (l: LevelDef) => analyzeLevel(l).minMoves !== null;
  const want = INTENT[index];
  const noLight = { ...level, edges: level.edges.filter((e) => !e.hidden) };
  const noVeins = { ...level, veins: [] };
  if (want.light && solvable(noLight)) issues.push('solvable without light');
  if (want.veins && solvable(noVeins)) issues.push('solvable without veins');
  const newest = level.veins[level.veins.length - 1];
  if (want.veins && newest && solvable({ ...level, veins: level.veins.slice(0, -1) })) issues.push(`solvable without newest vein ${newest.id}`);
  return issues;
}

let failed = false;
const rows: string[][] = [];
LEVELS.forEach((level, index) => {
  const a = analyzeLevel(level);
  const [lo, hi] = level.expectedMinMoves;
  const structure = structureIssues(level, index);
  const geometry = geometryIssues(level);
  const intent = needs(level, index);
  const checks: Check[] = [
    { name: 'solvable', pass: a.minMoves !== null, detail: a.minMoves === null ? 'no solution' : 'yes' },
    { name: 'minMoves', pass: a.minMoves !== null && a.minMoves >= lo && a.minMoves <= hi, detail: `${a.minMoves ?? '-'} in [${lo},${hi}]` },
    { name: 'noDeadEnds', pass: a.deadEnds.length === 0, detail: `${a.deadEnds.length}/${a.reachable}` },
    { name: 'initNotWon', pass: !a.initialWon, detail: a.initialWon ? 'won at start' : 'ok' },
    { name: 'intent', pass: intent.length === 0, detail: intent.length ? intent.join('; ') : `${INTENT[index].light ? 'light ' : ''}${INTENT[index].veins ? 'veins' : ''}`.trim() || 'tumble' },
    { name: 'structure', pass: structure.length === 0, detail: structure.length ? structure.join('; ') : 'ok' },
    { name: 'geometry', pass: geometry.length === 0, detail: geometry.length ? geometry.join('; ') : 'ok' },
  ];
  if (checks.some((c) => !c.pass)) failed = true;
  rows.push([level.id, ...checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.detail}`), a.solution ? a.solution.map(actionLabel).join(' ') : '-']);
  for (const d of a.deadEnds.slice(0, 5)) console.log(`  dead end in ${level.id}:`, JSON.stringify(d));
});

const header = ['level', 'solvable', 'minMoves', 'noDeadEnds (dead/reach)', 'initNotWon', 'needs', 'structure', 'geometry', 'solution'];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
console.log(line(header));
console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
rows.forEach((r) => console.log(line(r)));
console.log(failed ? '\nverify-levels: FAIL' : `\nverify-levels: PASS (${LEVELS.length} levels)`);
process.exit(failed ? 1 : 0);
