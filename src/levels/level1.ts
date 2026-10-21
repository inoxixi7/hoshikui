// Level 1 — 翻滚. Only tumbling. Push the relic any way and the droplet runs;
// one way down leads into the core.
import type { LevelDef } from '../puzzle/types';
import { vertsFromPlanes } from '../puzzle/geometry';
import { BASE_PLANES, veinsFor } from './relic';

const planes = [...BASE_PLANES];

export const level1: LevelDef = {
  id: 'l1',
  hullPoints: vertsFromPlanes(planes),
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 's', pos: [0, 0.3, 0] },
    { id: 'n1', pos: [0, 0.3, -0.3] },
    { id: 'n2', pos: [0.3, 0.3, 0] },
    { id: 'n3', pos: [-0.3, 0.3, -0.3] },
    { id: 'n4', pos: [-0.3, 0.3, 0] },
    { id: 'core', pos: [0.3, 0, 0] },
    { id: 'n6', pos: [0, 0.3, 0.3] },
  ],
  edges: [
    { a: 's', b: 'n1' },
    { a: 's', b: 'n2' },
    { a: 'n1', b: 'n3' },
    { a: 'n3', b: 'n4' },
    { a: 'n2', b: 'core' },
    { a: 's', b: 'n6' },
    { a: 's', b: 'n4' },
  ],
  veins: veinsFor(0),
  cracks: [],
  start: { dropletNode: 's' },
  goal: { dropletNode: 'core' },
  expectedMinMoves: [2, 3],
};
