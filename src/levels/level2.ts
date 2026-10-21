// Level 2 — 星光. A sealed channel opens only while the crack faces the star.
// The angle that lets the light in is not the angle that finishes.
import type { LevelDef } from '../puzzle/types';
import { plane, vertsFromPlanes } from '../puzzle/geometry';
import { facingStar } from '../puzzle/rules';
import { BASE_PLANES, veinsFor } from './relic';

// Faces the star once the relic is turned to [1, 0, 0, 0, -1, 0, 0, 0, -1].
const CRACK1 = plane(facingStar([1, 0, 0, 0, -1, 0, 0, 0, -1]), 0.8249);
const planes = [...BASE_PLANES, CRACK1];

export const level2: LevelDef = {
  id: 'l2',
  hullPoints: vertsFromPlanes(planes),
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 's', pos: [0.3, 0, 0] },
    { id: 'n1', pos: [0.3, 0, -0.3] },
    { id: 'n2', pos: [0.3, 0.3, -0.3] },
    { id: 'n3', pos: [0.3, 0.3, 0] },
    { id: 'core', pos: [0, 0.3, -0.3] },
    { id: 'n5', pos: [0, 0, 0] },
  ],
  edges: [
    { a: 's', b: 'n1' },
    { a: 'n1', b: 'n2', hidden: 'sun' },
    { a: 'n2', b: 'n3' },
    { a: 'n2', b: 'core' },
    { a: 's', b: 'n5' },
  ],
  veins: veinsFor(1),
  cracks: [
    { id: 'c1', normal: CRACK1.n, lights: 'sun', target: [0.3, 0.15, -0.3] },
  ],
  start: { dropletNode: 's' },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [3, 5],
};
