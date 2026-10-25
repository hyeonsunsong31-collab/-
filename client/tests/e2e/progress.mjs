// Progression walkthrough: kill XP ticks, LEVEL UP fanfare, the STATUS screen (allocation, preview, confirm,
// FORMS and RANKING tabs) and closing back to the game.
// Usage: node client/tests/e2e/progress.mjs <baseUrl> <outDir> [extraQuery]
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:5173/', outDir = '.', extra = 'offline'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`${base}?q=medium&${extra}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });

const sim = (frames) => page.evaluate((n) => window.__game.simulate(n), frames);
const prof = () => page.evaluate(() => {
  const p = window.__game.save.profile;
  return { mode: window.__game.save.mode, lv: p.level, xp: p.xp, unspent: p.unspent, stats: p.stats, plStats: window.__game.player.stats, plLv: window.__game.player.level };
});
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await prof()));
};
const wait = (ms) => page.waitForTimeout(ms);

await sim(30);
// Kill a real mob next to the player for an XP tick.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos.clone().addScaledVector(g.player.forward(), 2.6);
  const { mob, ai } = g.spawner.spawn('brigand', p, 4);
  g.spawner.extra.push({ mob, ai });
  mob.hp = 1;
  g.player.yaw = g.player.yawTo(mob.pos);
});
await page.evaluate(() => window.__game.input.set('light', true));
await sim(3);
await page.evaluate(() => window.__game.input.set('light', false));
await sim(20);
await wait(350);
await shot('p1_xp_tick');

// Grant enough XP for a multi-level jump (same path as kills).
await page.evaluate(() => {
  const s = window.__game.save;
  for (let i = 0; i < 9; i++) s.reportKill(9, 6000);
});
await sim(6);
await wait(500);
await shot('p2_levelup');
await sim(30);
await wait(1400);
await shot('p3_levelup_late');
await wait(2600);

// Open STATUS with C.
await page.keyboard.press('KeyC');
await sim(2);
for (let i = 0; i < 20; i++) {
  await sim(2);
  await wait(30);
}
await wait(700);
await shot('p4_status');
// Spend: 3×STR via +, 2×KI via keyboard, shift+click AGI.
const plus = (k) => page.click(`.ak-cs-row[data-k="${k}"] .inc`);
for (let i = 0; i < 3; i++) await plus('str');
await page.keyboard.press('KeyS'); // select KI
await page.keyboard.press('KeyD');
await page.keyboard.press('KeyD');
await page.click('.ak-cs-row[data-k="agi"] .inc', { modifiers: ['Shift'] });
await wait(700);
await shot('p5_pending');
await page.click('.ak-cs-foot .auto');
await wait(600);
await shot('p6_autobalance');
await page.click('.ak-cs-foot .confirm');
await wait(900);
await shot('p7_confirmed');
await page.click('.ak-cs-tabs button[data-tab="forms"]');
await wait(700);
await shot('p8_forms');
await page.click('.ak-cs-tabs button[data-tab="ranking"]');
await wait(900);
await shot('p9_ranking');
await page.keyboard.press('Escape');
for (let i = 0; i < 20; i++) {
  await sim(2);
  await wait(20);
}
await wait(500);
await shot('p10_closed');

// Mobile layout of the status screen.
await page.setViewportSize({ width: 844, height: 390 });
await page.evaluate(() => {
  window.__game.status.touch = true;
  window.__game.status.open();
});
await sim(10);
await wait(800);
await shot('p11_status_mobile');

// Online runs: the server's copy must match what the client shows.
const sync = await page.evaluate(async () => {
  const g = window.__game;
  await g.save.settle();
  const auth = JSON.parse(localStorage.getItem('ak.auth') || 'null');
  if (g.save.mode !== 'online' || !auth) return { mode: g.save.mode };
  const r = await fetch('/api/profile', { headers: { Authorization: `Bearer ${auth.id}.${auth.token}` } });
  const srv = (await r.json()).profile;
  const loc = g.save.profile;
  const same = JSON.stringify(srv.stats) === JSON.stringify(loc.stats) && srv.level === loc.level && srv.xp === loc.xp && srv.unspent === loc.unspent;
  return { mode: g.save.mode, same, srv: { lv: srv.level, xp: srv.xp, unspent: srv.unspent, stats: srv.stats } };
});
console.log('sync', JSON.stringify(sync));

const errs = logs.filter((l) => l.includes('error') || l.includes('pageerror'));
console.log('errors:', errs.length);
for (const l of errs.slice(0, 20)) console.log(l);
console.log(logs.filter((l) => l.includes('[boot]')).join('\n'));
await browser.close();
