// Level 1 — 翻滚. Only toppling. Every first topple visibly moves the droplet,
// but only one face leads straight down into the core.
import type { LevelDef } from '../puzzle/types';
import { plane, vertsFromPlanes } from '../puzzle/geometry';

const B = plane([0, -1, 0], 0.62);
const E = plane([1, 0, 0.06], 0.85);
const W = plane([-1, 0, -0.05], 0.8);
const N = plane([0.04, 0, -1], 0.55);

const planes = [
  B, E, W, N,
  plane([0, 0.08, 1], 0.62), // front
  plane([0.15, 1, 0.1], 0.78), // crown
  plane([-0.6, 0.8, 0.3], 0.86),
  plane([0.6, 0.6, 0.55], 1.0),
  plane([0, -0.7, 0.75], 0.78),
  plane([0.1, 0.7, -0.7], 0.76),
  plane([-0.55, -0.5, 0.6], 0.9),
];

export const level1: LevelDef = {
  id: 'l1',
  hullPoints: vertsFromPlanes(planes),
  poses: [
    { id: 'B', downNormal: B.n, neighbors: ['E', 'W', 'N'] },
    { id: 'E', downNormal: E.n, neighbors: ['B', 'N'] },
    { id: 'W', downNormal: W.n, neighbors: ['B', 'N'] },
    { id: 'N', downNormal: N.n, neighbors: ['B', 'E', 'W'] },
  ],
  plates: [],
  nodes: [
    { id: 's', pos: [0, 0.5, 0.3] },
    { id: 'a', pos: [0.5, 0.5, 0.3] },
    { id: 'b', pos: [-0.5, 0.5, 0.3] },
    { id: 'd', pos: [0, 0.5, -0.2] },
    { id: 'a2', pos: [0.5, -0.35, 0.3] },
    { id: 'b2', pos: [-0.5, -0.35, 0.3] },
    { id: 'a3', pos: [0.5, -0.35, -0.2] },
    { id: 'core', pos: [0, -0.4, -0.2] },
  ],
  edges: [
    { a: 's', b: 'a' },
    { a: 's', b: 'b' },
    { a: 's', b: 'd' },
    { a: 'a', b: 'a2' },
    { a: 'b', b: 'b2' },
    { a: 'a2', b: 'b2' },
    { a: 'a2', b: 'a3' },
    { a: 'a3', b: 'core' },
    { a: 'd', b: 'core' },
  ],
  cracks: [],
  start: { pose: 'B', dropletNode: 's', plates: {} },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [2, 3],
};
