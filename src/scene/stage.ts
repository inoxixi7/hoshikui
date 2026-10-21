// Renderer, camera, sky, the star, the floating pedestal and post-processing.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PALETTE } from '../palette';
import { STAR_DIR } from '../puzzle/rules';
import { glowTexture, shadowTexture, starTexture } from './textures';

export const IS_MOBILE =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

export const PEDESTAL_TOP = 0;
export const RELIC_TARGET = new THREE.Vector3(0, 0.8, 0);
const STAR_DISTANCE = 46;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Everything that floats together: pedestal, relic, shadow. */
  readonly floating = new THREE.Group();
  readonly starSprite: THREE.Sprite;
  readonly starHalo: THREE.Sprite;
  readonly starPos: THREE.Vector3;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private starsMat: THREE.ShaderMaterial;
  private skyMat!: THREE.ShaderMaterial;
  private shaft: THREE.Mesh;
  private debris: THREE.Mesh[] = [];
  private baseDistance = 7;
  private time = 0;
  readonly shadow: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE || window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
    // Looking roughly toward the star, so it hangs just above the relic.
    this.camera.position.set(0.352, 0.342, 0.871).multiplyScalar(7).add(RELIC_TARGET);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(RELIC_TARGET);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.minPolarAngle = 0.18 * Math.PI;
    this.controls.maxPolarAngle = 0.47 * Math.PI;
    this.controls.zoomSpeed = 0.6;

    this.skyMat = this.buildSky();
    this.starsMat = this.buildStarfield();

    // The star: the single light source of the world.
    this.starPos = new THREE.Vector3(...STAR_DIR).multiplyScalar(STAR_DISTANCE).add(RELIC_TARGET);
    this.starSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: starTexture(), color: 0xfff1d6, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    );
    this.starSprite.scale.setScalar(11);
    this.starSprite.position.copy(this.starPos);
    this.starHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: PALETTE.starlight, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.2 }),
    );
    this.starHalo.scale.setScalar(20);
    this.starHalo.position.copy(this.starPos);
    this.scene.add(this.starHalo, this.starSprite);

    // A faint permanent shaft from the star, so its role as light source reads at a glance.
    this.shaft = this.buildShaft();
    this.scene.add(this.shaft);

    // Lighting: a warm key from the star, cold fill from below, dim ambient.
    const key = new THREE.DirectionalLight(0xffe2b5, 2.4);
    key.position.copy(new THREE.Vector3(...STAR_DIR).multiplyScalar(10));
    const fill = new THREE.DirectionalLight(0x6f7cff, 0.55);
    fill.position.set(2, -1.5, 4);
    const rim = new THREE.DirectionalLight(0x9aa6ff, 0.9);
    rim.position.set(3, 2, -4);
    const front = new THREE.DirectionalLight(0xb8bcff, IS_MOBILE ? 1.5 : 1.0);
    front.position.set(3, 4, 6);
    const amb = new THREE.HemisphereLight(0x4a4f9a, 0x0a0812, 1.0);
    this.scene.add(key, fill, rim, front, amb);

    this.scene.add(this.floating);
    this.buildPedestal();
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = PEDESTAL_TOP + 0.004;
    this.floating.add(this.shadow);

    if (!IS_MOBILE) this.setupBloom();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildSky(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        mid: { value: new THREE.Color(PALETTE.skyMid) },
        bottom: { value: new THREE.Color(PALETTE.skyBottom) },
        starDir: { value: new THREE.Vector3(...STAR_DIR) },
        starGlow: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 starDir; uniform float starGlow;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          float h = vDir.y;
          vec3 col = mix(mid, top, smoothstep(0.0, 0.85, h));
          col = mix(bottom, col, smoothstep(-0.55, 0.05, h));
          // A faint dust band tilted across the sky.
          float band = exp(-pow(dot(vDir, normalize(vec3(0.35, 0.8, 0.5))) / 0.28, 2.0));
          float n = noise(vDir * 4.0) * 0.6 + noise(vDir * 9.0) * 0.4;
          col += vec3(0.10, 0.09, 0.22) * band * n;
          // Warm bloom of the star in the haze.
          float s = max(dot(vDir, starDir), 0.0);
          col += (vec3(0.42, 0.26, 0.12) * pow(s, 60.0) * 0.5 + vec3(0.10, 0.07, 0.10) * pow(s, 12.0) * 0.6) * starGlow;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 24), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
    return mat;
  }

  private buildStarfield(): THREE.ShaderMaterial {
    const count = IS_MOBILE ? 650 : 1400;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const y = u * 0.9 + 0.1; // sparser below the horizon
      const r = Math.sqrt(1 - Math.min(1, y * y));
      pos.set([r * Math.cos(t) * 70, y * 70, r * Math.sin(t) * 70], i * 3);
      size[i] = Math.pow(Math.random(), 6) * 3.2 + 0.6;
      phase[i] = Math.random() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, pr: { value: this.renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float phase; uniform float time; uniform float pr;
        varying float vA;
        void main() {
          vA = 0.55 + 0.45 * sin(time * (0.6 + fract(phase) * 1.4) + phase);
          gl_PointSize = size * pr;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * a * vA, 1.0);
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -9;
    this.scene.add(pts);
    return mat;
  }

  private buildShaft(): THREE.Mesh {
    const len = STAR_DISTANCE;
    const geo = new THREE.CylinderGeometry(0.05, 1.6, len, 24, 1, true);
    geo.translate(0, len / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(PALETTE.starlight) }, strength: { value: 0.05 } },
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
          float edge = pow(abs(dot(vN, vV)), 1.5);
          float fade = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.35, 1.0, vT));
          gl_FragColor = vec4(color * edge * fade * strength, 1.0);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(RELIC_TARGET);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...STAR_DIR));
    m.renderOrder = 5;
    return m;
  }

  private buildPedestal() {
    // A floating slab of the same basalt as the relic, irregular and chipped.
    const geo = new THREE.CylinderGeometry(1.45, 1.05, 0.42, 9, 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const rnd = mulberry(7);
    const jitter = new Map<string, [number, number]>();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const key = `${Math.round(a * 100)}|${Math.round(y * 100)}`;
      if (!jitter.has(key)) jitter.set(key, [0.9 + rnd() * 0.16, (rnd() - 0.5) * 0.06]);
      const [s, dy] = jitter.get(key) as [number, number];
      const isTop = y > 0.2;
      p.setXYZ(i, x * s, isTop ? y : y + dy, z * s);
    }
    geo.computeVertexNormals();
    geo.translate(0, PEDESTAL_TOP - 0.21, 0);
    const mat = new THREE.MeshStandardMaterial({ color: PALETTE.pedestal, roughness: 0.92, metalness: 0.05, flatShading: true });
    const slab = new THREE.Mesh(geo.toNonIndexed(), mat);
    slab.geometry.computeVertexNormals();
    this.floating.add(slab);

    // A faint engraved ring on the top surface.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.12, 1.14, 64),
      new THREE.MeshBasicMaterial({ color: 0x8a86b8, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = PEDESTAL_TOP + 0.003;
    this.floating.add(ring);

    // Small rocks drifting beneath the slab.
    const rockMat = new THREE.MeshStandardMaterial({ color: PALETTE.pedestal, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 + rnd() * 0.07, 0), rockMat);
      const a = (i / 6) * Math.PI * 2 + rnd();
      r.position.set(Math.cos(a) * (0.6 + rnd() * 0.8), -0.75 - rnd() * 0.7, Math.sin(a) * (0.6 + rnd() * 0.8));
      r.userData.phase = rnd() * 6.28;
      r.userData.baseY = r.position.y;
      this.debris.push(r);
      this.floating.add(r);
    }
  }

  private setupBloom() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setBloomStrength(s: number) {
    if (this.bloom) this.bloom.strength = s;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // Shift the frame up so the relic sits low and the star hangs above it.
    this.camera.setViewOffset(w, h, 0, -h * 0.07, w, h);
    // Keep the relic and pedestal framed on both landscape and portrait screens.
    const halfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const needH = 3.9 / (2 * halfV);
    const needW = 3.3 / (2 * halfV * this.camera.aspect);
    const prev = this.baseDistance;
    this.baseDistance = Math.max(needH, needW);
    this.controls.minDistance = this.baseDistance * 0.72;
    this.controls.maxDistance = this.baseDistance * 1.45;
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength((offset.length() / prev) * this.baseDistance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    this.time += dt;
    this.starsMat.uniforms.time.value = this.time;
    this.floating.position.y = Math.sin(this.time * 0.7) * 0.035;
    for (const r of this.debris) {
      r.position.y = r.userData.baseY + Math.sin(this.time * 0.8 + r.userData.phase) * 0.06;
      r.rotation.x += dt * 0.2;
      r.rotation.y += dt * 0.15;
    }
    const pulse = 1 + Math.sin(this.time * 1.3) * 0.04;
    if (this.starSprite.userData.free !== true) this.starSprite.scale.setScalar(11 * pulse);
    this.controls.update();
  }

  /** 0..1: how present the star is in the sky (it is swallowed in the ending). */
  setStarPresence(k: number) {
    this.skyMat.uniforms.starGlow.value = k;
    this.starHalo.material.opacity = 0.2 * k;
    this.setShaftStrength(0.05 * k);
  }

  setShaftStrength(s: number) {
    (this.shaft.material as THREE.ShaderMaterial).uniforms.strength.value = s;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
