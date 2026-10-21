// Level 3 — 错视. The first lit vein runs along the outside of the relic. Turn the
// relic until a vein end and a groove line up on screen — the droplet crosses there.
import type { LevelDef } from '../puzzle/types';
import { vertsFromPlanes } from '../puzzle/geometry';
import { BASE_PLANES, veinsFor } from './relic';

const planes = [...BASE_PLANES];

export const level3: LevelDef = {
  id: 'l3',
  hullPoints: vertsFromPlanes(planes),
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 's', pos: [0.3, 0.3, 0.3] },
    { id: 'n1', pos: [0.3, 0.3, 0] },
    { id: 'n2', pos: [0, 0.3, 0.3] },
    { id: 'n3', pos: [0, 0.3, 0] },
    { id: 'n4', pos: [0, 0.3, -0.3] },
    { id: 'n5', pos: [0, 0, 0.3] },
    { id: 'core', pos: [0.3, 0, 0.3] },
    { id: 'n7', pos: [-0.3, 0.3, 0.3] },
  ],
  edges: [
    { a: 's', b: 'n1' },
    { a: 's', b: 'n2' },
    { a: 'n1', b: 'n3' },
    { a: 'n3', b: 'n4' },
    { a: 'n2', b: 'n5' },
    { a: 'n5', b: 'core' },
    { a: 'n2', b: 'n7' },
  ],
  veins: veinsFor(2),
  cracks: [],
  start: { dropletNode: 's' },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [3, 5],
};
