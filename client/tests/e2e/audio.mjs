// Audio sanity: unlock the context, fire every synthesized effect and each music mode, and meter the master output
// (peak / RMS) so silent, broken or clipping recipes show up without listening. Usage: node audio.mjs <baseUrl>
import { chromium } from 'playwright';

const [base = 'http://localhost:5173/'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
await page.goto(`${base}?q=low&offline`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });
await page.keyboard.press('KeyX');
await page.waitForFunction(() => window.__game.audio.engine.ready, null, { timeout: 10000 });
await page.evaluate(() => window.__game.audio.music.setMode('silent'));
await page.waitForTimeout(2500);

const measure = async (label, code, ms = 700) => {
  const r = await page.evaluate(
    async ([src, ms]) => {
      const g = window.__game;
      const A = g.audio;
      const p = g.player.chest(g.player.pos.clone());
      // eslint-disable-next-line no-new-func
      new Function('A', 'p', 'g', src)(A, p, g);
      let peak = 0;
      let rms = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, 40));
        const m = A.engine.meter();
        peak = Math.max(peak, m.peak);
        rms = Math.max(rms, m.rms);
      }
      return { peak: +peak.toFixed(3), rms: +rms.toFixed(3) };
    },
    [code, ms],
  );
  const flag = r.peak < 0.01 ? '  <-- SILENT' : r.peak > 0.99 ? '  <-- CLIPPING' : '';
  console.log(label.padEnd(18), JSON.stringify(r), flag);
  await page.waitForTimeout(250);
};

await measure('punch light', 'A.sfx.punch(p, 0.3)');
await measure('punch heavy', 'A.sfx.punch(p, 1.1, true)');
await measure('slash metal', 'A.sfx.slash(p, 0.6, true)');
await measure('whoosh', 'A.sfx.whoosh(p, 1, 0.24, 0.5)');
await measure('block', 'A.sfx.block(p, 0.6)');
await measure('parry', 'A.sfx.parry(p)', 1200);
await measure('guard break', 'A.sfx.guardBreak(p)', 900);
await measure('ki fire', 'A.sfx.kiFire(p, 1)');
await measure('lightning', 'A.sfx.lightning(p, false)');
await measure('thunder', 'A.sfx.lightning(p, true)', 2200);
await measure('explosion s', 'A.sfx.explosion(p, 0.6, true)', 1200);
await measure('explosion L', 'A.sfx.explosion(p, 3, false)', 2500);
await measure('beam', 'const h = A.sfx.beam(p, false); setTimeout(() => h && h.stop(), 900)', 1200);
await measure('ultimate', 'const h = A.sfx.beam(p, true); setTimeout(() => h && h.stop(), 900)', 1200);
await measure('footstep', "A.sfx.footstep(p, 'stone', 0.8)", 300);
await measure('land hard', 'A.sfx.land(p, true)');
await measure('dash', 'A.sfx.dash(p)');
await measure('boom', 'A.sfx.takeoff(p, true)', 1300);
await measure('roar', 'A.sfx.roar(p, 1.4, 1)', 1900);
await measure('transform', 'A.sfx.transformBurst(p, 2)', 2500);
await measure('tele gold', 'A.sfx.telegraph(p, false)');
await measure('tele red', 'A.sfx.telegraph(p, true)');
await measure('perfect dodge', 'A.sfx.perfectDodge()', 1500);
await measure('stun', 'A.sfx.stun(p)');
await measure('stinger', 'A.sfx.stinger()', 1200);
await measure('ui select', "A.sfx.ui('select')", 400);
await measure('fanfare lvl', "A.sfx.fanfare('level')", 2000);
await measure('fanfare win', "A.sfx.fanfare('victory')", 2500);
await measure('crowd', 'A.sfx.crowd(1)', 2500);
await measure('music explore', "A.music.setMode('explore')", 6000);
await measure('music combat', "A.music.intensity = 1; A.music.setMode('combat')", 6000);
await measure('music title', "A.music.setMode('title')", 6000);
console.log('errors:', logs.length);
for (const l of logs.slice(0, 10)) console.log(l);
await browser.close();
