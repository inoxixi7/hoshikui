// Level 5 — 吞星. Light the inner channel, cross on a vein, and enter the core
// only while the star shines on it.
import type { LevelDef } from '../puzzle/types';
import { plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';
import { BASE_PLANES, veinsFor } from './relic';

// Faces the star once the relic is turned to [0, 0, 1, -1, 0, 0, 0, -1, 0].
const CRACK1 = plane(facingStar([0, 0, 1, -1, 0, 0, 0, -1, 0]), 0.8249);
// Faces the star once the relic is turned to [-1, 0, 0, 0, -1, 0, 0, 0, 1].
const CRACK2 = plane(facingStar([-1, 0, 0, 0, -1, 0, 0, 0, 1]), 0.7775);
const planes = [...BASE_PLANES, CRACK1, CRACK2];

export const level5: LevelDef = {
  id: 'l5',
  hullPoints: vertsFromPlanes(planes),
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 's', pos: [0, 0.3, 0] },
    { id: 'n1', pos: [0, 0.3, 0.3] },
    { id: 'n2', pos: [0.3, 0.3, 0.3] },
    { id: 'core', pos: [0.3, 0.3, 0] },
    { id: 'n4', pos: [-0.3, 0.3, 0.3] },
    { id: 'n5', pos: [0.3, 0, 0] },
    { id: 'n6', pos: [0, 0, 0.3] },
    { id: 'n7', pos: [0.3, 0, 0.3] },
    { id: 'n8', pos: [0.3, 0, -0.3] },
    { id: 'n9', pos: [-0.3, 0.3, 0] },
    { id: 'n10', pos: [0.3, -0.3, 0] },
  ],
  edges: [
    { a: 's', b: 'n1', hidden: 'sun' },
    { a: 'n1', b: 'n2' },
    { a: 's', b: 'core', hidden: 'heart' },
    { a: 'n1', b: 'n4' },
    { a: 'core', b: 'n5', hidden: 'heart' },
    { a: 'n1', b: 'n6' },
    { a: 'n2', b: 'n7' },
    { a: 'n5', b: 'n8' },
    { a: 's', b: 'n9' },
    { a: 'n5', b: 'n10' },
    { a: 'n2', b: 'core', hidden: 'heart' },
    { a: 'n4', b: 'n9' },
    { a: 'n6', b: 'n7' },
  ],
  veins: veinsFor(4),
  cracks: [
    { id: 'c1', normal: CRACK1.n, lights: 'sun', target: [0, 0.3, 0.15] },
    { id: 'heart', normal: CRACK2.n, lights: 'heart', target: [0.3, 0.3, 0] },
  ],
  start: { dropletNode: 's' },
  goal: { dropletNode: 'core', litTargets: ['heart'] },
  expectedMinMoves: [6, 9],
};
