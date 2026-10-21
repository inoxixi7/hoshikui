// Procedural WebAudio sound: no audio files. Everything is synthesized on demand.

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const BASE = 392; // G4

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: GainNode | null = null;
  private drone: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private _muted = false;

  get muted() {
    return this._muted;
  }

  setMuted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Must be called from a user gesture (iOS Safari). Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
        // Simple generated reverb for space.
        const conv = this.ctx.createConvolver();
        conv.buffer = this.impulse(2.8);
        this.wet = this.ctx.createGain();
        this.wet.gain.value = 0.35;
        this.wet.connect(conv);
        conv.connect(this.master);
        this.noiseBuf = this.makeNoise();
        this.startDrone();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startDrone() {
    const ctx = this.ctx as AudioContext;
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.gain.setTargetAtTime(0.05, ctx.currentTime, 2.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    this.drone.connect(lp);
    lp.connect(this.master as GainNode);
    lp.connect(this.wet as GainNode);
    for (const [f, det] of [
      [98, -4],
      [146.8, 3],
      [196, 6],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = 0.2;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(this.drone);
      o.start();
      lfo.start();
    }
  }

  private out(dry = 1, wet = 0.4): { node: GainNode; t: number } | null {
    if (!this.ctx || !this.master || !this.wet) return null;
    const g = this.ctx.createGain();
    const d = this.ctx.createGain();
    const w = this.ctx.createGain();
    d.gain.value = dry;
    w.gain.value = wet;
    g.connect(d);
    g.connect(w);
    d.connect(this.master);
    w.connect(this.wet);
    return { node: g, t: this.ctx.currentTime };
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; wet?: number; glideTo?: number; attack?: number } = {}) {
    const o = this.out(1, opts.wet ?? 0.4);
    if (!o || !this.ctx) return;
    const t = o.t + (opts.delay ?? 0);
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t + dur);
    const env = this.ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.005;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(o.node);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, freq: number, q: number, gain: number, delay = 0, wet = 0.3) {
    const o = this.out(1, wet);
    if (!o || !this.ctx || !this.noiseBuf) return;
    const t = o.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(o.node);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Stone settling on the pedestal. */
  land() {
    this.tone(110, 0.32, { gain: 0.45, glideTo: 48, wet: 0.25 });
    this.noise(0.18, 380, 0.9, 0.25, 0, 0.2);
    this.noise(0.08, 2400, 2, 0.05, 0.01, 0.1);
  }

  /** Droplet clicking through a groove; pitch climbs along the path. */
  roll(step: number) {
    const f = BASE * 2 * Math.pow(2, PENTA[Math.min(step, PENTA.length - 1)] / 12);
    this.tone(f, 0.22, { gain: 0.09, wet: 0.6 });
    this.tone(f * 2.01, 0.1, { gain: 0.03, wet: 0.6 });
  }

  /** Starlight entering a crack. */
  light() {
    [0, 4, 7, 12].forEach((s, i) =>
      this.tone(BASE * 2 * Math.pow(2, s / 12), 1.6, { gain: 0.05, attack: 0.25, delay: i * 0.05, wet: 0.9, type: 'triangle' }),
    );
    this.noise(1.2, 6000, 0.7, 0.03, 0, 0.9);
  }

  fold() {
    this.noise(0.28, 900, 1.4, 0.18, 0, 0.2);
    this.tone(260, 0.12, { gain: 0.12, glideTo: 180, delay: 0.22, wet: 0.2 });
  }

  /** Muted, short: the action did nothing. */
  refuse() {
    this.tone(150, 0.16, { gain: 0.18, glideTo: 110, wet: 0.1 });
  }

  tap() {
    this.tone(BASE * 3, 0.12, { gain: 0.05, wet: 0.5 });
  }

  /** Level solved: a rising pentatonic bloom. */
  win() {
    [0, 2, 4, 7, 9, 12, 16].forEach((s, i) => {
      const f = BASE * Math.pow(2, s / 12);
      this.tone(f, 1.8, { gain: 0.11, delay: i * 0.085, wet: 0.8 });
      this.tone(f * 2.76, 0.6, { gain: 0.02, delay: i * 0.085, wet: 0.8 });
    });
  }

  /** Shatter/re-form whoosh. */
  shatter() {
    this.noise(1.4, 1800, 0.5, 0.08, 0, 0.8);
    this.tone(880, 1.4, { gain: 0.04, glideTo: 1760, attack: 0.4, wet: 0.9 });
  }

  /** The star is swallowed. */
  ending() {
    this.tone(55, 3.5, { gain: 0.35, attack: 1.4, wet: 0.6, type: 'triangle', glideTo: 110 });
    [0, 7, 12, 16, 19, 24].forEach((s, i) =>
      this.tone(BASE * 0.5 * Math.pow(2, s / 12), 5, { gain: 0.07, attack: 1.2, delay: 1.4 + i * 0.12, wet: 1 }),
    );
    this.noise(2.5, 3000, 0.4, 0.1, 1.3, 1);
  }
}

export const sfx = new Sfx();
