// Level data and runtime state. Pure data — no rendering concerns beyond
// the coordinates the renderer needs to draw what the rules decide.

export type Vec3 = [number, number, number];

/** A local axis direction. Stable faces are always axis-aligned. */
export type Axis = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** World direction the relic is pushed: it tips over its edge on that side. */
export type Dir = 'px' | 'nx' | 'pz' | 'nz';

/**
 * Orientation of the relic as an exact rotation matrix (row-major, entries -1/0/1),
 * mapping local coordinates to world coordinates. Tumbling over an edge is an exact
 * 90° turn, so every reachable orientation is one of the 24 rotations of a cube.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface LevelDef {
  id: string;
  /** Relic silhouette: a convex hull is built from these points. */
  hullPoints: Vec3[];
  /** Faces (by outward local axis) the relic can rest on. Others make it roll on. */
  stableFaces: Axis[];
  /** Groove nodes, relic-local coordinates. */
  nodes: { id: string; pos: Vec3 }[];
  edges: EdgeDef[];
  /** Outer edges lit by earlier levels; the droplet can run along them. */
  veins: VeinDef[];
  cracks: CrackDef[];
  start: { orient?: Mat3; dropletNode: string };
  goal: { dropletNode: string; litTargets?: string[] };
  /** The solver's shortest solution must fall inside this inclusive range. */
  expectedMinMoves: [number, number];
}

export interface EdgeDef {
  a: string;
  b: string;
  /** Only passable while this light target is lit. */
  hidden?: string;
}

export interface VeinDef {
  id: string;
  /** Polyline along a hull edge (local); each point is a node `${id}.${i}`. */
  points: Vec3[];
}

export interface CrackDef {
  id: string;
  /** Local outward normal of the crack (a facet of the hull). */
  normal: Vec3;
  /** Light target lit while starlight enters this crack. */
  lights: string;
  /** Where the inner beam ends (relic-local); purely visual. */
  target?: Vec3;
}

export interface GameState {
  orient: Mat3;
  dropletNode: string;
  lit: string[];
}

export type Action = { type: 'topple'; dir: Dir };
