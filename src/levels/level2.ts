// Level 2 — 星光. The groove to the core is sealed by a hidden channel that only
// opens while the crown crack faces the star. That pose alone does not finish.
import type { LevelDef } from '../puzzle/types';
import { plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';

const B = plane([0, -1, 0], 0.6);
const E = plane([1, 0, 0.05], 0.82);
const W = plane([-1, 0, 0], 0.82);
const N = plane([0, 0, -1], 0.6);
const T = plane([0.3, 1, 0], 0.78);
const nN = N.n;
const C = plane(facingStar({ downNormal: nN }), 0.8); // the crown crack faces the star in pose N

const planes = [
  B, E, W, N, T, C,
  plane([0, 0.05, 1], 0.62), // front
  plane([0.55, -0.6, 0.6], 0.95),
  plane([-0.6, -0.5, -0.6], 0.98),
  plane([0.6, 0.45, -0.65], 1.02),
];

export const level2: LevelDef = {
  id: 'l2',
  hullPoints: vertsFromPlanes(planes),
  poses: [
    { id: 'B', downNormal: B.n, neighbors: ['E', 'W', 'N'] },
    { id: 'E', downNormal: E.n, neighbors: ['B', 'N', 'T'] },
    { id: 'W', downNormal: W.n, neighbors: ['B', 'N'] },
    { id: 'N', downNormal: nN, neighbors: ['B', 'E', 'W', 'T'] },
    { id: 'T', downNormal: T.n, neighbors: ['E', 'N'] },
  ],
  plates: [],
  nodes: [
    { id: 's', pos: [0, 0.4, 0.25] },
    { id: 'x', pos: [0.5, 0.4, 0.25] },
    { id: 'w', pos: [-0.5, 0.4, 0.25] },
    { id: 'y', pos: [0.5, 0.4, -0.3] },
    { id: 'w2', pos: [-0.5, -0.35, 0.25] },
    { id: 'x2', pos: [0.5, -0.35, 0.25] },
    { id: 'core', pos: [0.1, -0.35, -0.3] },
  ],
  edges: [
    { a: 's', b: 'x' },
    { a: 's', b: 'w' },
    { a: 'x', b: 'y', hidden: 'sun' },
    { a: 'y', b: 'core' },
    { a: 'w', b: 'w2' },
    { a: 'x', b: 'x2' },
    { a: 'w2', b: 'x2' },
  ],
  cracks: [{ id: 'crown', normal: C.n, lights: 'sun', target: [0.5, 0.4, -0.02] }],
  start: { pose: 'B', dropletNode: 's', plates: {} },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [3, 5],
};
