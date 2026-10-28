// Pure puzzle rules: (level, state, action) -> new state.
// Never import Three.js here; the renderer only reads what these return.

import type { Action, Axis, Dir, EdgeDef, GameState, LevelDef, Mat3, Turn, Vec3 } from './types';
import { cross, dot, normalize, quatFromAxisAngle, sub } from './math';

/** Fixed isometric view: unit vector from the relic towards the camera. */
export const VIEW_DIR: Vec3 = normalize([1, 1, 1]);
/** Screen-up direction for that view (world Y with the view component removed). */
export const VIEW_UP: Vec3 = normalize([-1, 2, -1]);
export const VIEW_RIGHT: Vec3 = normalize(cross(VIEW_UP, VIEW_DIR));

/**
 * World direction towards the distant star. It shines from the left of the screen,
 * across the lower-left face of the relic (world +Z), so a lit face is always one the
 * player can see.
 */
export const STAR_DIR: Vec3 = normalize([-0.25, 0.35, 1]);
export const LIGHT_COS = Math.cos((30 * Math.PI) / 180);
export const ROLL_THRESHOLD = 0.35;
export const MAX_ROLL_STEPS = 64;
/** Two points line up on screen when their projections are this close (world units). */
export const OVERLAP_TOL = 0.03;

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const DIRS: Dir[] = ['px', 'nx', 'pz', 'nz'];

export const AXES: Record<Axis, Vec3> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Local → world. */
export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const orientKey = (m: Mat3): string => m.join(',');

/** Rotation that tips the relic over its edge on the `dir` side (top moves towards dir). */
export const TIP: Record<Dir, Mat3> = {
  // About -Z by 90°: +Y → +X.
  px: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  // About +Z by 90°: +Y → -X.
  nx: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  // About +X by 90°: +Y → +Z.
  pz: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  // About -X by 90°: +Y → -Z.
  nz: [1, 0, 0, 0, 0, 1, 0, -1, 0],
};

/** Turning on the pedestal: a quarter turn about world Y. */
export const SPIN: Record<Turn, Mat3> = {
  1: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  [-1]: [0, 0, -1, 0, 1, 0, 1, 0, 0],
};

/** Rotation applied by an action (left-multiplied onto the orientation). */
export const actionMat = (a: Action): Mat3 => a.m;

export const rotateAction = (m: Mat3): Action => ({ type: 'rotate', m });

/** Short label for logs and tables: rotation axis and angle, e.g. "y+90". */
export function actionLabel(a: Action): string {
  const m = a.m;
  const tr = m[0] + m[4] + m[8];
  const angle = Math.round((Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI);
  let axis: Vec3 = [m[7] - m[5], m[2] - m[6], m[3] - m[1]];
  if (angle === 180) {
    // Axis from the symmetric part: (M + I) / 2 = a·aᵀ.
    const d = [(m[0] + 1) / 2, (m[4] + 1) / 2, (m[8] + 1) / 2];
    const i = d.indexOf(Math.max(...d));
    const col = [m[i] + (i === 0 ? 1 : 0), m[3 + i] + (i === 1 ? 1 : 0), m[6 + i] + (i === 2 ? 1 : 0)];
    axis = normalize(col as Vec3);
  }
  const n = normalize(axis).map((c) => Math.round(c * 100) / 100);
  const name = n.map((c, i) => (Math.abs(c) < 0.01 ? '' : `${c < 0 ? '-' : ''}${'xyz'[i]}`)).join('');
  return `${name}${angle === 180 ? '' : '+'}${angle}`;
}

/** The action that undoes `a`. */
export const inverseAction = (a: Action): Action => ({ type: 'rotate', m: transpose(a.m) });

export function axisOf(v: Vec3): Axis {
  const [x, y, z] = v.map((c) => Math.round(c));
  if (x === 1) return 'px';
  if (x === -1) return 'nx';
  if (y === 1) return 'py';
  if (y === -1) return 'ny';
  if (z === 1) return 'pz';
  return 'nz';
}

/** Local axis of the face touching the pedestal. */
export const downAxis = (m: Mat3): Axis => axisOf(apply(transpose(m), [0, -1, 0]));

/** Gravity in relic-local coordinates. */
export const localGravity = (m: Mat3): Vec3 => apply(transpose(m), [0, -1, 0]);

export function isStable(level: LevelDef, m: Mat3): boolean {
  return level.stableFaces.includes(downAxis(m));
}

export function nodePos(level: LevelDef, id: string): Vec3 {
  const n = allNodes(level).find((x) => x.id === id);
  if (!n) throw new Error(`Unknown node ${id} in ${level.id}`);
  return n.pos;
}

/** Groove nodes plus the nodes of every lit vein (outer edges lit by earlier levels). */
export function allNodes(level: LevelDef): { id: string; pos: Vec3; vein?: string }[] {
  const out: { id: string; pos: Vec3; vein?: string }[] = level.nodes.map((n) => ({ ...n }));
  for (const v of level.veins) v.points.forEach((p, i) => out.push({ id: `${v.id}.${i}`, pos: p, vein: v.id }));
  return out;
}

/** Groove edges plus the segments of every lit vein. */
export function allEdges(level: LevelDef): EdgeDef[] {
  const out = [...level.edges];
  for (const v of level.veins) for (let i = 1; i < v.points.length; i++) out.push({ a: `${v.id}.${i - 1}`, b: `${v.id}.${i}` });
  return out;
}

/** Screen-plane coordinates of a local point under orientation m (fixed view). */
export function project(m: Mat3, p: Vec3): [number, number] {
  const w = apply(m, p);
  return [dot(w, VIEW_RIGHT), dot(w, VIEW_UP)];
}

/**
 * Pairs of nodes that line up on screen in this orientation, where at least one
 * belongs to a lit vein. The droplet may pass between them as if they touched.
 */
export function overlaps(level: LevelDef, m: Mat3): [string, string][] {
  const nodes = allNodes(level);
  const proj = nodes.map((n) => project(m, n.pos));
  const out: [string, string][] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      if (!nodes[i].vein && !nodes[j].vein) continue;
      if (nodes[i].vein && nodes[i].vein === nodes[j].vein) continue;
      if (Math.hypot(proj[i][0] - proj[j][0], proj[i][1] - proj[j][1]) < OVERLAP_TOL) out.push([nodes[i].id, nodes[j].id]);
    }
  return out;
}

/** Light targets lit in an orientation. */
export function computeLit(level: LevelDef, m: Mat3): string[] {
  const lit: string[] = [];
  for (const c of level.cracks) {
    const w = apply(m, normalize(c.normal));
    if (dot(w, STAR_DIR) > LIGHT_COS && !lit.includes(c.lights)) lit.push(c.lights);
  }
  return lit;
}

export function edgePassable(edge: EdgeDef, lit: string[]): boolean {
  return !edge.hidden || lit.includes(edge.hidden);
}

/** One step of the droplet's path: `via` is set when it slipped through a visual overlap. */
export interface RollStep {
  node: string;
  via?: string;
}

/**
 * Let the droplet roll under local gravity until it rests. From each node it may
 * leave along its own grooves or along those of any node lined up with it on screen.
 */
export function rollPath(level: LevelDef, m: Mat3, from: string, lit: string[]): RollStep[] {
  const g = localGravity(m);
  const edges = allEdges(level);
  const links = overlaps(level, m);
  const pos = new Map(allNodes(level).map((n) => [n.id, n.pos]));
  const path: RollStep[] = [{ node: from }];
  const seen = new Set([from]);
  let cur = from;
  for (let i = 0; i < MAX_ROLL_STEPS; i++) {
    const starts = [cur, ...links.filter((l) => l.includes(cur)).map((l) => (l[0] === cur ? l[1] : l[0]))];
    let best: RollStep | null = null;
    let bestDot = ROLL_THRESHOLD;
    for (const s of starts) {
      const p = pos.get(s) as Vec3;
      for (const e of edges) {
        if (e.a !== s && e.b !== s) continue;
        if (!edgePassable(e, lit)) continue;
        const other = e.a === s ? e.b : e.a;
        if (seen.has(other)) continue;
        const d = dot(normalize(sub(pos.get(other) as Vec3, p)), g);
        if (d > bestDot + 1e-9) {
          bestDot = d;
          best = s === cur ? { node: other } : { node: other, via: s };
        }
      }
    }
    if (!best) break;
    cur = best.node;
    seen.add(cur);
    path.push(best);
  }
  return path;
}

export function settle(level: LevelDef, orient: Mat3, dropletNode: string): { state: GameState; path: RollStep[] } {
  const lit = computeLit(level, orient);
  const path = rollPath(level, orient, dropletNode, lit);
  return { state: { orient, dropletNode: path[path.length - 1].node, lit }, path };
}

export function initialState(level: LevelDef): GameState {
  return settle(level, level.start.orient ?? IDENTITY, level.start.dropletNode).state;
}

export type ActionResult = { ok: true; state: GameState; path: RollStep[] } | { ok: false; reason: 'unstable-face' };

export function applyAction(level: LevelDef, state: GameState, action: Action): ActionResult {
  if (!ROTATIONS.has(orientKey(action.m))) return { ok: false, reason: 'unstable-face' };
  const next = mulMat(action.m, state.orient);
  if (!isStable(level, next)) return { ok: false, reason: 'unstable-face' };
  const r = settle(level, next, state.dropletNode);
  return { ok: true, state: r.state, path: r.path };
}

/** Every move one free drag (or a push, or a pedestal turn) can make. */
export function legalActions(level: LevelDef, state: GameState): Action[] {
  return DRAG_ROTATIONS.filter((m) => isStable(level, mulMat(m, state.orient))).map(rotateAction);
}

export function isWon(level: LevelDef, state: GameState): boolean {
  if (state.dropletNode !== level.goal.dropletNode) return false;
  return (level.goal.litTargets ?? []).every((t) => state.lit.includes(t));
}

/** Local direction that faces the star in orientation m (level design helper). */
export function facingStar(m: Mat3): Vec3 {
  return normalize(apply(transpose(m), STAR_DIR));
}

/** Rotation matrix → quaternion [x, y, z, w] (for the renderer). */
export function matToQuat(m: Mat3): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** Every rotation of the cube (for design tools and the verifier). */
export function allOrientations(): Mat3[] {
  const seen = new Map<string, Mat3>([[orientKey(IDENTITY), IDENTITY]]);
  const queue: Mat3[] = [IDENTITY];
  for (let h = 0; h < queue.length; h++)
    for (const d of DIRS) {
      const n = mulMat(TIP[d], queue[h]);
      for (const m of [n, mulMat([0, 0, -1, 0, 1, 0, 1, 0, 0], queue[h])]) {
        if (!seen.has(orientKey(m))) {
          seen.set(orientKey(m), m);
          queue.push(m);
        }
      }
    }
  return [...seen.values()];
}

const ROTATIONS = new Set(allOrientations().map(orientKey));

/**
 * The rotations a single free drag can end on. A drag turns the relic about an axis
 * in the screen plane by up to half a turn; on release it settles on the nearest
 * cube orientation. Sampled once, finely, from the fixed view.
 */
export const DRAG_ROTATIONS: Mat3[] = (() => {
  const all = allOrientations();
  const qs = all.map(matToQuat);
  const hit = new Set<number>();
  for (let a = 0; a < 360; a += 1)
    for (let t = 1; t <= 180; t += 1) {
      const ang = (a * Math.PI) / 180;
      const axis: Vec3 = [0, 1, 2].map((i) => VIEW_UP[i] * Math.cos(ang) + VIEW_RIGHT[i] * Math.sin(ang)) as Vec3;
      hit.add(nearestIndex(qs, quatFromAxisAngle(axis, (t * Math.PI) / 180)));
    }
  return all.filter((m, i) => hit.has(i) && orientKey(m) !== orientKey(IDENTITY));
})();

function nearestIndex(qs: number[][], q: number[]): number {
  let best = 0;
  let bestDot = -1;
  qs.forEach((r, i) => {
    const d = Math.abs(r[0] * q[0] + r[1] * q[1] + r[2] * q[2] + r[3] * q[3]);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}

/**
 * Snap a free rotation (quaternion, world space) to the nearest move a drag can make,
 * or null if it is closest to not moving at all.
 */
export function snapDrag(q: [number, number, number, number]): Mat3 | null {
  const cands = [IDENTITY, ...DRAG_ROTATIONS];
  const i = nearestIndex(cands.map(matToQuat), q);
  return i === 0 ? null : cands[i];
}
