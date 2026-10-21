// Visual representation of one level's relic. Reads puzzle state; never decides rules.

import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { GameState, LevelDef, PlateDef, PoseDef, Vec3 } from '../puzzle/types';
import { LIGHT_COS, STAR_DIR, getPose, nodePos, platesMatch, poseQuat } from '../puzzle/rules';
import { openPlateShape, supportDistance, supportPoints, centroid } from '../puzzle/geometry';
import { PALETTE } from '../palette';
import { Animator, ease } from '../anim';
import { PEDESTAL_TOP } from '../scene/stage';
import { glowTexture, ringTexture } from '../scene/textures';
import { crackPolyline, placeSegment, prismGeometry, ribbonGeometry, segmentMesh, v3 } from './builders';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const STAR = new THREE.Vector3(...STAR_DIR);
const INNER_ORDER = 20;

const quat = (p: PoseDef) => {
  const q = poseQuat(p);
  return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
};

/** How a topple (or a tilt toward one) moves the relic. */
export interface TopplePlan {
  axis: THREE.Vector3;
  phi: number;
  pivot: THREE.Vector3;
  fromQ: THREE.Quaternion;
  fromPos: THREE.Vector3;
  yaw: number;
  correction: THREE.Vector3;
  dir: THREE.Vector3; // horizontal world direction of the topple
}

interface EdgeVis {
  a: THREE.Vector3;
  b: THREE.Vector3;
  hidden?: string;
  gate?: Record<string, boolean>;
  segA: THREE.Mesh;
  segB?: THREE.Mesh;
  reveal: number; // 0..1 for hidden edges
  gap: number; // 0.5 = closed groove, ~0.3 = gap
}

interface PlateVis {
  def: PlateDef;
  pivot: THREE.Group;
  axis: THREE.Vector3;
  mesh: THREE.Mesh;
  hinge: THREE.Mesh;
  pick: THREE.Mesh;
  angle: number; // current radians
  hingeMat: THREE.MeshBasicMaterial;
}

interface CrackVis {
  id: string;
  lights: string;
  local: THREE.Vector3;
  normal: THREE.Vector3;
  core: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  inner: THREE.Mesh | null;
  innerMat: THREE.MeshBasicMaterial;
  splash: THREE.Sprite;
  level: number; // current beam intensity
  blockedAt: THREE.Vector3 | null;
}

export class RelicView {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly anim = new Animator();
  private readonly world: THREE.Object3D;
  private readonly inner = new THREE.Group();
  private readonly fx = new THREE.Group(); // floating-space effects
  private bodyMat: THREE.MeshStandardMaterial;
  private edgeLines: THREE.LineSegments;
  private edgeMat: THREE.LineBasicMaterial;
  private edges: EdgeVis[] = [];
  private plates = new Map<string, PlateVis>();
  private cracks: CrackVis[] = [];
  private droplet: THREE.Mesh;
  private dropletGlow: THREE.Sprite;
  private trail: THREE.Sprite[] = [];
  private trailHist: THREE.Vector3[] = [];
  private core: THREE.Mesh;
  private coreGlow: THREE.Sprite;
  private veins: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; lit: number }[] = [];
  private hintGlow: THREE.Sprite;
  private shock: THREE.Sprite;

  /** Resting transform for the current pose. */
  baseQ = new THREE.Quaternion();
  basePos = new THREE.Vector3();
  /** Presentation offsets used by the title screen and the ending. */
  hover = 0;
  spin = 0;
  breath = 0;
  private time = 0;
  private plan: TopplePlan | null = null;
  private planT = 0;
  private planBlend = 0;
  private wobble = 0;
  private flash = 0;
  private hint: { kind: 'topple'; dir: THREE.Vector3 } | { kind: 'fold'; plate: string } | null = null;
  private state: GameState;
  private dropletNode: string;
  private dropletLocal = new THREE.Vector3();
  coreBurst = 0;
  private coreShards: { mesh: THREE.Mesh; dir: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private rolling = false;
  /** Set when the star has been swallowed: no more beams. */
  starGone = false;
  private glowAll = 0;

  constructor(
    readonly level: LevelDef,
    parent: THREE.Object3D,
    state: GameState,
  ) {
    this.world = parent;
    this.state = state;
    this.dropletNode = state.dropletNode;

    // --- body ---
    const pts = level.hullPoints.map(v3);
    const geo = new ConvexGeometry(pts);
    this.tintFaces(geo);
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
      emissive: new THREE.Color(0x2a2470),
      emissiveIntensity: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    addStoneGrain(this.bodyMat);
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.root.add(this.body);
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x9c95d6, transparent: true, opacity: 0.32 });
    this.edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 8), this.edgeMat);
    this.root.add(this.edgeLines);

    this.buildVeins(this.edgeLines.geometry as THREE.BufferGeometry);

    // --- interior: grooves, nodes, core, droplet ---
    this.inner.renderOrder = INNER_ORDER;
    this.root.add(this.inner);
    const grooveMat = innerMat(PALETTE.groove, 0.3);
    const revealMat = innerMat(PALETTE.starlight, 0.95);
    for (const e of level.edges) {
      const a = v3(nodePos(level, e.a));
      const b = v3(nodePos(level, e.b));
      const mat = e.hidden ? revealMat.clone() : e.requiresPlates ? grooveMat.clone() : grooveMat;
      const segA = segmentMesh(a, b, e.hidden ? 0.017 : 0.011, mat);
      segA.renderOrder = INNER_ORDER;
      this.inner.add(segA);
      const vis: EdgeVis = { a, b, hidden: e.hidden, gate: e.requiresPlates, segA, reveal: 0, gap: 0.5 };
      if (e.requiresPlates) {
        vis.segB = segmentMesh(a, b, 0.011, mat);
        vis.segB.renderOrder = INNER_ORDER;
        this.inner.add(vis.segB);
      }
      if (e.hidden) segA.visible = false;
      this.edges.push(vis);
    }
    const nodeGeo = new THREE.SphereGeometry(0.024, 10, 8);
    const nodeMat = innerMat(PALETTE.groove, 0.45);
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
    this.droplet.renderOrder = INNER_ORDER + 2;
    this.dropletGlow = glowSprite(PALETTE.dropletGlow, 0.55, 0.9);
    this.dropletGlow.renderOrder = INNER_ORDER + 1;
    this.inner.add(this.droplet, this.dropletGlow);
    this.dropletLocal.copy(v3(nodePos(level, state.dropletNode)));

    // --- plates ---
    for (const p of level.plates) this.buildPlate(p);
    // --- cracks ---
    level.cracks.forEach((c, i) => this.buildCrack(c.id, c.lights, c.normal, c.target, i));

    // --- floating-space fx ---
    this.world.add(this.fx);
    for (let i = 0; i < 10; i++) {
      const s = glowSprite(PALETTE.dropletGlow, 0.22 * (1 - i / 11), 0.5 * (1 - i / 10));
      s.renderOrder = INNER_ORDER;
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

  /** Five short chains along hull edges; one lights for each completed level. */
  private buildVeins(edgeGeo: THREE.BufferGeometry) {
    const p = edgeGeo.attributes.position as THREE.BufferAttribute;
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    for (let i = 0; i < p.count; i += 2) {
      segs.push([new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1)]);
    }
    const used = new Set<number>();
    const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    const chains: THREE.Vector3[][] = [];
    // Start from the longest unused edges; walk to connected unused edges.
    const order = segs.map((s, i) => ({ i, l: s[0].distanceTo(s[1]) })).sort((x, y) => y.l - x.l);
    for (const { i } of order) {
      if (chains.length >= 5) break;
      if (used.has(i)) continue;
      const chain = [segs[i][0], segs[i][1]];
      used.add(i);
      for (let step = 0; step < 2; step++) {
        const tail = key(chain[chain.length - 1]);
        const j = segs.findIndex((s, k) => !used.has(k) && (key(s[0]) === tail || key(s[1]) === tail));
        if (j < 0) break;
        used.add(j);
        chain.push(key(segs[j][0]) === tail ? segs[j][1] : segs[j][0]);
      }
      // Mark neighbours of this chain as used so the chains stay apart.
      const keys = new Set(chain.map(key));
      segs.forEach((s, k) => {
        if (keys.has(key(s[0])) || keys.has(key(s[1]))) used.add(k);
      });
      chains.push(chain);
    }
    for (const chain of chains) {
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE.starlight, transparent: true, opacity: 0, depthWrite: false });
      const group = new THREE.Group();
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i].clone().multiplyScalar(1.004);
        const b = chain[i + 1].clone().multiplyScalar(1.004);
        group.add(segmentMesh(a, b, 0.011, mat, 5));
      }
      const holder = new THREE.Mesh();
      holder.add(group);
      this.root.add(holder);
      this.veins.push({ mesh: holder, mat, lit: 0 });
    }
  }

  private buildPlate(def: PlateDef) {
    const [ha, hb] = def.hingeAxis.map(v3);
    const pivot = new THREE.Group();
    pivot.position.copy(ha);
    const axis = hb.clone().sub(ha).normalize();
    const outline = def.shape.map((s) => v3(s).sub(ha));
    const n = new THREE.Vector3().crossVectors(outline[1].clone().sub(outline[0]), outline[2].clone().sub(outline[0])).normalize();
    const c = new THREE.Vector3(...centroid(def.shape));
    if (n.dot(c) < 0) n.negate();
    const mat = new THREE.MeshStandardMaterial({ color: 0x45414f, roughness: 0.78, metalness: 0.1, flatShading: true });
    const mesh = new THREE.Mesh(prismGeometry(outline, n, 0.038), mat);
    pivot.add(mesh);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), new THREE.LineBasicMaterial({ color: 0xa8a0de, transparent: true, opacity: 0.35 }));
    pivot.add(lines);
    // Blue vein on the free edge marks the shard as movable.
    const veinMat = new THREE.MeshBasicMaterial({ color: PALETTE.vein });
    const free = [outline[2], outline[3]].map((p) => p.clone().addScaledVector(n, 0.04));
    pivot.add(segmentMesh(free[0], free[1], 0.009, veinMat, 5));
    const hingeMat = new THREE.MeshBasicMaterial({ color: PALETTE.vein });
    const hinge = segmentMesh(new THREE.Vector3(), hb.clone().sub(ha), 0.026, hingeMat, 8);
    pivot.add(hinge);
    const pick = segmentMesh(new THREE.Vector3(), hb.clone().sub(ha), 0.15, new THREE.MeshBasicMaterial({ visible: false }), 6);
    pivot.add(pick);
    // Seam left on the body where the shard rests.
    const seam = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(def.shape.map((s) => v3(s).addScaledVector(n, -0.008))),
      new THREE.LineBasicMaterial({ color: 0x0c0b12, transparent: true, opacity: 0.8 }),
    );
    this.root.add(seam, pivot);
    mesh.userData.plate = def.id;
    pick.userData.plate = def.id;
    hinge.userData.plate = def.id;
    this.plates.set(def.id, { def, pivot, axis, mesh, hinge, pick, angle: 0, hingeMat });
  }

  private buildCrack(id: string, lights: string, normal: Vec3, target: Vec3 | undefined, i: number) {
    const n = v3(normal).normalize();
    const pts = this.level.hullPoints;
    const center = new THREE.Vector3(...centroid(supportPoints(pts, normal)));
    // Keep the crack well inside its face.
    const d = supportDistance(pts, normal);
    center.copy(center.clone().projectOnPlane(n).add(n.clone().multiplyScalar(d)));
    const line = crackPolyline(center, n, 0.5, 0.7 + i * 1.9);
    const rimMat = new THREE.MeshBasicMaterial({ color: PALETTE.vein, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x07060c, side: THREE.DoubleSide, transparent: true, depthWrite: false });
    const rim = new THREE.Mesh(ribbonGeometry(line.map((p) => p.clone().addScaledVector(n, 0.006)), 0.11, n), rimMat);
    const core = new THREE.Mesh(ribbonGeometry(line.map((p) => p.clone().addScaledVector(n, 0.011)), 0.05, n), coreMat);
    rim.renderOrder = 2;
    core.renderOrder = 3;
    this.root.add(rim, core);

    // Beam from the star into the crack, built in floating space.
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
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float strength; varying float vT; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(abs(dot(vN, vV)), 2.0);
          float fade = (1.0 - smoothstep(0.0, 0.55, vT)) * smoothstep(0.0, 0.015, vT);
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
    const splash = glowSprite(PALETTE.starlight, 0.7, 0);
    splash.renderOrder = INNER_ORDER + 3;
    this.fx.add(splash);
    this.cracks.push({ id, lights, local: center, normal: n, core: coreMat, rim: rimMat, beam, beamMat, inner, innerMat: innerMatl, splash, level: 0, blockedAt: null });
  }

  // ---------------------------------------------------------------- state

  /** Snap every visual to a state without animation. */
  setState(s: GameState) {
    this.state = { ...s, plates: { ...s.plates }, lit: [...s.lit] };
    for (const [id, p] of this.plates) p.angle = s.plates[id] ? THREE.MathUtils.degToRad(p.def.openAngle) : 0;
    this.applyPlateAngles();
    this.baseQ.copy(quat(getPose(this.level, s.pose)));
    this.basePos.set(0, this.restY(this.baseQ), 0);
    this.plan = null;
    this.dropletNode = s.dropletNode;
    this.dropletLocal.copy(v3(nodePos(this.level, s.dropletNode)));
    this.trailHist = [];
    for (const e of this.edges) {
      if (e.hidden) e.reveal = s.lit.includes(e.hidden) ? 1 : 0;
      if (e.gate) e.gap = platesMatch(s.plates, e.gate) ? 0.5 : 0.3;
    }
    for (const c of this.cracks) c.level = s.lit.includes(c.lights) && this.crackFacing(c, s.pose) ? 1 : 0;
    this.applyEdges();
    this.applyTransform();
  }

  getState(): GameState {
    return this.state;
  }

  private restY(q: THREE.Quaternion, angles?: Map<string, number>): number {
    let min = Infinity;
    const tmp = new THREE.Vector3();
    for (const p of this.level.hullPoints) {
      tmp.set(p[0], p[1], p[2]).applyQuaternion(q);
      min = Math.min(min, tmp.y);
    }
    for (const pv of this.plates.values()) {
      const ang = angles?.get(pv.def.id) ?? pv.angle;
      if (ang < 0.01) continue;
      const [ha] = pv.def.hingeAxis.map(v3);
      const rot = new THREE.Quaternion().setFromAxisAngle(pv.axis, ang);
      for (const s of pv.def.shape) {
        tmp.copy(v3(s)).sub(ha).applyQuaternion(rot).add(ha).applyQuaternion(q);
        min = Math.min(min, tmp.y);
      }
    }
    return PEDESTAL_TOP - min;
  }

  private applyPlateAngles() {
    for (const p of this.plates.values()) p.pivot.quaternion.setFromAxisAngle(p.axis, p.angle);
  }

  private applyEdges() {
    for (const e of this.edges) {
      if (e.hidden) {
        e.segA.visible = e.reveal > 0.001;
        if (e.segA.visible) placeSegment(e.segA, e.a, e.b, e.reveal);
        (e.segA.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.6 * Math.min(1, e.reveal * 1.5);
      } else if (e.gate && e.segB) {
        placeSegment(e.segA, e.a, e.b, e.gap);
        placeSegment(e.segB, e.a, e.b, 1, 1 - e.gap);
      }
    }
  }

  /** Compute the relic transform from base pose, tilt/topple plan and presentation offsets. */
  private applyTransform() {
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    if (this.plan) {
      this.planTransform(this.plan, this.planT, this.planBlend, q, pos);
    } else {
      q.copy(this.baseQ);
      pos.copy(this.basePos);
    }
    if (this.wobble !== 0) {
      // Small shake around the vertical axis for refused actions.
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, this.wobble));
    }
    if (this.spin !== 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, this.spin));
    pos.y += this.hover;
    this.root.quaternion.copy(q);
    this.root.position.copy(pos);
  }

  private planTransform(p: TopplePlan, t: number, blend: number, outQ: THREE.Quaternion, outPos: THREE.Vector3) {
    const r = new THREE.Quaternion().setFromAxisAngle(p.axis, p.phi * t);
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, p.yaw * blend);
    outQ.copy(yaw).multiply(r).multiply(p.fromQ);
    outPos.copy(p.fromPos).sub(p.pivot).applyQuaternion(r).add(p.pivot).addScaledVector(p.correction, blend);
  }

  /** Plan the topple from the current pose to `to` (or a refused tilt toward a world direction). */
  planTopple(to: PoseDef | null, fallbackDir?: THREE.Vector3): TopplePlan {
    const fromQ = this.baseQ.clone();
    const fromPos = this.basePos.clone();
    let wB: THREE.Vector3;
    if (to) wB = v3(to.downNormal).normalize().applyQuaternion(fromQ);
    else wB = (fallbackDir ?? new THREE.Vector3(1, 0, 0)).clone().setY(0).normalize().add(new THREE.Vector3(0, -1, 0)).normalize();
    const dir = wB.clone().setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    dir.normalize();
    const phi = wB.angleTo(DOWN);
    const axis = new THREE.Vector3().crossVectors(wB, DOWN);
    if (axis.lengthSq() < 1e-8) axis.set(0, 0, 1);
    axis.normalize();
    // Pivot: midpoint of the contact edge facing the topple direction.
    const world = this.level.hullPoints.map((p) => v3(p).applyQuaternion(fromQ).add(fromPos));
    const minY = Math.min(...world.map((w) => w.y));
    const contact = world.filter((w) => w.y < minY + 0.03);
    const best = Math.max(...contact.map((w) => w.dot(dir)));
    const edge = contact.filter((w) => w.dot(dir) > best - 0.04);
    const pivot = edge.reduce((acc, w) => acc.add(w), new THREE.Vector3()).multiplyScalar(1 / edge.length);
    let yaw = 0;
    const correction = new THREE.Vector3();
    if (to) {
      const r = new THREE.Quaternion().setFromAxisAngle(axis, phi);
      const phys = r.clone().multiply(fromQ);
      const target = quat(to);
      const res = target.clone().multiply(phys.clone().invert());
      yaw = 2 * Math.atan2(res.y, res.w);
      if (yaw > Math.PI) yaw -= Math.PI * 2;
      if (yaw < -Math.PI) yaw += Math.PI * 2;
      const endPos = fromPos.clone().sub(pivot).applyQuaternion(r).add(pivot);
      correction.set(0, this.restY(target), 0).sub(endPos);
    }
    return { axis, phi, pivot, fromQ, fromPos, yaw, correction, dir };
  }

  /** World (floating-space) horizontal direction a topple to `to` would go. */
  toppleDir(to: PoseDef): THREE.Vector3 {
    return v3(to.downNormal).normalize().applyQuaternion(this.baseQ).setY(0).normalize();
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
        if (p) {
          this.plan = p;
          this.planT = t0 * (1 - k) + (refused ? Math.sin(raw * Math.PI * 3) * (1 - raw) * 0.04 : 0);
        }
        if (refused && !p) this.wobble = Math.sin(raw * Math.PI * 4) * (1 - raw) * 0.06;
      },
      ease.outCubic,
    );
    this.plan = null;
    this.planT = 0;
    this.wobble = 0;
  }

  /** Refused action without a tilt: shake in place and flash dimly. */
  async refuse() {
    this.flash = 1;
    await this.anim.tween(0.38, (_k, raw) => (this.wobble = Math.sin(raw * Math.PI * 4) * (1 - raw) * 0.07), ease.linear);
    this.wobble = 0;
  }

  // ---------------------------------------------------------------- actions

  /** Topple to a new pose, continuing from any tilt already applied. Resolves on landing. */
  async topple(to: PoseDef, onLand?: () => void) {
    const plan = this.plan && this.planT > 0 ? this.plan : this.planTopple(to);
    const fresh = this.planTopple(to);
    // Keep the tilt plan's geometry but take the target-specific yaw/correction.
    plan.yaw = fresh.yaw;
    plan.correction.copy(fresh.correction);
    plan.axis.copy(fresh.axis);
    plan.phi = fresh.phi;
    const t0 = this.plan === plan ? this.planT : 0;
    this.plan = plan;
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
    const rebound = Math.min(0.06, 0.12 / Math.max(plan.phi, 0.5));
    await this.anim.tween(
      0.24,
      (_k, raw) => {
        this.planT = 1 - Math.sin(raw * Math.PI) * rebound * (1 - raw * 0.5);
        this.planBlend = 1;
      },
      ease.linear,
    );
    this.baseQ.copy(quat(to));
    this.basePos.set(0, this.restY(this.baseQ), 0);
    this.plan = null;
    this.planT = 0;
    this.state = { ...this.state, pose: to.id };
  }

  /** Swing a shard open or closed; the relic re-seats itself if its footprint changed. */
  async fold(plateId: string, open: boolean) {
    const pv = this.plates.get(plateId);
    if (!pv) return;
    const from = pv.angle;
    const to = open ? THREE.MathUtils.degToRad(pv.def.openAngle) : 0;
    const y0 = this.basePos.y;
    const angles = new Map<string, number>([[plateId, to]]);
    const y1 = this.restY(this.baseQ, angles);
    await this.anim.tween(
      0.5,
      (k) => {
        pv.angle = from + (to - from) * k;
        this.applyPlateAngles();
        this.basePos.y = y0 + (y1 - y0) * k;
      },
      ease.outBack,
    );
    pv.angle = to;
    this.applyPlateAngles();
    this.basePos.y = y1;
    this.state = { ...this.state, plates: { ...this.state.plates, [plateId]: open } };
  }

  /** Refused fold: the shard lifts a little and drops back. */
  async refuseFold(plateId: string) {
    const pv = this.plates.get(plateId);
    if (!pv) return this.refuse();
    const base = pv.angle;
    const dirSign = base > 0.01 ? -1 : 1;
    this.flash = 1;
    await this.anim.tween(
      0.4,
      (_k, raw) => {
        pv.angle = base + dirSign * Math.sin(raw * Math.PI) * 0.22 * (1 - raw * 0.3);
        this.applyPlateAngles();
      },
      ease.linear,
    );
    pv.angle = base;
    this.applyPlateAngles();
  }

  /**
   * Update light visuals for new lit targets. Newly lit cracks get a beam and
   * their hidden grooves sweep into view; resolves when the reveal is done.
   */
  async updateLight(s: GameState, onNewLight?: () => void) {
    const prevLit = this.state.lit;
    this.state = { ...this.state, lit: [...s.lit], plates: { ...s.plates }, pose: s.pose };
    const newly = s.lit.filter((t) => !prevLit.includes(t));
    const lost = prevLit.filter((t) => !s.lit.includes(t));
    const jobs: Promise<void>[] = [];
    for (const c of this.cracks) {
      const want = s.lit.includes(c.lights) && this.crackFacing(c, s.pose) && !this.crackBlocked(c, s.plates) ? 1 : 0;
      const start = c.level;
      if (want !== start) jobs.push(this.anim.tween(0.35, (k) => (c.level = start + (want - start) * k), ease.outQuad));
    }
    for (const e of this.edges) {
      if (!e.hidden) continue;
      if (newly.includes(e.hidden)) {
        jobs.push(this.anim.tween(0.55, (k) => (e.reveal = k), ease.inOutSine).then(() => this.applyEdges()));
      } else if (lost.includes(e.hidden)) {
        const r0 = e.reveal;
        jobs.push(this.anim.tween(0.3, (k) => (e.reveal = r0 * (1 - k)), ease.outQuad, false));
      }
    }
    if (newly.length) onNewLight?.();
    await Promise.all(jobs);
  }

  /** Animate the plate-gated grooves to match plate state. */
  async updateGates(plates: Record<string, boolean>) {
    const jobs: Promise<void>[] = [];
    for (const e of this.edges) {
      if (!e.gate) continue;
      const want = platesMatch(plates, e.gate) ? 0.5 : 0.3;
      const g0 = e.gap;
      if (Math.abs(want - g0) < 1e-3) continue;
      jobs.push(this.anim.tween(0.3, (k) => (e.gap = g0 + (want - g0) * k), ease.outQuad));
      // The groove flashes the shard's blue so the link between them reads.
      const m = e.segA.material as THREE.MeshBasicMaterial;
      const vein = new THREE.Color(PALETTE.vein);
      const groove = new THREE.Color(PALETTE.groove);
      void this.anim.tween(
        0.9,
        (k) => {
          m.color.copy(vein).lerp(groove, k);
          m.opacity = 0.3 + 0.6 * (1 - k);
        },
        ease.inQuad,
        false,
      );
    }
    await Promise.all(jobs);
  }

  /** Roll the droplet along a node path. `onStep` fires as each segment starts. */
  async roll(path: string[], onStep?: (i: number) => void) {
    this.rolling = true;
    for (let i = 1; i < path.length; i++) {
      const a = v3(nodePos(this.level, path[i - 1]));
      const b = v3(nodePos(this.level, path[i]));
      const first = i === 1;
      const last = i === path.length - 1;
      const e = first && last ? ease.inOutSine : first ? ease.inQuad : last ? ease.outQuad : ease.linear;
      onStep?.(i);
      const dur = 0.25 * Math.min(1.6, Math.max(0.7, a.distanceTo(b) / 0.6));
      await this.anim.tween(dur, (k) => this.dropletLocal.lerpVectors(a, b, k), e);
    }
    this.rolling = false;
    this.dropletNode = path[path.length - 1];
    this.state = { ...this.state, dropletNode: this.dropletNode };
  }

  /** Move the droplet back along a path quickly (undo). */
  async rewindDroplet(path: string[]) {
    const pts = path.map((id) => v3(nodePos(this.level, id))).reverse();
    if (pts.length < 2) return;
    await this.anim.tween(
      0.28,
      (k) => {
        const f = k * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(f));
        this.dropletLocal.lerpVectors(pts[i], pts[i + 1], f - i);
      },
      ease.inOutSine,
    );
  }

  // ---------------------------------------------------------------- feedback

  setHint(h: { kind: 'topple'; to: string } | { kind: 'fold'; plate: string } | null) {
    if (!h) this.hint = null;
    else if (h.kind === 'fold') this.hint = h;
    else this.hint = { kind: 'topple', dir: this.toppleDir(getPose(this.level, h.to)) };
  }

  /** Success: the droplet sinks into the core, light bursts outward, a vein lights. */
  async celebrate(veinIndex: number) {
    const start = this.dropletLocal.clone();
    const corePos = this.core.position.clone();
    await this.anim.tween(0.35, (k) => this.dropletLocal.lerpVectors(start, corePos, k), ease.inQuad);
    this.droplet.visible = false;
    this.dropletGlow.visible = false;
    const v = this.veins[Math.min(veinIndex, this.veins.length - 1)];
    await this.anim.tween(
      1.25,
      (k, raw) => {
        this.coreBurst = Math.sin(Math.min(1, raw * 1.6) * Math.PI) * (1 - raw * 0.4);
        this.shock.material.opacity = (1 - k) * 0.9;
        this.shock.scale.setScalar(0.2 + k * 4.2);
        this.glowAll = Math.sin(raw * Math.PI) * 0.8;
        if (v && raw > 0.25) v.lit = Math.max(v.lit, Math.min(1, (raw - 0.25) / 0.5));
      },
      ease.outCubic,
    );
    this.coreBurst = 0;
    this.glowAll = 0;
  }

  setVeins(count: number) {
    this.veins.forEach((v, i) => (v.lit = i < count ? 1 : 0));
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

  setGlowAll(v: number) {
    this.glowAll = v;
  }

  /** Points spread over the relic surface in floating space (for the shatter transition). */
  sampleSurface(count: number): Float32Array {
    this.root.updateMatrix();
    const geo = this.body.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
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

  /** Core position in floating space. */
  coreWorld(): THREE.Vector3 {
    this.root.updateMatrix();
    return this.core.position.clone().applyMatrix4(this.root.matrix);
  }

  /** Hinge midpoint in floating space (for hints and the demo hand). */
  hingeWorld(plateId: string): THREE.Vector3 | null {
    const pv = this.plates.get(plateId);
    if (!pv) return null;
    const [a, b] = pv.def.hingeAxis.map(v3);
    this.root.updateMatrix();
    return a.add(b).multiplyScalar(0.5).applyMatrix4(this.root.matrix);
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [this.body];
    for (const p of this.plates.values()) out.push(p.mesh, p.pick, p.hinge);
    return out;
  }

  setVisible(v: boolean) {
    this.root.visible = v;
    this.fx.visible = v;
  }

  // ---------------------------------------------------------------- per-frame

  private crackFacing(c: CrackVis, poseId: string): boolean {
    const q = quat(getPose(this.level, poseId));
    return c.normal.clone().applyQuaternion(q).dot(STAR) > LIGHT_COS;
  }

  private crackBlocked(c: CrackVis, plates: Record<string, boolean>): boolean {
    const def = this.level.cracks.find((x) => x.id === c.id);
    return Boolean(def?.blockedByPlates && platesMatch(plates, def.blockedByPlates));
  }

  update(dt: number) {
    this.time += dt;
    this.anim.update(dt);
    this.applyEdges();
    this.applyTransform();
    this.root.updateMatrixWorld(true);
    const m = this.root.matrix;

    // Droplet + trail.
    this.droplet.position.copy(this.dropletLocal);
    this.dropletGlow.position.copy(this.dropletLocal);
    // The trail only follows the droplet's own motion through the grooves.
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
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
    this.dropletGlow.scale.setScalar(0.5 + pulse * 0.08);

    // Core breath and burst.
    this.core.rotation.y += dt * 0.6;
    this.core.rotation.x += dt * 0.25;
    const coreScale = 1 + Math.sin(this.time * 1.6) * 0.06 + this.coreBurst * 0.8;
    this.core.scale.setScalar(coreScale);
    this.coreGlow.scale.setScalar(0.75 + Math.sin(this.time * 1.6) * 0.06 + this.coreBurst * 3.2);
    this.coreGlow.material.opacity = 0.5 + this.coreBurst * 0.5 + this.glowAll * 0.3;
    this.shock.position.copy(this.core.position.clone().applyMatrix4(m));

    // Body breath (title), flash (refusals) and celebration glow.
    this.flash = Math.max(0, this.flash - dt * 4);
    const breathe = this.breath * (0.5 + 0.5 * Math.sin(this.time * 1.8));
    this.bodyMat.emissiveIntensity = breathe * 0.35 + this.glowAll * 0.9;
    this.bodyMat.emissive.setHex(this.glowAll > 0.01 ? 0x6a4a20 : 0x1c1838);
    this.edgeMat.opacity = 0.32 + breathe * 0.4 + this.flash * 0.6 + this.glowAll * 0.5;
    this.edgeMat.color.setHex(this.glowAll > 0.01 ? PALETTE.starlight : 0x9c95d6);

    // Veins.
    for (const v of this.veins) v.mat.opacity = v.lit * (0.75 + 0.25 * Math.sin(this.time * 2 + v.mesh.id));

    // Plates: hinge glow (and hint pulse).
    for (const p of this.plates.values()) {
      const hinted = this.hint?.kind === 'fold' && this.hint.plate === p.def.id;
      const k = hinted ? 0.5 + 0.5 * Math.sin(this.time * 5) : 0;
      p.hingeMat.color.setHex(PALETTE.vein).multiplyScalar(1 + k * 1.4);
      p.hinge.scale.x = p.hinge.scale.z = 1 + k * 0.9;
    }

    // Beams.
    for (const c of this.cracks) this.updateBeam(c, m);

    // Topple hint: a soft glow at the pedestal edge, plus a gentle lean.
    const hm = this.hintGlow.material;
    if (this.hint?.kind === 'topple') {
      const k = 0.5 + 0.5 * Math.sin(this.time * 3.2);
      this.hintGlow.position.copy(this.hint.dir).multiplyScalar(1.0).setY(PEDESTAL_TOP + 0.08);
      this.hintGlow.scale.setScalar(0.9 + k * 0.3);
      hm.opacity = 0.25 + 0.45 * k;
    } else hm.opacity = Math.max(0, hm.opacity - dt * 2);
  }

  private updateBeam(c: CrackVis, m: THREE.Matrix4) {
    const facing = this.crackFacing(c, this.state.pose) && !this.plan;
    const blocked = this.crackBlocked(c, this.state.plates);
    const crackWorld = c.local.clone().applyMatrix4(m);
    // A blocked crack facing the star: light stops on the shard covering it.
    let hit = crackWorld;
    let blockedLevel = 0;
    if (facing && blocked) {
      const def = this.level.cracks.find((x) => x.id === c.id);
      const plateId = Object.keys(def?.blockedByPlates ?? {})[0];
      const pv = plateId ? this.plates.get(plateId) : undefined;
      if (pv) {
        const open = (this.state.plates[plateId] ?? false) === true;
        const shape = open ? openPlateShape(pv.def) : pv.def.shape;
        const best = [...shape].sort((a, b) => v3(b).applyMatrix4(m).dot(STAR) - v3(a).applyMatrix4(m).dot(STAR))[0];
        const ctr = new THREE.Vector3(...centroid(shape)).lerp(v3(best), 0.3);
        hit = ctr.applyMatrix4(m);
        blockedLevel = 1;
      }
    }
    const strength = this.starGone ? 0 : Math.max(c.level, blockedLevel * 0.6);
    c.beam.visible = strength > 0.01 && this.root.visible;
    if (c.beam.visible) {
      c.beam.position.copy(hit);
      c.beam.quaternion.setFromUnitVectors(UP, STAR);
      c.beamMat.uniforms.strength.value = strength * (0.85 + 0.15 * Math.sin(this.time * 3));
    }
    c.splash.position.copy(hit);
    c.splash.material.opacity = blockedLevel ? 0.6 + 0.2 * Math.sin(this.time * 6) : c.level * 0.55;
    c.splash.scale.setScalar(blockedLevel ? 0.55 : 0.5);
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
        float fleck = step(0.985, sHash(floor(vStonePos * 90.0)));
        diffuseColor.rgb *= 0.78 + g * 0.42 + band * 0.08;
        diffuseColor.rgb += vec3(0.55, 0.5, 0.7) * fleck * 0.35;`,
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
