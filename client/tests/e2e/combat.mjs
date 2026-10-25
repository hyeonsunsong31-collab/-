// Scripted combat walkthrough against a rival dummy with deterministic stepping.
// Usage: node client/tests/e2e/combat.mjs <baseUrl> <outDir> [scenario,...]
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
await page.goto(`${base}?q=medium`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 240000, polling: 500 });

const sim = (frames) => page.evaluate((n) => window.__game.simulate(n), frames);
const act = (a, down) => page.evaluate(([a, d]) => window.__game.input.set(a, d), [a, down]);
const tap = async (a, frames = 1) => {
  await act(a, true);
  await sim(frames);
  await act(a, false);
};
const state = () =>
  page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const r = g.bots[0]?.hero;
    const f = (c) =>
      c && {
        hp: Math.round(c.hp),
        daze: Math.round(c.daze),
        st: c.state,
        act: c.actionName,
        pos: c.pos.toArray().map((v) => +v.toFixed(1)),
        en: Math.round(c.energy),
        surge: Math.round(c.surge),
        form: c.form.id,
      };
    return { p: f(p), r: f(r), slow: g.clock.slowmoActive, grey: +g.renderer.combat.u('uGrey').value.toFixed(2) };
  });
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await state()));
};
const want = (n) => !only || only.split(',').includes(n);
const events = [];
await page.evaluate(() => {
  window.__ev = [];
  window.__game.combat.on((e) => {
    if (e.type !== 'anim') window.__ev.push(e.type + (e.type === 'hit' ? `:${e.def.id}:${e.res.dmg}` : ''));
  });
});
const flushEvents = async (label) => {
  const ev = await page.evaluate(() => window.__ev.splice(0));
  console.log(`  events(${label}):`, ev.join(' '));
  events.push(...ev);
};

await sim(20);
// Spawn a passive dummy rival 3.2 m ahead.
await page.evaluate(() => {
  const g = window.__game;
  const r = g.spawnRival('normal', 3.2);
  r.controls.brain = null;
  window.__rival = r;
});
await sim(10);

if (want('combo')) {
  for (let i = 1; i <= 5; i++) {
    await tap('light');
    await sim(i === 5 ? 16 : 13);
    await shot(`k0${i}_light${i}`);
  }
  await flushEvents('combo');
  await sim(90);
}
if (want('rush')) {
  await page.evaluate(() => {
    const r = window.__rival;
    r.hp = r.maxHp;
    r.daze = 0;
    r.teleport(window.__game.player.pos.clone().addScaledVector(window.__game.player.forward(), 2.4), window.__game.player.yaw + Math.PI);
  });
  for (let i = 1; i <= 4; i++) {
    await tap('light');
    await sim(13);
  }
  await act('light', true);
  await sim(30);
  await shot('k06_rush');
  await sim(40);
  await act('light', false);
  await sim(14);
  await shot('k07_rush_end');
  await flushEvents('rush');
  await sim(90);
}
if (want('ex')) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 5), g.player.yaw + Math.PI);
    g.player.energy = 120;
  });
  await sim(60);
  await tap('heavy');
  await sim(16);
  await shot('k08_ex_flip');
  await sim(22);
  await shot('k09_ex_impact');
  await flushEvents('ex');
  await sim(90);
}
if (want('dodge')) {
  // Rival swings a roundhouse; the player dashes just before it lands → perfect dodge + grey slow-mo.
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    r.stunTimer = 0;
    r.daze = 0;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 2.2), g.player.yaw + Math.PI);
  });
  await sim(40);
  await page.evaluate(() => window.__rival.playAction('light4', { fadeIn: 0.04 }));
  await sim(9);
  await page.evaluate(() => {
    const s = window.__game.input.stick;
    s.active = true;
    s.x = 1;
    s.y = 0;
  });
  await tap('dodge');
  await sim(10);
  await shot('k10_perfect_dodge');
  await page.evaluate(() => {
    const s = window.__game.input.stick;
    s.active = false;
    s.x = 0;
  });
  await tap('light');
  await sim(14);
  await shot('k11_dodge_counter');
  await flushEvents('dodge');
  await sim(120);
}
if (want('parry')) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 2.2), g.player.yaw + Math.PI);
  });
  await sim(40);
  await page.evaluate(() => window.__rival.playAction('light2', { fadeIn: 0.04 }));
  await sim(3);
  await act('block', true);
  await sim(6);
  await shot('k12_parry');
  await act('block', false);
  await tap('light');
  await sim(10);
  await shot('k13_parry_counter');
  await flushEvents('parry');
  await sim(90);
}
if (want('ki')) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 14), g.player.yaw + Math.PI);
  });
  await sim(30);
  for (let i = 0; i < 3; i++) {
    await tap('ki');
    await sim(9);
  }
  await shot('k14_ki_bolts');
  await sim(30);
  await act('ki', true);
  await sim(80);
  await shot('k15_beam_charge');
  await act('ki', false);
  await sim(20);
  await shot('k16_beam_fire');
  await sim(80);
  await flushEvents('ki');
}
if (want('transform')) {
  await page.evaluate(() => {
    const g = window.__game;
    g.chain.end();
    window.__rival.stunTimer = 0;
    g.player.setStats(12, g.player.stats);
    g.player.surge = 3000;
  });
  await act('transform', true);
  await sim(70);
  await shot('k17_powerup');
  await sim(80);
  await shot('k18_transform_charge');
  await sim(20);
  await shot('k19_transform_burst');
  await act('transform', false);
  await sim(60);
  await shot('k20_golden');
  await flushEvents('transform');
}
if (want('chain')) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 2.4), g.player.yaw + Math.PI);
    r.daze = r.dazeMax - 1;
  });
  await sim(20);
  // light1 stuns (daze full), then the heavy-flagged launcher (light5 via the chain) triggers the prompt.
  await tap('light');
  await sim(16);
  await page.evaluate(() => (window.__rival.stunTimer = 5));
  await tap('heavy');
  await sim(40);
  await shot('k21_chain_prompt');
  await tap('light');
  await sim(30);
  await shot('k22_chain_rush');
  await sim(60);
  await shot('k23_chain_after');
  await flushEvents('chain');
  await sim(120);
}
if (want('ult')) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    r.stunTimer = 0;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 16), g.player.yaw + Math.PI);
    g.player.surge = 3000;
  });
  await sim(30);
  await act('ki', true);
  await sim(70);
  await shot('k24_ult_charge');
  await act('ki', false);
  await sim(50);
  await shot('k25_ult_fire');
  await sim(40);
  await shot('k26_ult_dragons');
  await sim(60);
  await flushEvents('ult');
}
if (want('ai')) {
  // Let the rival's brain loose on a passive player for a few seconds.
  await page.evaluate(() => {
    const g = window.__game;
    const r = window.__rival;
    r.hp = r.maxHp;
    r.stunTimer = 0;
    r.daze = 0;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    g.player.hp = g.player.maxHp;
    r.teleport(g.player.pos.clone().addScaledVector(g.player.forward(), 9), g.player.yaw + Math.PI);
    const b = g.bots[0];
    r.controls.brain = (h, c, dt) => b.ai.step(h, c, dt);
  });
  for (let i = 0; i < 6; i++) {
    await sim(45);
    await shot(`k3${i}_ai`);
  }
  await flushEvents('ai');
}
if (want('destroy')) {
  // Take the fight to the forest edge: a Dragon Fist + transformation burst flatten trees and boulders.
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.world;
    // Find a spot with several trees and a boulder close by.
    let best = null;
    let bestN = 0;
    for (let i = 0; i < 400; i++) {
      const x = -620 + Math.random() * 400;
      const z = -420 + Math.random() * 380;
      let n = 0;
      for (const t of w.data.trees) if (Math.hypot(t.x - x, t.z - z) < 7) n++;
      for (const r of w.data.rocks) if (Math.hypot(r.x - x, r.z - z) < 6) n += 2;
      if (n > bestN && !w.isWater(x, z)) {
        bestN = n;
        best = [x, z];
      }
    }
    const p = g.findSpawn(best[0], best[1]);
    g.player.teleport(p, 0);
    g.camRig.yaw = Math.PI + 0.6;
    g.player.setStats(12, g.player.stats);
    g.player.surge = 3000;
    const r = window.__rival;
    r.controls.brain = null;
    r.hp = r.maxHp;
    r.stunTimer = 0;
    if (r.state !== 'normal') {
      r.state = 'normal';
      r.stopAction(0);
    }
    r.teleport(p.clone().setZ(p.z + 3), Math.PI);
  });
  await sim(30);
  await act('transform', true);
  await sim(150);
  await act('transform', false);
  await shot('k40_destroy_burst');
  await sim(50);
  await shot('k41_destroy_topple');
  await sim(60);
  await shot('k42_destroy_after');
  await flushEvents('destroy');
}
console.log(logs.filter((l) => !l.includes('[vite]') && !l.includes('[debug]')).slice(-30).join('\n'));
await browser.close();
