import * as THREE from 'three';
import type { Lighting } from '../render/Lighting.ts';
import type { World } from '../world/World.ts';
import type { CombatEvent, CombatSystem } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';
import type { Hero } from '../gameplay/Hero.ts';
import { ATTACKS, type Limb } from '../combat/attacks.ts';
import { Particles, Shape } from './Particles.ts';
import { Lightning } from './Lightning.ts';
import { Trails } from './Trails.ts';
import { Afterimages } from './Afterimages.ts';
import { Shockwaves } from './Shockwaves.ts';
import { Debris } from './Debris.ts';
import { KiFx } from './KiFx.ts';
import { Aura } from './Aura.ts';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const GOLD = new THREE.Color('#ffc94a');
const RED = new THREE.Color('#ff3b2a');
const KI = new THREE.Color('#3fb2ff');
const DUST = new THREE.Color('#8b7d66');
const SMOKE = new THREE.Color('#5a554e');
const WATER = new THREE.Color('#d8eef8');

interface Tracked {
  hero: Hero;
  aura: Aura;
  boostAcc: number;
  chargeAcc: number;
  skyAcc: number;
}

/**
 * VFX director: owns every pooled effect system and turns the combat / animation event stream into hit sparks,
 * telegraph glints, limb trails, afterimages, dust, splashes, debris, shock rings, ki bolts, beams and auras.
 */
export class Vfx {
  readonly group = new THREE.Group();
  readonly add: Particles;
  readonly alpha: Particles;
  readonly lightning: Lightning;
  readonly trails = new Trails();
  readonly ghosts = new Afterimages();
  readonly waves = new Shockwaves();
  readonly debris: Debris;
  readonly ki: KiFx;
  private tracked = new Map<Combatant, Tracked>();
  private q: number;
  /** Game-time scheduler (effects stay in sync with hitstop, slow-mo and deterministic test stepping). */
  private timers: { t: number; fn: () => void }[] = [];

  constructor(
    lighting: Lighting,
    private world: World | null,
    quality = 1,
    private player: Combatant | null = null,
  ) {
    this.q = quality;
    this.add = new Particles(Math.round(5000 * Math.max(0.5, quality)), true);
    this.alpha = new Particles(Math.round(1800 * Math.max(0.5, quality)), false);
    this.lightning = new Lightning(7000);
    this.debris = new Debris(lighting, world, Math.round(320 * Math.max(0.5, quality)));
    this.ki = new KiFx(this.add, this.alpha, this.lightning, this.waves, world, quality);
    this.group.add(this.alpha.mesh, this.add.mesh, this.lightning.mesh, this.trails.mesh, this.ghosts.group, this.waves.group, this.debris.mesh, this.ki.group);
  }

  /** Give a hero an aura and continuous state effects. */
  track(hero: Hero, withLight = false): void {
    if (this.tracked.has(hero)) return;
    const aura = new Aura(hero.char, this.add, this.alpha, this.lightning, this.waves, this.world, withLight, this.q);
    aura.setForm(hero.form);
    this.tracked.set(hero, { hero, aura, boostAcc: 0, chargeAcc: 0, skyAcc: 0 });
  }

  untrack(c: Combatant): void {
    const t = this.tracked.get(c);
    if (t) t.aura.dispose();
    this.tracked.delete(c);
    this.ghosts.forget(c.char);
  }

  connect(combat: CombatSystem): void {
    combat.on((e) => this.onEvent(e));
  }

  /** Run `fn` after `delay` seconds of game time. */
  later(delay: number, fn: () => void): void {
    this.timers.push({ t: delay, fn });
  }

  /* ------------------------------------------------------------------ primitives */

  private kiColor(c: Combatant): THREE.Color {
    return c.form.tier > 0 ? _c.set(c.form.auraColor) : _c.copy(KI);
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, count: number, speed: number, spread = 0.9, size = 0.06): void {
    const n = Math.round(count * this.q);
    for (let i = 0; i < n; i++) {
      const d = _v2.randomDirection().multiplyScalar(spread).add(dir).normalize();
      this.add.emit({ pos, vel: d.multiplyScalar(speed * (0.45 + Math.random() * 0.9)), life: 0.16 + Math.random() * 0.24, size, color: _c.copy(color).multiplyScalar(2.8), color1: color, shape: Shape.Spark, stretch: 0.03, drag: 4, gravity: 6 });
    }
  }

  glint(pos: THREE.Vector3, color: THREE.Color, size: number, life = 0.18): void {
    this.add.emit({ pos, life, size, size1: size * 0.3, color: _c.copy(color).multiplyScalar(3), shape: Shape.Star, rot: Math.random() * Math.PI });
    this.add.emit({ pos, life: life * 0.8, size: size * 1.3, size1: size * 0.2, color: _c.copy(color).multiplyScalar(1.6), shape: Shape.Glow });
  }

  dustRing(pos: THREE.Vector3, radius: number, count: number, speed: number, alpha = 0.35): void {
    const n = Math.round(count * this.q);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const p = _v.set(pos.x + Math.cos(a) * radius * 0.3, pos.y + 0.15, pos.z + Math.sin(a) * radius * 0.3);
      this.alpha.emit({ pos: p, vel: _v2.set(Math.cos(a) * speed, 0.5 + Math.random() * 0.8, Math.sin(a) * speed), life: 0.7 + Math.random() * 0.5, size: radius * 0.3, size1: radius * 0.9, color: DUST, alpha, shape: Shape.Smoke, drag: 3 });
    }
  }

  splash(pos: THREE.Vector3, power: number): void {
    const n = Math.round((8 + power * 10) * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.alpha.emit({ pos: _v.set(pos.x, pos.y + 0.05, pos.z), vel: _v2.set(Math.cos(a) * (1 + Math.random() * 2.5) * power, (2 + Math.random() * 4) * power, Math.sin(a) * (1 + Math.random() * 2.5) * power), life: 0.6, size: 0.08, size1: 0.02, color: WATER, alpha: 0.85, shape: Shape.Glow, gravity: 16 });
    }
    this.waves.ground(pos, 1.6 * power, WATER, 0.6, 0.6, 0.05);
  }

  explosion(pos: THREE.Vector3, radius: number, color: THREE.Color, ground: boolean): void {
    this.add.emit({ pos, life: 0.2, size: radius * 2.2, size1: radius * 0.6, color: WHITE.clone().multiplyScalar(3), shape: Shape.Glow });
    this.add.emit({ pos, life: 0.45, size: radius * 1.5, size1: radius * 2.8, color: _c.copy(color).multiplyScalar(2), shape: Shape.Glow });
    this.waves.shell(pos, radius * 1.3, _c.copy(color).multiplyScalar(1.5), 0.45, 1);
    this.waves.air(pos, _v.set(0, 1, 0), radius * 2, _c.copy(color).multiplyScalar(1.4), 0.5, 0.9);
    this.sparks(pos, _v.set(0, 0.6, 0), color, 26, 22, 1.4, 0.09);
    for (let i = 0; i < 8 * this.q; i++) {
      this.alpha.emit({ pos: _v.copy(pos).add(_v2.randomDirection().multiplyScalar(radius * 0.4)), vel: _v2.randomDirection().multiplyScalar(radius * 1.5).setY(radius * 0.8), life: 1.4 + Math.random(), size: radius * 0.5, size1: radius * 1.6, color: SMOKE, alpha: 0.5, shape: Shape.Smoke, drag: 1.8 });
    }
    if (ground && this.world) {
      const g = this.world.terrainHeight(pos.x, pos.z);
      const gp = _v.set(pos.x, g, pos.z);
      this.waves.ground(gp, radius * 3, _c.copy(color).multiplyScalar(0.8), 0.7, 0.8);
      this.dustRing(gp, radius * 1.4, 16, radius * 3);
      this.debris.burst(gp, Math.round(radius * 6), radius * 3.5, 0.18 + radius * 0.03, '#6f6253');
    }
  }

  private limbPos(c: Combatant, limb: Limb, out: THREE.Vector3): THREE.Vector3 {
    switch (limb) {
      case 'handL':
        return c.char.handWorld('L', out);
      case 'handR':
        return c.char.handWorld('R', out);
      case 'footL':
        return c.char.footWorld('L', out);
      case 'footR':
        return c.char.footWorld('R', out);
      default:
        return c.chest(out);
    }
  }

  private trailLimb(c: Combatant, limb: Limb, dur: number): void {
    const limbs: Limb[] = limb === 'both' ? ['handL', 'handR'] : limb === 'body' ? ['footR'] : [limb];
    const col = c.form.tier > 0 ? new THREE.Color(c.form.auraColor).multiplyScalar(1.3) : new THREE.Color('#dff1ff').multiplyScalar(1.1);
    for (const l of limbs) {
      const p = new THREE.Vector3();
      const stop = this.trails.start(() => this.limbPos(c, l, p), col, l.startsWith('foot') ? 0.16 : 0.12, 0.14);
      this.later(dur, stop);
    }
  }

  /* ------------------------------------------------------------------ events */

  private onEvent(e: CombatEvent): void {
    switch (e.type) {
      case 'hit': {
        const d = e.def;
        const col = e.res.blocked ? KI : d.ki ? this.kiColor(e.attacker).clone() : e.res.crit ? new THREE.Color('#ffe08a') : d.tier >= 3 ? GOLD : WHITE;
        const size = 0.7 + d.tier * 0.45 + (e.res.crit ? 0.5 : 0);
        this.glint(e.point, col, size);
        this.sparks(e.point, e.dir, col, 6 + d.tier * 6, 10 + d.tier * 5, 0.85, 0.05 + d.tier * 0.012);
        if (d.tier >= 2) this.waves.air(e.point, e.dir, 0.9 + d.tier * 0.45, _c.copy(col).multiplyScalar(1.2), 0.22 + d.tier * 0.04, 0.9);
        if (d.tier >= 3) this.waves.shell(e.point, 1 + d.tier * 0.35, _c.copy(col).multiplyScalar(1.2), 0.25, 0.7);
        if (d.ki) this.ki.crawl(e.target, this.kiColor(e.attacker).clone(), 0.3, 2);
        if (d.tier >= 3 && e.target.move === 'ground') this.dustRing(e.target.pos, 1.4, 8, 4);
        if (e.res.stunned) {
          // Stun break: big gold star burst.
          this.glint(e.target.chest(_v), GOLD, 3.2, 0.35);
          this.waves.shell(e.target.chest(_v), 2.5, GOLD, 0.4, 1);
        }
        break;
      }
      case 'block':
        this.glint(e.point, KI, 1.1);
        this.sparks(e.point, _v.subVectors(e.attacker.pos, e.who.pos).normalize(), KI, 12, 9, 1.0, 0.045);
        this.waves.air(e.point, _v.subVectors(e.attacker.pos, e.who.pos).normalize(), 1.1, _c.copy(KI).multiplyScalar(1.3), 0.25, 0.9);
        break;
      case 'parry':
        this.glint(e.point, GOLD, 3.4, 0.3);
        this.sparks(e.point, _v.subVectors(e.attacker.pos, e.who.pos).setY(0.3).normalize(), GOLD, 36, 18, 1.2, 0.07);
        this.waves.air(e.point, _v.subVectors(e.attacker.pos, e.who.pos).normalize(), 2.6, _c.copy(GOLD).multiplyScalar(1.6), 0.35, 1, 0.1);
        this.waves.shell(e.point, 2, _c.copy(GOLD).multiplyScalar(1.4), 0.3, 1);
        break;
      case 'guardBreak':
        for (let i = 0; i < 18 * this.q; i++) {
          this.add.emit({ pos: e.who.chest(_v), vel: _v2.randomDirection().multiplyScalar(6 + Math.random() * 6), life: 0.5, size: 0.12, color: _c.copy(KI).multiplyScalar(2), shape: Shape.Chip, spin: 10, gravity: 12 });
        }
        this.waves.shell(e.who.chest(_v), 1.8, KI, 0.3, 1);
        break;
      case 'flash': {
        const def = e.who.action ? ATTACKS[e.who.action.clip.name] : undefined;
        const p = this.limbPos(e.who, def?.limb ?? 'handR', new THREE.Vector3());
        const col = e.color === 'red' ? RED : GOLD;
        this.glint(p, col, 1.8, 0.32);
        this.add.emit({ pos: p, life: 0.3, size: 0.4, size1: 2.6, color: _c.copy(col).multiplyScalar(2), shape: Shape.Ring });
        break;
      }
      case 'perfectDodge': {
        this.ghosts.spawn(e.who.char, '#cfe6ff', 0.9, 1.2);
        this.glint(e.pos, WHITE, 2.4, 0.4);
        this.waves.shell(e.pos, 2.2, _c.set('#bfe0ff'), 0.6, 0.8);
        this.waves.ground(e.who.pos, 4, _c.set('#cfe6ff'), 0.7, 0.8);
        break;
      }
      case 'stun':
        this.glint(e.who.chest(_v), GOLD, 2.6, 0.4);
        break;
      case 'death':
        this.glint(e.who.chest(_v), WHITE, 2.4, 0.35);
        break;
      case 'slam':
        this.dustRing(e.pos, 2.4, 18, 7, 0.45);
        this.waves.ground(e.pos, 4, DUST, 0.55, 0.7);
        this.debris.burst(e.pos, 10, 6, 0.22, '#6f6253');
        break;
      case 'bodyfall':
        this.dustRing(e.pos, 1.4, 10, 3.5, 0.32);
        break;
      case 'boltSpawn':
        this.ki.spawnBolt(e.bolt);
        break;
      case 'boltImpact':
        this.ki.impactBolt(e.bolt, e.pos, e.normal, e.target);
        break;
      case 'beamStart':
        this.ki.startBeam(e.beam);
        break;
      case 'beamEnd':
        this.ki.endBeam(e.beam);
        break;
      case 'blast': {
        const g = this.world ? this.world.terrainHeight(e.pos.x, e.pos.z) : 0;
        if (e.def.id === 'burst') break;
        this.explosion(e.pos, Math.max(1.5, e.radius * 0.7), e.def.ki ? this.kiColor(e.who).clone() : GOLD, e.pos.y - g < e.radius);
        break;
      }
      case 'crater': {
        this.debris.burst(e.pos, Math.round(8 + e.radius * 7), 5 + e.radius * 2.2, 0.1 + e.radius * 0.03, '#8a7d6c');
        // Shattered boulders burst into big chunks and dust.
        for (const r of e.rocks) {
          const rp = new THREE.Vector3(r.x, r.y + r.s * 0.4, r.z);
          this.debris.burst(rp, Math.round(8 + r.s * 10), 4 + r.s * 2, 0.15 + r.s * 0.18, '#8c8578', 0.8);
          this.dustRing(rp, r.s * 1.5, 8, 4, 0.4);
        }
        this.dustRing(e.pos, e.radius * 1.2, 22, e.radius * 2.8, 0.5);
        this.waves.ground(e.pos, e.radius * 2.6, _c.set('#ffcf8a'), 0.6, 0.8);
        for (let i = 0; i < 10 * this.q; i++) {
          this.alpha.emit({ pos: _v.copy(e.pos).add(_v2.randomDirection().multiplyScalar(e.radius * 0.6)).setY(e.pos.y + 0.3), vel: _v2.randomDirection().multiplyScalar(2).setY(3 + Math.random() * 3), life: 1.6 + Math.random(), size: e.radius * 0.4, size1: e.radius * 1.3, color: DUST, alpha: 0.5, shape: Shape.Smoke, drag: 1.4 });
        }
        break;
      }
      case 'anim':
        this.onAnim(e.who, e.name, e.data);
        break;
    }
  }

  private onAnim(who: Combatant, name: string, data?: Record<string, unknown>): void {
    switch (name) {
      case 'step': {
        const p = data?.pos as THREE.Vector3 | undefined;
        if (!p) break;
        if (data?.water) this.splash(p, 0.45);
        else if (Number(data?.dust ?? 0) > 0) {
          this.alpha.emit({ pos: p, vel: _v.set((Math.random() - 0.5) * 0.8, 0.7, (Math.random() - 0.5) * 0.8), life: 0.7, size: 0.3, size1: 1.1, color: DUST, alpha: 0.28, shape: Shape.Smoke, drag: 2 });
        }
        break;
      }
      case 'land': {
        const p = (data?.pos as THREE.Vector3) ?? who.pos;
        if (data?.water) this.splash(p, data?.hard ? 1.6 : 0.9);
        else if (data?.hard) {
          this.dustRing(p, 2.4, 20, 8, 0.5);
          this.waves.ground(p, 5, DUST, 0.6, 0.8);
          this.debris.burst(p, 8, 5, 0.18, '#6c5f50');
        } else this.dustRing(p, 1, 8, 2.4, 0.25);
        break;
      }
      case 'jump':
        if (data?.water) this.splash(who.pos, 0.6);
        else this.dustRing(who.pos, 0.8, 6, 2, 0.22);
        break;
      case 'dash': {
        const dir = (data?.dir as THREE.Vector3) ?? who.forward();
        this.ghosts.spawn(who.char, who.form.tier > 0 ? who.form.auraColor : '#bfe0ff', 0.28, 0.9);
        this.later(0.06, () => this.ghosts.spawn(who.char, who.form.tier > 0 ? who.form.auraColor : '#bfe0ff', 0.24, 0.6));
        for (let i = 0; i < 8 * this.q; i++) {
          const p = _v.copy(who.pos).add(_v2.set((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8));
          this.add.emit({ pos: p, vel: _v2.copy(dir).multiplyScalar(-20 - Math.random() * 12), life: 0.16, size: 0.025, color: _c.set('#e6f4ff').multiplyScalar(1.6), shape: Shape.Spark, stretch: 0.04 });
        }
        if (!data?.air) this.dustRing(who.pos, 0.9, 6, 2.5, 0.25);
        break;
      }
      case 'flight':
        if (data?.on) {
          this.waves.ground(who.pos, 3, _c.copy(this.kiColor(who)), 0.5, 0.8);
          this.dustRing(who.pos, 1.6, 12, 6, 0.35);
        }
        break;
      case 'boost': {
        const dir = (data?.dir as THREE.Vector3) ?? who.forward();
        this.waves.sonicCone(who.chest(_v), dir, 2.4, _c.set('#e8f6ff'), 0.45);
        this.waves.air(who.chest(_v), dir, 2.8, _c.set('#e8f6ff'), 0.4, 0.9);
        this.ghosts.spawn(who.char, who.form.tier > 0 ? who.form.auraColor : '#bfe0ff', 0.4, 1);
        break;
      }
      case 'vanish': {
        const from = data?.from as THREE.Vector3 | undefined;
        const to = data?.to as THREE.Vector3 | undefined;
        this.ghosts.spawn(who.char, '#e8f2ff', 0.45, 1.2);
        if (from) {
          this.glint(_v.copy(from).setY(from.y + 1.1), WHITE, 1.6, 0.2);
          this.waves.shell(_v.copy(from).setY(from.y + 1), 1.6, WHITE, 0.25, 0.8);
        }
        if (to) this.glint(_v.copy(to).setY(to.y + 1.1), WHITE, 2.2, 0.22);
        break;
      }
      case 'whoosh': {
        const clip = String(data?.clip ?? '');
        const def = ATTACKS[clip];
        if (def) this.trailLimb(who, def.limb, 0.2);
        else if (clip === 'rush') this.trailLimb(who, 'both', 0.15);
        break;
      }
      case 'rushHit':
        this.trailLimb(who, data?.hand === 'L' ? 'handL' : 'handR', 0.08);
        break;
      case 'kiGather':
        for (const s of ['L', 'R'] as const) this.add.emit({ pos: who.char.handWorld(s, _v), life: 0.2, size: 0.3, size1: 0.9, color: _c.copy(this.kiColor(who)).multiplyScalar(2), shape: Shape.Glow });
        break;
      case 'palmBurst': {
        const p = who.char.handWorld('L', _v).add(who.char.handWorld('R', _v2)).multiplyScalar(0.5);
        const f = who.forward(_v2);
        const col = this.kiColor(who).clone();
        this.add.emit({ pos: p, life: 0.18, size: 2.4, size1: 0.6, color: WHITE.clone().multiplyScalar(2.6), shape: Shape.Glow });
        this.add.emit({ pos: p, life: 0.3, size: 1.8, size1: 3.2, color: col.clone().multiplyScalar(2), shape: Shape.Glow });
        this.waves.air(p, f, 2.2, col.clone().multiplyScalar(1.5), 0.3, 1);
        this.sparks(p, f, col, 20, 16, 0.6, 0.06);
        for (let i = 0; i < 3; i++) this.lightning.add({ from: p, to: _v.copy(p).addScaledVector(f, 1.5 + Math.random()).add(_v2.randomDirection().multiplyScalar(0.6)), color: col.clone().multiplyScalar(1.5), width: 0.04, life: 0.12, jag: 0.25, segments: 8 });
        break;
      }
      case 'dragonRise': {
        this.trailLimb(who, 'handR', 0.4);
        this.add.emit({ pos: who.char.handWorld('R', _v), life: 0.4, size: 0.8, size1: 2.2, color: _c.set('#ffcf6a').multiplyScalar(2), shape: Shape.Glow });
        this.dustRing(who.pos, 1.4, 10, 5, 0.35);
        break;
      }
      case 'dragonFist': {
        const p = who.char.handWorld('R', _v).clone();
        const f = who.forward(_v2).clone();
        const charge = Number(data?.charge ?? 0);
        const col = who.form.tier > 0 ? new THREE.Color(who.form.auraColor) : new THREE.Color('#ffd27a');
        for (let i = 0; i < 4; i++) {
          this.later(i * 0.03, () => this.waves.air(_v.copy(p).addScaledVector(f, i * 1.6), f, 1.6 + i * 0.7 + charge, col.clone().multiplyScalar(1.6), 0.35, 1 - i * 0.15, 0.09));
        }
        this.add.emit({ pos: p, life: 0.2, size: 3, size1: 1, color: WHITE.clone().multiplyScalar(2.8), shape: Shape.Glow });
        this.sparks(p, f, col, 30, 26, 0.35, 0.08);
        const g = this.world ? this.world.terrainHeight(p.x, p.z) : 0;
        for (let i = 0; i < 6; i++) {
          const gp = _v.copy(who.pos).addScaledVector(f, 1 + i * 1.3);
          gp.y = g;
          const at = gp.clone();
          this.later(i * 0.025, () => this.dustRing(at, 1 + i * 0.2, 4, 4, 0.35));
        }
        break;
      }
      case 'exSpecial':
        this.glint(who.chest(_v), GOLD, 2.4, 0.3);
        break;
      case 'meteorImpact':
        this.add.emit({ pos: who.pos, life: 0.25, size: 6, size1: 2, color: WHITE.clone().multiplyScalar(3), shape: Shape.Glow });
        break;
      case 'transformCharge':
        this.waves.shell(who.chest(_v), 3, _c.set(who.form.auraColor), 0.5, 0.6);
        break;
      case 'transformBurst': {
        const t = this.tracked.get(who);
        if (t) t.aura.setForm(who.form);
        const c = who.chest(new THREE.Vector3());
        const col = new THREE.Color(who.form.auraColor);
        this.add.emit({ pos: c, life: 0.35, size: 14, size1: 4, color: WHITE.clone().multiplyScalar(3), shape: Shape.Glow });
        this.waves.shell(c, 14, col.clone().multiplyScalar(1.6), 0.9, 1);
        this.waves.shell(c, 7, WHITE.clone().multiplyScalar(1.4), 0.5, 1);
        this.waves.ground(who.pos, 18, col.clone().multiplyScalar(1.3), 0.9, 1, 0.06);
        this.waves.ground(who.pos, 10, WHITE, 0.6, 0.8, 0.05);
        this.waves.air(c, _v.set(0, 1, 0), 9, col.clone().multiplyScalar(1.4), 0.6, 0.9);
        this.dustRing(who.pos, 5, 30, 16, 0.55);
        this.debris.burst(who.pos, 36, 12, 0.11, '#8a7d6c');
        this.sparks(c, _v.set(0, 0.4, 0), col, 50, 30, 1.6, 0.1);
        for (let i = 0; i < 10; i++) {
          const to = _v.copy(c).add(_v2.randomDirection().multiplyScalar(4 + Math.random() * 4));
          this.lightning.add({ from: c, to, color: col.clone().multiplyScalar(1.6), width: 0.07, life: 0.25 + Math.random() * 0.2, jag: 0.2, segments: 14, branches: 2, regen: 0.04 });
        }
        break;
      }
      case 'revert': {
        const t = this.tracked.get(who);
        if (t) t.aura.setForm(who.form);
        this.waves.shell(who.chest(_v), 2.4, WHITE, 0.4, 0.6);
        break;
      }
      case 'perfectDodge':
        break;
      case 'ultimate':
        this.waves.shell(who.chest(_v), 4, _c.set('#bfe6ff'), 0.6, 0.8);
        break;
      case 'thunderStrike': {
        const from = data?.from as THREE.Vector3;
        const to = data?.to as THREE.Vector3;
        if (!from || !to) break;
        const col = who.form.tier > 0 ? new THREE.Color(who.form.lightningColor) : new THREE.Color('#9fe0ff');
        for (let i = 0; i < 5; i++) {
          const end = to.clone().add(_v2.randomDirection().multiplyScalar(i === 0 ? 0 : 1.2));
          this.lightning.add({ from, to: end, color: col.clone().multiplyScalar(2), width: i === 0 ? 0.26 : 0.1, life: 0.45, jag: 0.12, segments: 18, branches: 3, regen: 0.035 });
        }
        // A second strike straight down from the sky.
        const sky = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 40, (Math.random() - 0.5) * 6));
        this.lightning.add({ from: sky, to, color: col.clone().multiplyScalar(2.2), width: 0.3, life: 0.4, jag: 0.1, segments: 26, branches: 4, regen: 0.04 });
        this.glint(from, WHITE, 2.6, 0.25);
        this.ki.crawl(this.tracked.get(who)?.hero ?? who, col, 0.5, 4);
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number, realDt: number, camera: THREE.Camera): void {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    for (const t of this.tracked.values()) this.updateHero(t, dt);
    this.add.update(dt);
    this.alpha.update(dt);
    this.lightning.update(realDt, camera);
    this.trails.update(dt, camera);
    this.ghosts.update(realDt);
    this.waves.update(dt);
    this.debris.update(dt);
    this.ki.update(dt);
  }

  private updateHero(t: Tracked, dt: number): void {
    const h = t.hero;
    const a = t.aura;
    if (!h.alive) {
      a.target = 0;
      a.charging = 0;
      a.update(dt, h.vel, h.move === 'ground');
      return;
    }
    const speed = h.vel.length();
    const boosting = h.flying && speed > h.flySpeed * 1.4;
    let level = h.form.tier > 0 ? 0.3 : 0;
    if (h.power === 'powerup') level = Math.max(level, 0.85);
    if (h.power === 'burst') level = 1;
    if (boosting) level = Math.max(level, 0.6);
    const act = h.actionName;
    if (act === 'beam_charge' || act === 'heavy_charge' || act === 'ultimate') level = Math.max(level, 0.6);
    if (act === 'ex_special') level = Math.max(level, 0.5);
    a.target = level;
    a.charging = h.power === 'charging' ? 1 : 0;
    a.update(dt, h.vel, h.move === 'ground');
    // Charge ball between the hands for beams / Ultimate / Dragon Fist.
    if (act === 'beam_charge' || (act === 'ultimate' && h.action && h.action.time < 1.65)) {
      const p = h.char.handWorld('L', _v).add(h.char.handWorld('R', _v2)).multiplyScalar(0.5);
      const k = act === 'ultimate' ? Math.min(1, (h.action?.time ?? 0) / 1.5) : Math.min(1, (h.action?.time ?? 0) / 1.6);
      const col = this.kiColor(h).clone();
      this.add.emit({ pos: p, life: 0.05, size: 0.35 + k * (act === 'ultimate' ? 1.6 : 0.9), color: col.clone().multiplyScalar(2.6), shape: Shape.Glow });
      this.add.emit({ pos: p, life: 0.05, size: 0.15 + k * 0.4, color: WHITE.clone().multiplyScalar(3), shape: Shape.Glow });
      t.chargeAcc += dt * (20 + k * 30) * this.q;
      while (t.chargeAcc >= 1) {
        t.chargeAcc -= 1;
        // Motes spiralling inward.
        const from = _v2.randomDirection().multiplyScalar(1.4 + Math.random()).add(p);
        this.add.emit({ pos: from, vel: _v.subVectors(p, from).multiplyScalar(3.5), life: 0.28, size: 0.04, color: col.clone().multiplyScalar(2.5), shape: Shape.Spark, stretch: 0.05 });
      }
      if (Math.random() < dt * (6 + k * 12)) this.lightning.add({ from: p, to: _v.randomDirection().multiplyScalar(0.4 + k * 0.6).add(p), color: col.clone().multiplyScalar(1.6), width: 0.025, life: 0.06, jag: 0.3, segments: 6 });
    } else if (act === 'heavy_charge') {
      const p = h.char.handWorld('R', _v);
      this.add.emit({ pos: p, life: 0.05, size: 0.5, color: _c.set('#ffcf6a').multiplyScalar(2.2), shape: Shape.Glow });
    }
    // Boost: afterimage trail.
    if (boosting) {
      t.boostAcc += dt;
      if (t.boostAcc > 0.07) {
        t.boostAcc = 0;
        this.ghosts.spawn(h.char, h.form.tier > 0 ? h.form.auraColor : '#cfe6ff', 0.3, 0.55);
      }
    }
    // Transformation charge: lightning strikes from the sky and glowing cracks around the feet.
    if (h.power === 'charging' && this.world) {
      t.skyAcc += dt;
      if (t.skyAcc > 0.35) {
        t.skyAcc = 0;
        const a2 = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 8;
        const gx = h.pos.x + Math.cos(a2) * r;
        const gz = h.pos.z + Math.sin(a2) * r;
        const gy = this.world.terrainHeight(gx, gz);
        const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 10, gy + 45, gz + (Math.random() - 0.5) * 10);
        this.lightning.add({ from: top, to: new THREE.Vector3(gx, gy, gz), color: _c.set(h.form.tier >= 1 || a.lightningOn ? '#bfe6ff' : '#dfefff').multiplyScalar(2), width: 0.22, life: 0.16, jag: 0.12, segments: 22, branches: 3, regen: 0.04 });
        this.glint(new THREE.Vector3(gx, gy + 0.3, gz), WHITE, 2.4, 0.2);
        this.world.data.scorch(gx, gz, 1.2, 0.5);
      }
      if (Math.random() < dt * 4) this.world.data.scorch(h.pos.x + (Math.random() - 0.5) * 3, h.pos.z + (Math.random() - 0.5) * 3, 1.6, 0.25);
    }
  }
}
