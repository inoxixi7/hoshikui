// The relic bursts into motes of light and reassembles as the next relic.

import * as THREE from 'three';
import { PALETTE } from '../palette';

export class ShatterField {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(from: Float32Array, to: Float32Array, pixelRatio: number) {
    const count = Math.min(from.length, to.length) / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(from.slice(0, count * 3), 3));
    g.setAttribute('target', new THREE.BufferAttribute(to.slice(0, count * 3), 3));
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        progress: { value: 0 },
        pr: { value: pixelRatio },
        colA: { value: new THREE.Color(PALETTE.starlight) },
        colB: { value: new THREE.Color(PALETTE.dropletGlow) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 target; attribute vec4 seed;
        uniform float progress; uniform float pr;
        varying float vA; varying float vMix;
        void main() {
          // 0..0.4 burst outward, 0.4..1 converge on the target with a swirl.
          vec3 centre = vec3(0.0, 0.8, 0.0);
          vec3 out1 = normalize(position - centre + (seed.xyz - 0.5) * 0.6) * (0.9 + seed.w * 1.4);
          float burst = smoothstep(0.0, 0.4, progress);
          float gather = smoothstep(0.38, 1.0, progress);
          vec3 cloud = position + out1 * burst;
          float ang = (1.0 - gather) * (2.5 + seed.x * 3.0);
          vec3 rel = cloud - centre;
          rel = vec3(rel.x * cos(ang) - rel.z * sin(ang), rel.y, rel.x * sin(ang) + rel.z * cos(ang));
          vec3 p = mix(centre + rel, target, gather * gather * (3.0 - 2.0 * gather));
          vA = sin(progress * 3.14159) * 0.8 + 0.2 * (1.0 - progress);
          vMix = seed.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + seed.z * 3.5) * pr * (6.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 colA; uniform vec3 colB; varying float vA; varying float vMix;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(mix(colA, colB, vMix) * a * vA, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 40;
  }

  set progress(v: number) {
    this.mat.uniforms.progress.value = v;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
