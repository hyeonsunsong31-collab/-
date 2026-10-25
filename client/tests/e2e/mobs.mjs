// Visits each enemy camp, lets the mobs engage the (unkillable) player and screenshots idle, telegraph, attack,
// nameplates and a kill. Usage: node client/tests/e2e/mobs.mjs <baseUrl> <outDir> [campId,...]
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
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`${base}?q=medium&offline`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });

await page.evaluate(() => {
  const g = window.__game;
  window.__ev = [];
  g.combat.on((e) => {
    if (e.type === 'anim') return;
    const who = e.who ?? e.attacker;
    window.__ev.push(`${e.type}${e.type === 'hit' ? `:${e.def.id}:${e.res.dmg}` : ''}${who?.name ? `@${who.name}` : ''}`);
  });
  // Unkillable player so the mobs keep fighting.
  g.addFrameHook((gg) => {
    if (window.__god) gg.player.hp = gg.player.maxHp;
  });
});
const sim = (frames) => page.evaluate((n) => window.__game.simulate(n), frames);
const flush = async (label) => {
  const ev = await page.evaluate(() => window.__ev.splice(0));
  console.log(`  events(${label}):`, ev.slice(0, 60).join(' '));
  return ev;
};
const state = () =>
  page.evaluate(() => {
    const g = window.__game;
    return g.spawner.mobs.map((m) => ({
      k: m.kind.id,
      lv: m.level,
      pl: m.powerLevel,
      hp: Math.round(m.hp),
      st: m.state,
      act: m.actionName,
      d: +m.pos.distanceTo(g.player.pos).toFixed(1),
    }));
  });
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await state()));
};

const camps = await page.evaluate(() => window.__game.spawner.camps.map((c) => ({ id: c.id, x: c.x, z: c.z })));
for (const c of camps) {
  if (only && !only.split(',').includes(c.id)) continue;
  console.log(`== ${c.id}`);
  // Stand 14 m south-west of the camp, facing it, camera behind.
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    window.__god = true;
    g.spawner.clear();
    const px = x - 10;
    const pz = z - 10;
    const spot = g.findSpawn(px, pz);
    const yaw = Math.atan2(x - spot.x, z - spot.z);
    g.player.teleport(spot, yaw);
    g.camRig.yaw = Math.atan2(-(x - spot.x), -(z - spot.z));
    g.camRig.pitch = -0.22;
  }, c);
  await sim(30);
  await shot(`${c.id}_1_idle`);
  // Walk in until something winds up (telegraph) or 6 s pass.
  let flashed = false;
  for (let i = 0; i < 36 && !flashed; i++) {
    await page.evaluate(() => window.__game.input.set('sprint', false));
    await page.evaluate(({ x, z }) => {
      const g = window.__game;
      const p = g.player;
      const d = Math.hypot(x - p.pos.x, z - p.pos.z);
      g.input.stick.active = d > 5;
      g.input.stick.x = 0;
      g.input.stick.y = d > 5 ? 1 : 0;
    }, c);
    await sim(10);
    const ev = await page.evaluate(() => window.__ev.slice());
    flashed = ev.some((e) => e.startsWith('flash'));
  }
  await page.evaluate(() => {
    const s = window.__game.input.stick;
    s.active = false;
    s.x = s.y = 0;
  });
  await sim(4);
  await shot(`${c.id}_2_telegraph`);
  await sim(14);
  await shot(`${c.id}_3_attack`);
  await sim(120);
  await shot(`${c.id}_4_brawl`);
  await flush(c.id);
  // Fight back: light combo on the nearest mob after softening it.
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.spawner.mobs.filter((m) => m.alive).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
    if (m) {
      m.hp = Math.min(m.hp, m.maxHp * 0.08);
      g.player.yaw = g.player.yawTo(m.pos);
      window.__victim = m;
    }
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__game.input.set('light', true));
    await sim(2);
    await page.evaluate(() => window.__game.input.set('light', false));
    await sim(12);
  }
  await shot(`${c.id}_5_kill`);
  await sim(75);
  await shot(`${c.id}_5b_burn`);
  await sim(75);
  await shot(`${c.id}_6_after`);
  const ev = await flush(`${c.id} kill`);
  console.log('  victim:', await page.evaluate(() => ({ alive: window.__victim?.alive, dissolve: window.__victim?.dissolve })), ev.filter((e) => e.startsWith('death')).length, 'deaths');
}

const errs = logs.filter((l) => l.includes('error') || l.includes('pageerror'));
console.log('errors:', errs.length);
for (const l of errs.slice(0, 20)) console.log(l);
await browser.close();
