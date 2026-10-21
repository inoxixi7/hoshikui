// Pure geometry helpers used by level data and the verifier.
// A relic is described as an intersection of half-spaces; its hull points are
// the polytope vertices, so every pose face normal is exact by construction.

import type { PlateDef, Vec3 } from './types';
import { add, cross, dot, length, normalize, rotateAroundLine, scale, sub } from './math';

export interface Plane {
  n: Vec3; // outward unit normal
  d: number; // dot(x, n) <= d
}

export const plane = (n: Vec3, d: number): Plane => ({ n: normalize(n), d });

function solve3(a: Plane, b: Plane, c: Plane): Vec3 | null {
  const n1 = a.n, n2 = b.n, n3 = c.n;
  const c23 = cross(n2, n3);
  const det = dot(n1, c23);
  if (Math.abs(det) < 1e-9) return null;
  const p = add(add(scale(c23, a.d), scale(cross(n3, n1), b.d)), scale(cross(n1, n2), c.d));
  return scale(p, 1 / det);
}

/** Vertices of the bounded polytope ∩ {x·n <= d}. Rounded and de-duplicated. */
export function vertsFromPlanes(planes: Plane[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const p = solve3(planes[i], planes[j], planes[k]);
        if (!p) continue;
        if (planes.some((pl) => dot(pl.n, p) > pl.d + 1e-7)) continue;
        const r: Vec3 = [round(p[0]), round(p[1]), round(p[2])];
        if (!out.some((q) => length(sub(q, r)) < 1e-4)) out.push(r);
      }
  return out;
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;

/** Points of `pts` lying on the supporting plane with outward normal n. */
export function supportPoints(pts: Vec3[], n: Vec3, eps = 1e-3): Vec3[] {
  const nn = normalize(n);
  const m = Math.max(...pts.map((p) => dot(p, nn)));
  return pts.filter((p) => dot(p, nn) > m - eps);
}

export function supportDistance(pts: Vec3[], n: Vec3): number {
  const nn = normalize(n);
  return Math.max(...pts.map((p) => dot(p, nn)));
}

/** True if n is a genuine face normal of the hull of pts (≥3 non-collinear support points). */
export function isFaceNormal(pts: Vec3[], n: Vec3): boolean {
  const s = supportPoints(pts, n);
  if (s.length < 3) return false;
  for (let i = 1; i < s.length; i++)
    for (let j = i + 1; j < s.length; j++)
      if (length(cross(sub(s[i], s[0]), sub(s[j], s[0]))) > 1e-4) return true;
  return false;
}

/** Two faces are adjacent if they share at least two hull vertices (an edge). */
export function facesAdjacent(pts: Vec3[], n1: Vec3, n2: Vec3): boolean {
  const a = supportPoints(pts, n1);
  const b = supportPoints(pts, n2);
  return a.filter((p) => b.some((q) => length(sub(p, q)) < 1e-4)).length >= 2;
}

/** Plate outline in its open position (local coordinates). */
export function openPlateShape(p: PlateDef): Vec3[] {
  const [a, b] = p.hingeAxis;
  const angle = (p.openAngle * Math.PI) / 180;
  return p.shape.map((v) => rotateAroundLine(v, a, sub(b, a), angle));
}

/**
 * A flap cut from face `on`, hinged on its shared edge with face `toward`.
 * Opening swings it out until it continues the plane of `toward`.
 * `depth` is how far the flap reaches into `on`; `inset` trims the hinge ends.
 */
export function flap(planes: Plane[], on: number, toward: number, depth: number, inset = 0.12, id = 'p'): PlateDef {
  const pts = vertsFromPlanes(planes);
  const A = planes[on], B = planes[toward];
  const shared = supportPoints(supportPoints(pts, A.n), B.n);
  if (shared.length < 2) throw new Error('flap: faces are not adjacent');
  // Extreme points along the shared edge.
  const dir = normalize(sub(shared[1], shared[0]));
  shared.sort((p, q) => dot(p, dir) - dot(q, dir));
  let h0 = shared[0];
  let h1 = shared[shared.length - 1];
  const edgeLen = length(sub(h1, h0));
  h0 = add(h0, scale(dir, edgeLen * inset));
  h1 = sub(h1, scale(dir, edgeLen * inset));
  // In-plane direction on face `on`, pointing away from the hinge.
  let inward = normalize(cross(A.n, dir));
  const faceCenter = centroid(supportPoints(pts, A.n));
  if (dot(sub(faceCenter, h0), inward) < 0) inward = scale(inward, -1);
  const lift = scale(A.n, 0.012);
  const shape: Vec3[] = [
    add(h0, lift),
    add(h1, lift),
    add(add(h1, scale(inward, depth)), add(lift, scale(dir, -edgeLen * 0.08))),
    add(add(h0, scale(inward, depth)), add(lift, scale(dir, edgeLen * 0.08))),
  ];
  // Opening angle = angle between the two face normals; orient the hinge so a
  // positive rotation lifts the flap off face `on`.
  const angle = (Math.acos(Math.max(-1, Math.min(1, dot(A.n, B.n)))) * 180) / Math.PI;
  let hingeAxis: [Vec3, Vec3] = [add(h0, lift), add(h1, lift)];
  const probe = rotateAroundLine(shape[2], hingeAxis[0], sub(hingeAxis[1], hingeAxis[0]), 0.2);
  if (dot(sub(probe, shape[2]), A.n) < 0) hingeAxis = [hingeAxis[1], hingeAxis[0]];
  return { id, hingeAxis, shape, openAngle: round(angle) };
}

export function centroid(pts: Vec3[]): Vec3 {
  const s = pts.reduce((acc, p) => add(acc, p), [0, 0, 0] as Vec3);
  return scale(s, 1 / pts.length);
}
