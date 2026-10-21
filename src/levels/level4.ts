// Level 4 — 光与错视. Starlight and a lined-up vein, both needed, in the right order.
import type { LevelDef } from '../puzzle/types';
import { plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';
import { BASE_PLANES, veinsFor } from './relic';

// Faces the star once the relic is turned to [-1, 0, 0, 0, -1, 0, 0, 0, 1].
const CRACK1 = plane(facingStar([-1, 0, 0, 0, -1, 0, 0, 0, 1]), 0.8249);
const planes = [...BASE_PLANES, CRACK1];

export const level4: LevelDef = {
  id: 'l4',
  hullPoints: vertsFromPlanes(planes),
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 's', pos: [-0.3, 0, -0.3] },
    { id: 'n1', pos: [0, 0, -0.3] },
    { id: 'n2', pos: [0, -0.3, -0.3] },
    { id: 'core', pos: [0, -0.3, 0] },
    { id: 'n4', pos: [-0.3, 0.3, -0.3] },
    { id: 'n5', pos: [0.3, 0, -0.3] },
    { id: 'n6', pos: [0.3, 0.3, -0.3] },
    { id: 'n7', pos: [0, 0.3, -0.3] },
  ],
  edges: [
    { a: 's', b: 'n1' },
    { a: 'n1', b: 'n2' },
    { a: 'n2', b: 'core' },
    { a: 's', b: 'n4' },
    { a: 'n1', b: 'n5' },
    { a: 'n5', b: 'n6', hidden: 'sun' },
    { a: 'n6', b: 'n7' },
  ],
  veins: veinsFor(3),
  cracks: [
    { id: 'c1', normal: CRACK1.n, lights: 'sun', target: [0.3, 0.15, -0.3] },
  ],
  start: { dropletNode: 's' },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [5, 7],
};
