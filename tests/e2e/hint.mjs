// Screenshots of idle hints and the ending. Usage: node tests/e2e/hint.mjs <url> <outdir>
import { chromium } from '@playwright/test';
const [url = 'http://localhost:4173/', out = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const idle = async () => { for (let i = 0; i < 400; i++) { if (!(await p.evaluate(() => window.__hoshikui.busy()))) return; await wait(50); } };
await p.goto(url + '?debug&all'); await wait(1200);
await p.evaluate(() => window.__hoshikui.start()); await idle();
await p.evaluate(() => window.__hoshikui.load(2)); await idle();
await p.evaluate(() => window.__hoshikui.hint()); await wait(1500);
await p.screenshot({ path: `${out}/hint-topple.png` });
await p.evaluate(() => window.__hoshikui.act({ type: 'topple', to: 'E' })); await idle();
await p.evaluate(() => window.__hoshikui.hint()); await wait(1200);
await p.screenshot({ path: `${out}/hint-fold.png` });
await p.evaluate(() => window.__hoshikui.load(4)); await idle();
const sol = await p.evaluate(() => window.__hoshikui.solve());
for (const a of sol.slice(0, -1)) { await p.evaluate((a) => window.__hoshikui.act(a), a); await idle(); }
const last = p.evaluate((a) => window.__hoshikui.act(a), sol[sol.length - 1]);
for (const t of [2500, 5500, 7500]) { await wait(t === 2500 ? 2500 : t - (t === 5500 ? 2500 : 5500)); await p.screenshot({ path: `${out}/ending-${t}.png` }); }
await last; await wait(1500);
await p.screenshot({ path: `${out}/ending-final.png` });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
