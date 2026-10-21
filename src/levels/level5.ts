// Level 5 — 吞星. Everything at once: open the crown to the star, shut it again so
// the propped front face will hold, then lay the relic on its side and open the
// last shard so starlight reaches the heart just as the droplet does.
import type { LevelDef } from '../puzzle/types';
import { flap, plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';

const B = plane([0, -1, 0], 0.5);
const E = plane([1, 0, 0.03], 0.72);
const W = plane([-1, 0, 0], 0.72);
const N = plane([0, 0, -1], 0.58);
const S = plane([0, 0, 1], 0.5);
const SLOPE = plane([0, 0.8, 0.6], 0.56);
const CROWN = plane(facingStar({ downNormal: N.n }), 0.66);
const BACK = plane(facingStar({ downNormal: W.n }), 0.62);

const planes = [
  B, E, W, N, S, SLOPE, CROWN, BACK,
  plane([0.62, 0.5, -0.6], 0.9),
  plane([0.55, -0.55, 0.6], 0.82),
  plane([-0.6, -0.55, 0.55], 0.84),
  plane([0.7, 0.4, 0.55], 0.95),
];

const prop = flap(planes, 5, 4, 0.5, 0.12, 'a');
const crownLid = flap(planes, 6, 2, 0.4, 0.14, 'p');
const heartLid = flap(planes, 7, 3, 0.4, 0.16, 'q');

export const level5: LevelDef = {
  id: 'l5',
  hullPoints: vertsFromPlanes(planes),
  poses: [
    { id: 'B', downNormal: B.n, neighbors: ['E', 'W', 'N', 'S'] },
    { id: 'E', downNormal: E.n, neighbors: ['B', 'N', 'S'] },
    { id: 'W', downNormal: W.n, neighbors: ['B', 'N', 'S'] },
    { id: 'N', downNormal: N.n, neighbors: ['B', 'E', 'W'] },
    { id: 'S', downNormal: S.n, neighbors: ['B', 'E', 'W'], requiresPlates: { a: true, p: false } },
  ],
  plates: [prop, crownLid, heartLid],
  nodes: [
    { id: 's', pos: [0.5, 0.1, 0.25] },
    { id: 'w', pos: [-0.05, 0.1, 0.25] },
    { id: 'a', pos: [0.5, 0.1, -0.35] },
    { id: 'b', pos: [0.5, 0.35, 0.2] },
    { id: 'core', pos: [-0.35, 0.35, 0.2] },
  ],
  edges: [
    { a: 's', b: 'w' },
    { a: 's', b: 'a', hidden: 'sunA' },
    { a: 'a', b: 'b' },
    { a: 'b', b: 'core', hidden: 'heart' },
  ],
  cracks: [
    { id: 'crown', normal: CROWN.n, lights: 'sunA', blockedByPlates: { p: false }, target: [0.5, 0.1, -0.05] },
    { id: 'heart', normal: BACK.n, lights: 'heart', blockedByPlates: { q: false }, target: [-0.35, 0.35, 0.2] },
  ],
  start: { pose: 'B', dropletNode: 's', plates: { a: false, p: false, q: false } },
  goal: { dropletNode: 'core', litTargets: ['heart'] },
  expectedMinMoves: [6, 9],
};
