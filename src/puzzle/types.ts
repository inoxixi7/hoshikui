// Level data and runtime state. Pure data — no rendering concerns beyond
// the coordinates the renderer needs to draw what the rules decide.

export type Vec3 = [number, number, number];

export type PlateCondition = Record<string, boolean>;

export interface LevelDef {
  id: string;
  /** Relic silhouette: a convex hull is built from these points. */
  hullPoints: Vec3[];
  /** 4–6 stable resting faces. */
  poses: PoseDef[];
  /** Foldable shell fragments (none in levels 1 & 2). true = open. */
  plates: PlateDef[];
  /** Groove nodes, relic-local coordinates. */
  nodes: { id: string; pos: Vec3 }[];
  edges: EdgeDef[];
  cracks: CrackDef[];
  start: { pose: string; dropletNode: string; plates: Record<string, boolean> };
  goal: { dropletNode: string; litTargets?: string[] };
  /** The solver's shortest solution must fall inside this inclusive range. */
  expectedMinMoves: [number, number];
}

export interface PoseDef {
  id: string;
  /** Local outward normal of the face touching the pedestal in this pose. */
  downNormal: Vec3;
  /** Spin around world Y (degrees) applied after the face is put down. */
  yaw?: number;
  neighbors: string[];
  /** The pose is only stable while plates match this condition. */
  requiresPlates?: PlateCondition;
}

export interface EdgeDef {
  a: string;
  b: string;
  /** Only passable while this light target is lit. */
  hidden?: string;
  requiresPlates?: PlateCondition;
}

export interface CrackDef {
  id: string;
  /** Local outward normal of the crack. */
  normal: Vec3;
  /** Light target lit while starlight enters this crack. */
  lights: string;
  blockedByPlates?: PlateCondition;
  /** Where the inner beam ends (relic-local); purely visual. */
  target?: Vec3;
}

export interface PlateDef {
  id: string;
  /** Hinge end points (local). Opening rotates around a→b, right-handed. */
  hingeAxis: [Vec3, Vec3];
  /** Closed-position outline of the fragment (local, roughly planar). */
  shape: Vec3[];
  /** Opening angle in degrees. */
  openAngle: number;
}

export interface GameState {
  pose: string;
  dropletNode: string;
  plates: Record<string, boolean>;
  lit: string[];
}

export type Action = { type: 'topple'; to: string } | { type: 'fold'; plate: string };
