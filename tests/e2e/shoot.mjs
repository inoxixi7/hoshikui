// Visual smoke test: opens the built game in Chromium, captures screenshots and console errors.
// Usage: node tests/e2e/shoot.mjs <url> <outdir> [scenario]
import { chromium, devices } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'shots';
const scenario = process.argv[4] ?? 'basic';
const exe = process.env.CHROME ?? '/opt/pw-browsers/chromium';

const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(ctxOpts, name) {
  const ctx = await browser.newContext(ctxOpts);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  return p;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async (p) => { for (let i = 0; i < 200; i++) { if (!(await p.evaluate(() => window.__hoshikui.busy()))) return; await wait(50); } };

const desktop = await page({ viewport: { width: 1280, height: 800 } }, 'desktop');
await desktop.goto(url + (url.includes('?') ? '&' : '?') + 'debug');
await wait(1500);
await desktop.screenshot({ path: `${out}/desktop-title.png` });

if (scenario === 'basic' || scenario === 'play') {
  await desktop.evaluate(() => window.__hoshikui.start());
  await wait(1300);
  await desktop.screenshot({ path: `${out}/desktop-play.png` });
  // Drag the relic toward the first solution move.
  const sol = await desktop.evaluate(() => window.__hoshikui.solve());
  console.log('solution', JSON.stringify(sol));
  for (const [i, a] of sol.entries()) {
    if (a.type === 'topple') {
      const c = await desktop.evaluate(() => window.__hoshikui.relicScreen());
      const d = await desktop.evaluate((to) => window.__hoshikui.toppleScreenDir(to), a.to);
      await desktop.mouse.move(c.x, c.y);
      await desktop.mouse.down();
      for (let k = 1; k <= 12; k++) await desktop.mouse.move(c.x + d.x * 12 * k, c.y + d.y * 12 * k);
      if (i === 0) await desktop.screenshot({ path: `${out}/desktop-tilt.png` });
      await desktop.mouse.up();
    } else {
      const h = await desktop.evaluate((id) => window.__hoshikui.hingeScreen(id), a.plate);
      await desktop.mouse.click(h.x, h.y);
    }
    await wait(250);
    if (i === 0) await desktop.screenshot({ path: `${out}/desktop-move1.png` });
    await idle(desktop);
    console.log('after', JSON.stringify(a), JSON.stringify(await desktop.evaluate(() => window.__hoshikui.state())));
  }
  await wait(900);
  await desktop.screenshot({ path: `${out}/desktop-win.png` });
  await wait(1200);
  await desktop.screenshot({ path: `${out}/desktop-shatter.png` });
  await idle(desktop);
  await wait(400);
  await desktop.screenshot({ path: `${out}/desktop-next.png` });
  console.log('level now', await desktop.evaluate(() => window.__hoshikui.level()));
}

const mobile = await page({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, 'mobile');
await mobile.goto(url + (url.includes('?') ? '&' : '?') + 'debug');
await wait(1500);
await mobile.screenshot({ path: `${out}/mobile-title.png` });
console.log('sprites near pedestal:', await mobile.evaluate(() => { const out = []; window.__hoshikui.scene().traverseVisible((o) => { if (o.isSprite && o.material.opacity > 0.01) { const v = o.getWorldPosition(o.position.clone()); if (v.length() < 0.6) out.push([o.material.color.getHexString(), o.material.opacity, o.scale.x, v.toArray()]); } }); return JSON.stringify(out); }));
await mobile.evaluate(() => window.__hoshikui.start());
await wait(1300);
await mobile.screenshot({ path: `${out}/mobile-play.png` });

// Zero-text check on the live DOM: no visible text nodes anywhere in the body.
const text = await mobile.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim() && n.parentElement?.tagName !== 'SCRIPT') found.push(n.textContent.trim());
  return found;
});
console.log('visible text nodes:', JSON.stringify(text));
console.log('console errors/warnings:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
