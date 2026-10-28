// The one relic every level is carved from: a basalt cube. Its five star veins
// run along outer edges; each solved level lights the next one.
import type { Vec3, VeinDef } from '../puzzle/types';
import { type Plane, plane } from '../puzzle/geometry';

export const H = 0.6; // half size

/** The six faces of the cube; it can rest on any of them. */
export const BASE_PLANES: Plane[] = [
  plane([1, 0, 0], H),
  plane([-1, 0, 0], H),
  plane([0, 1, 0], H),
  plane([0, -1, 0], H),
  plane([0, 0, 1], H),
  plane([0, 0, -1], H),
];

const seg = (a: Vec3, b: Vec3): Vec3[] => [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b];

/** Veins in the order they light up: vein k is lit for every level after level k. */
export const VEINS: VeinDef[] = [
  { id: 'v1', points: seg([-0.3, H, H], [0.3, H, H]) },
  { id: 'v2', points: seg([H, H, -0.3], [H, H, 0.3]) },
  { id: 'v3', points: seg([H, -0.3, H], [H, 0.3, H]) },
  { id: 'v4', points: seg([-0.3, -H, H], [0.3, -H, H]) },
  { id: 'v5', points: seg([-H, H, -0.3], [-H, H, 0.3]) },
];

/** Veins already lit when entering level index i (0-based). */
export const veinsFor = (i: number): VeinDef[] => VEINS.slice(0, i);
