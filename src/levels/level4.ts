// Level 4 — 影与光. Two shards. One covers the crown crack: open it to let the
// star in. The other props the thin front face so the relic can stand on it —
// but the relic only stands there once the crown shard is shut again.
import type { LevelDef } from '../puzzle/types';
import { flap, plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';

const B = plane([0, -1, 0], 0.45);
const E = plane([1, 0, 0], 0.62);
const W = plane([-1, 0, 0], 0.62);
const N = plane([0, 0, -1], 0.5);
const S = plane([0, 0, 1], 0.45);
const SLOPE = plane([0, 0.8, 0.6], 0.36);
const CROWN = plane(facingStar({ downNormal: N.n }), 0.5);
const BACK = plane(facingStar({ downNormal: W.n }), 0.52);

const planes = [
  B, E, W, N, S, SLOPE, CROWN, BACK,
  plane([0.6, 0.5, -0.6], 0.82),
  plane([0.55, -0.55, 0.6], 0.78),
];

const prop = flap(planes, 5, 4, 0.5, 0.1, 'a');
const lid = flap(planes, 6, 2, 0.36, 0.14, 'p');

export const level4: LevelDef = {
  id: 'l4',
  hullPoints: vertsFromPlanes(planes),
  poses: [
    { id: 'B', downNormal: B.n, neighbors: ['E', 'W', 'N', 'S'] },
    { id: 'E', downNormal: E.n, neighbors: ['B', 'N', 'S'] },
    { id: 'W', downNormal: W.n, neighbors: ['B', 'N', 'S'] },
    { id: 'N', downNormal: N.n, neighbors: ['B', 'E', 'W'] },
    { id: 'S', downNormal: S.n, neighbors: ['B', 'E', 'W'], requiresPlates: { a: true, p: false } },
  ],
  plates: [prop, lid],
  nodes: [
    { id: 's', pos: [0.45, 0.1, 0.25] },
    { id: 'a', pos: [0.45, 0.1, -0.3] },
    { id: 'b', pos: [-0.45, 0.1, -0.3] },
    { id: 'core', pos: [-0.45, 0.1, 0.25] },
  ],
  edges: [
    { a: 's', b: 'a', hidden: 'sunA' },
    { a: 'a', b: 'b', hidden: 'sunB' },
    { a: 'b', b: 'core' },
  ],
  cracks: [
    { id: 'crown', normal: CROWN.n, lights: 'sunA', blockedByPlates: { p: false }, target: [0.45, 0.1, -0.02] },
    { id: 'back', normal: BACK.n, lights: 'sunB', target: [0, 0.1, -0.3] },
  ],
  start: { pose: 'B', dropletNode: 's', plates: { a: false, p: false } },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [5, 7],
};
