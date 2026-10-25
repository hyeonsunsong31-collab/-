// Interface walkthrough: title, HUD in combat (target, combo, damage numbers, gauges, buffs), world map, pause,
// settings, controls, defeat/respawn, then the touch layout with a driven joystick and camera drag.
// Usage: node client/tests/e2e/hud.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base = 'http://localhost:5173/', outDir = '.'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const logs = [];
const open = async (query, viewport, touch = false) => {
  const page = await browser.newPage({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`${base}?q=medium&offline&${query}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });
  return page;
};
const wait = (page, ms) => page.waitForTimeout(ms);
const simQ = (page, n) => page.evaluate((k) => window.__game.simulate(k, 1 / 60, false), n);
const run = async (page, frames, ms = 16) => {
  for (let i = 0; i < frames; i += 10) {
    await simQ(page, Math.min(10, frames - i));
    if (ms) await wait(page, ms * Math.min(10, frames - i));
  }
  await page.evaluate(() => window.__game.simulate(0));
};
const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log(name);
};

process.on('uncaughtException', (e) => {
  console.log('FAILED:', e.message.split('\n')[0]);
  for (const l of logs.filter((x) => x.includes('error') || x.includes('pageerror')).slice(0, 20)) console.log(l);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.log('FAILED:', String(e?.message ?? e).split('\n')[0]);
  for (const l of logs.filter((x) => x.includes('error') || x.includes('pageerror')).slice(0, 20)) console.log(l);
  process.exit(1);
});

/* ------------------------------------------------------------ desktop */
let page = await open('title', { width: 1280, height: 720 });
await run(page, 90, 20);
await wait(page, 1200);
await shot(page, 'h1_title');
await page.keyboard.press('Enter');
await run(page, 120, 12);
await wait(page, 600);
await shot(page, 'h2_hud_town');

// Fight a brigand: target panel, combo, damage numbers, buffs.
await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos.clone().addScaledVector(g.player.forward(), 2.6);
  const { mob, ai } = g.spawner.spawn('brigand', p, 3);
  g.spawner.extra.push({ mob, ai });
  mob.hp = mob.maxHp * 3;
  window.__mob = mob;
  g.player.yaw = g.player.yawTo(mob.pos);
  g.player.energy = 120;
  g.player.surge = 2400;
  g.player.buffs.add('instinct', 2);
  g.player.buffs.add('zenkai', 1);
  g.addFrameHook((gg) => {
    if (gg.player.alive && window.__god) gg.player.hp = Math.max(gg.player.hp, gg.player.maxHp * 0.55);
  });
  window.__god = true;
});
await page.keyboard.press('Tab');
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => window.__game.input.set('light', true));
  await simQ(page, 2);
  await page.evaluate(() => window.__game.input.set('light', false));
  await simQ(page, 11);
}
await run(page, 6, 30);
await shot(page, 'h3_hud_combat');

// World map.
console.log('pre-map', JSON.stringify(await page.evaluate(() => { const g = window.__game; return { busy: g.player.busy, st: g.player.state, act: g.player.actionName, can: g.canOpenMenu, cap: g.input.uiCapture, cine: g.camRig.inCinematic, chain: g.chain.active, slow: g.clock.slowmoActive }; })));
await simQ(page, 40);
await page.keyboard.press('KeyM');
await run(page, 4, 30);
await wait(page, 600);
await shot(page, 'h4_map');
await page.keyboard.press('Escape');
await run(page, 4, 30);

// Pause, settings, controls.
await page.keyboard.press('Escape');
await run(page, 4, 30);
await wait(page, 500);
await shot(page, 'h5_pause');
await page.click('.ak-pause [data-a="settings"]');
await wait(page, 500);
await shot(page, 'h6_settings');
await page.keyboard.press('Escape');
await page.click('.ak-pause [data-a="controls"]');
await wait(page, 500);
await shot(page, 'h7_controls');
await page.keyboard.press('Escape');
await wait(page, 200);
await page.click('.ak-pause [data-a="resume"]');
await run(page, 10, 20);

// Defeat → rise again.
await page.evaluate(() => {
  const g = window.__game;
  const m = window.__mob;
  // Deal a lethal blow through the real damage path.
  window.__god = false;
  g.player.hp = 1;
  g.player.invulnTimer = 0;
  const def = { id: 'brig_slash', mult: 99, daze: 0, kind: 'heavy', limb: 'body', reach: 3, arc: 180, yMin: -2, yMax: 3, knock: 3, lift: 0, hitstop: 0.05, shake: 0.3, energy: 0, tier: 2, poise: 2 };
  g.combat.resolveHit(m, g.player, def);
});
await run(page, 150, 12);
await wait(page, 1200);
await shot(page, 'h8_defeat');
await page.keyboard.press('Enter');
await run(page, 60, 10);
await shot(page, 'h9_respawn');
await page.close();

/* ------------------------------------------------------------ touch */
page = await open('touch', { width: 844, height: 390 }, true);
await run(page, 30, 10);
await shot(page, 't1_touch_hud');
// Joystick: press in the left zone and drag up-right; camera: drag on the right.
await page.evaluate(() => {
  const zone = document.querySelector('.ak-touch .zone-move');
  const cam = document.querySelector('.ak-touch .zone-cam');
  const ev = (type, target, id, x, y) =>
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
  ev('pointerdown', zone, 1, 120, 300);
  ev('pointermove', window, 1, 160, 250);
  ev('pointerdown', cam, 2, 600, 200);
  ev('pointermove', window, 2, 660, 210);
  window.__touchEv = ev;
});
await run(page, 40, 10);
const st = await page.evaluate(() => ({ stick: { ...window.__game.input.stick }, pos: window.__game.player.pos.toArray(), vel: window.__game.player.vel.length() }));
console.log('touch state', JSON.stringify(st));
await shot(page, 't2_touch_moving');
await page.evaluate(() => {
  window.__touchEv('pointerup', window, 1, 160, 250);
  window.__touchEv('pointerup', window, 2, 660, 210);
});
// Tap ATK twice and DASH.
await page.tap('.ak-touch .tb[data-id="atk"]');
await simQ(page, 8);
await page.tap('.ak-touch .tb[data-id="atk"]');
await simQ(page, 8);
await page.tap('.ak-touch .tb[data-id="dash"]');
await run(page, 6, 10);
await shot(page, 't3_touch_actions');
console.log('acts', await page.evaluate(() => window.__game.player.actionName));
await page.close();

const errs = logs.filter((l) => l.includes('error') || l.includes('pageerror'));
console.log('errors:', errs.length);
for (const l of errs.slice(0, 20)) console.log(l);
await browser.close();
