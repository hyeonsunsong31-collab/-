// Scripted controller walkthrough with deterministic stepping.
// Usage: node client/tests/e2e/controller.mjs <baseUrl> <outDir> [scenario,...]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:5173/', outDir = '.', only = ''] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?q=medium`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });

const sim = (frames) => page.evaluate((n) => window.__game.simulate(n), frames);
const stick = (x, y) =>
  page.evaluate(
    ([x, y]) => {
      const s = window.__game.input.stick;
      s.x = x;
      s.y = y;
      s.active = x !== 0 || y !== 0;
    },
    [x, y],
  );
const act = (a, down) => page.evaluate(([a, d]) => window.__game.input.set(a, d), [a, down]);
const tap = async (a) => {
  await act(a, true);
  await sim(1);
  await act(a, false);
};
const state = () =>
  page.evaluate(() => {
    const p = window.__game.player;
    return {
      pos: p.pos.toArray().map((v) => +v.toFixed(2)),
      vel: p.vel.toArray().map((v) => +v.toFixed(2)),
      yaw: +p.yaw.toFixed(2),
      move: p.move,
      action: p.actionName,
      loco: [...window.__game.player.char.animator['loco'].entries()].filter(([, e]) => e.w > 0.05).map(([n, e]) => `${n}:${e.w.toFixed(2)}`),
    };
  });
const shot = async (name) => {
  const t = Date.now();
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  process.stdout.write(`(${Date.now() - t}ms) `);
  console.log(name, JSON.stringify(await state()));
};
const want = (n) => !only || only.split(',').includes(n);

await sim(30);
if (want('idle')) await shot('c01_idle');
if (want('run')) {
  await stick(0, 1);
  await sim(60);
  await shot('c02_run');
  await stick(0.8, 0.6);
  await sim(12);
  await shot('c03_turn');
}
if (want('sprint')) {
  await stick(0, 1);
  await act('sprint', true);
  await sim(70);
  await shot('c04_sprint');
  await act('sprint', false);
  await stick(0, 0);
  await sim(10);
  await shot('c05_skid');
  await sim(40);
}
if (want('jump')) {
  await tap('jump');
  await sim(4);
  await shot('c06_jump_takeoff');
  await sim(18);
  await shot('c07_jump_apex');
  await sim(30);
  await shot('c08_jump_land');
  await sim(30);
}
if (want('fly')) {
  await tap('jump');
  await sim(10);
  await tap('jump');
  await sim(40);
  await shot('c09_hover');
  await act('jump', true);
  await sim(60);
  await act('jump', false);
  await stick(0, 1);
  await sim(70);
  await shot('c10_fly_fwd');
  await act('sprint', true);
  await sim(80);
  await shot('c11_fly_boost');
  await stick(0.9, 0.4);
  await sim(20);
  await shot('c12_fly_bank');
  await act('sprint', false);
  await stick(0, 0);
  await sim(60);
  await shot('c13_fly_stop');
  await tap('jump');
  await sim(3);
  await tap('jump');
  await sim(150);
  await shot('c14_fall_land');
  await sim(60);
}
if (want('dash')) {
  for (const [name, x, y] of [
    ['f', 0, 1],
    ['l', -1, 0],
    ['r', 1, 0],
    ['b', 0, 0],
  ]) {
    await sim(40);
    await stick(x, y);
    await tap('dodge');
    await sim(7);
    await shot(`c15_dash_${name}`);
    await stick(0, 0);
    await sim(30);
  }
}
console.log(logs.filter((l) => !l.includes('[vite]')).slice(-30).join('\n'));
await browser.close();
