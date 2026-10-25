// Training-arena walkthrough: herald prompt, select screen, VS intro, fight HUD, K.O. finish, result + reward,
// rematch decided by ring-out, leaving the arena.
// Usage: node client/tests/e2e/arena.mjs <baseUrl> <outDir> [extraQuery]
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
const simQ = (frames) => page.evaluate((n) => window.__game.simulate(n, 1 / 60, false), frames);
const wait = (ms) => page.waitForTimeout(ms);
const state = () =>
  page.evaluate(() => {
    const g = window.__game;
    const a = g.arena;
    const r = a.rival;
    const f = (c) => c && { hp: Math.round(c.hp), st: c.state, act: c.actionName, mv: c.move, pos: c.pos.toArray().map((v) => +v.toFixed(1)) };
    return { phase: a.phase, t: +a.timeLeft.toFixed(1), p: f(g.player), r: f(r), lv: g.save.profile.level, wins: g.save.profile.wins };
  });
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png`, timeout: 180000 });
  console.log(name, JSON.stringify(await state()));
};
// Paced stepping: simulate in unrendered chunks while letting wall-clock pass for CSS animations, then render once.
const run = async (frames, ms = 16) => {
  for (let i = 0; i < frames; i += 10) {
    const n = Math.min(10, frames - i);
    await page.evaluate((k) => window.__game.simulate(k, 1 / 60, false), n);
    if (ms) await wait(ms * n);
  }
  await sim(0);
};

await page.evaluate(() => {
  window.__game.addFrameHook((g) => {
    if (window.__god && g.player.alive) g.player.hp = g.player.maxHp;
  });
});
const untilPhase = async (ph, maxChunks = 60) => {
  for (let i = 0; i < maxChunks && (await state()).phase !== ph; i++) await run(20);
};
await sim(20);
// 1) Walk up to the Ashford herald.
await page.evaluate(() => {
  const g = window.__game;
  const h = g.arena.heralds.find((n) => n.name === 'Arena Herald');
  const p = h.pos.clone().add({ x: Math.sin(h.yaw) * 2.4, y: 0, z: Math.cos(h.yaw) * 2.4 });
  g.player.teleport(g.findSpawn(p.x, p.z), h.yaw + Math.PI);
  g.camRig.yaw = h.yaw + Math.PI * 0 + 0.5;
  g.camRig.pitch = -0.12;
});
await run(40, 10);
await shot('a1_herald');

// 2) Talk (F) → select.
await page.keyboard.press('KeyF');
await run(4, 0);
await wait(700);
await shot('a2_select');
await page.keyboard.press('ArrowRight'); // hard
await wait(300);
await page.keyboard.press('ArrowLeft'); // back to normal
await wait(300);
await page.keyboard.press('Enter');
await wait(900);
await untilPhase('intro');

// 3) VS intro.
await run(30);
await shot('a3_intro_rival');
await run(70);
await shot('a4_intro_wide');
await run(105);
await shot('a5_ready');
await run(80);
await shot('a6_fight');

// 4) Fight: a few light combos at the rival (the player can't fall in this scripted bout).
await page.evaluate(() => {
  const g = window.__game;
  window.__god = true;
  window.__arenaT0 = performance.now();
  g.player.yaw = g.player.yawTo(g.arena.rival.pos);
});
for (let k = 0; k < 4; k++) {
  await page.evaluate(() => {
    const g = window.__game;
    const r = g.arena.rival;
    // Close the distance.
    const d = g.player.pos.distanceTo(r.pos);
    if (d > 2.2) {
      const p = r.pos.clone().addScaledVector(r.pos.clone().sub(g.player.pos).setY(0).normalize(), -1.8);
      p.y = g.world.groundAt(p.x, p.z, r.pos.y + 1);
      g.player.teleport(p, g.player.yawTo(r.pos));
    }
  });
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.__game.input.set('light', true));
    await simQ(2);
    await page.evaluate(() => window.__game.input.set('light', false));
    await simQ(11);
  }
  await simQ(30);
}
await shot('a7_fight_hud');

// 5) Finish by K.O. (the ticket is aged past the minimum match length so the win counts).
await page.evaluate(() => {
  const g = window.__game;
  if (g.arena.ticket) g.arena.ticket.startedAt -= 20000;
  const r = g.arena.rival;
  r.hp = Math.min(r.hp, 30);
  g.player.yaw = g.player.yawTo(r.pos);
  const d = g.player.pos.distanceTo(r.pos);
  if (d > 2.2) {
    const p = r.pos.clone().addScaledVector(r.pos.clone().sub(g.player.pos).setY(0).normalize(), -1.8);
    p.y = g.world.groundAt(p.x, p.z, r.pos.y + 1);
    g.player.teleport(p, g.player.yawTo(r.pos));
  }
});
for (let i = 0; i < 4 && (await state()).phase === 'fight'; i++) {
  await page.evaluate(() => window.__game.input.set('heavy', true));
  await simQ(2);
  await page.evaluate(() => window.__game.input.set('heavy', false));
  await simQ(30);
}
await run(20);
await shot('a8_ko');
await run(110);
await shot('a9_ko_late');
await untilPhase('result');
await wait(2600);
await shot('a10_result');

// 6) Rematch, decided by ring-out.
await page.keyboard.press('Enter');
await wait(900);
await untilPhase('intro');
await untilPhase('fight');
await page.evaluate(() => {
  const g = window.__game;
  const r = g.arena.rival;
  // Shove the rival onto the sand beyond the stage edge.
  const p = g.arena.stagePoint(0, 19);
  p.y = g.world.terrainHeight(p.x, p.z);
  r.move = 'ground';
  r.teleport(p, r.yaw);
});
await run(30);
await shot('a11_ringout');
await untilPhase('result');
await wait(2600);
await shot('a12_result_ringout');

// 7) Leave.
await page.keyboard.press('Escape');
await wait(600);
await run(40);
await shot('a13_left');

// 8) Mobile select layout.
await page.setViewportSize({ width: 844, height: 390 });
await page.evaluate(() => {
  const g = window.__game;
  g.input.touchMode = true;
  g.arena.openSelect();
});
await wait(800);
await shot('a14_select_mobile');

const errs = logs.filter((l) => l.includes('error') || l.includes('pageerror'));
console.log('errors:', errs.length);
for (const l of errs.slice(0, 20)) console.log(l);
await browser.close();
