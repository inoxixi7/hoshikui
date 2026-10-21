// Breadth-first solver over the discrete puzzle state space (pure).

import type { Action, GameState, LevelDef } from './types';
import { applyAction, initialState, isWon, legalActions } from './rules';

export function stateKey(level: LevelDef, s: GameState): string {
  const plates = level.plates.map((p) => (s.plates[p.id] ? '1' : '0')).join('');
  return `${s.pose}|${s.dropletNode}|${plates}`;
}

/** Shortest action sequence from `from` to a won state, or null if unsolvable. */
export function solve(level: LevelDef, from: GameState): Action[] | null {
  if (isWon(level, from)) return [];
  const startKey = stateKey(level, from);
  const prev = new Map<string, { key: string; action: Action } | null>([[startKey, null]]);
  const queue: GameState[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head];
    const k = stateKey(level, s);
    for (const a of legalActions(level, s)) {
      const r = applyAction(level, s, a);
      if (!r.ok) continue;
      const nk = stateKey(level, r.state);
      if (prev.has(nk)) continue;
      prev.set(nk, { key: k, action: a });
      if (isWon(level, r.state)) {
        const actions: Action[] = [];
        let cur: string = nk;
        for (let link = prev.get(cur); link; link = prev.get(cur)) {
          actions.unshift(link.action);
          cur = link.key;
        }
        return actions;
      }
      queue.push(r.state);
    }
  }
  return null;
}

export interface LevelAnalysis {
  minMoves: number | null;
  solution: Action[] | null;
  reachable: number;
  /** Reachable, unwon states from which no won state can be reached. */
  deadEnds: GameState[];
  initialWon: boolean;
}

export function analyzeLevel(level: LevelDef): LevelAnalysis {
  const init = initialState(level);
  const states = new Map<string, GameState>();
  const edges = new Map<string, string[]>(); // forward adjacency
  const queue: GameState[] = [init];
  states.set(stateKey(level, init), init);
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head];
    const k = stateKey(level, s);
    const out: string[] = [];
    if (!isWon(level, s)) {
      for (const a of legalActions(level, s)) {
        const r = applyAction(level, s, a);
        if (!r.ok) continue;
        const nk = stateKey(level, r.state);
        out.push(nk);
        if (!states.has(nk)) {
          states.set(nk, r.state);
          queue.push(r.state);
        }
      }
    }
    edges.set(k, out);
  }
  // Reverse reachability from won states.
  const reverse = new Map<string, string[]>();
  for (const [k, outs] of edges) for (const o of outs) reverse.set(o, [...(reverse.get(o) ?? []), k]);
  const canWin = new Set<string>();
  const stack = [...states.entries()].filter(([, s]) => isWon(level, s)).map(([k]) => k);
  stack.forEach((k) => canWin.add(k));
  while (stack.length) {
    const k = stack.pop() as string;
    for (const p of reverse.get(k) ?? []) {
      if (!canWin.has(p)) {
        canWin.add(p);
        stack.push(p);
      }
    }
  }
  const deadEnds = [...states.entries()].filter(([k]) => !canWin.has(k)).map(([, s]) => s);
  const solution = solve(level, init);
  return {
    minMoves: solution ? solution.length : null,
    solution,
    reachable: states.size,
    deadEnds,
    initialWon: isWon(level, init),
  };
}
