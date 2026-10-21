// Level 3 — 折叠. A wedge whose front face is too thin to stand on. Lifting the
// shard on its slope extends that face so the relic can rest there — but the
// open shard also severs the groove the droplet needs first.
import type { LevelDef } from '../puzzle/types';
import { flap, plane, vertsFromPlanes } from '../puzzle/geometry';

const B = plane([0, -1, 0], 0.55);
const E = plane([1, 0, 0], 0.8);
const W = plane([-1, 0, -0.04], 0.8);
const S = plane([0, 0, 1], 0.6);
const SLOPE = plane([0, 0.8, 0.6], 0.2);

const planes = [
  B, E, W, S, SLOPE,
  plane([0, 0, -1], 0.7), // back
  plane([0.5, 0.5, -0.7], 0.92),
  plane([-0.6, 0.35, -0.72], 0.92),
  plane([-0.6, -0.6, -0.5], 0.85),
];

const shard = flap(planes, 4, 3, 0.62, 0.1, 'p');

export const level3: LevelDef = {
  id: 'l3',
  hullPoints: vertsFromPlanes(planes),
  poses: [
    { id: 'B', downNormal: B.n, neighbors: ['E', 'W', 'S'] },
    { id: 'E', downNormal: E.n, neighbors: ['B', 'S'] },
    { id: 'W', downNormal: W.n, neighbors: ['B', 'S'] },
    { id: 'S', downNormal: S.n, neighbors: ['B', 'E', 'W'], requiresPlates: { p: true } },
  ],
  plates: [shard],
  nodes: [
    { id: 's', pos: [-0.1, -0.25, -0.35] },
    { id: 'w', pos: [-0.55, -0.25, -0.35] },
    { id: 'm', pos: [0.4, -0.25, -0.35] },
    { id: 'core', pos: [0.4, -0.25, 0.25] },
  ],
  edges: [
    { a: 'w', b: 's' },
    { a: 's', b: 'm', requiresPlates: { p: false } },
    { a: 'm', b: 'core' },
  ],
  cracks: [],
  start: { pose: 'B', dropletNode: 's', plates: { p: false } },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [3, 5],
};
