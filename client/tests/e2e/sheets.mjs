// Usage: node client/tests/e2e/sheets.mjs <outDir> <view> <phases> clipA clipB ...
// Renders one contact-sheet PNG per clip (phases across) reusing one browser.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [outDir, view, phases, ...clips] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const base = process.env.BASE || 'http://localhost:5173/';
const extra = process.env.EXTRA || '';
for (const clip of clips) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 420 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${base}?q=medium&gallery=${encodeURIComponent(clip)}&phases=${phases}&view=${view}&spacing=1.3${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${clip}.png` });
  if (errs.length) console.log(clip, 'ERR', errs.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
console.log('done', clips.length);
