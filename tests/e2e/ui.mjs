// UI flow check with real pointer input. Usage: node tests/e2e/ui.mjs <url> <outdir>
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4173/', out = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };

async function open(q, vp = { width: 1280, height: 800 }, touch = false) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage();
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url + q);
  await wait(1200);
  return p;
}
const H = (p, f, ...a) => p.evaluate(f, ...a);
const idle = async (p) => { for (let i = 0; i < 300; i++) { if (!(await H(p, () => window.__hoshikui.busy()))) return; await wait(50); } };

// 1. Fresh visit: tap the relic to start, demo hand appears after ~3s.
let p = await open('?debug');
const c0 = await H(p, () => window.__hoshikui.relicScreen());
await p.mouse.click(c0.x, c0.y);
await idle(p);
check('tap relic starts game', (await H(p, () => window.__hoshikui.screen())) === 'play');
const handUp = async (ms) => { for (let t = 0; t < ms; t += 100) { if (await p.evaluate(() => document.querySelector('.hand').classList.contains('show'))) return true; await wait(100); } return false; };
const shown = await handUp(25000);
await wait(500);
await p.screenshot({ path: `${out}/ui-demo-hand.png` });
check('first-visit demo hand shown', shown);
await wait(2000);
// 2. Short drag (below threshold) does nothing; drag in a dead direction refuses.
const s0 = JSON.stringify(await H(p, () => window.__hoshikui.state()));
const c = await H(p, () => window.__hoshikui.relicScreen());
await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x + 20, c.y, { steps: 4 }); await p.mouse.up();
await wait(500);
check('short drag springs back', JSON.stringify(await H(p, () => window.__hoshikui.state())) === s0);
// A small sideways drag off the relic turns it a little, then it eases back.
{
  const q = await H(p, () => window.__hoshikui.quarterPx());
  await p.mouse.move(120, 600); await p.mouse.down(); await p.mouse.move(120 + q * 0.35, 600, { steps: 8 }); await p.mouse.up();
  await idle(p);
  check('small sideways drag snaps back', JSON.stringify(await H(p, () => window.__hoshikui.state())) === s0);
}
// 3. Undo/reset buttons.
const c2 = await H(p, () => window.__hoshikui.relicScreen());
const ppr = await H(p, () => window.__hoshikui.pxPerRadian());
await p.mouse.move(c2.x, c2.y); await p.mouse.down();
for (let k = 1; k <= 12; k++) await p.mouse.move(c2.x + (ppr * 1.57 * k) / 12, c2.y + k * 0.5);
await p.screenshot({ path: `${out}/ui-free-drag.png` });
await p.mouse.up();
await idle(p);
check('free drag turns the relic', (await H(p, () => window.__hoshikui.state())).orient.join() !== '1,0,0,0,1,0,0,0,1');
await p.click('button[aria-label="undo"]');
await idle(p);
check('undo restores', JSON.stringify(await H(p, () => window.__hoshikui.state())) === s0);
// 3b. Sideways drag anywhere off the relic: it follows the finger and settles on the nearest quarter.
{
  const before = (await H(p, () => window.__hoshikui.state())).orient.join();
  const q = await H(p, () => window.__hoshikui.quarterPx());
  await p.mouse.move(150, 650); await p.mouse.down();
  for (let k = 1; k <= 6; k++) await p.mouse.move(150 + (q * 0.55 * k) / 6, 650 + k);
  await p.screenshot({ path: `${out}/ui-turn-mid.png` });
  for (let k = 7; k <= 10; k++) await p.mouse.move(150 + (q * 0.95 * k) / 10, 650 + k);
  await p.mouse.up();
  await idle(p);
  const after = await H(p, () => window.__hoshikui.state());
  check('sideways drag turns a quarter', after.orient.join() === '0,0,1,0,1,0,-1,0,0', `${before} -> ${after.orient.join()}`);
  await p.click('button[aria-label="undo"]');
  await idle(p);
  check('undo turns it back', (await H(p, () => window.__hoshikui.state())).orient.join() === before);
  // A long drag turns twice in one motion; two undos bring it back.
  await p.mouse.move(100, 650); await p.mouse.down(); await p.mouse.move(100 + q * 2.1, 650, { steps: 20 }); await p.mouse.up();
  await idle(p);
  check('long drag turns a half turn', (await H(p, () => window.__hoshikui.state())).orient.join() === '-1,0,0,0,1,0,0,0,-1');
  await p.click('button[aria-label="undo"]'); await idle(p);
  await p.click('button[aria-label="undo"]'); await idle(p);
  check('two undos restore', (await H(p, () => window.__hoshikui.state())).orient.join() === before);
}
// 4. Menu overlay + sound toggle + long-press clear.
await p.click('button[aria-label="menu"]');
await wait(500);
await p.screenshot({ path: `${out}/ui-menu.png` });
await p.click('.menu button[aria-label="sound"]');
const muted = await p.evaluate(() => JSON.parse(localStorage.getItem('hoshikui.v1') || '{}').muted);
check('sound toggle persists', muted === true);
const hold = await p.locator('.hold').boundingBox();
await p.mouse.move(hold.x + hold.width / 2, hold.y + hold.height / 2);
await p.mouse.down(); await wait(500); await p.mouse.up();
await wait(200);
await p.mouse.down(); await wait(1200);
await p.screenshot({ path: `${out}/ui-hold.png` });
await p.mouse.up();
check('long press clears progress', await p.evaluate(() => JSON.parse(localStorage.getItem('hoshikui.v1') || '{}').unlocked === 0));
await p.click('.menu button[aria-label="close"]');
await wait(400);
check('menu closes to play', (await H(p, () => window.__hoshikui.screen())) === 'play');
await p.context().close();

// 5. Chapter select with ?all, choose level 3 and solve it by dragging.
p = await open('?debug&all');
await p.click('button[aria-label="chapters"]');
await wait(700);
await p.screenshot({ path: `${out}/ui-chapters.png` });
check('all chapters unlocked with ?all', (await p.locator('.chapter:not([disabled])').count()) === 5);
await p.click('.chapter >> nth=2');
await wait(300);
await idle(p);
check('chapter 3 loaded', (await H(p, () => window.__hoshikui.level())) === 2);
// Play chapter 3 with real free drags along the solver's solution: it needs the vein illusion.
const sol3 = await H(p, () => window.__hoshikui.solve());
for (const act of sol3) {
  const dd = await H(p, (key) => window.__hoshikui.dragFor(key), act.m.join(','));
  const cc = await H(p, () => window.__hoshikui.relicScreen());
  await p.mouse.move(cc.x, cc.y); await p.mouse.down(); await p.mouse.move(cc.x + dd.x, cc.y + dd.y, { steps: 14 }); await p.mouse.up();
  await idle(p);
  await p.screenshot({ path: `${out}/ui-l3-step.png` });
}
await wait(300); await idle(p);
check('chapter 3 solved by dragging (vein crossing)', (await H(p, () => window.__hoshikui.level())) === 3);
await p.context().close();

// 6. Mobile touch: tap to start and swipe topple.
p = await open('?debug', { width: 390, height: 844 }, true);
const m0 = await H(p, () => window.__hoshikui.relicScreen());
await p.touchscreen.tap(m0.x, m0.y);
await wait(200); await idle(p);
check('touch tap starts', (await H(p, () => window.__hoshikui.screen())) === 'play');
const cdp = await p.context().newCDPSession(p);
const mppr = await H(p, () => window.__hoshikui.pxPerRadian());
const mc = await H(p, () => window.__hoshikui.relicScreen());
const pts = Array.from({ length: 10 }, (_, i) => ({ x: mc.x, y: mc.y + (mppr * 1.57 * i) / 9 }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
for (const pt of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt] }); await wait(16); }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await idle(p);
check('touch swipe turns the relic', (await H(p, () => window.__hoshikui.state())).orient.join() !== '1,0,0,0,1,0,0,0,1');
await p.screenshot({ path: `${out}/ui-mobile-after.png` });

console.log(results.join('\n'));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
