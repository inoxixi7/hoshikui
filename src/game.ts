// Game flow: title → levels → ending. Owns the puzzle state and drives the views.

import * as THREE from 'three';
import { LEVELS } from './levels';
import type { Action, Dir, GameState, LevelDef, Turn } from './puzzle/types';
import { DIRS, TIP, applyAction, initialState, inverseAction, isStable, isWon, mulMat, type RollStep } from './puzzle/rules';
import { solve } from './puzzle/solver';
import { Stage } from './scene/stage';
import { DIR_VEC, RelicView, type TopplePlan } from './relic/relicView';
import { ShatterField } from './relic/transition';
import { Hud } from './ui/hud';
import { PointerInput } from './input/pointer';
import { sfx } from './audio/sfx';
import { Animator, ease } from './anim';
import { type SaveData, clearSave, loadSave, writeSave } from './save';

const MAX_TILT = THREE.MathUtils.degToRad(15);
const REFUSED_TILT = THREE.MathUtils.degToRad(8);
const IDLE_HINT_S = 30;

interface HistoryEntry {
  prev: GameState;
  action: Action;
  path: RollStep[];
}

interface DragCandidate {
  dir: Dir;
  valid: boolean;
  screen: THREE.Vector2;
  plan: TopplePlan;
}

export class Game {
  private stage: Stage;
  private hud: Hud;
  private relic: RelicView;
  private anim = new Animator();
  private save: SaveData;
  private readonly allUnlocked: boolean;
  private levelIndex = 0;
  private state: GameState;
  private history: HistoryEntry[] = [];
  private busy = false;
  private idle = 0;
  private hinting = false;
  private refusals = 0;
  private demoShown = false;
  private demoTimer = -1;
  private drag: { candidates: DragCandidate[]; choice: DragCandidate | null; dist: number } | null = null;
  private turnDrag: { cx: number; cy: number; last: number; angle: number } | null = null;
  private spinSpeed = 0;
  private overlayReturn: 'title' | 'play' = 'play';
  private flashEl: HTMLElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, flash: HTMLElement) {
    this.flashEl = flash;
    this.stage = new Stage(canvas);
    this.save = loadSave();
    this.allUnlocked = new URLSearchParams(location.search).has('all');
    sfx.setMuted(this.save.muted);

    this.hud = new Hud(
      uiRoot,
      {
        undo: () => this.undo(),
        reset: () => this.reset(),
        openMenu: () => this.openMenu(),
        closeOverlay: () => this.closeOverlay(),
        toggleSound: () => this.toggleSound(),
        openChapters: () => this.openChapters(),
        chooseLevel: (i) => this.chooseLevel(i),
        home: () => this.goHome(),
        clearProgress: () => this.clearProgress(),
        replay: () => this.replay(),
        uiTap: () => (sfx.unlock(), sfx.tap()),
      },
      LEVELS.length,
    );
    this.hud.setMuted(this.save.muted);

    this.levelIndex = this.resumeIndex();
    this.state = initialState(this.level);
    this.relic = new RelicView(this.level, this.stage.floating, this.state);
    this.enterTitle(true);

    new PointerInput(canvas, this.stage.camera, this.stage.controls, () => ({ pickables: () => this.relic.pickables(), turntable: () => this.stage.turnPickables }), {
      canInteract: () => this.hud.current === 'play' || this.hud.current === 'title',
      activity: () => this.onActivity(),
      dragStart: () => this.dragStart(),
      dragMove: (dx, dy) => this.dragMove(dx, dy),
      dragEnd: (dx, dy, c) => this.dragEnd(dx, dy, c),
      turnStart: (x, y) => this.turnStart(x, y),
      turnMove: (x, y) => this.turnMove(x, y),
      turnEnd: (c) => this.turnEnd(c),
      tap: (_plate, hitRelic) => this.tap(hitRelic),
    });
    window.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('visibilitychange', () => (this.idle = 0));
  }

  // ------------------------------------------------------------ helpers

  private get level(): LevelDef {
    return LEVELS[this.levelIndex];
  }

  private get unlocked(): number {
    return this.allUnlocked ? LEVELS.length - 1 : Math.min(this.save.unlocked, LEVELS.length - 1);
  }

  private get completedFlags(): boolean[] {
    return LEVELS.map((l) => this.save.completed.includes(l.id));
  }

  private resumeIndex(): number {
    const firstOpen = LEVELS.findIndex((l) => !this.save.completed.includes(l.id));
    return Math.max(0, Math.min(firstOpen < 0 ? 0 : firstOpen, this.unlocked));
  }

  private get inputLocked(): boolean {
    return this.busy || this.relic.anim.busy || this.anim.busy;
  }

  private persist() {
    writeSave(this.save);
  }

  private refreshHud() {
    this.hud.setProgress(this.levelIndex, this.completedFlags);
    this.hud.setUndoEnabled(this.history.length > 0);
  }

  private relicCenterScreen(): THREE.Vector2 {
    return this.toScreen(this.relic.root.getWorldPosition(new THREE.Vector3()));
  }

  private toScreen(world: THREE.Vector3): THREE.Vector2 {
    const p = world.clone().project(this.stage.camera);
    return new THREE.Vector2((p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight);
  }

  /** Floating-space point → world point. */
  private floatToWorld(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().add(this.stage.floating.position);
  }

  private onActivity() {
    sfx.unlock();
    this.idle = 0;
    if (this.hinting) {
      this.hinting = false;
      this.relic.setHint(null);
      this.stage.setRingHint(false);
    }
    if (this.demoTimer >= 0) this.demoTimer = -1;
  }

  // ------------------------------------------------------------ screens

  private enterTitle(instant = false) {
    this.hud.setScreen('title');
    this.relic.breath = 1;
    this.spinSpeed = 0.35;
    const h0 = this.relic.hover;
    void this.anim.tween(instant ? 0 : 0.9, (k) => (this.relic.hover = h0 + (0.42 - h0) * k), ease.inOutSine, false);
    this.stage.setBloomStrength(0.95);
  }

  private async startFromTitle() {
    if (this.busy) return;
    this.busy = true;
    sfx.unlock();
    sfx.tap();
    this.spinSpeed = 0;
    const s0 = this.relic.spin;
    // Settle to the nearest full turn so the play pose matches the rules exactly.
    const s1 = Math.round(s0 / (Math.PI * 2)) * Math.PI * 2;
    const h0 = this.relic.hover;
    await this.anim.tween(
      0.9,
      (k) => {
        this.relic.spin = s0 + (s1 - s0) * k;
        this.relic.hover = h0 * (1 - k);
        this.relic.breath = 1 - k;
      },
      ease.inOutCubic,
    );
    this.relic.spin = 0;
    sfx.land();
    this.stage.setBloomStrength(0.85);
    this.hud.setScreen('play');
    this.refreshHud();
    this.busy = false;
    this.idle = 0;
    this.maybeScheduleFirstDemo();
  }

  private maybeScheduleFirstDemo() {
    if (this.levelIndex === 0 && this.save.completed.length === 0 && !this.demoShown) this.demoTimer = 3;
  }

  private openMenu() {
    if (this.hud.current !== 'play') return;
    this.overlayReturn = 'play';
    this.hud.setScreen('menu');
  }

  private openChapters() {
    if (this.busy) return;
    if (this.hud.current === 'title') this.overlayReturn = 'title';
    this.hud.setChapters(this.unlocked, this.completedFlags, this.levelIndex);
    this.hud.setScreen('chapters');
  }

  private closeOverlay() {
    if (this.overlayReturn === 'title') this.hud.setScreen('title');
    else {
      this.hud.setScreen('play');
      this.refreshHud();
    }
  }

  private toggleSound() {
    sfx.unlock();
    this.save.muted = !this.save.muted;
    sfx.setMuted(this.save.muted);
    this.hud.setMuted(this.save.muted);
    this.persist();
    if (!this.save.muted) sfx.tap();
  }

  private goHome() {
    this.overlayReturn = 'title';
    this.enterTitle();
  }

  private clearProgress() {
    const muted = this.save.muted;
    this.save = clearSave();
    this.save.muted = muted;
    this.persist();
    sfx.refuse();
    this.hud.setChapters(this.unlocked, this.completedFlags, this.levelIndex);
    this.refreshHud();
    if (this.levelIndex > this.unlocked) void this.loadLevel(0, 'title');
  }

  private async chooseLevel(i: number) {
    if (this.busy || i > this.unlocked) return;
    sfx.unlock();
    sfx.tap();
    const back = this.overlayReturn;
    if (i === this.levelIndex) {
      if (back === 'title') this.hud.setScreen('title');
      else this.closeOverlay();
      if (back === 'title') await this.startFromTitle();
      return;
    }
    await this.loadLevel(i, 'play');
  }

  // ------------------------------------------------------------ level flow

  /** Shatter the current relic and re-form it as level `i`. */
  private async loadLevel(i: number, then: 'play' | 'title') {
    this.busy = true;
    this.hud.setScreen('transition');
    this.relic.setHint(null);
    this.hinting = false;
    const old = this.relic;
    const from = old.sampleSurface(IS_LOW() ? 900 : 1600);
    this.levelIndex = i;
    this.state = initialState(this.level);
    this.history = [];
    this.refusals = 0;
    const next = new RelicView(this.level, this.stage.floating, this.state);
    next.update(0);
    const to = next.sampleSurface(IS_LOW() ? 900 : 1600);
    next.setVisible(false);
    const field = new ShatterField(from, to, this.stage.renderer.getPixelRatio());
    this.stage.floating.add(field.points);
    old.setVisible(false);
    this.refreshHud();
    sfx.shatter();
    await this.anim.tween(2.0, (k) => (field.progress = k), ease.linear);
    old.dispose();
    this.relic = next;
    next.setVisible(true);
    this.stage.floating.remove(field.points);
    field.dispose();
    await this.anim.tween(0.5, (k) => next.setGlowAll((1 - k) * 0.7), ease.outQuad);
    next.setGlowAll(0);
    this.busy = false;
    this.idle = 0;
    if (then === 'title') {
      this.overlayReturn = 'title';
      this.enterTitle();
    } else {
      this.hud.setScreen('play');
      this.refreshHud();
      this.maybeScheduleFirstDemo();
    }
  }

  private async perform(action: Action): Promise<boolean> {
    const prev = this.state;
    const r = applyAction(this.level, prev, action);
    if (!r.ok) {
      await this.refuse();
      return false;
    }
    this.busy = true;
    this.refusals = 0;
    this.history.push({ prev, action, path: r.path });
    this.hud.setUndoEnabled(true);
    if (action.type === 'topple') await this.relic.topple(action.dir, () => sfx.land());
    else {
      sfx.fold();
      await this.relic.turn(action.turn);
    }
    await this.relic.updateLight(r.state, () => sfx.light());
    if (r.path.length > 1) await this.relic.roll(r.path, (i) => sfx.roll(i));
    this.state = r.state;
    this.relic.setState(r.state);
    if (isWon(this.level, r.state)) await this.win();
    this.busy = false;
    return true;
  }

  private async refuse() {
    sfx.refuse();
    this.refusals++;
    await this.relic.refuse();
    if (this.refusals >= 3) {
      this.refusals = 0;
      void this.showDemo();
    }
  }

  private async undo() {
    if (this.inputLocked || this.hud.current !== 'play') return;
    const h = this.history.pop();
    if (!h) {
      sfx.refuse();
      void this.relic.refuse();
      return;
    }
    this.onActivity();
    this.busy = true;
    sfx.tap();
    const prev = h.prev;
    const jobs: Promise<void>[] = [this.relic.rewindDroplet(h.path)];
    const back = inverseAction(h.action);
    if (back.type === 'topple') jobs.push(this.relic.topple(back.dir, () => sfx.land()));
    else {
      sfx.fold();
      jobs.push(this.relic.turn(back.turn));
    }
    await Promise.all(jobs);
    await this.relic.updateLight(prev);
    this.state = prev;
    this.relic.setState(prev);
    this.refreshHud();
    this.busy = false;
  }

  private async reset() {
    if (this.inputLocked || this.hud.current !== 'play') return;
    this.onActivity();
    if (!this.history.length) {
      sfx.refuse();
      void this.relic.refuse();
      return;
    }
    this.busy = true;
    sfx.tap();
    await this.anim.tween(0.22, (k) => ((this.relic.hover = k * 0.3), this.relic.setGlowAll(k * 0.5)), ease.outQuad);
    this.state = initialState(this.level);
    this.history = [];
    this.relic.setState(this.state);
    await this.anim.tween(0.35, (k) => ((this.relic.hover = (1 - k) * 0.3), this.relic.setGlowAll((1 - k) * 0.5)), ease.inQuad);
    this.relic.hover = 0;
    this.relic.setGlowAll(0);
    sfx.land();
    this.refreshHud();
    this.busy = false;
  }

  private async win() {
    const idx = this.levelIndex;
    sfx.win();
    const already = this.save.completed.includes(this.level.id);
    // Solving level k lights vein k for every later level.
    const veinIndex = idx;
    if (!already) this.save.completed.push(this.level.id);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(idx + 1, LEVELS.length - 1));
    this.persist();
    this.hud.burstDot(idx);
    await this.relic.celebrate(veinIndex);
    this.refreshHud();
    if (idx === LEVELS.length - 1) {
      await this.ending();
      return;
    }
    await this.anim.wait(0.35);
    await this.loadLevel(idx + 1, 'play');
  }

  private async ending() {
    this.hud.setScreen('transition');
    const star = this.stage.starSprite;
    const start = star.position.clone();
    const target = this.floatToWorld(this.relic.coreWorld());
    sfx.ending();
    star.userData.free = true;
    // The core splits open and draws the star down out of the sky.
    await this.anim.tween(
      2.6,
      (k, raw) => {
        this.relic.coreBurst = Math.min(1.4, raw * 2);
        this.relic.setCoreCrack(Math.min(1, raw * 1.5));
        const p = start.clone().lerp(target, k);
        // Curve the path slightly upward so it reads as a pull, not a slide.
        p.y += Math.sin(raw * Math.PI) * 2.2;
        star.position.copy(p);
        star.scale.setScalar(11 * (1 - k) + 0.6);
        this.stage.setStarPresence(1 - k);
        this.relic.setGlowAll(k * 0.6);
      },
      ease.inQuad,
    );
    star.visible = false;
    this.relic.starGone = true;
    this.flashEl.classList.add('on');
    await this.anim.wait(0.25);
    this.flashEl.classList.remove('on');
    this.relic.lightAllVeins();
    this.relic.coreBurst = 0.4;
    this.relic.setGlowAll(0.55);
    this.relic.breath = 1;
    this.spinSpeed = 0.18;
    await this.anim.tween(1.4, (k) => (this.relic.hover = k * 0.35), ease.inOutSine);
    this.hud.setScreen('ending');
  }

  private async replay() {
    if (this.busy) return;
    sfx.tap();
    const star = this.stage.starSprite;
    star.visible = true;
    star.position.copy(this.stage.starPos);
    star.userData.free = false;
    this.spinSpeed = 0;
    this.relic.spin = 0;
    this.relic.hover = 0;
    this.relic.coreBurst = 0;
    this.relic.setGlowAll(0);
    this.relic.setCoreCrack(0);
    void this.anim.tween(1.5, (k) => this.stage.setStarPresence(k), ease.inOutSine, false);
    await this.loadLevel(0, 'title');
  }

  // ------------------------------------------------------------ hints

  private async showDemo() {
    if (this.hud.current !== 'play' || this.inputLocked) return;
    const next = solve(this.level, this.state)?.[0];
    if (!next) return;
    this.demoShown = true;
    const a = this.relicCenterScreen();
    const center = this.relic.root.getWorldPosition(new THREE.Vector3());
    if (next.type === 'spin') {
      // Drag along the front of the turntable: right turns it one way, left the other.
      const front = this.toScreen(this.floatToWorld(new THREE.Vector3(0.85, 0, 0.85)));
      const side = this.toScreen(this.floatToWorld(new THREE.Vector3(0.85, 0, -0.85))).sub(front).normalize();
      const b = front.clone().addScaledVector(side, (next.turn === 1 ? 1 : -1) * 120);
      this.stage.setRingHint(true);
      this.hinting = true;
      await this.hud.showHand(front, b);
      return;
    }
    const b2 = this.toScreen(center.clone().addScaledVector(DIR_VEC[next.dir], 1));
    const v = b2.sub(a).normalize().multiplyScalar(Math.max(120, this.dragThreshold() * 1.6));
    const b = a.clone().add(v);
    const plan = this.relic.planTopple(next.dir);
    // The relic leans along with the hand, then settles back.
    void this.anim
      .tween(
        1.9,
        (_k, raw) => {
          if (this.drag) return;
          const lean = raw < 0.28 ? 0 : raw < 0.7 ? (raw - 0.28) / 0.42 : Math.max(0, 1 - (raw - 0.7) / 0.25);
          this.relic.setTilt(plan, MAX_TILT * 0.7 * ease.inOutSine(Math.min(1, lean)));
        },
        ease.linear,
        false,
      )
      .then(() => !this.drag && this.relic.setTilt(null, 0));
    await this.hud.showHand(a, b);
  }

  private showIdleHint() {
    const next = solve(this.level, this.state)?.[0];
    if (!next) return;
    this.hinting = true;
    if (next.type === 'spin') this.stage.setRingHint(true);
    else this.relic.setHint(next.dir);
  }

  // ------------------------------------------------------------ input

  private dragThreshold(): number {
    return Math.min(window.innerWidth, window.innerHeight) * 0.08;
  }

  private dragStart() {
    if (this.hud.current !== 'play' || this.inputLocked) {
      this.drag = null;
      return;
    }
    this.hud.hideHand();
    const c = this.relicCenterScreen();
    const center = this.relic.root.getWorldPosition(new THREE.Vector3());
    // Every push tips the relic over the edge on that side; only a face that cannot
    // hold it (none on the current relics, but the rules allow it) refuses.
    const candidates: DragCandidate[] = DIRS.map((dir) => {
      const s = this.toScreen(center.clone().addScaledVector(DIR_VEC[dir], 0.8)).sub(c);
      return { dir, valid: isStable(this.level, mulMat(TIP[dir], this.state.orient)), screen: s.normalize(), plan: this.relic.planTopple(dir) };
    });
    this.drag = { candidates, choice: null, dist: 0 };
  }

  private dragMove(dx: number, dy: number) {
    const d = this.drag;
    if (!d) return;
    const dist = Math.hypot(dx, dy);
    d.dist = dist;
    if (dist < 6) {
      d.choice = null;
      this.relic.setTilt(null, 0);
      return;
    }
    const v = new THREE.Vector2(dx, dy).normalize();
    let best = d.candidates[0];
    for (const c of d.candidates) if (c.screen.dot(v) > best.screen.dot(v)) best = c;
    d.choice = best;
    const k = 1 - Math.exp(-dist / (this.dragThreshold() * 0.9));
    this.relic.setTilt(best.plan, (best.valid ? MAX_TILT : REFUSED_TILT) * k);
  }

  private dragEnd(dx: number, dy: number, cancelled: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const dist = Math.hypot(dx, dy);
    if (cancelled || dist < this.dragThreshold() || !d.choice) {
      if (this.relic.tiltAngle > 0) void this.relic.springBack(false);
      return;
    }
    if (d.choice.valid) void this.perform({ type: 'topple', dir: d.choice.dir });
    else {
      sfx.refuse();
      this.refusals++;
      void this.relic.springBack(true).then(() => {
        if (this.refusals >= 3) {
          this.refusals = 0;
          void this.showDemo();
        }
      });
    }
  }

  /** Turning on the pedestal: the pointer's angle around the relic is the turn. */
  private turnStart(x: number, y: number) {
    if (this.hud.current !== 'play' || this.inputLocked) {
      this.turnDrag = null;
      return;
    }
    this.hud.hideHand();
    const c = this.relicCenterScreen();
    this.turnDrag = { cx: c.x, cy: c.y, last: Math.atan2(y - c.y, x - c.x), angle: 0 };
  }

  private turnMove(x: number, y: number) {
    const t = this.turnDrag;
    if (!t) return;
    const a = Math.atan2(y - t.cy, x - t.cx);
    let d = a - t.last;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    t.last = a;
    // Screen y points down, so a clockwise drag on screen is a counter-clockwise turn from above.
    t.angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, t.angle - d));
    this.relic.setTurnPreview(t.angle);
  }

  private turnEnd(cancelled: boolean) {
    const t = this.turnDrag;
    this.turnDrag = null;
    if (!t) return;
    if (!cancelled && Math.abs(t.angle) > 0.35) void this.perform({ type: 'spin', turn: (t.angle > 0 ? 1 : -1) as Turn });
    else if (t.angle !== 0) void this.relic.cancelTurn();
  }

  private tap(hitRelic: boolean) {
    const screen = this.hud.current;
    if (screen === 'title') {
      if (hitRelic) void this.startFromTitle();
      return;
    }
    if (screen !== 'play' || this.inputLocked || !hitRelic) return;
    if (this.history.length === 0 && !this.demoShown) {
      // Tapping the relic instead of dragging it: show how it moves.
      void this.showDemo();
    }
  }

  private key(e: KeyboardEvent) {
    const screen = this.hud.current;
    if (screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      void this.startFromTitle();
      return;
    }
    if (e.key === 'Escape') {
      if (screen === 'play') this.openMenu();
      else if (screen === 'menu' || screen === 'chapters') this.closeOverlay();
      return;
    }
    if (screen !== 'play' || this.inputLocked) return;
    this.onActivity();
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [x, y] = arrows[e.key];
      const len = this.dragThreshold() * 1.5;
      this.dragStart();
      this.dragMove(x * len, y * len);
      this.dragEnd(x * len, y * len, false);
    } else if (e.key === 'q' || e.key === 'Q') void this.perform({ type: 'spin', turn: 1 });
    else if (e.key === 'e' || e.key === 'E') void this.perform({ type: 'spin', turn: -1 });
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') void this.undo();
    else if (e.key === 'r' || e.key === 'R') void this.reset();

  }

  // ------------------------------------------------------------ frame

  update(dt: number) {
    this.anim.update(dt);
    if (this.spinSpeed) this.relic.spin += dt * this.spinSpeed;
    // The turntable notches turn with the relic while it is being turned.
    this.stage.turntable.rotation.y = this.hud.current === 'play' ? this.relic.spin : 0;
    this.relic.update(dt);
    this.stage.update(dt);
    if (this.hud.current === 'play' && !this.inputLocked && !this.drag && !this.turnDrag) {
      this.idle += dt;
      if (this.demoTimer >= 0) {
        this.demoTimer -= dt;
        if (this.demoTimer < 0 && this.history.length === 0) void this.showDemo();
      }
      if (this.idle > IDLE_HINT_S && !this.hinting) this.showIdleHint();
    }
    this.stage.render();
  }

  /** Test hook (only exposed with ?debug). */
  debug() {
    return {
      state: () => this.state,
      scene: () => this.stage.scene,
      camera: () => this.stage.camera,
      level: () => this.levelIndex,
      screen: () => this.hud.current,
      busy: () => this.inputLocked,
      act: (a: Action) => this.perform(a),
      solve: () => solve(this.level, this.state),
      start: () => this.startFromTitle(),
      hint: () => this.showIdleHint(),
      load: (i: number) => this.loadLevel(i, 'play'),
      relicScreen: () => this.relicCenterScreen(),
      pedestalScreen: (x: number, z: number) => this.toScreen(this.floatToWorld(new THREE.Vector3(x, 0, z))),
      toppleScreenDir: (dir: Dir) => {
        const c = this.relicCenterScreen();
        const center = this.relic.root.getWorldPosition(new THREE.Vector3());
        return this.toScreen(center.addScaledVector(DIR_VEC[dir], 0.8)).sub(c).normalize();
      },
    };
  }
}

function IS_LOW(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
