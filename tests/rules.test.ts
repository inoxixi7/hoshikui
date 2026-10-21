import { describe, expect, it } from 'vitest';
import type { LevelDef, Mat3, Vec3 } from '../src/puzzle/types';
import {
  IDENTITY,
  TIP,
  VIEW_DIR,
  allOrientations,
  apply,
  applyAction,
  computeLit,
  downAxis,
  facingStar,
  initialState,
  isWon,
  legalActions,
  localGravity,
  matToQuat,
  mulMat,
  overlaps,
  rollPath,
  transpose,
} from '../src/puzzle/rules';
import { rotate } from '../src/puzzle/math';
import { solve, analyzeLevel } from '../src/puzzle/solver';
import { LEVELS } from '../src/levels';

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

// A cube fixture with a vertical groove and a side branch.
const fixture = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 'fx',
  hullPoints: [],
  stableFaces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
  nodes: [
    { id: 'top', pos: [0, 0.3, 0] },
    { id: 'mid', pos: [0, 0, 0] },
    { id: 'low', pos: [0, -0.3, 0] },
    { id: 'east', pos: [0.3, -0.3, 0] },
    { id: 'back', pos: [0.3, -0.3, -0.3] },
  ],
  edges: [
    { a: 'top', b: 'mid' },
    { a: 'mid', b: 'low' },
    { a: 'low', b: 'east' },
    { a: 'east', b: 'back', hidden: 'sun' },
  ],
  veins: [],
  cracks: [],
  start: { dropletNode: 'top' },
  goal: { dropletNode: 'back' },
  expectedMinMoves: [1, 9],
  ...over,
});

describe('orientation and gravity', () => {
  it('tipping turns the top toward the push direction', () => {
    close(apply(TIP.px, [0, 1, 0]), [1, 0, 0]);
    close(apply(TIP.nx, [0, 1, 0]), [-1, 0, 0]);
    close(apply(TIP.pz, [0, 1, 0]), [0, 0, 1]);
    close(apply(TIP.nz, [0, 1, 0]), [0, 0, -1]);
  });

  it('a push and the opposite push cancel exactly', () => {
    expect(mulMat(TIP.nx, TIP.px)).toEqual(IDENTITY);
    expect(mulMat(TIP.pz, TIP.nz)).toEqual(IDENTITY);
  });

  it('reaches exactly the 24 rotations of a cube', () => {
    expect(allOrientations()).toHaveLength(24);
  });

  it('local gravity is the face on the pedestal', () => {
    const m = mulMat(TIP.px, IDENTITY); // tipped right: the +X face is now down
    expect(downAxis(m)).toBe('px');
    close(localGravity(m), [1, 0, 0]);
    close(localGravity(IDENTITY), [0, -1, 0]);
  });

  it('matrix and quaternion agree', () => {
    for (const m of allOrientations()) {
      const q = matToQuat(m);
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) close(rotate(q, v), apply(m, v));
    }
  });
});

describe('droplet rolling', () => {
  it('rolls along successive grooves until it comes to rest', () => {
    const lvl = fixture();
    expect(rollPath(lvl, IDENTITY, 'top', []).map((s) => s.node)).toEqual(['top', 'mid', 'low']);
    expect(rollPath(lvl, TIP.px, 'low', []).map((s) => s.node)).toEqual(['low', 'east']);
  });

  it('ignores grooves below the 0.35 alignment threshold', () => {
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
    expect(rollPath(lvl, IDENTITY, 'top', []).map((s) => s.node)).toEqual(['top', 'low']);
  });

  it('settles the droplet in the initial state', () => {
    expect(initialState(fixture()).dropletNode).toBe('low');
  });
});

describe('actions', () => {
  it('refuses to tip onto a face the relic cannot rest on', () => {
    const lvl = fixture({ stableFaces: ['ny', 'nx', 'pz', 'nz', 'py'] });
    const s = initialState(lvl);
    expect(applyAction(lvl, s, { type: 'topple', dir: 'px' })).toEqual({ ok: false, reason: 'unstable-face' });
    expect(legalActions(lvl, s)).not.toContainEqual({ type: 'topple', dir: 'px' });
    expect(legalActions(lvl, s)).toHaveLength(3);
  });
});

describe('starlight', () => {
  it('lights a crack facing the star and the revealed groove carries the droplet', () => {
    const target: Mat3 = mulMat(TIP.nz, TIP.px); // gravity now pulls toward local -Z
    const lvl = fixture({ cracks: [{ id: 'c', normal: facingStar(target), lights: 'sun' }] });
    expect(computeLit(lvl, IDENTITY)).toEqual([]);
    expect(computeLit(lvl, target)).toEqual(['sun']);
    const atEast = { orient: TIP.px, dropletNode: 'east', lit: [] };
    const r = applyAction(lvl, atEast, { type: 'topple', dir: 'nz' });
    expect(r.ok && r.state.lit).toEqual(['sun']);
    expect(r.ok && r.state.dropletNode).toBe('back');
    expect(r.ok && isWon(lvl, r.state)).toBe(true);
  });

  it('a hidden groove stays shut while its crack is dark', () => {
    const lvl = fixture({ cracks: [{ id: 'c', normal: facingStar(IDENTITY), lights: 'sun' }] });
    const atEast = { orient: TIP.px, dropletNode: 'east', lit: [] };
    const r = applyAction(lvl, atEast, { type: 'topple', dir: 'nz' });
    expect(r.ok && r.state.lit).toEqual([]);
    expect(r.ok && r.state.dropletNode).toBe('east');
  });
});

describe('veins and overlaps', () => {
  // A vein point exactly one view-step in front of the groove end 'low'.
  const step = 0.3;
  const veinPt: Vec3 = [step * VIEW_DIR[0] * Math.sqrt(3), -0.3 + step * VIEW_DIR[1] * Math.sqrt(3), step * VIEW_DIR[2] * Math.sqrt(3)];
  const withVein = (): LevelDef =>
    fixture({
      nodes: [
        { id: 'top', pos: [0, 0.3, 0] },
        { id: 'low', pos: [0, -0.3, 0] },
        { id: 'goal', pos: [0.3, -0.6, 0.3] },
      ],
      edges: [{ a: 'top', b: 'low' }],
      veins: [{ id: 'v', points: [veinPt, [0.3, -0.6, 0.3]] }],
      goal: { dropletNode: 'v.1' },
    });

  it('links a groove node and a vein node that line up on screen', () => {
    const lvl = withVein();
    expect(overlaps(lvl, IDENTITY)).toContainEqual(['low', 'v.0']);
    // Turn the relic and the two points no longer line up.
    expect(overlaps(lvl, TIP.px)).not.toContainEqual(['low', 'v.0']);
  });

  it('the droplet slips through the overlap and runs along the vein', () => {
    const lvl = withVein();
    const path = rollPath(lvl, IDENTITY, 'top', []);
    expect(path.map((s) => s.node)).toEqual(['top', 'low', 'v.1']);
    expect(path[2].via).toBe('v.0');
  });

  it('two groove nodes lining up on screen never link', () => {
    const lvl = fixture({
      nodes: [
        { id: 'top', pos: [0, 0, 0] },
        { id: 'far', pos: [-0.3, -0.3, -0.3] },
        { id: 'mid', pos: [5, 5, 5] },
        { id: 'low', pos: [6, 6, 6] },
        { id: 'east', pos: [7, 7, 7] },
        { id: 'back', pos: [8, 8, 8] },
      ],
      edges: [],
    });
    expect(overlaps(lvl, IDENTITY)).toEqual([]);
  });

  it('view helpers stay orthonormal', () => {
    for (const m of allOrientations()) expect(mulMat(m, transpose(m))).toEqual(IDENTITY);
  });
});

describe('shipped levels', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('%s is solvable without dead ends', (_id, level) => {
    const a = analyzeLevel(level);
    expect(a.minMoves).not.toBeNull();
    expect(a.deadEnds).toHaveLength(0);
    let s = initialState(level);
    for (const act of solve(level, s) ?? []) {
      const r = applyAction(level, s, act);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(isWon(level, s)).toBe(true);
  });
});
