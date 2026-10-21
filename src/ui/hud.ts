// DOM overlay: icon buttons, progress lights, chapter arc, menu and the demo hand.
// No text nodes anywhere; buttons carry aria-labels for assistive tech only.

import { ICONS } from './icons';

export type Screen = 'title' | 'play' | 'menu' | 'chapters' | 'ending' | 'transition';

export interface HudHandlers {
  undo(): void;
  reset(): void;
  openMenu(): void;
  closeOverlay(): void;
  toggleSound(): void;
  openChapters(): void;
  chooseLevel(i: number): void;
  home(): void;
  clearProgress(): void;
  replay(): void;
  uiTap(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
};

function iconButton(icon: string, label: string, cls: string, parent: HTMLElement, onClick: () => void): HTMLButtonElement {
  const b = el('button', `icon-btn ${cls}`, parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.innerHTML = icon;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export class Hud {
  private root: HTMLElement;
  private screen: Screen = 'title';
  private titleBar: HTMLElement;
  private playBar: HTMLElement;
  private progress: HTMLElement;
  private menu: HTMLElement;
  private chapters: HTMLElement;
  private chapterArc: HTMLElement;
  private ending: HTMLElement;
  private soundBtns: HTMLButtonElement[] = [];
  private undoBtn: HTMLButtonElement;
  private hand: HTMLElement;
  private handRipple: HTMLElement;
  private dots: HTMLElement[] = [];

  constructor(root: HTMLElement, private h: HudHandlers, private total: number) {
    this.root = root;

    // Title: chapters + sound, bottom-left.
    this.titleBar = el('div', 'bar bar-bl', root);
    iconButton(ICONS.chapters, 'chapters', '', this.titleBar, () => (h.uiTap(), h.openChapters()));
    this.soundBtns.push(iconButton(ICONS.soundOn, 'sound', 'sound', this.titleBar, () => h.toggleSound()));

    // Play: undo, reset, menu top-right; progress lights top-centre.
    this.playBar = el('div', 'bar bar-tr', root);
    this.undoBtn = iconButton(ICONS.undo, 'undo', '', this.playBar, () => h.undo());
    iconButton(ICONS.reset, 'reset', '', this.playBar, () => h.reset());
    iconButton(ICONS.menu, 'menu', '', this.playBar, () => (h.uiTap(), h.openMenu()));
    this.progress = el('div', 'progress', root);
    this.progress.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < total; i++) this.dots.push(el('span', 'pdot', this.progress));

    // Menu overlay.
    this.menu = el('div', 'overlay menu', root);
    this.menu.addEventListener('click', (e) => e.target === this.menu && h.closeOverlay());
    const row = el('div', 'menu-row', this.menu);
    this.soundBtns.push(iconButton(ICONS.soundOn, 'sound', 'sound big', row, () => h.toggleSound()));
    iconButton(ICONS.chapters, 'chapters', 'big', row, () => (h.uiTap(), h.openChapters()));
    iconButton(ICONS.home, 'title', 'big', row, () => (h.uiTap(), h.home()));
    row.appendChild(this.buildHoldButton());
    iconButton(ICONS.back, 'close', 'close', this.menu, () => (h.uiTap(), h.closeOverlay()));

    // Chapter arc.
    this.chapters = el('div', 'overlay chapters', root);
    this.chapters.addEventListener('click', (e) => e.target === this.chapters && h.closeOverlay());
    this.chapterArc = el('div', 'arc', this.chapters);
    iconButton(ICONS.back, 'close', 'close', this.chapters, () => (h.uiTap(), h.closeOverlay()));

    // Ending: replay bottom-right.
    this.ending = el('div', 'bar bar-br', root);
    iconButton(ICONS.replay, 'replay', 'big glow', this.ending, () => h.replay());

    // Demonstration hand.
    this.hand = el('div', 'hand', root);
    this.hand.innerHTML = ICONS.hand;
    this.handRipple = el('div', 'ripple', root);

    this.setScreen('title');
  }

  private buildHoldButton(): HTMLElement {
    const b = el('button', 'icon-btn big hold');
    b.type = 'button';
    b.setAttribute('aria-label', 'clear progress (hold)');
    b.innerHTML = `${ICONS.clear}<svg class="ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" /></svg>`;
    const ring = b.querySelector('.ring circle') as SVGCircleElement;
    const C = 2 * Math.PI * 21;
    ring.style.strokeDasharray = `${C}`;
    ring.style.strokeDashoffset = `${C}`;
    let raf = 0;
    let start = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      ring.style.transition = 'stroke-dashoffset .25s';
      ring.style.strokeDashoffset = `${C}`;
    };
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1000);
      ring.style.strokeDashoffset = `${C * (1 - k)}`;
      if (k >= 1) {
        raf = 0;
        b.classList.add('done');
        setTimeout(() => b.classList.remove('done'), 700);
        this.h.clearProgress();
        setTimeout(stop, 350);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ring.style.transition = 'none';
      start = performance.now();
      raf = requestAnimationFrame(tick);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => raf && stop());
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  setScreen(s: Screen) {
    this.screen = s;
    const show = (e: HTMLElement, v: boolean) => e.classList.toggle('show', v);
    show(this.titleBar, s === 'title');
    show(this.playBar, s === 'play');
    show(this.progress, s === 'play' || s === 'transition' || s === 'menu');
    show(this.menu, s === 'menu');
    show(this.chapters, s === 'chapters');
    show(this.ending, s === 'ending');
    if (s !== 'play') this.hideHand();
  }

  get current(): Screen {
    return this.screen;
  }

  setMuted(m: boolean) {
    for (const b of this.soundBtns) {
      b.innerHTML = m ? ICONS.soundOff : ICONS.soundOn;
      b.setAttribute('aria-pressed', String(!m));
    }
  }

  setUndoEnabled(v: boolean) {
    this.undoBtn.classList.toggle('dim', !v);
  }

  /** Progress lights: done ones are filled stars, the current one a breathing ring. */
  setProgress(current: number, completed: boolean[]) {
    this.dots.forEach((d, i) => {
      d.classList.toggle('done', completed[i]);
      d.classList.toggle('current', i === current);
    });
  }

  /** Light up one progress dot with a burst (after a level is solved). */
  burstDot(i: number) {
    const d = this.dots[i];
    if (!d) return;
    d.classList.add('done', 'burst');
    setTimeout(() => d.classList.remove('burst'), 900);
  }

  setChapters(unlocked: number, completed: boolean[], current: number) {
    this.chapterArc.innerHTML = '';
    for (let i = 0; i < this.total; i++) {
      const t = this.total === 1 ? 0.5 : i / (this.total - 1);
      const ang = Math.PI * (0.85 - 0.7 * t);
      const x = 50 + Math.cos(ang) * 42;
      const y = 78 - Math.sin(ang) * 52;
      const b = el('button', 'chapter', this.chapterArc);
      b.type = 'button';
      b.style.left = `${x}%`;
      b.style.top = `${y}%`;
      b.setAttribute('aria-label', `chapter ${i + 1}`);
      const open = i <= unlocked;
      b.disabled = !open;
      b.classList.toggle('open', open);
      b.classList.toggle('done', completed[i]);
      b.classList.toggle('current', i === current);
      b.style.animationDelay = `${i * 70}ms`;
      b.innerHTML = completed[i]
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>';
      if (open) b.addEventListener('click', (e) => (e.stopPropagation(), this.h.chooseLevel(i)));
    }
  }

  /** Animate the demo hand: a drag from a→b, or a tap at a when b is omitted. */
  showHand(a: { x: number; y: number }, b?: { x: number; y: number }): Promise<void> {
    const hand = this.hand;
    const ripple = this.handRipple;
    hand.getAnimations().forEach((x) => x.cancel());
    hand.classList.add('show');
    const pos = (p: { x: number; y: number }, s = 1) => `translate(${p.x - 14}px, ${p.y - 6}px) scale(${s})`;
    const frames: Keyframe[] = b
      ? [
          { transform: pos(a, 1.1), opacity: 0, offset: 0 },
          { transform: pos(a, 1.1), opacity: 1, offset: 0.15 },
          { transform: pos(a, 0.92), opacity: 1, offset: 0.28 },
          { transform: pos(b, 0.92), opacity: 1, offset: 0.7, easing: 'ease-out' },
          { transform: pos(b, 1.05), opacity: 1, offset: 0.8 },
          { transform: pos(b, 1.05), opacity: 0, offset: 1 },
        ]
      : [
          { transform: pos(a, 1.1), opacity: 0, offset: 0 },
          { transform: pos(a, 1.1), opacity: 1, offset: 0.2 },
          { transform: pos(a, 0.88), opacity: 1, offset: 0.4 },
          { transform: pos(a, 1.05), opacity: 1, offset: 0.55 },
          { transform: pos(a, 0.88), opacity: 1, offset: 0.7 },
          { transform: pos(a, 1.05), opacity: 0, offset: 1 },
        ];
    const anim = hand.animate(frames, { duration: b ? 1900 : 1700, easing: 'ease-in-out', fill: 'forwards' });
    if (b) {
      // A fading streak behind the drag.
      ripple.style.left = `${a.x}px`;
      ripple.style.top = `${a.y}px`;
      ripple.className = 'ripple';
    } else {
      ripple.style.left = `${a.x}px`;
      ripple.style.top = `${a.y}px`;
      ripple.className = 'ripple';
      void ripple.offsetWidth;
      setTimeout(() => (ripple.className = 'ripple go'), 650);
      setTimeout(() => (ripple.className = 'ripple'), 1600);
    }
    return anim.finished.then(
      () => this.hideHand(),
      () => undefined,
    );
  }

  hideHand() {
    this.hand.getAnimations().forEach((x) => x.cancel());
    this.hand.classList.remove('show');
  }

  get rootEl(): HTMLElement {
    return this.root;
  }
}
