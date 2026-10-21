import * as THREE from 'three';

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
/** Soft radial glow, white, for additive sprites. */
export function glowTexture(): THREE.Texture {
  glowTex ??= canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return glowTex;
}

let starTex: THREE.Texture | null = null;
/** The distant star: a hot core with four long diffraction spikes. */
export function starTexture(): THREE.Texture {
  starTex ??= canvasTexture(256, (g, s) => {
    const c = s / 2;
    const core = g.createRadialGradient(c, c, 0, c, c, c);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.06, 'rgba(255,246,225,1)');
    core.addColorStop(0.16, 'rgba(255,214,150,0.45)');
    core.addColorStop(0.4, 'rgba(255,190,120,0.08)');
    core.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    for (const [w, len, a] of [
      [2.2, 1, 0.9],
      [1.2, 0.62, 0.5],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(c, c);
        g.rotate((i * Math.PI) / 2 + (len < 1 ? Math.PI / 4 : 0));
        const lg = g.createLinearGradient(0, 0, c * len, 0);
        lg.addColorStop(0, `rgba(255,240,210,${a})`);
        lg.addColorStop(1, 'rgba(255,240,210,0)');
        g.fillStyle = lg;
        g.beginPath();
        g.moveTo(0, -w);
        g.lineTo(c * len, 0);
        g.lineTo(0, w);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  });
  return starTex;
}

let shadowTex: THREE.Texture | null = null;
/** Fake contact shadow under the relic. */
export function shadowTexture(): THREE.Texture {
  shadowTex ??= canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return shadowTex;
}

let ringTex: THREE.Texture | null = null;
/** Thin luminous ring used for success shockwaves. */
export function ringTexture(): THREE.Texture {
  ringTex ??= canvasTexture(256, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.86, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  return ringTex;
}
