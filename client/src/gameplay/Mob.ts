import * as THREE from 'three';
import { distributePoints, type StatKey } from '@ak/shared';
import { Combatant } from '../combat/Combatant.ts';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import * as Looks from '../character/Looks.ts';
import type { Look } from '../character/Looks.ts';
import { ATTACKS } from '../combat/attacks.ts';
import type { MoveIntent } from './Fighter.ts';

export type MobKindId = 'brigand' | 'knight' | 'imp' | 'golem' | 'warlock';

export interface MobAttack {
  clip: string;
  /** Distance band (m, scaled by the mob's size) in which the attack is chosen. */
  min: number;
  max: number;
  weight: number;
  cooldown: number;
  /** Chance to chain straight into another clip on the combo window. */
  follow?: { clip: string; chance: number };
}

export interface MobKind {
  id: MobKindId;
  name: string;
  look: Look;
  loco: { idle: string; walk: string; run: string; walkSpeed: number; runSpeed: number };
  /** Upper-body overlay keeping the weapon in hand while moving. */
  hold?: string;
  walk: number;
  run: number;
  poise: number;
  dazeMax: number;
  hpMult: number;
  atkMult: number;
  weights: Partial<Record<StatKey, number>>;
  attacks: MobAttack[];
  aggro: number;
  /** Preferred fighting distance (ranged casters keep away). */
  keep: number;
  turn: number;
  /** Raises a shield against frontal attacks. */
  blocks?: boolean;
  /** XP multiplier (tough or rare foes are worth more). */
  xp: number;
}

export const MOB_KINDS: Record<MobKindId, MobKind> = {
  brigand: {
    id: 'brigand',
    name: 'Brigand',
    look: Looks.BRIGAND_LOOK,
    loco: { idle: 'brig_idle', walk: 'walk', run: 'run', walkSpeed: 1.6, runSpeed: 5.5 },
    hold: 'brig_hold',
    walk: 1.6,
    run: 5.6,
    poise: 1,
    dazeMax: 80,
    hpMult: 0.9,
    atkMult: 0.85,
    weights: { str: 2, vit: 1.2, agi: 1, imp: 0.8, ki: 0.3, foc: 0.6 },
    attacks: [
      { clip: 'brig_slash', min: 0, max: 2.6, weight: 3, cooldown: 1.2, follow: { clip: 'brig_backhand', chance: 0.55 } },
      { clip: 'brig_overhead', min: 0, max: 2.8, weight: 1.2, cooldown: 4.5 },
      { clip: 'brig_kick', min: 0, max: 2.0, weight: 1, cooldown: 3 },
    ],
    aggro: 26,
    keep: 2.1,
    turn: 7,
    xp: 1,
  },
  knight: {
    id: 'knight',
    name: 'Iron Knight',
    look: Looks.KNIGHT_LOOK,
    loco: { idle: 'knight_idle', walk: 'walk', run: 'run', walkSpeed: 1.6, runSpeed: 5.5 },
    hold: 'knight_hold',
    walk: 1.5,
    run: 4.8,
    poise: 2,
    dazeMax: 130,
    hpMult: 1.45,
    atkMult: 1,
    weights: { vit: 2, str: 1.6, imp: 1, agi: 0.6, foc: 0.8, ki: 0.3 },
    attacks: [
      { clip: 'knight_slash', min: 0, max: 2.8, weight: 3, cooldown: 1.4, follow: { clip: 'knight_rising', chance: 0.5 } },
      { clip: 'knight_thrust', min: 2.0, max: 4.4, weight: 2, cooldown: 4 },
      { clip: 'knight_bash', min: 0, max: 2.2, weight: 1, cooldown: 3.5 },
    ],
    aggro: 28,
    keep: 2.4,
    turn: 5,
    blocks: true,
    xp: 1.6,
  },
  imp: {
    id: 'imp',
    name: 'Mandrake Imp',
    look: Looks.IMP_LOOK,
    loco: { idle: 'imp_idle', walk: 'walk', run: 'run', walkSpeed: 1.6, runSpeed: 5.5 },
    walk: 1.6,
    run: 6.8,
    poise: 0,
    dazeMax: 50,
    hpMult: 0.5,
    atkMult: 0.7,
    weights: { agi: 2.4, str: 1, foc: 1, imp: 0.6, vit: 0.6, ki: 0.4 },
    attacks: [
      { clip: 'imp_claw', min: 0, max: 1.8, weight: 3, cooldown: 1.0 },
      { clip: 'imp_leap', min: 3.0, max: 7.5, weight: 2, cooldown: 3.2 },
    ],
    aggro: 24,
    keep: 1.6,
    turn: 12,
    xp: 0.6,
  },
  golem: {
    id: 'golem',
    name: 'Stone Golem',
    look: Looks.GOLEM_LOOK,
    loco: { idle: 'golem_idle', walk: 'golem_walk', run: 'golem_walk', walkSpeed: 2.2, runSpeed: 2.2 },
    walk: 2.0,
    run: 3.6,
    poise: 3,
    dazeMax: 260,
    hpMult: 3.2,
    atkMult: 1.25,
    weights: { vit: 2.6, str: 2, imp: 1.4, agi: 0.3, foc: 0.4, ki: 0.3 },
    attacks: [
      { clip: 'golem_slam', min: 0, max: 4.8, weight: 2, cooldown: 4 },
      { clip: 'golem_swipe', min: 0, max: 4.4, weight: 2.5, cooldown: 3 },
      { clip: 'golem_stomp', min: 0, max: 5.5, weight: 1.2, cooldown: 6 },
    ],
    aggro: 30,
    keep: 3.4,
    turn: 2.6,
    xp: 3.5,
  },
  warlock: {
    id: 'warlock',
    name: 'Warlock Templar',
    look: Looks.WARLOCK_LOOK,
    loco: { idle: 'warlock_idle', walk: 'walk', run: 'run', walkSpeed: 1.6, runSpeed: 5.5 },
    hold: 'warlock_hold',
    walk: 1.4,
    run: 4.6,
    poise: 1,
    dazeMax: 90,
    hpMult: 0.8,
    atkMult: 1,
    weights: { ki: 2.6, foc: 1.6, agi: 0.9, vit: 0.8, str: 0.3, imp: 0.6 },
    attacks: [
      { clip: 'warlock_cast', min: 4, max: 26, weight: 3, cooldown: 1.8 },
      { clip: 'warlock_nova', min: 3, max: 16, weight: 1.5, cooldown: 5.5 },
    ],
    aggro: 32,
    keep: 11,
    turn: 6,
    xp: 1.4,
  },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Stats for a mob of a kind at a level: same 5-points-per-level economy as the player, archetype-weighted. */
export function mobStats(kind: MobKind, level: number) {
  const pts = 5 * Math.max(0, level - 1) + 6;
  return distributePoints(pts, kind.weights);
}

/**
 * An enemy: a Combatant with an archetype moveset. The AI writes `intent` (movement), `face` and `want`
 * (attack to start); the mob turns, moves with its own gaits, attacks, blocks and fires its special events
 * (quakes, orbs, runes, self-destruct).
 */
export class Mob extends Combatant {
  readonly kind: MobKind;
  readonly intent: MoveIntent = { dir: new THREE.Vector3(), sprint: false, vertical: 0, flyDir: null, faceYaw: null };
  /** Requested attack (AI → mob); cleared when started. */
  want: string | null = null;
  /** Yaw to face this frame (null = movement direction). */
  face: number | null = null;
  readonly cooldowns = new Map<string, number>();
  target: Combatant | null = null;
  home = new THREE.Vector3();
  /** Seconds the imp has been fizzing before it blows. */
  private bombT = -1;
  private holdOn = false;
  /** Pending warlock rune: world position and countdown. */
  rune: { pos: THREE.Vector3; t: number } | null = null;
  onRune: ((pos: THREE.Vector3, t: number) => void) | null = null;
  /** Seconds since death (for removal). */
  deadT = 0;

  constructor(kind: MobKind, char: Character, world: World, level: number) {
    super(char, world, kind.name, 'foe', level, mobStats(kind, level));
    this.dissolveOnDeath = true;
    char.dissolveColor.set(kind.id === 'imp' ? '#a6ff3a' : kind.id === 'warlock' ? '#c56bff' : kind.id === 'golem' ? '#ffb340' : '#ff7a2e');
    this.kind = kind;
    this.basePoise = kind.poise;
    this.dazeMax = kind.dazeMax;
    this.loco = { ...this.loco, idle: kind.loco.idle, relaxed: kind.loco.idle, walk: kind.loco.walk, run: kind.loco.run, sprint: kind.loco.run, walkSpeed: kind.loco.walkSpeed, runSpeed: kind.loco.runSpeed };
    this.walkSpeed = kind.walk * char.scale;
    this.runSpeed = kind.run * char.scale;
    this.sprintSpeed = kind.run * char.scale;
    this.derived = { ...this.derived, maxHp: Math.round(this.derived.maxHp * kind.hpMult), atk: Math.round(this.derived.atk * kind.atkMult), kiAtk: Math.round(this.derived.kiAtk * kind.atkMult) };
    this.hp = this.derived.maxHp;
    char.animator.setLoco({ [kind.loco.idle]: 1 }, 0);
    char.animator.onEvent((clip, name, data) => this.onAnimEvent(clip, name, data));
  }

  get size(): number {
    return this.char.scale;
  }

  /** Start an attack clip (AI already checked range/cooldown). */
  attack(clip: string): void {
    const spec = this.kind.attacks.find((a) => a.clip === clip);
    this.cooldowns.set(clip, spec?.cooldown ?? 2);
    if (this.target) this.yaw = this.yawTo(this.target.pos);
    this.stopCosmetic(0.05);
    this.guarding = false;
    this.playAction(clip, { fadeIn: 0.1, fadeOut: 0.2 });
    // Attack magnetism (lighter than the hero's): close part of the gap during the lunge.
    const c = this.char.animator.clip(clip);
    if (this.target && c.def.move) {
      const m = c.motionAt(c.dur, [0, 0, 0])[0] * this.size;
      const d = _v.subVectors(this.target.pos, this.pos).setY(0).length();
      const def = ATTACKS[clip];
      const want = d - (def ? def.reach * 0.6 : 1.5) - this.target.radius;
      if (m > 0.1) this.motionScale = THREE.MathUtils.clamp(want / m, 0.2, 1.8);
    }
  }

  startBlock(): void {
    if (this.busy) return;
    this.guarding = true;
    this.guardAge = 1; // mobs block, they never perfect-parry
    this.playAction('knight_block', { fadeIn: 0.12, fadeOut: 0.2 });
  }

  stopBlock(): void {
    if (!this.guarding) return;
    this.guarding = false;
    if (this.actionName === 'knight_block') this.stopAction(0.2);
  }

  /** Imp self-destruct. */
  startBomb(): void {
    this.playAction('imp_bomb', { fadeIn: 0.1 });
    this.bombT = 0;
  }

  private onAnimEvent(_clip: string, name: string, data?: Record<string, unknown>): void {
    const cs = this.combat;
    if (!cs) return;
    switch (name) {
      case 'clawHit':
        cs.meleeBurst(this, 'imp_claw2');
        break;
      case 'quake': {
        // Ground shockwave: launches anyone standing on the ground nearby (jump or dash through it).
        const r = Number(data?.r ?? 6) * this.size * 0.55;
        const at = Number(data?.at ?? 0) * this.size;
        const c = _v.copy(this.pos).addScaledVector(this.forward(_v2), at);
        for (const t of cs.foesOf(this)) {
          if (t.move !== 'ground') continue;
          const d = Math.hypot(t.pos.x - c.x, t.pos.z - c.z);
          if (d > r) continue;
          const dir = _v2.subVectors(t.pos, c).setY(0);
          if (dir.lengthSq() < 1e-4) this.forward(dir);
          cs.resolveHit(this, t, ATTACKS.golem_quake, t.chest(new THREE.Vector3()), 1 - (d / r) * 0.4, dir.normalize());
        }
        cs.emit({ type: 'blast', who: this, pos: c.clone().setY(this.pos.y + 0.2), radius: r, def: ATTACKS.golem_quake });
        cs.crater(c.clone().setY(this.world.terrainHeight(c.x, c.z)), Math.min(4, r * 0.45));
        break;
      }
      case 'groundImpact': {
        const r = Number(data?.r ?? 1.5);
        const tip = this.char.handWorld('R', new THREE.Vector3()).addScaledVector(this.forward(_v2), 0.8 * this.size);
        cs.crater(tip.setY(this.world.terrainHeight(tip.x, tip.z)), r);
        break;
      }
      case 'castOrb': {
        const from = this.char.handWorld('L', new THREE.Vector3());
        const t = this.target;
        const dir = t ? _v.subVectors(t.chest(_v2), from).normalize() : this.forward(_v);
        cs.spawnBolt(this, from, dir, t, new THREE.Color('#b46bff'), 1.25, { speed: 26, defId: 'warlock_orb', homing: 2.2, life: 3.5, kind: 'orb' });
        break;
      }
      case 'runeMark': {
        const t = this.target;
        if (!t) break;
        const delay = Number(data?.delay ?? 1);
        // Mark where the target will be; a skilled caster leads a moving target a little.
        const pos = t.pos.clone().addScaledVector(t.vel, 0.35).setY(this.world.terrainHeight(t.pos.x, t.pos.z));
        this.rune = { pos, t: delay };
        this.onRune?.(pos, delay);
        break;
      }
      case 'blink': {
        const t = this.target;
        const away = t ? _v.subVectors(this.pos, t.pos).setY(0) : this.forward(_v).negate();
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        away.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.6);
        const from = this.pos.clone();
        const to = this.pos.clone().addScaledVector(away, 9);
        to.y = this.world.groundAt(to.x, to.z, to.y + 2);
        this.pos.copy(to);
        cs.emit({ type: 'anim', who: this, name: 'vanish', data: { from, to: to.clone() } });
        break;
      }
      case 'bombBlast':
        this.bombT = -1;
        cs.blast(this, 'imp_blast', this.chest(new THREE.Vector3()), 3.6);
        // The imp is consumed by its own blast.
        this.hp = 0;
        this.state = 'dead';
        this.dissolve = 1;
        cs.emit({ type: 'death', who: this, by: this });
        break;
    }
  }

  update(dt: number): void {
    this.updateCombat(dt);
    if (!this.alive) this.deadT += dt;
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, v - dt);
    // Warlock rune detonation.
    if (this.rune) {
      this.rune.t -= dt;
      if (this.rune.t <= 0) {
        const p = this.rune.pos.clone().setY(this.rune.pos.y + 0.8);
        this.rune = null;
        this.combat?.blast(this, 'warlock_rune', p, 3.4);
      }
    }
    if (this.bombT >= 0) {
      this.bombT += dt;
      this.char.tremble = Math.min(1.5, this.bombT);
      this.char.glow = Math.min(1, this.bombT);
      this.char.glowColor.set('#ff4a2a');
      if (this.state !== 'normal') {
        // Interrupted before it blew: fizzles.
        this.bombT = -1;
        this.char.tremble = 0;
        this.char.glow = 0;
      }
    }
    if (this.state !== 'normal') {
      this.guarding = false;
      this.integrate(dt, null);
      this.driveLocomotion(dt, null, true);
      this.syncCharacter(dt);
      return;
    }
    if (this.action && this.action.ended) {
      const done = this.actionName;
      const spec = this.kind.attacks.find((a) => a.clip === done);
      this.stopAction(0.22);
      void spec;
    }
    // Chained follow-ups inside the combo window.
    if (this.busy && this.action) {
      const spec = this.kind.attacks.find((a) => a.clip === this.actionName);
      if (spec?.follow && this.actionWindow('combo') && !this.followRolled) {
        this.followRolled = true;
        if (Math.random() < spec.follow.chance && this.target && this.target.pos.distanceTo(this.pos) < 4 * this.size) {
          this.stopCosmetic(0.05);
          this.playAction(spec.follow.clip, { fadeIn: 0.08, fadeOut: 0.2 });
          this.cooldowns.set(spec.follow.clip, 1.5);
        }
      }
    } else this.followRolled = false;
    if (this.want && !this.busy) {
      const w = this.want;
      this.want = null;
      this.attack(w);
    }
    // Facing.
    if (!this.busy || this.guarding) {
      if (this.face !== null) this.turnToward(this.face, this.kind.turn, dt);
      else if (this.intent.dir.lengthSq() > 0.01) this.turnToward(Math.atan2(this.intent.dir.x, this.intent.dir.z), this.kind.turn, dt);
    } else if (this.target && this.action) {
      // Track during the wind-up only (that's what makes dodging the release possible).
      const hw = this.action.clip.def.win?.hit;
      if (hw && this.action.time < hw[0] - 0.12) this.turnToward(this.yawTo(this.target.pos), this.kind.turn * 0.6, dt);
    }
    this.speedMult = 1;
    this.integrate(dt, this.busy && !this.guarding ? null : this.intent);
    this.driveLocomotion(dt, this.intent, !!this.target);
    // Weapon-ready overlay while moving.
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.6 * this.size;
    if (this.kind.hold) {
      const A = this.char.animator;
      const want = moving && !this.busy;
      if (want && !this.holdOn) A.play(this.kind.hold, { layer: 'overlay', mask: 'auto', fadeIn: 0.25, fadeOut: 0.25 });
      if (!want && this.holdOn) A.stop('overlay', 0.25);
      this.holdOn = want;
    }
    if (this.target?.alive) this.char.lookTarget = this.target.chest(new THREE.Vector3());
    this.syncCharacter(dt);
  }

  private followRolled = false;
}
