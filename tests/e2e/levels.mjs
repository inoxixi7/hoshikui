// Plays every level through its solver solution and screenshots each step.
// Usage: node tests/e2e/levels.mjs <url> <outdir> [levelIndex] [width] [height]
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4173/', out = 'shots', only, w = '1280', h = '800'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: +w < 600 });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async () => { for (let i = 0; i < 300; i++) { if (!(await p.evaluate(() => window.__hoshikui.busy()))) return; await wait(50); } throw new Error('stuck busy'); };
await p.goto(url + '?debug&all');
await wait(1200);
await p.evaluate(() => window.__hoshikui.start());
await idle();
const count = 5;
for (let i = 0; i < count; i++) {
  if (only !== undefined && only !== '' && +only !== i) continue;
  const ok = await p.evaluate(async (i) => { if (window.__hoshikui.level() !== i) await window.__hoshikui.load(i); return window.__hoshikui.level() === i; }, i).catch(() => false);
  if (!ok) break;
  await idle();
  await wait(300);
  await p.screenshot({ path: `${out}/L${i + 1}-0.png` });
  const sol = await p.evaluate(() => window.__hoshikui.solve());
  console.log(`L${i + 1} solution`, JSON.stringify(sol));
  for (const [k, a] of sol.entries()) {
    const done = p.evaluate((a) => window.__hoshikui.act(a), a);
    if (k === sol.length - 1) { await wait(900); await p.screenshot({ path: `${out}/L${i + 1}-win.png` }); }
    await done;
    if (k < sol.length - 1) { await idle(); await wait(150); await p.screenshot({ path: `${out}/L${i + 1}-${k + 1}.png` }); }
  }
  await idle();
  console.log(`L${i + 1} -> level`, await p.evaluate(() => window.__hoshikui.level()), 'screen', await p.evaluate(() => window.__hoshikui.screen()));
}
await wait(500);
await p.screenshot({ path: `${out}/final.png` });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
