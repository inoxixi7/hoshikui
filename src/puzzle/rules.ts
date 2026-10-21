// Pure puzzle rules: (level, state, action) -> new state.
// Never import Three.js here; the renderer only reads what these return.

import type { Action, EdgeDef, GameState, LevelDef, PlateCondition, PoseDef, Vec3 } from './types';
import {
  type Quat,
  dot,
  normalize,
  quatFromAxisAngle,
  quatFromUnitVectors,
  quatInvert,
  quatMul,
  rotate,
  sub,
} from './math';

/** World direction towards the distant star (the only light source). */
export const STAR_DIR: Vec3 = normalize([-0.372, 0.122, -0.92]);
export const LIGHT_COS = Math.cos((25 * Math.PI) / 180);
export const ROLL_THRESHOLD = 0.35;
export const MAX_ROLL_STEPS = 64;
const DOWN: Vec3 = [0, -1, 0];

export function getPose(level: LevelDef, id: string): PoseDef {
  const p = level.poses.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown pose ${id} in ${level.id}`);
  return p;
}

export function nodePos(level: LevelDef, id: string): Vec3 {
  const n = level.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Unknown node ${id} in ${level.id}`);
  return n.pos;
}

/** Rotation taking the pose's down face onto the pedestal, then spun by yaw. */
export function poseQuat(pose: Pick<PoseDef, 'downNormal' | 'yaw'>): Quat {
  const tilt = quatFromUnitVectors(normalize(pose.downNormal), DOWN);
  const yaw = quatFromAxisAngle([0, 1, 0], ((pose.yaw ?? 0) * Math.PI) / 180);
  return quatMul(yaw, tilt);
}

/** Gravity expressed in relic-local coordinates. */
export function localGravity(pose: PoseDef): Vec3 {
  return normalize(rotate(quatInvert(poseQuat(pose)), DOWN));
}

export function platesMatch(plates: Record<string, boolean>, cond?: PlateCondition): boolean {
  if (!cond) return true;
  return Object.entries(cond).every(([k, v]) => (plates[k] ?? false) === v);
}

export function isPoseStable(pose: PoseDef, plates: Record<string, boolean>): boolean {
  return platesMatch(plates, pose.requiresPlates);
}

/** Light targets lit for a pose + plate configuration. */
export function computeLit(level: LevelDef, poseId: string, plates: Record<string, boolean>): string[] {
  const q = poseQuat(getPose(level, poseId));
  const lit: string[] = [];
  for (const c of level.cracks) {
    if (c.blockedByPlates && platesMatch(plates, c.blockedByPlates)) continue;
    const w = rotate(q, normalize(c.normal));
    if (dot(w, STAR_DIR) > LIGHT_COS && !lit.includes(c.lights)) lit.push(c.lights);
  }
  return lit;
}

export function edgePassable(edge: EdgeDef, plates: Record<string, boolean>, lit: string[]): boolean {
  if (edge.hidden && !lit.includes(edge.hidden)) return false;
  return platesMatch(plates, edge.requiresPlates);
}

/**
 * Let the droplet roll under local gravity until it rests.
 * Returns the visited node ids, starting with `from`.
 */
export function rollPath(
  level: LevelDef,
  poseId: string,
  from: string,
  plates: Record<string, boolean>,
  lit: string[],
): string[] {
  const g = localGravity(getPose(level, poseId));
  const path = [from];
  let cur = from;
  for (let i = 0; i < MAX_ROLL_STEPS; i++) {
    const p = nodePos(level, cur);
    let best: string | null = null;
    let bestDot = ROLL_THRESHOLD;
    for (const e of level.edges) {
      if (e.a !== cur && e.b !== cur) continue;
      if (!edgePassable(e, plates, lit)) continue;
      const other = e.a === cur ? e.b : e.a;
      const d = dot(normalize(sub(nodePos(level, other), p)), g);
      if (d > bestDot) {
        bestDot = d;
        best = other;
      }
    }
    if (best === null) break;
    cur = best;
    path.push(cur);
  }
  return path;
}

/** Recompute lighting, then let the droplet settle. Light first: it may open paths. */
export function settle(
  level: LevelDef,
  pose: string,
  dropletNode: string,
  plates: Record<string, boolean>,
): { state: GameState; path: string[] } {
  const lit = computeLit(level, pose, plates);
  const path = rollPath(level, pose, dropletNode, plates, lit);
  return { state: { pose, dropletNode: path[path.length - 1], plates: { ...plates }, lit }, path };
}

export function initialState(level: LevelDef): GameState {
  return settle(level, level.start.pose, level.start.dropletNode, level.start.plates).state;
}

export type ActionResult =
  | { ok: true; state: GameState; path: string[] }
  | { ok: false; reason: 'not-neighbor' | 'unstable-pose' | 'fold-unstable' | 'unknown-plate' };

export function applyAction(level: LevelDef, state: GameState, action: Action): ActionResult {
  if (action.type === 'topple') {
    const cur = getPose(level, state.pose);
    if (!cur.neighbors.includes(action.to)) return { ok: false, reason: 'not-neighbor' };
    const next = getPose(level, action.to);
    if (!isPoseStable(next, state.plates)) return { ok: false, reason: 'unstable-pose' };
    const r = settle(level, next.id, state.dropletNode, state.plates);
    return { ok: true, state: r.state, path: r.path };
  }
  if (!level.plates.some((p) => p.id === action.plate)) return { ok: false, reason: 'unknown-plate' };
  const plates = { ...state.plates, [action.plate]: !(state.plates[action.plate] ?? false) };
  if (!isPoseStable(getPose(level, state.pose), plates)) return { ok: false, reason: 'fold-unstable' };
  const r = settle(level, state.pose, state.dropletNode, plates);
  return { ok: true, state: r.state, path: r.path };
}

export function legalActions(level: LevelDef, state: GameState): Action[] {
  const out: Action[] = [];
  for (const to of getPose(level, state.pose).neighbors) {
    if (isPoseStable(getPose(level, to), state.plates)) out.push({ type: 'topple', to });
  }
  for (const p of level.plates) {
    const plates = { ...state.plates, [p.id]: !(state.plates[p.id] ?? false) };
    if (isPoseStable(getPose(level, state.pose), plates)) out.push({ type: 'fold', plate: p.id });
  }
  return out;
}

export function isWon(level: LevelDef, state: GameState): boolean {
  if (state.dropletNode !== level.goal.dropletNode) return false;
  return (level.goal.litTargets ?? []).every((t) => state.lit.includes(t));
}

/** Local direction that faces the star while resting in the given pose (level design helper). */
export function facingStar(pose: Pick<PoseDef, 'downNormal' | 'yaw'>): Vec3 {
  return normalize(rotate(quatInvert(poseQuat(pose)), STAR_DIR));
}
