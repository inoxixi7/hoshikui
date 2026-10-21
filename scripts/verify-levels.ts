// Runs the BFS solver over every level and checks the design contract.
// Exits non-zero if any check fails.

import { LEVELS } from '../src/levels';
import type { LevelDef, Vec3 } from '../src/puzzle/types';
import { analyzeLevel } from '../src/puzzle/solver';
import { getPose, isPoseStable, rollPath, computeLit } from '../src/puzzle/rules';
import { facesAdjacent, isFaceNormal, openPlateShape, supportDistance } from '../src/puzzle/geometry';
import { dot, normalize } from '../src/puzzle/math';

type Check = { name: string; pass: boolean; detail: string };

function structureIssues(level: LevelDef): string[] {
  const issues: string[] = [];
  const nodes = new Set(level.nodes.map((n) => n.id));
  const poses = new Set(level.poses.map((p) => p.id));
  const plates = new Set(level.plates.map((p) => p.id));
  const targets = new Set(level.cracks.map((c) => c.lights));
  const cond = (c: Record<string, boolean> | undefined, where: string) =>
    Object.keys(c ?? {}).forEach((k) => plates.has(k) || issues.push(`${where}: unknown plate ${k}`));
  for (const e of level.edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) issues.push(`edge ${e.a}-${e.b}: unknown node`);
    if (e.hidden && !targets.has(e.hidden)) issues.push(`edge ${e.a}-${e.b}: no crack lights ${e.hidden}`);
    cond(e.requiresPlates, `edge ${e.a}-${e.b}`);
  }
  for (const p of level.poses) {
    p.neighbors.forEach((n) => poses.has(n) || issues.push(`pose ${p.id}: unknown neighbor ${n}`));
    p.neighbors.forEach((n) => {
      if (!level.poses.find((q) => q.id === n)?.neighbors.includes(p.id)) issues.push(`pose ${p.id}→${n} not symmetric`);
    });
    cond(p.requiresPlates, `pose ${p.id}`);
  }
  level.cracks.forEach((c) => cond(c.blockedByPlates, `crack ${c.id}`));
  if (!poses.has(level.start.pose)) issues.push('start pose unknown');
  if (!nodes.has(level.start.dropletNode)) issues.push('start node unknown');
  if (!nodes.has(level.goal.dropletNode)) issues.push('goal node unknown');
  (level.goal.litTargets ?? []).forEach((t) => targets.has(t) || issues.push(`goal target ${t} never lit`));
  return issues;
}

function geometryIssues(level: LevelDef): string[] {
  const issues: string[] = [];
  const pts = level.hullPoints;
  for (const p of level.poses) {
    if (!isFaceNormal(pts, p.downNormal)) issues.push(`pose ${p.id}: downNormal is not a hull face`);
    for (const n of p.neighbors) {
      if (!facesAdjacent(pts, p.downNormal, getPose(level, n).downNormal)) issues.push(`pose ${p.id}/${n}: faces not adjacent`);
    }
  }
  for (const c of level.cracks) {
    if (!isFaceNormal(pts, c.normal)) issues.push(`crack ${c.id}: normal is not a hull face`);
  }
  // An open plate must never reach below the face the relic stands on.
  const combos = 1 << level.plates.length;
  for (const pose of level.poses) {
    const ground = supportDistance(pts, pose.downNormal);
    const n = normalize(pose.downNormal);
    for (let m = 0; m < combos; m++) {
      const plates: Record<string, boolean> = {};
      level.plates.forEach((pl, i) => (plates[pl.id] = Boolean(m & (1 << i))));
      if (!isPoseStable(pose, plates)) continue;
      for (const pl of level.plates) {
        if (!plates[pl.id]) continue;
        const below = openPlateShape(pl).some((v: Vec3) => dot(v, n) > ground + 0.02);
        if (below) issues.push(`pose ${pose.id}: plate ${pl.id} open pierces the pedestal`);
      }
    }
  }
  // The start must already be at rest so the first frame is honest.
  const s = level.start;
  const lit = computeLit(level, s.pose, s.plates);
  if (rollPath(level, s.pose, s.dropletNode, s.plates, lit).length > 1) issues.push('droplet not at rest at start');
  return [...new Set(issues)];
}

let failed = false;
const rows: string[][] = [];
for (const level of LEVELS) {
  const a = analyzeLevel(level);
  const [lo, hi] = level.expectedMinMoves;
  const structure = structureIssues(level);
  const geometry = geometryIssues(level);
  const checks: Check[] = [
    { name: 'solvable', pass: a.minMoves !== null, detail: a.minMoves === null ? 'no solution' : 'yes' },
    {
      name: 'minMoves',
      pass: a.minMoves !== null && a.minMoves >= lo && a.minMoves <= hi,
      detail: `${a.minMoves ?? '-'} in [${lo},${hi}]`,
    },
    { name: 'noDeadEnds', pass: a.deadEnds.length === 0, detail: `${a.deadEnds.length}/${a.reachable}` },
    { name: 'initNotWon', pass: !a.initialWon, detail: a.initialWon ? 'won at start' : 'ok' },
    { name: 'structure', pass: structure.length === 0, detail: structure.length ? structure.join('; ') : 'ok' },
    { name: 'geometry', pass: geometry.length === 0, detail: geometry.length ? geometry.join('; ') : 'ok' },
  ];
  if (checks.some((c) => !c.pass)) failed = true;
  rows.push([
    level.id,
    ...checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.detail}`),
    a.solution ? a.solution.map((x) => (x.type === 'topple' ? `→${x.to}` : `⟲${x.plate}`)).join(' ') : '-',
  ]);
  for (const d of a.deadEnds.slice(0, 5)) console.log(`  dead end in ${level.id}:`, JSON.stringify(d));
}

const header = ['level', 'solvable', 'minMoves', 'noDeadEnds (dead/reach)', 'initNotWon', 'structure', 'geometry', 'solution'];
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
console.log(line(header));
console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
rows.forEach((r) => console.log(line(r)));
console.log(failed ? '\nverify-levels: FAIL' : `\nverify-levels: PASS (${LEVELS.length} levels)`);
process.exit(failed ? 1 : 0);
