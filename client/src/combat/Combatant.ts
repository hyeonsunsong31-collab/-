import * as THREE from 'three';
import { BuffSet, COMBAT, FORMS, deriveStats, powerLevel, type Derived, type FormDef, type Stats } from '@ak/shared';
import { Fighter } from '../gameplay/Fighter.ts';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import type { AttackDef } from './attacks.ts';
import type { CombatSystem } from './CombatSystem.ts';

export type Team = 'hero' | 'foe';
export type BodyState = 'normal' | 'hurt' | 'airborne' | 'down' | 'getup' | 'stun' | 'dead' | 'guardbreak';

export interface HitInfo {
  attacker: Combatant;
  def: AttackDef;
  /** World-space impact point (sparks, decals). */
  point: THREE.Vector3;
  /** Horizontal push direction (attacker → target, unit). */
  dir: THREE.Vector3;
  /** Extra damage scale (charged beams, chain finishers). */
  scale?: number;
}

export interface HitResult {
  dmg: number;
  crit: boolean;
  blocked: boolean;
  parried: boolean;
  guardBroken: boolean;
  killed: boolean;
  stunned: boolean;
  /** Took damage without flinching (super armor / poise). */
  armored: boolean;
}

const _v = new THREE.Vector3();

/**
 * A fighter that takes part in combat: stats, HP, Daze/Stun, guard, Energy, Ki, Surge, stacking buffs,
 * forms, telegraph flashes and the whole hit-reaction state machine (flinch, stagger, launch/juggle, knockdown,
 * spike, down, kip-up, stun wobble, guard break, death).
 */
export class Combatant extends Fighter {
  name: string;
  team: Team;
  level = 1;
  stats: Stats;
  derived: Derived;
  form: FormDef = FORMS[0];
  hp: number;
  daze = 0;
  dazeMax = 100;
  stunTimer = 0;
  guard: number = COMBAT.guardMax;
  energy = 0;
  ki = 0;
  surge = 0;
  readonly buffs = new BuffSet();
  state: BodyState = 'normal';
  /** Resistance to flinching (1 = flinches from everything, 3 = super armor vs everything but finishers). */
  basePoise = 1;
  combat: CombatSystem | null = null;
  /** Telegraph glint before an enemy attack lands (gold = parryable, red = dodge only). */
  flash: 'gold' | 'red' | null = null;
  flashTimer = 0;
  /** Seconds since the last dash started (perfect-dodge timing). */
  dashAge = 9;
  /** Guard (RMB) held and the time it was raised (perfect-parry timing). */
  guarding = false;
  guardAge = 9;
  /** Brief invulnerability after getting up / respawning. */
  invulnTimer = 0;
  private downTimer = 0;
  private hurtAlt = false;
  /** Seconds since this combatant last took damage. */
  sinceHit = 99;
  /** Dissolve progress after death (0..1), drives removal. */
  dissolve = 0;
  /** Whether hits on this combatant may push it around at all (training post, bosses mid-ultimate…). */
  movable = true;
  /** Heroes (player, rival) can perfect-dodge; one trigger per dash. */
  canPerfectDodge = false;
  perfectDodged = false;
  /** Damage scale applied to the current melee action (charged Dragon Fist). */
  attackScale = 1;
  /** Swap the attack data used by a clip (chain-attack finishers reuse regular clips). */
  defOverride: Record<string, string> | null = null;

  constructor(char: Character, world: World, name: string, team: Team, level: number, stats: Stats) {
    super(char, world);
    this.name = name;
    this.team = team;
    this.level = level;
    this.stats = stats;
    this.derived = deriveStats(stats, level);
    this.hp = this.derived.maxHp;
    this.ki = this.derived.maxKi;
  }

  setStats(level: number, stats: Stats, heal = true): void {
    const frac = this.hp / this.maxHp;
    this.level = level;
    this.stats = stats;
    this.derived = deriveStats(stats, level);
    this.hp = heal ? this.maxHp : Math.max(1, Math.round(this.maxHp * frac));
    this.ki = Math.min(this.ki, this.derived.maxKi);
  }

  get maxHp(): number {
    return this.derived.maxHp;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get stunned(): boolean {
    return this.stunTimer > 0;
  }

  get poise(): number {
    let p = this.basePoise;
    if (this.actionWindow('armor')) p = Math.max(p, 3);
    return p;
  }

  /** i-frames from clips (dash, EX, getup) or timers. */
  get invulnerable(): boolean {
    return this.state === 'dead' || this.invulnTimer > 0 || this.actionWindow('iframes');
  }

  /** Can act on its own (not reeling, downed, stunned or dead). */
  get canAct(): boolean {
    return this.state === 'normal';
  }

  /** Live power level including form and buffs (shown on nameplates). */
  get powerLevel(): number {
    const buffMult = 1 + this.buffs.total('atkPct') + this.buffs.total('dmgPct') * 0.5;
    return powerLevel(this.stats, this.form.plMult, buffMult);
  }

  get atk(): number {
    return this.derived.atk * (1 + this.buffs.total('atkPct'));
  }

  get kiAtk(): number {
    return this.derived.kiAtk * (1 + this.buffs.total('atkPct'));
  }

  get def(): number {
    return this.derived.def * (1 + this.buffs.total('defPct'));
  }

  get critRate(): number {
    return this.derived.critRate + this.buffs.total('critRate');
  }

  get critDmg(): number {
    return this.derived.critDmg + this.buffs.total('critDmg');
  }

  /** Movement/attack speed multiplier from AGI, form and buffs. */
  get speed(): number {
    return this.derived.moveSpeed * this.form.speedMult * (1 + this.buffs.total('moveSpdPct'));
  }

  startFlash(color: 'gold' | 'red', lead: number = COMBAT.flashLead): void {
    this.flash = color;
    this.flashTimer = lead;
    this.combat?.emit({ type: 'flash', who: this, color });
  }

  /* ------------------------------------------------------------------ hooks */

  /** An attack was perfect-dodged (counter window opens for heroes). */
  onPerfectDodge(_attacker: Combatant): void {}

  /** This combatant perfectly parried `attacker`. */
  onParry(_attacker: Combatant): void {}

  /** A hit was absorbed by the guard. */
  onBlocked(_attacker: Combatant, _def: AttackDef): void {
    if (this.actionName === 'guard' || this.actionName === 'guard_hit' || !this.busy) this.playAction('guard_hit', { fadeIn: 0.03, fadeOut: 0.1 });
  }

  /** Guard shattered: stagger open. */
  onGuardBreak(_attacker: Combatant): void {
    this.guarding = false;
    this.playAction('guard_break', { fadeIn: 0.03, fadeOut: 0.2 });
    this.state = 'guardbreak';
  }

  /* ------------------------------------------------------------------ hits */

  /** Apply an already-computed hit: HP, Daze, reaction. Called by the CombatSystem. */
  applyHit(h: HitInfo, dmg: number, daze: number, res: HitResult): void {
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHit = 0;
    this.char.hitFlash = 0.9;
    this.buffs.remove('momentum');
    if (this.hp <= 0) {
      res.killed = true;
      this.die(h);
      return;
    }
    // Zenkai: pushed to the brink.
    if (this.hp < this.maxHp * 0.3) this.buffs.add('zenkai');
    if (!this.stunned) {
      this.daze = Math.min(this.dazeMax, this.daze + daze * (1 + this.buffs.total('dazeTakenPct')));
      if (this.daze >= this.dazeMax) {
        res.stunned = true;
        this.enterStun();
      }
    }
    const def = h.def;
    const finisher = def.kind === 'launch' || def.kind === 'knockdown' || def.kind === 'spike';
    // Stunned (ZZZ): the foe reels in place and soaks everything until the daze wears off.
    if (this.stunned && this.move === 'ground') return;
    if (def.poise <= this.poise && !(finisher && this.poise < 3)) {
      res.armored = true;
      return;
    }
    this.react(h);
  }

  private enterStun(): void {
    this.stunTimer = COMBAT.stunDuration;
    this.combat?.emit({ type: 'stun', who: this });
    if (this.move === 'ground' && this.state !== 'down') this.playReaction('stun', { fadeIn: 0.1 });
    this.state = this.move === 'ground' ? 'stun' : this.state;
  }

  protected playReaction(name: string, opts: { fadeIn?: number; hold?: boolean; speed?: number } = {}): void {
    this.playAction(name, { fadeIn: opts.fadeIn ?? 0.04, fadeOut: 0.18, hold: opts.hold, speed: opts.speed });
  }

  private react(h: HitInfo): void {
    const def = h.def;
    const airborne = this.move !== 'ground';
    this.jumpReset();
    const toAtt = _v.copy(h.attacker.pos).sub(this.pos).setY(0);
    const front = toAtt.lengthSq() < 1e-4 || toAtt.normalize().dot(this.forward(new THREE.Vector3())) > -0.2;
    if (this.movable) this.knock.copy(h.dir).setY(0).multiplyScalar(def.knock);
    switch (def.kind) {
      case 'light':
        if (airborne) {
          // Juggle: keep them floating in front of the attacker.
          this.vel.y = Math.max(this.vel.y, def.lift || 1.5);
          this.floatTimer = 0.32;
          this.state = 'airborne';
          this.playReaction('launch', { hold: true });
        } else {
          if (front) this.yaw = Math.atan2(toAtt.x, toAtt.z);
          this.hurtAlt = !this.hurtAlt;
          this.playReaction(front ? (this.hurtAlt ? 'hit_f' : 'hit_f2') : 'hit_b');
          this.state = 'hurt';
        }
        break;
      case 'heavy':
        if (airborne) {
          this.vel.y = Math.max(this.vel.y, 2.5);
          this.floatTimer = 0.2;
          this.state = 'airborne';
          this.playReaction('launch', { hold: true });
        } else {
          if (front) this.yaw = Math.atan2(toAtt.x, toAtt.z);
          this.playReaction(front ? 'hit_heavy' : 'hit_b');
          this.state = 'hurt';
        }
        break;
      case 'launch':
      case 'knockdown':
      case 'spike': {
        this.yaw = Math.atan2(toAtt.x, toAtt.z);
        const lift = def.lift;
        if (this.movable && (lift !== 0 || airborne)) {
          if (this.move === 'fly') this.move = 'air';
          if (this.move === 'ground') {
            this.move = 'air';
            this.grounded = false;
            this.pos.y += 0.05;
          }
          this.vel.y = lift;
          this.floatTimer = def.kind === 'launch' ? 0.18 : 0;
          this.state = 'airborne';
          this.spiked = def.kind === 'spike';
          this.playReaction('launch', { hold: true });
        } else {
          this.playReaction('knockdown');
          this.state = 'down';
          this.downTimer = 1.1;
        }
        break;
      }
    }
  }

  private spiked = false;

  /** Hook for subclasses to cancel jumps/flight state when hit. */
  protected jumpReset(): void {}

  protected die(h: HitInfo): void {
    this.state = 'dead';
    this.stunTimer = 0;
    this.guarding = false;
    this.knock.copy(h.dir).setY(0).multiplyScalar(Math.max(4, h.def.knock));
    if (this.move !== 'ground') {
      if (this.move === 'fly') this.move = 'air';
      this.vel.y = Math.max(this.vel.y, 4);
      this.playReaction('launch', { hold: true });
    } else {
      this.yaw = this.yawTo(h.attacker.pos);
      this.playAction('death', { fadeIn: 0.05, hold: true });
    }
    this.combat?.emit({ type: 'death', who: this, by: h.attacker });
  }

  protected override onLand(impact: number): void {
    if (this.state === 'airborne' || this.state === 'dead') {
      if (this.spiked && impact > 8) {
        // Bounce off the ground once.
        this.spiked = false;
        this.combat?.emit({ type: 'slam', who: this, pos: this.pos.clone(), power: impact });
        this.move = 'air';
        this.grounded = false;
        this.vel.y = 5.5;
        this.pos.y += 0.05;
        return;
      }
      this.spiked = false;
      this.combat?.emit({ type: 'bodyfall', who: this, pos: this.pos.clone(), power: impact });
      if (this.state === 'dead') {
        this.playAction('knockdown', { fadeIn: 0.05, hold: true });
        return;
      }
      this.playReaction('knockdown', { fadeIn: 0.04 });
      this.state = 'down';
      this.downTimer = this.stunned ? 0.4 : 0.95;
      return;
    }
    this.landed(impact);
  }

  /** Normal (non-reaction) landing; heroes override. */
  protected landed(_impact: number): void {}

  /* ------------------------------------------------------------------ update */

  /** Per-frame combat bookkeeping; call before movement integration. */
  updateCombat(dt: number): void {
    this.buffs.update(dt);
    this.sinceHit += dt;
    this.dashAge += dt;
    if (this.guarding) this.guardAge += dt;
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    // Gauges.
    if (this.alive) {
      this.energy = Math.min(COMBAT.energyMax, this.energy + COMBAT.energyRegen * this.derived.energyRegen * dt);
      this.ki = Math.min(this.derived.maxKi, this.ki + (this.guarding ? 4 : 10) * dt);
      if (!this.guarding) this.guard = Math.min(COMBAT.guardMax, this.guard + 22 * dt);
      if (this.sinceHit > 4 && !this.stunned) this.daze = Math.max(0, this.daze - 6 * dt);
    }
    // Telegraph glow.
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= -0.12) this.flash = null;
    }
    // Stun.
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.state === 'normal' || this.state === 'hurt') {
        if (this.move === 'ground' && this.actionName !== 'stun') this.playReaction('stun', { fadeIn: 0.15 });
        this.state = 'stun';
      }
      if (this.stunTimer <= 0) {
        this.stunTimer = 0;
        this.daze = 0;
        if (this.state === 'stun') {
          this.stopAction(0.3);
          this.state = 'normal';
        }
      }
    }
    // Reaction state machine.
    switch (this.state) {
      case 'hurt':
      case 'guardbreak':
        if (this.actionDone) {
          this.stopAction(0.15);
          this.state = 'normal';
        }
        break;
      case 'down':
        if (this.actionDone && this.actionName === 'knockdown') this.playAction('down', { fadeIn: 0.2 });
        this.downTimer -= dt;
        if (this.downTimer <= 0 && this.alive) {
          this.playAction('getup', { fadeIn: 0.12, fadeOut: 0.2 });
          this.state = 'getup';
        }
        break;
      case 'getup':
        if (this.actionDone || this.actionWindow('cancel')) {
          this.stopAction(0.2);
          this.state = this.stunned ? 'stun' : 'normal';
          this.invulnTimer = 0.3;
        }
        break;
      case 'dead':
        if (this.move === 'ground' && this.actionDone) this.dissolve = Math.min(1, this.dissolve + dt * 0.25);
        break;
    }
  }
}
