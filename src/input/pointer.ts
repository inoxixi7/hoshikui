// Pointer routing: background drags orbit the camera, drags on the relic topple it,
// short taps on a hinge or shard fold it. Camera motion never touches puzzle state.

import * as THREE from 'three';

export interface PointerTargets {
  /** Objects that start a topple drag (relic body, shards). */
  pickables(): THREE.Object3D[];
}

export interface PointerHandlers {
  canInteract(): boolean;
  /** Pointer went down on the relic (or a shard): begin a topple drag. */
  dragStart(): void;
  /** Screen-space drag vector in CSS pixels since pointer down. */
  dragMove(dx: number, dy: number): void;
  dragEnd(dx: number, dy: number, cancelled: boolean): void;
  /** A short tap on something carrying userData.plate, or on the relic body. */
  tap(plate: string | null, hitRelic: boolean): void;
  /** Any interaction at all (for idle timers / audio unlock). */
  activity(): void;
}

const TAP_PX = 9;
const TAP_MS = 450;

export class PointerInput {
  private raycaster = new THREE.Raycaster();
  private active: { id: number; x: number; y: number; t: number; onRelic: boolean; plate: string | null; dragging: boolean } | null = null;

  constructor(
    private el: HTMLElement,
    private camera: THREE.Camera,
    private controls: { enabled: boolean },
    private targets: () => PointerTargets | null,
    private h: PointerHandlers,
  ) {
    // Capture phase on the wrapper so we decide before OrbitControls sees the event.
    const wrapper = el.parentElement ?? el;
    wrapper.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e, false));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Raycast the relic at a client position. */
  pick(clientX: number, clientY: number): THREE.Intersection | null {
    const t = this.targets();
    if (!t) return null;
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(t.pickables(), false);
    return hits[0] ?? null;
  }

  private down(e: PointerEvent) {
    if (e.target !== this.el) return; // buttons and overlays handle themselves
    this.h.activity();
    if (this.active) {
      // A second finger: hand everything to the camera (pinch zoom).
      if (this.active.onRelic) this.h.dragEnd(0, 0, true);
      this.active = null;
      this.controls.enabled = true;
      return;
    }
    const hit = this.h.canInteract() ? this.pick(e.clientX, e.clientY) : null;
    const plate = hit ? findPlate(hit.object) : null;
    const onRelic = Boolean(hit);
    this.active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), onRelic, plate, dragging: false };
    if (onRelic) {
      this.controls.enabled = false;
      this.h.dragStart();
    } else {
      this.controls.enabled = true;
    }
  }

  private move(e: PointerEvent) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.hypot(dx, dy) > TAP_PX) a.dragging = true;
    if (a.onRelic) this.h.dragMove(dx, dy);
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.active = null;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    const isTap = !a.dragging && performance.now() - a.t < TAP_MS && Math.hypot(dx, dy) <= TAP_PX;
    if (a.onRelic) {
      if (isTap && !cancelled) {
        this.h.dragEnd(0, 0, true);
        this.h.tap(a.plate, true);
      } else this.h.dragEnd(dx, dy, cancelled);
    } else if (isTap && !cancelled) {
      this.h.tap(null, false);
    }
    this.controls.enabled = true;
  }
}

function findPlate(o: THREE.Object3D | null): string | null {
  for (let cur = o; cur; cur = cur.parent) {
    const p = cur.userData?.plate;
    if (typeof p === 'string') return p;
  }
  return null;
}
