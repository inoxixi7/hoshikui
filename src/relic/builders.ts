// Small geometry builders shared by the relic visuals.

import * as THREE from 'three';
import type { Vec3 } from '../puzzle/types';

export const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

/** A cylinder spanning a→b; its local Y runs from a (y=0) to b (y=1) when scaled by length. */
export function segmentMesh(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material, radial = 6): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, radial, 1, false);
  geo.translate(0, 0.5, 0);
  const m = new THREE.Mesh(geo, mat);
  placeSegment(m, a, b, 1);
  return m;
}

/** Re-place a unit segment mesh to cover a fraction [from, to] of a→b. */
export function placeSegment(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, to: number, from = 0) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  m.position.copy(a).addScaledVector(dir, len * from);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.scale.set(1, Math.max(1e-4, len * (to - from)), 1);
}

/** A flat strip following a polyline lying on a plane with normal n. */
export function ribbonGeometry(points: THREE.Vector3[], width: number, n: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const t = next.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(n, t).normalize();
    const taper = i === 0 || i === points.length - 1 ? 0.25 : 1;
    const w = (width / 2) * taper;
    const l = points[i].clone().addScaledVector(side, w);
    const r = points[i].clone().addScaledVector(side, -w);
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A thin prism from a planar outline, extruded along n by `thickness`. */
export function prismGeometry(outline: THREE.Vector3[], n: THREE.Vector3, thickness: number): THREE.BufferGeometry {
  const top = outline.map((p) => p.clone().addScaledVector(n, thickness));
  const tris: THREE.Vector3[] = [];
  for (let i = 1; i < outline.length - 1; i++) {
    tris.push(top[0], top[i], top[i + 1]);
    tris.push(outline[0], outline[i + 1], outline[i]);
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    tris.push(outline[i], outline[j], top[j], outline[i], top[j], top[i]);
  }
  // Fix winding so faces point outward from the prism centre.
  const c = new THREE.Vector3();
  [...outline, ...top].forEach((p) => c.add(p));
  c.multiplyScalar(1 / (outline.length * 2));
  const pos: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, d] = [tris[i], tris[i + 1], tris[i + 2]];
    const nrm = new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a));
    const mid = a.clone().add(b).add(d).multiplyScalar(1 / 3);
    const flip = nrm.dot(mid.sub(c)) < 0;
    const order = flip ? [a, d, b] : [a, b, d];
    order.forEach((p) => pos.push(p.x, p.y, p.z));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Deterministic jagged polyline across a face, used for cracks. */
export function crackPolyline(center: THREE.Vector3, n: THREE.Vector3, length: number, seed: number): THREE.Vector3[] {
  const tangent = new THREE.Vector3(0, 1, 0).cross(n);
  if (tangent.lengthSq() < 1e-4) tangent.set(1, 0, 0).cross(n);
  tangent.normalize();
  const bi = new THREE.Vector3().crossVectors(n, tangent).normalize();
  const dir = tangent.clone().multiplyScalar(Math.cos(seed)).addScaledVector(bi, Math.sin(seed));
  const perp = new THREE.Vector3().crossVectors(n, dir).normalize();
  const pts: THREE.Vector3[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps - 0.5;
    const wobble = i === 0 || i === steps ? 0 : Math.sin(seed * 13.1 + i * 2.7) * 0.045;
    pts.push(center.clone().addScaledVector(dir, t * length).addScaledVector(perp, wobble));
  }
  return pts;
}
