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
// Background drag rotates camera but not the puzzle.
await p.mouse.move(80, 400); await p.mouse.down(); await p.mouse.move(400, 380, { steps: 10 }); await p.mouse.up();
await wait(400);
check('background drag leaves puzzle state', JSON.stringify(await H(p, () => window.__hoshikui.state())) === s0);
await p.screenshot({ path: `${out}/ui-orbit.png` });
// 3. Undo/reset buttons.
const d = await H(p, () => window.__hoshikui.toppleScreenDir('E'));
const c2 = await H(p, () => window.__hoshikui.relicScreen());
await p.mouse.move(c2.x, c2.y); await p.mouse.down(); await p.mouse.move(c2.x + d.x * 160, c2.y + d.y * 160, { steps: 12 }); await p.mouse.up();
await idle(p);
check('drag topples to E', (await H(p, () => window.__hoshikui.state())).pose === 'E');
await p.click('button[aria-label="undo"]');
await idle(p);
check('undo restores', JSON.stringify(await H(p, () => window.__hoshikui.state())) === s0);
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

// 5. Chapter select with ?all, choose level 3, fold by tapping the hinge.
p = await open('?debug&all');
await p.click('button[aria-label="chapters"]');
await wait(700);
await p.screenshot({ path: `${out}/ui-chapters.png` });
check('all chapters unlocked with ?all', (await p.locator('.chapter:not([disabled])').count()) === 5);
await p.click('.chapter >> nth=2');
await wait(300);
await idle(p);
check('chapter 3 loaded', (await H(p, () => window.__hoshikui.level())) === 2);
const hs = await H(p, () => window.__hoshikui.hingeScreen('p'));
await p.mouse.click(hs.x, hs.y);
await idle(p);
check('tap hinge opens shard', (await H(p, () => window.__hoshikui.state())).plates.p === true);
await p.screenshot({ path: `${out}/ui-fold.png` });
// fold back, then 3 refused topples (to S needs shard open → close first)
await p.mouse.click(hs.x, hs.y); await idle(p);
let handSeen = false;
for (let i = 0; i < 3; i++) {
  const dd = await H(p, () => window.__hoshikui.toppleScreenDir('S'));
  const cc = await H(p, () => window.__hoshikui.relicScreen());
  await p.mouse.move(cc.x, cc.y); await p.mouse.down(); await p.mouse.move(cc.x + dd.x * 160, cc.y + dd.y * 160, { steps: 10 }); await p.mouse.up();
  for (let t = 0; t < 30; t++) { if (!(await H(p, () => window.__hoshikui.busy()))) break; await wait(100); }
}
for (let t = 0; t < 60 && !handSeen; t++) { handSeen = await p.evaluate(() => document.querySelector('.hand').classList.contains('show')); if (!handSeen) await wait(100); }
await p.screenshot({ path: `${out}/ui-refusal-hand.png` });
check('refused topple keeps pose', (await H(p, () => window.__hoshikui.state())).pose === 'B');
check('3 refusals show hand', handSeen);
await p.context().close();

// 6. Mobile touch: tap to start and swipe topple.
p = await open('?debug', { width: 390, height: 844 }, true);
const m0 = await H(p, () => window.__hoshikui.relicScreen());
await p.touchscreen.tap(m0.x, m0.y);
await wait(200); await idle(p);
check('touch tap starts', (await H(p, () => window.__hoshikui.screen())) === 'play');
const cdp = await p.context().newCDPSession(p);
const md = await H(p, () => window.__hoshikui.toppleScreenDir('N'));
const mc = await H(p, () => window.__hoshikui.relicScreen());
const pts = Array.from({ length: 10 }, (_, i) => ({ x: mc.x + md.x * 12 * i, y: mc.y + md.y * 12 * i }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
for (const pt of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt] }); await wait(16); }
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await idle(p);
check('touch swipe topples', (await H(p, () => window.__hoshikui.state())).pose === 'N');
await p.screenshot({ path: `${out}/ui-mobile-after.png` });

console.log(results.join('\n'));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
