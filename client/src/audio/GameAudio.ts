import * as THREE from 'three';
import type { Game } from '../Game.ts';
import type { CombatEvent } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';
import { Hero } from '../gameplay/Hero.ts';
import { AudioEngine } from './AudioEngine.ts';
import { Sfx } from './Sfx.ts';
import { Music, type MusicMode } from './Music.ts';

const _v = new THREE.Vector3();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Loop {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
  filter?: BiquadFilterNode;
}

/**
 * Sound director: listens to the combat bus, fighter presentation beats, arena phases and progression, and voices
 * them through the procedural synth; runs the continuous layers (wind, birds, water, village bell, the player's
 * aura roar, beams) and steers the generative score between exploration, combat, arena and title.
 */
export class GameAudio {
  readonly engine = new AudioEngine();
  readonly sfx = new Sfx(this.engine);
  readonly music = new Music(this.engine);
  private beams = new Map<object, { stop: () => void }>();
  private aura: Loop | null = null;
  private wind: Loop | null = null;
  private water: Loop | null = null;
  private birdT = 2;
  private bellT = 20;
  private arcT = 0.5;
  private combatHold = 0;
  private waterCheck = 0;
  private waterLevel = 0;
  private lastArena = 'idle';

  constructor(private g: Game) {
    const unlock = () => this.engine.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    this.engine.onUnlock(() => this.startLoops());
    g.combat.on((e) => this.onCombat(e));
    g.player.fxHooks.push((name, data) => this.onPlayerFx(name, data));
    g.save.onProgress((e) => {
      if (e.kind === 'xp') this.sfx.ui('xp');
      if (e.kind === 'level' && e.levels) this.sfx.fanfare('level');
    });
    this.applyVolumes();
    g.settings.onChange(() => this.applyVolumes());
    // UI clicks.
    document.addEventListener(
      'pointerdown',
      (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && !b.closest('.ak-touch')) this.sfx.ui(b.classList.contains('x') ? 'back' : 'select');
      },
      true,
    );
  }

  private applyVolumes(): void {
    const s = this.g.settings.data;
    this.engine.setVolumes(s.master, s.music, s.sfx);
  }

  /* ---------------------------------------------------------------- loops */

  private startLoops(): void {
    const a = this.engine;
    // Wind: pink noise through a wandering band-pass.
    {
      const out = a.gain(0, a.amb);
      const bp = a.filter('bandpass', 500, 0.6, out);
      const src = a.noise(a.pink, a.now, 1e6, bp);
      const lfo = a.ctx!.createOscillator();
      lfo.frequency.value = 0.07;
      const lg = a.gain(220);
      lfo.connect(lg).connect(bp.frequency);
      lfo.start();
      this.wind = { out, nodes: [src, lfo], filter: bp };
    }
    // River / lake wash.
    {
      const out = a.gain(0, a.amb);
      const bp = a.filter('bandpass', 900, 0.5, out);
      const src = a.noise(a.white, a.now, 1e6, bp);
      const trem = a.ctx!.createOscillator();
      trem.frequency.value = 0.35;
      const tg = a.gain(0.25);
      trem.connect(tg).connect(out.gain);
      trem.start();
      this.water = { out, nodes: [src, trem], filter: bp };
    }
    // Player aura: low roar + saw drone + hiss, shaped per frame.
    {
      const out = a.gain(0, a.sfx);
      const lp = a.filter('lowpass', 400, 0.9, out);
      const roar = a.noise(a.brown, a.now, 1e6, a.gain(1.4, lp));
      const hiss = a.noise(a.white, a.now, 1e6, a.filter('bandpass', 2400, 0.7, a.gain(0.08, out)));
      const d1 = a.osc('sawtooth', 55, a.now, 1e6, a.filter('lowpass', 300, 1, a.gain(0.18, out)));
      const d2 = a.osc('sawtooth', 82.4, a.now, 1e6, a.filter('lowpass', 300, 1, a.gain(0.12, out)));
      this.aura = { out, nodes: [roar, hiss, d1, d2], filter: lp };
    }
  }

  /* ---------------------------------------------------------------- events */

  private near(p: THREE.Vector3, r = 70): boolean {
    return p.distanceTo(this.engine.listener.pos) < r;
  }

  private onCombat(e: CombatEvent): void {
    if (!this.engine.ready) return;
    const s = this.sfx;
    const player = this.g.player;
    switch (e.type) {
      case 'hit': {
        if (!this.near(e.point)) break;
        const id = e.def.id;
        if (id.endsWith('_tick')) break;
        if (e.res.blocked) {
          s.block(e.point, Math.min(1, e.def.tier / 4));
          break;
        }
        const power = Math.min(1.2, 0.3 + e.def.tier * 0.18 + (e.res.crit ? 0.25 : 0));
        if (e.def.ki) {
          // Ki hits are voiced by the bolt / blast impact.
          if (!id.includes('bolt') && !id.includes('orb')) s.punch(e.point, power, e.def.tier >= 3);
        } else if (/^(brig|knight)_/.test(id) && !/kick|bash/.test(id)) s.slash(e.point, power, true);
        else if (id.startsWith('imp_claw')) s.slash(e.point, power * 0.8, false);
        else s.punch(e.point, power, e.def.tier >= 3 || e.def.kind === 'knockdown' || e.def.kind === 'spike');
        if (e.target === player) s.punch(undefined, 0.3, false);
        break;
      }
      case 'flash':
        if (this.near(e.who.pos, 45)) s.telegraph(e.who.chest(_v), e.color === 'red');
        break;
      case 'perfectDodge':
        if (e.who === player) s.perfectDodge();
        break;
      case 'parry':
        s.parry(e.point);
        break;
      case 'guardBreak':
        s.guardBreak(e.who.chest(_v));
        break;
      case 'stun':
        s.stun(e.who.chest(_v));
        break;
      case 'bodyfall':
      case 'slam':
        if (this.near(e.pos)) s.land(e.pos, e.power > 8 || e.type === 'slam');
        break;
      case 'boltSpawn': {
        const b = e.bolt;
        if (this.near(b.pos)) s.kiFire(b.pos, b.scale);
        break;
      }
      case 'boltImpact':
        if (this.near(e.pos, 90)) s.explosion(e.pos, 0.55, true);
        break;
      case 'beamStart': {
        const h = s.beam(e.beam.origin, e.beam.ultimate);
        if (h) this.beams.set(e.beam, h);
        break;
      }
      case 'beamEnd': {
        this.beams.get(e.beam)?.stop();
        this.beams.delete(e.beam);
        break;
      }
      case 'blast':
        if (this.near(e.pos, 140)) s.explosion(e.pos, Math.min(3, e.radius / 2.5), !!e.def.ki);
        break;
      case 'crater':
        if (this.near(e.pos, 160)) {
          s.explosion(e.pos, Math.min(3, e.radius / 2.2), false);
          if (e.felled > 0) s.slash(e.pos, 0.5, false);
        }
        break;
      case 'chain':
        if (e.phase === 'prompt') s.stinger();
        else if (e.phase === 'start') s.whoosh(undefined, 1.1, 0.4, 0.6);
        break;
      case 'anim':
        this.onAnim(e.who, e.name, e.data);
        break;
    }
  }

  private surface(p: THREE.Vector3): 'grass' | 'stone' | 'dirt' {
    const d = this.g.world.data;
    if (d.splatAt(p.x, p.z, 1) > 0.5) return 'stone';
    if (d.splatAt(p.x, p.z, 0) > 0.4) return 'dirt';
    const A = this.g.world.settlements.arena;
    if (Math.abs(p.y - A.stageTop) < 0.3 && Math.hypot(p.x - A.x, p.z - A.z) < 24) return 'stone';
    return 'grass';
  }

  private onAnim(who: Combatant, name: string, data?: Record<string, unknown>): void {
    const s = this.sfx;
    const pos = (data?.pos as THREE.Vector3 | undefined) ?? who.pos;
    if (!this.near(pos, 60)) return;
    switch (name) {
      case 'step':
        s.footstep(pos, data?.water ? 'water' : this.surface(pos), Math.min(1, Math.hypot(who.vel.x, who.vel.z) / 9));
        break;
      case 'whoosh':
        s.whoosh(who.chest(_v), Number(data?.pitch ?? 1), 0.24, 0.45);
        break;
      case 'land':
        s.land(pos, !!data?.hard);
        break;
      case 'dash':
        s.dash(who.pos);
        break;
      case 'jump':
        s.whoosh(who.pos, 0.8, 0.25, 0.3);
        break;
      case 'flight':
        if (data?.on) s.takeoff(who.pos, false);
        break;
      case 'boost':
        s.takeoff(who.pos, true);
        break;
      case 'vanish':
      case 'blink':
        s.vanish(who.chest(_v));
        break;
      case 'transformCharge':
        s.roar(who.chest(_v), 1.5, who instanceof Hero && who !== this.g.player ? 0.9 : 1);
        s.lightning(who.chest(_v), false);
        break;
      case 'transformBurst':
        s.transformBurst(who.chest(_v), Number(data?.tier ?? 1));
        break;
      case 'ultimate':
        s.roar(who.chest(_v), 1.1, 1.05);
        break;
      case 'kiGather':
      case 'beamCharge':
      case 'castGather':
        s.lightning(who.chest(_v), false);
        break;
      case 'groundImpact':
      case 'quake':
        s.explosion(pos, name === 'quake' ? 1.8 : 0.9, false);
        break;
      case 'thunderStrike':
        s.lightning(pos, true);
        break;
      case 'bombStart':
        s.lightning(who.chest(_v), false);
        break;
      case 'exSpecial':
        s.whoosh(who.pos, 0.6, 0.5, 0.6);
        break;
    }
  }

  private onPlayerFx(name: string, _data?: Record<string, unknown>): void {
    if (!this.engine.ready) return;
    if (name === 'targetLock') this.sfx.ui('point');
  }

  /* ---------------------------------------------------------------- per frame */

  update(dt: number): void {
    const a = this.engine;
    if (!a.ready) return;
    const g = this.g;
    a.setListener(g.camera);
    a.slowmo(g.clock.slowmoAmount);
    const p = g.player;
    const t = a.now;
    // Wind: stronger with altitude and speed.
    if (this.wind) {
      const alt = Math.max(0, p.pos.y - g.world.terrainHeight(p.pos.x, p.pos.z));
      const speed = p.vel.length();
      const w = 0.05 + Math.min(0.35, alt * 0.004) + Math.min(0.4, speed * (p.flying ? 0.012 : 0.003));
      this.wind.out.gain.setTargetAtTime(w, t, 0.4);
      this.wind.filter!.Q.setTargetAtTime(p.flying ? 0.9 : 0.6, t, 0.5);
    }
    // Water proximity.
    this.waterCheck -= dt;
    if (this.waterCheck <= 0 && this.water) {
      this.waterCheck = 0.6;
      let near = 0;
      for (const r of [6, 14, 28])
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          if (g.world.isWater(p.pos.x + Math.cos(ang) * r, p.pos.z + Math.sin(ang) * r)) near = Math.max(near, 1 - r / 34);
        }
      this.waterLevel = near;
      this.water.out.gain.setTargetAtTime(near * 0.22, t, 0.8);
    }
    // Aura roar.
    if (this.aura) {
      const charging = p.power === 'charging' ? 1 : p.power === 'powerup' ? 0.65 : 0;
      const form = p.form.tier > 0 ? 0.22 + p.form.tier * 0.03 : 0;
      const k = Math.max(charging, form);
      this.aura.out.gain.setTargetAtTime(k * 0.55, t, 0.15);
      this.aura.filter!.frequency.setTargetAtTime(280 + k * 900, t, 0.2);
      // Bio-electric arcs for the Storm forms and while charging.
      this.arcT -= dt;
      if (this.arcT <= 0) {
        this.arcT = rnd(0.25, 0.9);
        if ((p.form.lightning && p.form.tier > 0) || p.power === 'charging') this.sfx.lightning(p.chest(_v), false);
      }
    }
    // Birds by day, away from fights and the arena.
    const fighting = this.inCombat(dt);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = rnd(1.4, 4.5);
      if (!fighting && !g.arena.busy && !p.flying) this.bird();
    }
    // Village bell now and then.
    this.bellT -= dt;
    if (this.bellT <= 0) {
      this.bellT = rnd(35, 70);
      if (Math.hypot(p.pos.x, p.pos.z) < 120 && !fighting) this.villageBell();
    }
    // Arena cues.
    const ph = g.arena.phase;
    if (ph !== this.lastArena) {
      if (ph === 'intro') this.sfx.crowd(0.8);
      if (ph === 'fight') {
        this.sfx.stinger();
        this.sfx.crowd(1.2);
      }
      if (ph === 'finish') {
        this.sfx.explosion(undefined, 1.2, false);
        this.sfx.crowd(1.5);
      }
      if (ph === 'result') this.sfx.fanfare(g.arena.lastOutcome === 'loss' ? 'defeat' : 'victory');
      this.lastArena = ph;
    }
    // Score.
    let mode: MusicMode = 'explore';
    if (g.inTitle) mode = 'title';
    else if (g.arena.busy && ph !== 'select' && ph !== 'loading') mode = 'arena';
    else if (fighting) mode = 'combat';
    this.music.setMode(mode);
    this.music.intensity = mode === 'arena' ? 1 : this.combatIntensity();
    this.music.setDuck(g.menuOpen || g.pause.isOpen || g.map.isOpen ? 0.45 : 1);
  }

  private inCombat(dt: number): boolean {
    const g = this.g;
    const p = g.player;
    let engaged = false;
    for (const m of g.spawner.mobs) if (m.alive && m.target === p && m.pos.distanceTo(p.pos) < 35) engaged = true;
    for (const b of g.bots) if (b.hero.alive && b.hero.pos.distanceTo(p.pos) < 40) engaged = true;
    if (engaged) this.combatHold = 4;
    else this.combatHold -= dt;
    return this.combatHold > 0;
  }

  private combatIntensity(): number {
    const g = this.g;
    const p = g.player;
    let n = 0;
    let danger = 0;
    for (const m of g.spawner.mobs) {
      if (!m.alive || m.target !== p) continue;
      n++;
      if (m.level >= p.level + 5) danger = 1;
    }
    if (g.bots.length) danger = Math.max(danger, 0.8);
    return Math.min(1, Math.max(danger, 0.3 + n * 0.15 + (p.form.tier > 0 ? 0.2 : 0)));
  }

  private bird(): void {
    const a = this.engine;
    const L = a.listener.pos;
    const pos = new THREE.Vector3(L.x + rnd(-25, 25), L.y + rnd(4, 12), L.z + rnd(-25, 25));
    const v = a.voice(1.2, { pos, gain: 0.16, reverb: 0.3, bus: 'amb', range: 40 });
    if (!v) return;
    const t = a.now;
    const notes = Math.floor(rnd(2, 6));
    const base = rnd(2600, 4200);
    for (let i = 0; i < notes; i++) {
      const at = t + i * rnd(0.08, 0.16);
      const g = a.gain(0, v.input);
      const o = a.osc('sine', base * rnd(0.9, 1.15), at, 0.12, g);
      o.frequency.exponentialRampToValueAtTime(base * rnd(1.2, 1.6), at + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * rnd(0.8, 1), at + 0.1);
      a.env(g.gain, at, 0.005, 0.5, 0.09);
    }
  }

  private villageBell(): void {
    const a = this.engine;
    const v = a.voice(6, { pos: new THREE.Vector3(0, 30, -20), gain: 0.5, reverb: 0.6, bus: 'amb', range: 200 });
    if (!v) return;
    for (let k = 0; k < 3; k++) {
      const t = a.now + k * 1.6;
      for (const [r, amp] of [
        [1, 0.3],
        [2.76, 0.12],
        [5.4, 0.06],
        [8.93, 0.03],
      ] as const) {
        const g = a.gain(0, v.input);
        a.osc('sine', 196 * r, t, 4, g);
        a.env(g.gain, t, 0.004, amp, 3.6);
      }
    }
  }
}
