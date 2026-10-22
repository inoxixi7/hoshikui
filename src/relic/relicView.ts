// Visual representation of one level's relic. Reads puzzle state; never decides rules.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { Dir, GameState, LevelDef, Mat3, Turn, Vec3 } from '../puzzle/types';
import { LIGHT_COS, SPIN, STAR_DIR, TIP, allNodes, apply, matToQuat, mulMat, nodePos, overlaps, type RollStep } from '../puzzle/rules';
import { supportDistance, supportPoints, centroid } from '../puzzle/geometry';
import { VEINS } from '../levels/relic';
import { PALETTE } from '../palette';
import { Animator, ease } from '../anim';
import { PEDESTAL_TOP } from '../scene/stage';
import { glowTexture, ringTexture } from '../scene/textures';
import { crackPolyline, placeSegment, ribbonGeometry, segmentMesh, v3 } from './builders';

const UP = new THREE.Vector3(0, 1, 0);
const STAR = new THREE.Vector3(...STAR_DIR);
const INNER_ORDER = 20;

export const DIR_VEC: Record<Dir, THREE.Vector3> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};

const quatOf = (m: Mat3) => {
  const q = matToQuat(m);
  return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
};

/** How a topple (or a tilt toward one) moves the relic: a turn about its contact edge. */
export interface TopplePlan {
  axis: THREE.Vector3;
  phi: number;
  pivot: THREE.Vector3;
  fromQ: THREE.Quaternion;
  fromPos: THREE.Vector3;
  correction: THREE.Vector3;
  dir: THREE.Vector3;
}

interface EdgeVis {
  a: THREE.Vector3;
  b: THREE.Vector3;
  hidden?: string;
  seg: THREE.Mesh;
  reveal: number;
}

interface CrackVis {
  lights: string;
  local: THREE.Vector3;
  normal: THREE.Vector3;
  core: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  inner: THREE.Mesh | null;
  innerMat: THREE.MeshBasicMaterial;
  splash: THREE.Sprite;
  level: number;
}

interface VeinVis {
  id: string;
  lit: boolean;
  mat: THREE.MeshBasicMaterial;
  ghost: THREE.MeshBasicMaterial;
  glow: number; // 0..1, animates when a vein lights up
}

interface JunctionVis {
  key: string;
  local: THREE.Vector3;
  sprite: THREE.Sprite;
  ring: THREE.Sprite;
  level: number;
  want: number;
}

export class RelicView {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly anim = new Animator();
  private readonly world: THREE.Object3D;
  private readonly inner = new THREE.Group();
  private readonly fx = new THREE.Group(); // floating-space effects
  private bodyMat: THREE.MeshStandardMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private edges: EdgeVis[] = [];
  private cracks: CrackVis[] = [];
  private veins: VeinVis[] = [];
  private junctions = new Map<string, JunctionVis>();
  private droplet: THREE.Mesh;
  private dropletGlow: THREE.Sprite;
  private trail: THREE.Sprite[] = [];
  private trailHist: THREE.Vector3[] = [];
  private core: THREE.Mesh;
  private coreGlow: THREE.Sprite;
  private hintGlow: THREE.Sprite;
  private shock: THREE.Sprite;

  /** Resting transform for the current orientation. */
  baseQ = new THREE.Quaternion();
  basePos = new THREE.Vector3();
  /** Presentation offsets used by the title screen and the ending. */
  hover = 0;
  spin = 0;
  breath = 0;
  coreBurst = 0;
  /** Set when the star has been swallowed: no more beams. */
  starGone = false;
  private time = 0;
  private plan: TopplePlan | null = null;
  private planT = 0;
  private planBlend = 0;
  private wobble = 0;
  private flash = 0;
  private hint: THREE.Vector3 | null = null;
  private state: GameState;
  private dropletLocal = new THREE.Vector3();
  private coreShards: { mesh: THREE.Mesh; dir: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private rolling = false;
  private glowAll = 0;

  constructor(
    readonly level: LevelDef,
    parent: THREE.Object3D,
    state: GameState,
  ) {
    this.world = parent;
    this.state = state;

    // --- body ---
    const geo = new ConvexGeometry(level.hullPoints.map(v3));
    this.tintFaces(geo);
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
      emissive: new THREE.Color(0x1c1838),
      emissiveIntensity: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    addStoneGrain(this.bodyMat);
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.root.add(this.body);
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x9c95d6, transparent: true, opacity: 0.3 });
    this.root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 8), this.edgeMat));

    // --- star veins on the outer edges ---
    this.buildVeins();

    // --- interior: grooves, nodes, core, droplet ---
    this.inner.renderOrder = INNER_ORDER;
    this.root.add(this.inner);
    const grooveMat = innerMat(PALETTE.groove, 0.32);
    const revealMat = innerMat(PALETTE.starlight, 0.95);
    for (const e of level.edges) {
      const a = v3(nodePos(level, e.a));
      const b = v3(nodePos(level, e.b));
      const seg = segmentMesh(a, b, e.hidden ? 0.018 : 0.012, e.hidden ? revealMat.clone() : grooveMat);
      seg.renderOrder = INNER_ORDER;
      seg.visible = !e.hidden;
      this.inner.add(seg);
      this.edges.push({ a, b, hidden: e.hidden, seg, reveal: 0 });
    }
    const nodeGeo = new THREE.SphereGeometry(0.026, 10, 8);
    const nodeMat = innerMat(PALETTE.groove, 0.5);
    for (const n of level.nodes) {
      if (n.id === level.goal.dropletNode) continue;
      const m = new THREE.Mesh(nodeGeo, nodeMat);
      m.position.copy(v3(n.pos));
      m.renderOrder = INNER_ORDER;
      this.inner.add(m);
    }
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), innerMat(PALETTE.core, 0.9));
    this.core.position.copy(v3(nodePos(level, level.goal.dropletNode)));
    this.core.renderOrder = INNER_ORDER;
    this.inner.add(this.core);
    this.coreGlow = glowSprite(PALETTE.core, 0.75, 0.55);
    this.coreGlow.position.copy(this.core.position);
    this.inner.add(this.coreGlow);

    this.droplet = new THREE.Mesh(new THREE.SphereGeometry(0.068, 18, 14), innerMat(PALETTE.droplet, 1));
    this.droplet.renderOrder = INNER_ORDER + 3;
    this.dropletGlow = glowSprite(PALETTE.dropletGlow, 0.55, 0.9);
    this.dropletGlow.renderOrder = INNER_ORDER + 2;
    this.inner.add(this.droplet, this.dropletGlow);

    level.cracks.forEach((c, i) => this.buildCrack(c.lights, c.normal, c.target, i));

    // --- floating-space fx ---
    this.world.add(this.fx);
    for (let i = 0; i < 10; i++) {
      const s = glowSprite(PALETTE.dropletGlow, 0.22 * (1 - i / 11), 0.5 * (1 - i / 10));
      this.trail.push(s);
      this.fx.add(s);
    }
    this.hintGlow = glowSprite(0xfff4dd, 0.9, 0);
    this.fx.add(this.hintGlow);
    this.shock = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color: PALETTE.starlight, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.shock.renderOrder = INNER_ORDER + 5;
    this.fx.add(this.shock);

    this.world.add(this.root);
    this.setState(state);
  }

  dispose() {
    this.world.remove(this.root);
    this.world.remove(this.fx);
    const seen = new Set<unknown>();
    const free = (o: THREE.Object3D) => {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry && !seen.has(m.geometry)) {
          seen.add(m.geometry);
          m.geometry.dispose();
        }
        const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
        for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          if (!seen.has(mm)) {
            seen.add(mm);
            mm.dispose();
          }
        }
      });
    };
    free(this.root);
    free(this.fx);
  }

  // ---------------------------------------------------------------- building

  private tintFaces(geo: THREE.BufferGeometry) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(PALETTE.stone);
    const tints = new Map<string, THREE.Color>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let seed = 1;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
      if (!tints.has(key)) {
        seed = (seed * 9301 + 49297) % 233280;
        const r = seed / 233280;
        tints.set(key, base.clone().offsetHSL((r - 0.5) * 0.03, (r - 0.5) * 0.06, (r - 0.5) * 0.07));
      }
      const col = tints.get(key) as THREE.Color;
      for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (i + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /**
   * All five veins are carved in. Lit ones (earned in earlier levels) glow and carry
   * the droplet; where the stone hides them they still show, dimmer, so the eye can
   * follow a vein around the back.
   */
  private buildVeins() {
    const litIds = new Set(this.level.veins.map((v) => v.id));
    const nodeGeo = new THREE.SphereGeometry(0.03, 10, 8);
    for (const v of VEINS) {
      const lit = litIds.has(v.id);
      const mat = new THREE.MeshBasicMaterial({ color: lit ? PALETTE.starlight : 0x2a2740, transparent: true, depthWrite: false });
      const ghost = new THREE.MeshBasicMaterial({ color: PALETTE.starlight, transparent: true, opacity: lit ? 0.32 : 0, depthWrite: false, depthFunc: THREE.GreaterDepth });
      const pts = v.points.map(v3);
      const dir = pts[pts.length - 1].clone().sub(pts[0]).normalize();
      const a = pts[0].clone().addScaledVector(dir, -0.06);
      const b = pts[pts.length - 1].clone().addScaledVector(dir, 0.06);
      for (const [m, order] of [
        [mat, 4],
        [ghost, 5],
      ] as const) {
        const seg = segmentMesh(a, b, 0.02, m, 6);
        seg.renderOrder = order;
        this.root.add(seg);
        for (const p of pts) {
          const n = new THREE.Mesh(nodeGeo, m);
          n.position.copy(p);
          n.renderOrder = order;
          n.visible = lit;
          this.root.add(n);
        }
      }
      this.veins.push({ id: v.id, lit, mat, ghost, glow: 0 });
    }
  }

  private buildCrack(lights: string, normal: Vec3, target: Vec3 | undefined, i: number) {
    const n = v3(normal).normalize();
    const pts = this.level.hullPoints;
    const face = supportPoints(pts, normal).map(v3);
    const center = new THREE.Vector3(...centroid(supportPoints(pts, normal)));
    const d = supportDistance(pts, normal);
    center.copy(center.clone().projectOnPlane(n).add(n.clone().multiplyScalar(d)));
    const span = Math.max(...face.map((p) => p.distanceTo(center)));
    const line = crackPolyline(center, n, Math.min(0.5, span * 1.1), 0.7 + i * 1.9);
    const rimMat = new THREE.MeshBasicMaterial({ color: PALETTE.vein, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x07060c, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const rim = new THREE.Mesh(ribbonGeometry(line.map((p) => p.clone().addScaledVector(n, 0.006)), 0.1, n), rimMat);
    const core = new THREE.Mesh(ribbonGeometry(line.map((p) => p.clone().addScaledVector(n, 0.011)), 0.045, n), coreMat);
    rim.renderOrder = 2;
    core.renderOrder = 3;
    this.root.add(rim, core);

    const len = 30;
    const geo = new THREE.CylinderGeometry(0.42, 0.09, len, 20, 1, true);
    geo.translate(0, len / 2, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(PALETTE.starlight) }, strength: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          vT = position.y / ${len.toFixed(1)};
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = (projectionMatrix[3][3] > 0.5) ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float strength; varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(abs(dot(vN, vV)), 2.0);
          float fade = (1.0 - smoothstep(0.0, 0.18, vT)) * smoothstep(0.0, 0.01, vT);
          gl_FragColor = vec4(color * edge * fade * strength * 1.6, 1.0);
        }`,
    });
    const beam = new THREE.Mesh(geo, beamMat);
    beam.renderOrder = 6;
    beam.visible = false;
    this.fx.add(beam);

    const innerMatl = innerMat(PALETTE.starlight, 0);
    let inner: THREE.Mesh | null = null;
    if (target) {
      inner = segmentMesh(center.clone().addScaledVector(n, -0.02), v3(target), 0.022, innerMatl);
      inner.renderOrder = INNER_ORDER;
      inner.visible = false;
      this.inner.add(inner);
    }
    const splash = glowSprite(PALETTE.starlight, 0.5, 0);
    this.fx.add(splash);
    this.cracks.push({ lights, local: center, normal: n, core: coreMat, beam, beamMat, inner, innerMat: innerMatl, splash, level: 0 });
  }

  // ---------------------------------------------------------------- state

  /** Snap every visual to a state without animation. */
  setState(s: GameState) {
    this.state = { ...s, lit: [...s.lit] };
    this.baseQ.copy(quatOf(s.orient));
    this.basePos.set(0, this.restY(this.baseQ), 0);
    this.plan = null;
    this.dropletLocal.copy(v3(nodePos(this.level, s.dropletNode)));
    this.trailHist = [];
    for (const e of this.edges) if (e.hidden) e.reveal = s.lit.includes(e.hidden) ? 1 : 0;
    for (const c of this.cracks) c.level = s.lit.includes(c.lights) && this.crackFacing(c, s.orient) ? 1 : 0;
    this.syncJunctions(true);
    this.applyEdges();
    this.applyTransform();
  }

  getState(): GameState {
    return this.state;
  }

  private restY(q: THREE.Quaternion): number {
    let min = Infinity;
    const tmp = new THREE.Vector3();
    for (const p of this.level.hullPoints) min = Math.min(min, tmp.set(p[0], p[1], p[2]).applyQuaternion(q).y);
    return PEDESTAL_TOP - min;
  }

  private applyEdges() {
    for (const e of this.edges) {
      if (!e.hidden) continue;
      e.seg.visible = e.reveal > 0.001;
      if (e.seg.visible) placeSegment(e.seg, e.a, e.b, e.reveal);
      (e.seg.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.6 * Math.min(1, e.reveal * 1.5);
    }
  }

  /** Show a glint wherever a lit vein lines up with a groove on screen right now. */
  private syncJunctions(instant: boolean) {
    const pairs = overlaps(this.level, this.state.orient);
    const nodes = new Map(allNodes(this.level).map((n) => [n.id, n]));
    const active = new Set<string>();
    for (const [a, b] of pairs) {
      // Draw the glint on the vein end (it sits on the surface, nearest the eye).
      const veinNode = nodes.get(a)?.vein ? a : b;
      const key = `${a}|${b}`;
      active.add(key);
      let j = this.junctions.get(key);
      if (!j) {
        const local = v3((nodes.get(veinNode) as { pos: Vec3 }).pos);
        const sprite = glowSprite(PALETTE.starlight, 0.42, 0);
        const ring = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: ringTexture(), color: PALETTE.starlight, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
        );
        ring.renderOrder = INNER_ORDER + 4;
        sprite.position.copy(local);
        ring.position.copy(local);
        this.root.add(sprite, ring);
        j = { key, local, sprite, ring, level: 0, want: 1 };
        this.junctions.set(key, j);
      }
      j.want = 1;
      if (instant) j.level = 1;
    }
    for (const j of this.junctions.values()) {
      if (!active.has(j.key)) {
        j.want = 0;
        if (instant) j.level = 0;
      }
    }
  }

  /** Compute the relic transform from base pose, tilt/topple plan and presentation offsets. */
  private applyTransform() {
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    if (this.plan) this.planTransform(this.plan, this.planT, this.planBlend, q, pos);
    else {
      q.copy(this.baseQ);
      pos.copy(this.basePos);
    }
    if (this.wobble !== 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, this.wobble));
    if (this.spin !== 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, this.spin));
    pos.y += this.hover;
    this.root.quaternion.copy(q);
    this.root.position.copy(pos);
  }

  private planTransform(p: TopplePlan, t: number, blend: number, outQ: THREE.Quaternion, outPos: THREE.Vector3) {
    const r = new THREE.Quaternion().setFromAxisAngle(p.axis, p.phi * t);
    outQ.copy(r).multiply(p.fromQ);
    outPos.copy(p.fromPos).sub(p.pivot).applyQuaternion(r).add(p.pivot).addScaledVector(p.correction, blend);
  }

  /** Plan a 90° tumble over the contact edge on the `dir` side. */
  planTopple(dir: Dir): TopplePlan {
    const d = DIR_VEC[dir];
    const fromQ = this.baseQ.clone();
    const fromPos = this.basePos.clone();
    const axis = new THREE.Vector3().crossVectors(UP, d).normalize();
    const phi = Math.PI / 2;
    const world = this.level.hullPoints.map((p) => v3(p).applyQuaternion(fromQ).add(fromPos));
    const minY = Math.min(...world.map((w) => w.y));
    const contact = world.filter((w) => w.y < minY + 0.03);
    const best = Math.max(...contact.map((w) => w.dot(d)));
    const edge = contact.filter((w) => w.dot(d) > best - 0.04);
    const pivot = edge.reduce((acc, w) => acc.add(w), new THREE.Vector3()).multiplyScalar(1 / edge.length);
    const r = new THREE.Quaternion().setFromAxisAngle(axis, phi);
    const endQ = r.clone().multiply(fromQ);
    const endPos = fromPos.clone().sub(pivot).applyQuaternion(r).add(pivot);
    const correction = new THREE.Vector3(0, this.restY(endQ), 0).sub(endPos);
    return { axis, phi, pivot, fromQ, fromPos, correction, dir: d.clone() };
  }

  // ---------------------------------------------------------------- drag tilt

  setTilt(plan: TopplePlan | null, angle: number) {
    this.plan = plan;
    this.planT = plan ? Math.min(angle, plan.phi * 0.5) / plan.phi : 0;
    this.planBlend = 0;
  }

  get tiltAngle(): number {
    return this.plan ? this.plan.phi * this.planT : 0;
  }

  /** Spring back from a tilt. `refused` adds a little shake and a dim flash. */
  async springBack(refused: boolean) {
    const p = this.plan;
    const t0 = this.planT;
    if (refused) this.flash = 1;
    await this.anim.tween(
      refused ? 0.42 : 0.3,
      (k, raw) => {
        if (!p) return;
        this.plan = p;
        this.planT = t0 * (1 - k) + (refused ? Math.sin(raw * Math.PI * 3) * (1 - raw) * 0.03 : 0);
      },
      ease.outCubic,
    );
    this.plan = null;
    this.planT = 0;
  }

  /** Refused action without a tilt: shake in place and flash dimly. */
  async refuse() {
    this.flash = 1;
    await this.anim.tween(0.38, (_k, raw) => (this.wobble = Math.sin(raw * Math.PI * 4) * (1 - raw) * 0.07), ease.linear);
    this.wobble = 0;
  }

  // ---------------------------------------------------------------- actions

  /** Tumble over the edge on the `dir` side, continuing from any tilt already applied. */
  async topple(dir: Dir, onLand?: () => void) {
    const fresh = this.planTopple(dir);
    const continuing = this.plan && this.planT > 0 && this.plan.dir.equals(fresh.dir);
    const t0 = continuing ? this.planT : 0;
    this.plan = fresh;
    await this.anim.tween(
      0.45 * (1 - t0 * 0.6),
      (k) => {
        this.planT = t0 + (1 - t0) * k;
        this.planBlend = ease.smooth(k);
      },
      ease.outCubic,
    );
    onLand?.();
    // Landing: a short rebound around the contact edge.
    await this.anim.tween(
      0.22,
      (_k, raw) => {
        this.planT = 1 - Math.sin(raw * Math.PI) * 0.035 * (1 - raw * 0.5);
        this.planBlend = 1;
      },
      ease.linear,
    );
    const orient = mulMat(TIP[dir], this.state.orient);
    this.baseQ.copy(quatOf(orient));
    this.basePos.set(0, this.restY(this.baseQ), 0);
    this.plan = null;
    this.planT = 0;
    this.state = { ...this.state, orient };
    this.syncJunctions(false);
  }

  /** Live turn while the player drags on the turntable (radians, about world Y). */
  setTurnPreview(angle: number) {
    this.spin = angle;
  }

  /** Spring back from a turn preview that did not reach a quarter turn. */
  async cancelTurn() {
    const a0 = this.spin;
    await this.anim.tween(0.28, (k) => (this.spin = a0 * (1 - k)), ease.outCubic);
    this.spin = 0;
  }

  /**
   * Settle `quarters` quarter turns (signed) from wherever the player's drag left the
   * relic. The drag already did the turning; this only eases into the nearest notch.
   */
  async turnBy(quarters: number, onSettle?: () => void) {
    const a0 = this.spin;
    const a1 = (quarters * Math.PI) / 2;
    await this.anim.tween(Math.max(0.16, Math.min(0.45, Math.abs(a1 - a0) * 0.5)), (k) => (this.spin = a0 + (a1 - a0) * k), ease.outCubic);
    onSettle?.();
    let orient = this.state.orient;
    const turn: Turn = quarters > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(quarters); i++) orient = mulMat(SPIN[turn], orient);
    this.baseQ.copy(quatOf(orient));
    this.spin = 0;
    this.state = { ...this.state, orient };
    this.syncJunctions(false);
  }

  /** Update light visuals; newly revealed grooves sweep into view before the droplet moves. */
  async updateLight(s: GameState, onNewLight?: () => void) {
    const prevLit = this.state.lit;
    this.state = { ...this.state, lit: [...s.lit], orient: s.orient };
    const newly = s.lit.filter((t) => !prevLit.includes(t));
    const lost = prevLit.filter((t) => !s.lit.includes(t));
    const jobs: Promise<void>[] = [];
    for (const c of this.cracks) {
      const want = s.lit.includes(c.lights) && this.crackFacing(c, s.orient) ? 1 : 0;
      const start = c.level;
      if (want !== start) jobs.push(this.anim.tween(0.35, (k) => (c.level = start + (want - start) * k), ease.outQuad));
    }
    for (const e of this.edges) {
      if (!e.hidden) continue;
      if (newly.includes(e.hidden)) jobs.push(this.anim.tween(0.55, (k) => (e.reveal = k), ease.inOutSine));
      else if (lost.includes(e.hidden)) {
        const r0 = e.reveal;
        jobs.push(this.anim.tween(0.3, (k) => (e.reveal = r0 * (1 - k)), ease.outQuad, false));
      }
    }
    if (newly.length) onNewLight?.();
    await Promise.all(jobs);
  }

  /** Roll the droplet along a path. A `via` step slips through an on-screen overlap. */
  async roll(path: RollStep[], onStep?: (i: number) => void) {
    this.rolling = true;
    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      if (step.via) {
        // The droplet crosses where two paths only meet in the eye: a bright blink.
        await this.anim.tween(0.12, (k) => (this.dropletGlow.material.opacity = 0.9 + k * 0.6), ease.outQuad);
        this.dropletLocal.copy(v3(nodePos(this.level, step.via)));
        this.trailHist = [];
        const j = [...this.junctions.values()].find((x) => x.key.split('|').includes(step.via as string));
        if (j) j.level = 1.8;
        this.dropletGlow.material.opacity = 0.9;
      }
      const a = this.dropletLocal.clone();
      const b = v3(nodePos(this.level, step.node));
      const first = i === 1;
      const last = i === path.length - 1;
      const e = first && last ? ease.inOutSine : first ? ease.inQuad : last ? ease.outQuad : ease.linear;
      onStep?.(i);
      const dur = 0.25 * Math.min(1.6, Math.max(0.7, a.distanceTo(b) / 0.4));
      await this.anim.tween(dur, (k) => this.dropletLocal.lerpVectors(a, b, k), e);
    }
    this.rolling = false;
    this.state = { ...this.state, dropletNode: path[path.length - 1].node };
  }

  /** Move the droplet back along a path quickly (undo). */
  async rewindDroplet(path: RollStep[]) {
    const pts: THREE.Vector3[] = [];
    for (const s of path) {
      if (s.via) pts.push(v3(nodePos(this.level, s.via)));
      pts.push(v3(nodePos(this.level, s.node)));
    }
    pts.reverse();
    if (pts.length < 2) return;
    await this.anim.tween(
      0.3,
      (k) => {
        const f = k * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(f));
        this.dropletLocal.lerpVectors(pts[i], pts[i + 1], f - i);
      },
      ease.inOutSine,
    );
  }

  // ---------------------------------------------------------------- feedback

  setHint(dir: Dir | null) {
    this.hint = dir ? DIR_VEC[dir].clone() : null;
  }

  /** Success: the droplet sinks into the core, light bursts outward, the next vein lights. */
  async celebrate(veinIndex: number) {
    const start = this.dropletLocal.clone();
    const corePos = this.core.position.clone();
    await this.anim.tween(0.35, (k) => this.dropletLocal.lerpVectors(start, corePos, k), ease.inQuad);
    this.droplet.visible = false;
    this.dropletGlow.visible = false;
    const v = this.veins[veinIndex];
    if (v && !v.lit) v.lit = true;
    await this.anim.tween(
      1.25,
      (k, raw) => {
        this.coreBurst = Math.sin(Math.min(1, raw * 1.6) * Math.PI) * (1 - raw * 0.4);
        this.shock.material.opacity = (1 - k) * 0.9;
        this.shock.scale.setScalar(0.2 + k * 4.2);
        this.glowAll = Math.sin(raw * Math.PI) * 0.8;
        if (v && raw > 0.25) v.glow = Math.min(1, (raw - 0.25) / 0.5);
      },
      ease.outCubic,
    );
    this.coreBurst = 0;
    this.glowAll = 0;
  }

  /** Light every vein (ending). */
  lightAllVeins() {
    for (const v of this.veins) {
      v.lit = true;
      v.glow = 1;
    }
  }

  setGlowAll(v: number) {
    this.glowAll = v;
  }

  /** Ending: the core splits into drifting shards around a bare light (0..1). */
  setCoreCrack(k: number) {
    if (!this.coreShards.length) {
      const geo = new THREE.TetrahedronGeometry(0.05, 0);
      const mat = innerMat(PALETTE.core, 0.95);
      for (let i = 0; i < 12; i++) {
        const dir = new THREE.Vector3(Math.sin(i * 2.4) * Math.cos(i), Math.cos(i * 1.7), Math.sin(i * 1.3)).normalize();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = INNER_ORDER + 1;
        mesh.scale.setScalar(0.6 + ((i * 37) % 10) / 12);
        this.inner.add(mesh);
        this.coreShards.push({ mesh, dir, spin: new THREE.Vector3(i % 3, (i + 1) % 2, 1).multiplyScalar(0.8) });
      }
    }
    this.core.visible = k < 0.05;
    for (const sh of this.coreShards) {
      sh.mesh.visible = k >= 0.05;
      sh.mesh.position.copy(this.core.position).addScaledVector(sh.dir, 0.05 + k * 0.32);
      sh.mesh.rotation.set(sh.spin.x * k * 4 + this.time * 0.3, sh.spin.y * k * 4, sh.spin.z * k * 4);
    }
  }

  /** Points spread over the relic surface in floating space (for the shatter transition). */
  sampleSurface(count: number): Float32Array {
    this.root.updateMatrix();
    const pos = this.body.geometry.attributes.position as THREE.BufferAttribute;
    const tris = pos.count / 3;
    const areas: number[] = [];
    let total = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < tris; i++) {
      a.fromBufferAttribute(pos, i * 3);
      b.fromBufferAttribute(pos, i * 3 + 1);
      c.fromBufferAttribute(pos, i * 3 + 2);
      total += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      areas.push(total);
    }
    const out = new Float32Array(count * 3);
    const m = this.root.matrix;
    for (let k = 0; k < count; k++) {
      const r = Math.random() * total;
      let i = areas.findIndex((x) => x >= r);
      if (i < 0) i = tris - 1;
      a.fromBufferAttribute(pos, i * 3);
      b.fromBufferAttribute(pos, i * 3 + 1);
      c.fromBufferAttribute(pos, i * 3 + 2);
      let u = Math.random(), w = Math.random();
      if (u + w > 1) {
        u = 1 - u;
        w = 1 - w;
      }
      const p = a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), w).applyMatrix4(m);
      out.set([p.x, p.y, p.z], k * 3);
    }
    return out;
  }

  coreWorld(): THREE.Vector3 {
    this.root.updateMatrix();
    return this.core.position.clone().applyMatrix4(this.root.matrix);
  }

  pickables(): THREE.Object3D[] {
    return [this.body];
  }

  setVisible(v: boolean) {
    this.root.visible = v;
    this.fx.visible = v;
  }

  // ---------------------------------------------------------------- per-frame

  private crackFacing(c: CrackVis, orient: Mat3): boolean {
    const w = apply(orient, [c.normal.x, c.normal.y, c.normal.z]);
    return new THREE.Vector3(...w).dot(STAR) > LIGHT_COS;
  }

  update(dt: number) {
    this.time += dt;
    this.anim.update(dt);
    this.applyEdges();
    this.applyTransform();
    this.root.updateMatrixWorld(true);
    const m = this.root.matrix;

    // Droplet + trail (only follows its own motion through the grooves).
    this.droplet.position.copy(this.dropletLocal);
    this.dropletGlow.position.copy(this.dropletLocal);
    const dWorld = this.dropletLocal.clone().applyMatrix4(m);
    if (this.rolling) {
      const last = this.trailHist[0];
      this.trailHist.unshift(last && last.distanceTo(dWorld) < 0.004 ? last.clone() : dWorld);
      this.trailHist.length = Math.min(this.trailHist.length, this.trail.length * 2);
    } else if (this.trailHist.length) this.trailHist.pop();
    this.trail.forEach((s, i) => {
      const h = this.trailHist[(i + 1) * 2 - 1];
      s.visible = Boolean(h && h.distanceTo(dWorld) > 0.01) && this.droplet.visible && this.root.visible;
      if (h) s.position.copy(h);
    });
    this.dropletGlow.scale.setScalar(0.5 + (0.5 + 0.5 * Math.sin(this.time * 2.2)) * 0.08);

    // Core breath and burst.
    this.core.rotation.y += dt * 0.6;
    this.core.rotation.x += dt * 0.25;
    this.core.scale.setScalar(1 + Math.sin(this.time * 1.6) * 0.06 + this.coreBurst * 0.8);
    this.coreGlow.scale.setScalar(0.75 + Math.sin(this.time * 1.6) * 0.06 + this.coreBurst * 3.2);
    this.coreGlow.material.opacity = 0.5 + this.coreBurst * 0.5 + this.glowAll * 0.3;
    this.shock.position.copy(this.core.position.clone().applyMatrix4(m));

    // Body breath (title), flash (refusals) and celebration glow.
    this.flash = Math.max(0, this.flash - dt * 4);
    const breathe = this.breath * (0.5 + 0.5 * Math.sin(this.time * 1.8));
    this.bodyMat.emissiveIntensity = breathe * 0.35 + this.glowAll * 0.9;
    this.bodyMat.emissive.setHex(this.glowAll > 0.01 ? 0x6a4a20 : 0x1c1838);
    this.edgeMat.opacity = 0.3 + breathe * 0.4 + this.flash * 0.6 + this.glowAll * 0.5;
    this.edgeMat.color.setHex(this.glowAll > 0.01 ? PALETTE.starlight : 0x9c95d6);

    // Veins: lit ones shimmer; a freshly lit one flares.
    for (const v of this.veins) {
      if (!v.lit) continue;
      v.glow = Math.max(0, v.glow - dt * 0.35);
      v.mat.color.setHex(PALETTE.starlight).multiplyScalar(0.85 + 0.15 * Math.sin(this.time * 2 + v.id.length) + v.glow * 0.8);
      v.mat.opacity = 1;
      v.ghost.opacity = 0.32;
    }

    // Junction glints fade in once the relic settles into a matching angle.
    const settled = !this.plan && this.spin === 0;
    for (const j of this.junctions.values()) {
      const target = settled ? j.want : 0;
      j.level += (target - j.level) * (1 - Math.exp(-dt * (j.level > 1 ? 3 : 6)));
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 4);
      j.sprite.material.opacity = Math.min(1, j.level) * 0.6 * pulse;
      j.sprite.scale.setScalar(0.3 * (0.9 + 0.2 * pulse) * Math.max(1, j.level));
      j.ring.material.opacity = Math.min(1, j.level) * 0.35;
      j.ring.scale.setScalar(0.2 + 0.03 * Math.sin(this.time * 3));
    }

    for (const c of this.cracks) this.updateBeam(c, m);

    // Topple hint: a soft glow at the pedestal edge on that side.
    const hm = this.hintGlow.material;
    if (this.hint) {
      const k = 0.5 + 0.5 * Math.sin(this.time * 3.2);
      this.hintGlow.position.copy(this.hint).multiplyScalar(1.0).setY(PEDESTAL_TOP + 0.08);
      this.hintGlow.scale.setScalar(0.9 + k * 0.3);
      hm.opacity = 0.25 + 0.45 * k;
    } else hm.opacity = Math.max(0, hm.opacity - dt * 2);
  }

  private updateBeam(c: CrackVis, m: THREE.Matrix4) {
    const strength = this.starGone || this.plan || (this.spin !== 0 && !this.breath) ? 0 : c.level;
    const hit = c.local.clone().applyMatrix4(m);
    c.beam.visible = strength > 0.01 && this.root.visible;
    if (c.beam.visible) {
      c.beam.position.copy(hit);
      c.beam.quaternion.setFromUnitVectors(UP, STAR);
      c.beamMat.uniforms.strength.value = strength * (0.85 + 0.15 * Math.sin(this.time * 3));
    }
    c.splash.position.copy(hit);
    c.splash.material.opacity = strength * 0.55;
    c.core.color.setHex(0x07060c).lerp(new THREE.Color(PALETTE.starlight), c.level);
    if (c.inner) {
      c.inner.visible = c.level > 0.01;
      c.innerMat.opacity = c.level * 0.9;
    }
  }
}

/** Mineral speckle and banding so the flat facets read as stone, not glass. */
function addStoneGrain(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStonePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vStonePos;
        float sHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float sNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(sHash(i), sHash(i + vec3(1,0,0)), f.x), mix(sHash(i + vec3(0,1,0)), sHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(sHash(i + vec3(0,0,1)), sHash(i + vec3(1,0,1)), f.x), mix(sHash(i + vec3(0,1,1)), sHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float g = sNoise(vStonePos * 7.0) * 0.55 + sNoise(vStonePos * 23.0) * 0.3 + sNoise(vStonePos * 61.0) * 0.15;
        float band = sin(vStonePos.y * 9.0 + sNoise(vStonePos * 3.0) * 4.0) * 0.5 + 0.5;
        float fleck = step(0.988, sHash(floor(vStonePos * 90.0)));
        diffuseColor.rgb *= 0.78 + g * 0.42 + band * 0.08;
        diffuseColor.rgb += vec3(0.55, 0.5, 0.7) * fleck * 0.3;`,
      );
  };
}

function innerMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
}

function glowSprite(color: number, size: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  s.renderOrder = INNER_ORDER;
  return s;
}
