import { describe, expect, it } from 'vitest';
import type { LevelDef, PoseDef } from '../src/puzzle/types';
import {
  STAR_DIR,
  applyAction,
  computeLit,
  facingStar,
  initialState,
  isWon,
  legalActions,
  localGravity,
  poseQuat,
  rollPath,
} from '../src/puzzle/rules';
import { rotate } from '../src/puzzle/math';
import { solve, analyzeLevel } from '../src/puzzle/solver';
import { LEVELS } from '../src/levels';

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

// A cube-like fixture: B = bottom down, E = +X down, N = -Z down, T = top down.
const fixture = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'fx',
  hullPoints: [],
  poses: [
    { id: 'B', downNormal: [0, -1, 0], neighbors: ['E', 'N'] },
    { id: 'E', downNormal: [1, 0, 0], neighbors: ['B', 'N'] },
    { id: 'N', downNormal: [0, 0, -1], neighbors: ['B', 'E'], requiresPlates: { p: true } },
  ],
  plates: [{ id: 'p', hingeAxis: [[0, 0, 0], [1, 0, 0]], shape: [], openAngle: 90 }],
  nodes: [
    { id: 'top', pos: [0, 1, 0] },
    { id: 'mid', pos: [0, 0, 0] },
    { id: 'low', pos: [0, -1, 0] },
    { id: 'east', pos: [1, -1, 0] },
    { id: 'back', pos: [1, -1, -1] },
  ],
  edges: [
    { a: 'top', b: 'mid' },
    { a: 'mid', b: 'low' },
    { a: 'low', b: 'east' },
    { a: 'east', b: 'back', hidden: 'sun' },
  ],
  cracks: [],
  start: { pose: 'B', dropletNode: 'top', plates: { p: false } },
  goal: { dropletNode: 'back' },
  expectedMinMoves: [1, 9],
  ...over,
});

describe('local gravity', () => {
  it('equals the down normal for untwisted and twisted poses', () => {
    const poses: PoseDef[] = [
      { id: 'a', downNormal: [0, -1, 0], neighbors: [] },
      { id: 'b', downNormal: [1, 0, 0], neighbors: [] },
      { id: 'c', downNormal: [0.3, 0.2, -1], yaw: 73, neighbors: [] },
      { id: 'd', downNormal: [0, 1, 0], yaw: 12, neighbors: [] },
    ];
    for (const p of poses) {
      const n = Math.hypot(...p.downNormal);
      close(localGravity(p), p.downNormal.map((x) => x / n));
      close(rotate(poseQuat(p), p.downNormal.map((x) => x / n) as [number, number, number]), [0, -1, 0]);
    }
  });
});

describe('droplet rolling', () => {
  it('rolls along successive edges until it comes to rest', () => {
    const lvl = fixture();
    expect(rollPath(lvl, 'B', 'top', {}, [])).toEqual(['top', 'mid', 'low']);
    expect(rollPath(lvl, 'E', 'low', {}, [])).toEqual(['low', 'east']);
  });

  it('ignores edges below the 0.35 alignment threshold', () => {
    const lvl = fixture({
      nodes: [
        { id: 'top', pos: [0, 0, 0] },
        { id: 'mid', pos: [1, -0.3, 0] }, // dot ≈ 0.29 with gravity
        { id: 'low', pos: [-1, -0.5, 0] }, // dot ≈ 0.45
        { id: 'east', pos: [5, 5, 5] },
        { id: 'back', pos: [6, 6, 6] },
      ],
      edges: [
        { a: 'top', b: 'mid' },
        { a: 'top', b: 'low' },
      ],
    });
    expect(rollPath(lvl, 'B', 'top', {}, [])).toEqual(['top', 'low']);
  });

  it('initial state settles the droplet', () => {
    expect(initialState(fixture()).dropletNode).toBe('low');
  });
});

describe('actions', () => {
  it('rejects toppling to a non-neighbour pose', () => {
    const lvl = fixture({
      poses: [
        { id: 'B', downNormal: [0, -1, 0], neighbors: ['E'] },
        { id: 'E', downNormal: [1, 0, 0], neighbors: ['B'] },
        { id: 'N', downNormal: [0, 0, -1], neighbors: [] },
      ],
    });
    const s = initialState(lvl);
    const r = applyAction(lvl, s, { type: 'topple', to: 'N' });
    expect(r.ok).toBe(false);
  });

  it('rejects toppling onto a face that needs an open plate', () => {
    const lvl = fixture();
    const s = initialState(lvl);
    const r = applyAction(lvl, s, { type: 'topple', to: 'N' });
    expect(r).toEqual({ ok: false, reason: 'unstable-pose' });
    expect(legalActions(lvl, s)).not.toContainEqual({ type: 'topple', to: 'N' });
  });

  it('rejects a fold that would leave the current pose unstable', () => {
    const lvl = fixture();
    let s = initialState(lvl);
    const open = applyAction(lvl, s, { type: 'fold', plate: 'p' });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const onN = applyAction(lvl, open.state, { type: 'topple', to: 'N' });
    expect(onN.ok).toBe(true);
    if (!onN.ok) return;
    s = onN.state;
    expect(applyAction(lvl, s, { type: 'fold', plate: 'p' })).toEqual({ ok: false, reason: 'fold-unstable' });
  });
});

describe('starlight', () => {
  it('lights a crack facing the star and reveals the hidden edge', () => {
    const E = { downNormal: [1, 0, 0] as [number, number, number] };
    const lvl = fixture({ cracks: [{ id: 'c', normal: facingStar(E), lights: 'sun' }] });
    expect(computeLit(lvl, 'B', {})).toEqual([]);
    expect(computeLit(lvl, 'E', {})).toEqual(['sun']);
    // In E the droplet runs low → east; the revealed edge east→back goes -Z, so
    // it rests at east. Toppling to N (plate open) then pulls it along -Z only if lit.
    const s0 = initialState(lvl);
    const r = applyAction(lvl, s0, { type: 'topple', to: 'E' });
    expect(r.ok && r.state.lit).toEqual(['sun']);
    expect(r.ok && r.state.dropletNode).toBe('east');
  });

  it('a hidden edge stays shut while the crack is dark or blocked', () => {
    const lit = fixture({
      poses: [
        { id: 'B', downNormal: [0, -1, 0], neighbors: ['E'] },
        { id: 'E', downNormal: [1, 0, 0], neighbors: ['B', 'K'] },
        { id: 'K', downNormal: [0.7, 0, -0.7], neighbors: ['E'] },
      ],
      cracks: [{ id: 'c', normal: facingStar({ downNormal: [0.7, 0, -0.7] }), lights: 'sun', blockedByPlates: { p: true } }],
    });
    const atEast = { pose: 'K', dropletNode: 'east', plates: { p: false }, lit: [] };
    const open = applyAction(lit, { ...atEast, pose: 'E' }, { type: 'topple', to: 'K' });
    expect(open.ok && open.state.dropletNode).toBe('back');
    const blocked = applyAction(lit, { ...atEast, pose: 'E', plates: { p: true } }, { type: 'topple', to: 'K' });
    expect(blocked.ok && blocked.state.dropletNode).toBe('east');
    expect(STAR_DIR[1]).toBeGreaterThan(0);
  });
});

describe('shipped levels', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('%s is solvable without dead ends', (_id, level) => {
    const a = analyzeLevel(level);
    expect(a.minMoves).not.toBeNull();
    expect(a.deadEnds).toHaveLength(0);
    const sol = solve(level, initialState(level)) ?? [];
    let s = initialState(level);
    for (const act of sol) {
      const r = applyAction(level, s, act);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(isWon(level, s)).toBe(true);
  });
});
