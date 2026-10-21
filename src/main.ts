import './style.css';
import { Game } from './game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const flash = document.getElementById('flash') as HTMLElement;

const game = new Game(canvas, ui, flash);
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __hoshikui: ReturnType<Game['debug']> }).__hoshikui = game.debug();
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  game.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
