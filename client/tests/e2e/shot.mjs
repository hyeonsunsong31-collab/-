// Usage: node client/tests/e2e/shot.mjs <url> <out.png> [waitMs] [width] [height] [evalJs]
import { chromium } from 'playwright';

const [url, out, waitMs = '3000', w = '1280', h = '720', evalJs = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });
} catch (e) {
  logs.push('[timeout] game not ready');
}
const tReady = Date.now() - t0;
if (evalJs) await page.evaluate(evalJs);
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
const fps = await page.evaluate(() => {
  const g = window.__game;
  return g ? { realDt: g.clock.realDt, pr: g.renderer?.pixelRatio } : null;
});
console.log(JSON.stringify({ readyMs: tReady, fps }));
console.log(logs.slice(-40).join('\n'));
await browser.close();
