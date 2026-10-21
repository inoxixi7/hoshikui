// A tiny frame-driven tween runner. Everything animated in the game goes through
// one of these so that input can be locked while anything important is moving.

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  smooth: (t: number) => t * t * (3 - 2 * t),
};

interface Tween {
  elapsed: number;
  duration: number;
  step: (k: number, raw: number) => void;
  ease: Ease;
  resolve: () => void;
  blocking: boolean;
}

export class Animator {
  private tweens: Tween[] = [];

  /** Run `step` with eased progress 0..1 over `duration` seconds. */
  tween(duration: number, step: (k: number, raw: number) => void, e: Ease = ease.inOutSine, blocking = true): Promise<void> {
    return new Promise((resolve) => {
      if (duration <= 0) {
        step(1, 1);
        resolve();
        return;
      }
      step(e(0), 0);
      this.tweens.push({ elapsed: 0, duration, step, ease: e, resolve, blocking });
    });
  }

  wait(seconds: number): Promise<void> {
    return this.tween(seconds, () => undefined, ease.linear);
  }

  get busy(): boolean {
    return this.tweens.some((t) => t.blocking);
  }

  update(dt: number) {
    if (!this.tweens.length) return;
    const done: Tween[] = [];
    for (const t of [...this.tweens]) {
      t.elapsed += dt;
      const raw = Math.min(1, t.elapsed / t.duration);
      t.step(t.ease(raw), raw);
      if (raw >= 1) done.push(t);
    }
    if (done.length) {
      this.tweens = this.tweens.filter((t) => !done.includes(t));
      done.forEach((t) => t.resolve());
    }
  }
}
