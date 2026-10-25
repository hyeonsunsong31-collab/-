import * as THREE from 'three';
import { COMBAT, computeDamage, dazeAmount } from '@ak/shared';
import type { Clock } from '../core/Clock.ts';
import type { World } from '../world/World.ts';
import type { ActionHandle } from '../animation/Animator.ts';
import { ATTACKS, type AttackDef } from './attacks.ts';
import type { Combatant, HitInfo, HitResult } from './Combatant.ts';

export interface Bolt {
  owner: Combatant;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  target: Combatant | null;
  age: number;
  life: number;
  radius: number;
  def: AttackDef;
  color: THREE.Color;
  /** Visual + damage scale (charged / transformed bolts are thicker). */
  scale: number;
  dead: boolean;
  /** Targets that perfect-dodged this bolt (it flies on through them). */
  dodged: Set<Combatant>;
  /** Steering rate toward the target (1/s). */
  homing: number;
  /** Visual style: crackling ki bolt or a slower arcane orb. */
  kind: 'bolt' | 'orb';
}

export interface Beam {
  owner: Combatant;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  end: THREE.Vector3;
  maxLength: number;
  radius: number;
  /** Charge 0..1 scales width, damage and the final blast. */
  power: number;
  age: number;
  tick: number;
  tickDef: AttackDef;
  blastDef: AttackDef;
  hitTarget: Combatant | null;
  ultimate: boolean;
  color: THREE.Color;
  /** Set by the owner when the beam should stop (release / duration). */
  ending: boolean;
  dead: boolean;
}

export type CombatEvent =
  | { type: 'hit'; attacker: Combatant; target: Combatant; def: AttackDef; point: THREE.Vector3; dir: THREE.Vector3; res: HitResult }
  | { type: 'flash'; who: Combatant; color: 'gold' | 'red' }
  | { type: 'stun'; who: Combatant }
  | { type: 'death'; who: Combatant; by: Combatant }
  | { type: 'slam'; who: Combatant; pos: THREE.Vector3; power: number }
  | { type: 'bodyfall'; who: Combatant; pos: THREE.Vector3; power: number }
  | { type: 'perfectDodge'; who: Combatant; from: Combatant; pos: THREE.Vector3 }
  | { type: 'parry'; who: Combatant; attacker: Combatant; point: THREE.Vector3 }
  | { type: 'block'; who: Combatant; attacker: Combatant; point: THREE.Vector3 }
  | { type: 'guardBreak'; who: Combatant; attacker: Combatant }
  | { type: 'boltSpawn'; bolt: Bolt }
  | { type: 'boltImpact'; bolt: Bolt; pos: THREE.Vector3; normal: THREE.Vector3; target: Combatant | null }
  | { type: 'beamStart'; beam: Beam }
  | { type: 'beamEnd'; beam: Beam }
  | { type: 'blast'; who: Combatant; pos: THREE.Vector3; radius: number; def: AttackDef }
  | { type: 'crater'; pos: THREE.Vector3; radius: number; felled: number; rocks: { x: number; y: number; z: number; s: number }[] }
  | { type: 'anim'; who: Combatant; name: string; data?: Record<string, unknown> }
  | { type: 'chain'; phase: 'prompt' | 'start' | 'end'; attacker: Combatant; target: Combatant; count: number };

type Listener = (e: CombatEvent) => void;

interface MeleeTrack {
  handle: ActionHandle;
  hit: Set<Combatant>;
  dodged: Set<Combatant>;
  flashed: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _limb = new THREE.Vector3();

/**
 * Resolves every combat interaction: melee windows, telegraphs, perfect dodges, parries/blocks, damage and Daze,
 * gauges and buffs, ki bolts, beams, area blasts, craters, and the Chain Attack trigger. Presentation layers (VFX,
 * screen effects, camera, audio, HUD) subscribe to its event stream.
 */
export class CombatSystem {
  readonly list: Combatant[] = [];
  readonly bolts: Bolt[] = [];
  readonly beams: Beam[] = [];
  player: Combatant | null = null;
  private listeners: Listener[] = [];
  private tracks = new Map<Combatant, MeleeTrack>();
  private craterCooldown = 0;
  /** Random source (crits); tests inject a deterministic one. */
  rand: () => number = Math.random;
  /** Called when the player lands a heavy hit on a stunned foe (Chain Attack). */
  onChainTrigger: ((attacker: Combatant, target: Combatant) => void) | null = null;

  constructor(
    readonly clock: Clock,
    readonly world: World | null,
  ) {}

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  emit(e: CombatEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  add(c: Combatant): void {
    if (this.list.includes(c)) return;
    this.list.push(c);
    c.combat = this;
  }

  remove(c: Combatant): void {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    this.tracks.delete(c);
    if (c.combat === this) c.combat = null;
  }

  foesOf(c: Combatant): Combatant[] {
    return this.list.filter((o) => o !== c && o.team !== c.team && o.alive);
  }

  /* ------------------------------------------------------------------ targeting */

  /**
   * Best target for an attack: foes inside a cone around `dir` (input or facing) within `range`, scored by distance
   * and angle; falls back to the nearest foe within `near` metres in any direction.
   */
  acquireTarget(att: Combatant, dir: THREE.Vector3 | null, range = 7.5, coneDeg = 80, near = 4): Combatant | null {
    const fwd = dir && dir.lengthSq() > 1e-4 ? _v.copy(dir).setY(0).normalize() : att.forward(_v);
    const cosCone = Math.cos((coneDeg * Math.PI) / 180);
    let best: Combatant | null = null;
    let bestScore = Infinity;
    for (const o of this.list) {
      if (o === att || o.team === att.team || !o.alive) continue;
      const to = _v2.subVectors(o.pos, att.pos);
      const dy = Math.abs(to.y);
      to.y = 0;
      const d = to.length();
      if (d > range || dy > 6) continue;
      const c = d > 1e-3 ? to.dot(fwd) / d : 1;
      if (c < cosCone && d > near) continue;
      const score = d * (1.6 - c) + dy * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ geometry */

  /** World position of the striking limb (for sparks). */
  limbPos(att: Combatant, def: AttackDef, out: THREE.Vector3): THREE.Vector3 {
    const ch = att.char;
    switch (def.limb) {
      case 'handL':
        return ch.handWorld('L', out);
      case 'handR':
        return ch.handWorld('R', out);
      case 'footL':
        return ch.footWorld('L', out);
      case 'footR':
        return ch.footWorld('R', out);
      case 'both':
        ch.handWorld('L', out);
        return out.add(ch.handWorld('R', _v3)).multiplyScalar(0.5);
      default:
        return att.chest(out);
    }
  }

  /** Is `t` inside `att`'s strike volume for this attack (reach, arc, vertical band)? `extra` widens it. */
  inStrike(att: Combatant, t: Combatant, def: AttackDef, extra = 0): boolean {
    const to = _v.subVectors(t.pos, att.pos);
    const dyFeet = to.y;
    to.y = 0;
    const d = to.length();
    if (d - t.radius > def.reach + extra) return false;
    // Vertical overlap of the target's body with the attack band.
    if (dyFeet > def.yMax + extra * 0.5 || dyFeet + t.height < def.yMin - extra * 0.5) return false;
    if (d < 0.6) return true;
    const f = att.forward(_v2);
    const cos = to.dot(f) / d;
    return cos >= Math.cos(((def.arc + extra * 12) * Math.PI) / 180);
  }

  private impactPoint(att: Combatant, t: Combatant, def: AttackDef, out: THREE.Vector3): THREE.Vector3 {
    this.limbPos(att, def, _limb);
    // Closest point on the target's body axis, pushed out to its surface toward the limb.
    const y = THREE.MathUtils.clamp(_limb.y, t.pos.y + 0.3 * t.char.scale, t.pos.y + 1.65 * t.char.scale);
    out.set(t.pos.x, y, t.pos.z);
    const toward = _v3.subVectors(_limb, out).setY(0);
    if (toward.lengthSq() > 1e-4) out.addScaledVector(toward.normalize(), t.radius * 0.9);
    return out;
  }

  /* ------------------------------------------------------------------ resolution */

  /**
   * Resolve one hit of `def` from `att` on `t`. Handles perfect dodge, parry, block, damage, Daze, gauges, buffs,
   * reactions, hitstop, craters and the Chain Attack trigger. Returns null when the hit was avoided.
   */
  resolveHit(att: Combatant, t: Combatant, def: AttackDef, point?: THREE.Vector3, scale = 1, dirOverride?: THREE.Vector3): HitResult | null {
    if (!t.alive || (!att.alive && !def.ki)) return null;
    const p = point ? point.clone() : this.impactPoint(att, t, def, new THREE.Vector3());
    const dir = dirOverride ? dirOverride.clone().setY(0) : new THREE.Vector3().subVectors(t.pos, att.pos).setY(0);
    if (dir.lengthSq() < 1e-4) att.forward(dir);
    dir.normalize();
    const res: HitResult = { dmg: 0, crit: false, blocked: false, parried: false, guardBroken: false, killed: false, stunned: false, armored: false };

    // Perfect dodge / i-frames.
    if (t.invulnerable || t.dashAge <= this.dodgeWindow(t)) {
      if (t.dashAge <= this.dodgeWindow(t)) this.perfectDodge(t, att);
      return null;
    }

    // Guard / parry.
    if (t.guarding && t.canAct) {
      const toAtt = _v.subVectors(att.pos, t.pos).setY(0).normalize();
      const facing = toAtt.dot(t.forward(_v2)) > 0.25;
      if (facing) {
        if (def.flash === 'red' || (att.team === 'foe' && !def.flash && def.tier >= 4)) {
          this.guardBreak(t, att);
          res.guardBroken = true;
        } else if (t.guardAge <= COMBAT.parryWindow) {
          this.parry(t, att, p);
          res.parried = true;
          return res;
        } else {
          res.blocked = true;
        }
      }
    }

    const wasStunned = t.stunned;
    const crit = this.rand() < att.critRate;
    let dmgBonus = att.buffs.total('dmgPct');
    if (def.ki) dmgBonus += att.buffs.total('beamPct') * (def.id.startsWith('beam') || def.id.startsWith('ult') ? 1 : 0.3);
    const dmg = computeDamage({
      atk: def.ki ? att.kiAtk : att.atk,
      skillMult: def.mult * scale,
      dmgBonus,
      crit,
      critDmg: att.critDmg,
      attackerLevel: att.level,
      targetDef: t.def,
      defDown: t.buffs.total('defDownPct'),
      stunned: wasStunned,
      formAtkMult: att.form.atkMult,
      formDefMult: t.form.defMult,
      blocked: res.blocked,
    });
    res.dmg = dmg;
    res.crit = crit;
    if (res.blocked) {
      t.guard -= 10 + def.mult * 16 * scale;
      if (t.guard <= 0) {
        this.guardBreak(t, att);
        res.guardBroken = true;
        res.blocked = false;
      } else {
        t.hp = Math.max(1, t.hp - dmg);
        t.knock.copy(dir).multiplyScalar(def.knock * 0.5);
        t.onBlocked(att, def);
        this.clock.addHitstop(def.hitstop * 0.6);
        this.emit({ type: 'block', who: t, attacker: att, point: p });
        return res;
      }
    }
    const daze = res.blocked ? 0 : dazeAmount(def.daze, att.derived.impact) * scale;
    const h: HitInfo = { attacker: att, def, point: p, dir, scale };
    t.applyHit(h, dmg, daze, res);

    // Attacker gauges and buffs.
    att.energy = Math.min(COMBAT.energyMax, att.energy + def.energy * att.derived.energyRegen);
    this.addSurge(att, COMBAT.surge.hit);
    if (att.team === 'hero') {
      att.buffs.add('momentum');
      if (def.id === 'ki_bolt') att.buffs.add('overcharge');
    }
    if (def.ki) t.buffs.add('static');
    if (res.stunned) this.addSurge(att, COMBAT.surge.stun);

    this.clock.addHitstop(def.hitstop * (crit ? 1.2 : 1));
    if (def.crater) this.tryCrater(p, def.crater);
    this.emit({ type: 'hit', attacker: att, target: t, def, point: p, dir, res });

    if (wasStunned && def.heavy && att === this.player && t.alive && this.onChainTrigger) this.onChainTrigger(att, t);
    return res;
  }

  dodgeWindow(t: Combatant): number {
    if (!t.canPerfectDodge) return -1;
    return COMBAT.perfectDodgeWindow * t.form.dodgeWindowMult;
  }

  addSurge(c: Combatant, amount: number): void {
    c.surge = Math.min(COMBAT.surgeMax, c.surge + amount * c.derived.surgeGain);
  }

  private perfectDodge(t: Combatant, att: Combatant): void {
    // Only one perfect dodge per dash.
    if (t.perfectDodged) return;
    t.perfectDodged = true;
    this.addSurge(t, COMBAT.surge.perfectDodge);
    t.buffs.add('instinct');
    if (t === this.player) this.clock.startSlowmo(COMBAT.slowMoDuration, COMBAT.slowMoWorldScale, COMBAT.slowMoPlayerScale);
    t.onPerfectDodge(att);
    this.emit({ type: 'perfectDodge', who: t, from: att, pos: t.chest(new THREE.Vector3()) });
  }

  private parry(t: Combatant, att: Combatant, p: THREE.Vector3): void {
    this.addSurge(t, COMBAT.surge.perfectParry);
    att.buffs.add('guardCrack');
    const def = ATTACKS.parried;
    const dir = new THREE.Vector3().subVectors(att.pos, t.pos).setY(0).normalize();
    const res: HitResult = { dmg: 0, crit: false, blocked: false, parried: false, guardBroken: false, killed: false, stunned: false, armored: false };
    att.applyHit({ attacker: t, def, point: p, dir }, 0, dazeAmount(def.daze, t.derived.impact), res);
    if (res.stunned) this.addSurge(t, COMBAT.surge.stun);
    this.clock.addHitstop(def.hitstop);
    t.onParry(att);
    this.emit({ type: 'parry', who: t, attacker: att, point: p });
  }

  private guardBreak(t: Combatant, att: Combatant): void {
    t.guard = COMBAT.guardMax * 0.5;
    t.onGuardBreak(att);
    this.emit({ type: 'guardBreak', who: t, attacker: att });
  }

  private tryCrater(p: THREE.Vector3, radius: number): void {
    if (!this.world || this.craterCooldown > 0) return;
    const g = this.world.terrainHeight(p.x, p.z);
    if (p.y - g > radius + 1.5) return;
    this.craterCooldown = 0.2;
    const { felled, rocks } = this.world.crater(p.x, p.z, radius, radius * 0.22);
    this.emit({ type: 'crater', pos: new THREE.Vector3(p.x, g, p.z), radius, felled: felled.length, rocks });
  }

  /** Public crater for scripted moves (Meteor Crash miss, transformation burst, beam blasts). */
  crater(p: THREE.Vector3, radius: number): void {
    this.craterCooldown = 0;
    this.tryCrater(p, radius);
  }

  /* ------------------------------------------------------------------ attacks */

  /** One-shot area hit around `center` (palm bursts, transformation, explosions). */
  blast(att: Combatant, defId: string, center: THREE.Vector3, radius: number, scale = 1): number {
    const def = ATTACKS[defId];
    let n = 0;
    for (const t of this.foesOf(att)) {
      const d = _v.subVectors(t.chest(_v2), center).length();
      if (d > radius + t.radius) continue;
      const dir = _v3.subVectors(t.pos, center).setY(0);
      if (dir.lengthSq() < 1e-4) att.forward(dir);
      if (this.resolveHit(att, t, def, t.chest(new THREE.Vector3()), scale * (1 - (d / (radius + 1)) * 0.4), dir.normalize())) n++;
    }
    if (def.crater) this.crater(center, def.crater * Math.max(0.6, scale));
    this.emit({ type: 'blast', who: att, pos: center.clone(), radius, def });
    return n;
  }

  /** Single-frame melee check (multi-hit barrages fire this from animation events). */
  meleeBurst(att: Combatant, defId: string, scale = 1): number {
    const def = ATTACKS[att.defOverride?.[defId] ?? defId];
    let n = 0;
    for (const t of this.foesOf(att)) if (this.inStrike(att, t, def) && this.resolveHit(att, t, def, undefined, scale)) n++;
    return n;
  }

  spawnBolt(
    owner: Combatant,
    from: THREE.Vector3,
    dir: THREE.Vector3,
    target: Combatant | null,
    color: THREE.Color,
    scale = 1,
    opts: { speed?: number; defId?: string; homing?: number; life?: number; kind?: 'bolt' | 'orb' } = {},
  ): Bolt {
    const b: Bolt = {
      owner,
      pos: from.clone(),
      prev: from.clone(),
      vel: dir.clone().normalize().multiplyScalar(opts.speed ?? 78),
      target,
      age: 0,
      life: opts.life ?? 2.2,
      radius: 0.45 * scale,
      def: ATTACKS[opts.defId ?? 'ki_bolt'],
      color: color.clone(),
      scale,
      dead: false,
      dodged: new Set(),
      homing: opts.homing ?? 5,
      kind: opts.kind ?? 'bolt',
    };
    this.bolts.push(b);
    this.emit({ type: 'boltSpawn', bolt: b });
    return b;
  }

  startBeam(owner: Combatant, origin: THREE.Vector3, dir: THREE.Vector3, power: number, color: THREE.Color, ultimate = false): Beam {
    const b: Beam = {
      owner,
      origin: origin.clone(),
      dir: dir.clone().normalize(),
      end: origin.clone(),
      maxLength: ultimate ? 260 : 160,
      radius: (ultimate ? 1.7 : 0.6 + power * 0.5) * owner.char.scale,
      power,
      age: 0,
      tick: 0,
      tickDef: ATTACKS[ultimate ? 'ultimate_tick' : 'beam_tick'],
      blastDef: ATTACKS[ultimate ? 'ultimate_blast' : 'beam_blast'],
      hitTarget: null,
      ultimate,
      color: color.clone(),
      ending: false,
      dead: false,
    };
    this.beams.push(b);
    this.emit({ type: 'beamStart', beam: b });
    return b;
  }

  /* ------------------------------------------------------------------ update */

  update(worldDt: number, playerDt: number): void {
    this.craterCooldown = Math.max(0, this.craterCooldown - worldDt);
    this.separate(worldDt);
    for (const c of this.list) this.updateMelee(c);
    for (const b of this.bolts) this.updateBolt(b, b.owner === this.player ? playerDt : worldDt);
    for (let i = this.bolts.length - 1; i >= 0; i--) if (this.bolts[i].dead) this.bolts.splice(i, 1);
    for (const b of this.beams) this.updateBeam(b, b.owner === this.player ? playerDt : worldDt);
    for (let i = this.beams.length - 1; i >= 0; i--) if (this.beams[i].dead) this.beams.splice(i, 1);
  }

  /**
   * Soft body collision: fighters standing in each other's space are eased apart (mass by size, the player yields
   * least so a crowd can't shove them around). Dashes and other i-frame moves slip through, like in ZZZ.
   */
  private separate(dt: number): void {
    if (dt <= 0) return;
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive || !a.movable || a.actionWindow('iframes')) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (!b.alive || !b.movable || b.actionWindow('iframes')) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        // Only bodies at roughly the same height collide (flyers pass over).
        if (Math.abs(b.pos.y - a.pos.y) > Math.min(a.height, b.height) * 0.8) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : Math.cos(i * 2.4 + j);
        const nz = d > 1e-4 ? dz / d : Math.sin(i * 2.4 + j);
        let ma = a.char.scale ** 3 * (a === this.player ? 4 : 1);
        let mb = b.char.scale ** 3 * (b === this.player ? 4 : 1);
        if (a.busy) ma *= 2;
        if (b.busy) mb *= 2;
        const push = Math.min(rr - d, 6 * dt);
        const ka = mb / (ma + mb);
        a.pos.x -= nx * push * ka;
        a.pos.z -= nz * push * ka;
        b.pos.x += nx * push * (1 - ka);
        b.pos.z += nz * push * (1 - ka);
      }
    }
  }

  private updateMelee(att: Combatant): void {
    const a = att.action;
    if (!a || !att.alive || att.state !== 'normal') {
      this.tracks.delete(att);
      return;
    }
    const def = ATTACKS[att.defOverride?.[a.clip.name] ?? a.clip.name];
    if (!def) {
      this.tracks.delete(att);
      return;
    }
    let tr = this.tracks.get(att);
    if (!tr || tr.handle !== a) {
      tr = { handle: a, hit: new Set(), dodged: new Set(), flashed: false };
      this.tracks.set(att, tr);
    }
    const win = a.clip.def.win?.hit;
    if (!win) return;
    // Telegraph for foes: flash shortly before the hit frame (gold = parryable, red = dodge only).
    const flash = def.flash ?? (att.team === 'foe' && def.tier >= 2 ? (def.tier >= 4 ? 'red' : 'gold') : undefined);
    if (flash && !tr.flashed && a.time >= win[0] - COMBAT.flashLead * a.speed) {
      tr.flashed = true;
      att.startFlash(flash, Math.max(0.05, (win[0] - a.time) / Math.max(0.01, a.speed)));
    }
    if (a.time < win[0] || a.time > win[1]) return;
    for (const t of this.list) {
      if (t === att || t.team === att.team || !t.alive || tr.hit.has(t) || tr.dodged.has(t)) continue;
      const inside = this.inStrike(att, t, def);
      // Perfect dodges also count when the dash carried the target just outside the swing.
      if (!inside) {
        if (t.dashAge <= this.dodgeWindow(t) && this.inStrike(att, t, def, 2.5)) {
          tr.dodged.add(t);
          this.perfectDodge(t, att);
        }
        continue;
      }
      if (t.invulnerable || t.dashAge <= this.dodgeWindow(t)) {
        if (t.dashAge <= this.dodgeWindow(t)) {
          tr.dodged.add(t);
          this.perfectDodge(t, att);
        }
        continue;
      }
      tr.hit.add(t);
      this.resolveHit(att, t, def, undefined, att.attackScale);
    }
  }

  private updateBolt(b: Bolt, dt: number): void {
    if (b.dead || dt <= 0) return;
    b.age += dt;
    b.prev.copy(b.pos);
    // Mild homing toward the target's chest while it is roughly ahead.
    if (b.target && b.target.alive) {
      const want = b.target.chest(_v).sub(b.pos);
      const d = want.length();
      if (d > 0.5) {
        want.divideScalar(d);
        const speed = b.vel.length();
        const cur = _v2.copy(b.vel).divideScalar(speed);
        if (cur.dot(want) > 0.2) {
          cur.lerp(want, 1 - Math.exp(-dt * b.homing)).normalize();
          b.vel.copy(cur).multiplyScalar(speed);
        }
      }
    }
    b.pos.addScaledVector(b.vel, dt);
    // Targets.
    for (const t of this.list) {
      if (t === b.owner || t.team === b.owner.team || !t.alive || b.dodged.has(t)) continue;
      const d = segToAxisDistance(b.prev, b.pos, t);
      if (d > b.radius + t.radius * 1.15) continue;
      if (t.invulnerable || t.dashAge <= this.dodgeWindow(t)) {
        if (t.dashAge <= this.dodgeWindow(t)) this.perfectDodge(t, b.owner);
        b.dodged.add(t);
        continue;
      }
      const p = _v3.copy(b.pos);
      this.resolveHit(b.owner, t, b.def, p.clone(), b.scale, b.vel);
      this.impactBolt(b, p, _v.copy(b.vel).normalize().negate(), t);
      return;
    }
    // Terrain and buildings.
    if (this.world) {
      const g = this.world.terrainHeight(b.pos.x, b.pos.z);
      if (b.pos.y <= g) {
        const n = this.world.normalAt(b.pos.x, b.pos.z);
        b.pos.y = g + 0.05;
        this.impactBolt(b, b.pos.clone(), new THREE.Vector3(n.x, n.y, n.z), null);
        return;
      }
      if (this.world.colliders.segment(b.prev.x, b.prev.y, b.prev.z, b.pos.x, b.pos.y, b.pos.z) < 1) {
        this.impactBolt(b, b.pos.clone(), _v.copy(b.vel).normalize().negate(), null);
        return;
      }
    }
    if (b.age > b.life) b.dead = true;
  }

  private impactBolt(b: Bolt, pos: THREE.Vector3, normal: THREE.Vector3, target: Combatant | null): void {
    b.dead = true;
    if (!target && this.world) this.world.data.scorch(pos.x, pos.z, 1.2 * b.scale, 0.6);
    this.emit({ type: 'boltImpact', bolt: b, pos: pos.clone(), normal: normal.clone(), target });
  }

  private updateBeam(b: Beam, dt: number): void {
    if (b.dead) return;
    b.age += dt;
    // March the ray: first foe, building or the ground stops it.
    let len = b.maxLength;
    let hit: Combatant | null = null;
    for (const t of this.list) {
      if (t === b.owner || t.team === b.owner.team || !t.alive) continue;
      const along = _v.subVectors(t.chest(_v2), b.origin).dot(b.dir);
      if (along < 0 || along > len) continue;
      const closest = _v3.copy(b.origin).addScaledVector(b.dir, along);
      const off = closest.distanceTo(t.chest(_v2));
      if (off <= b.radius + t.radius * 1.3) {
        len = along;
        hit = t;
      }
    }
    if (this.world) {
      const step = 1.5;
      for (let s = step; s < len; s += step) {
        const x = b.origin.x + b.dir.x * s;
        const y = b.origin.y + b.dir.y * s;
        const z = b.origin.z + b.dir.z * s;
        if (y < this.world.terrainHeight(x, z)) {
          len = s;
          hit = null;
          break;
        }
      }
    }
    b.end.copy(b.origin).addScaledVector(b.dir, len);
    b.hitTarget = hit;
    b.tick -= dt;
    if (hit && b.tick <= 0) {
      b.tick = 0.09;
      const scale = (0.6 + b.power * 0.8) * (b.ultimate ? 1 : 1);
      if (hit.invulnerable || hit.dashAge <= this.dodgeWindow(hit)) {
        if (hit.dashAge <= this.dodgeWindow(hit)) this.perfectDodge(hit, b.owner);
      } else this.resolveHit(b.owner, hit, b.tickDef, b.end.clone(), scale, b.dir);
    }
    if (!hit && this.world && b.tick <= 0 && len < b.maxLength) {
      b.tick = 0.12;
      this.world.data.scorch(b.end.x, b.end.z, b.radius * 1.4, 0.35);
    }
    if (b.ending) {
      b.dead = true;
      if (len < b.maxLength) this.blast(b.owner, b.blastDef.id, b.end.clone(), (b.ultimate ? 9 : 3 + b.power * 2.5) * b.owner.char.scale, 0.7 + b.power * 0.6);
      this.emit({ type: 'beamEnd', beam: b });
    }
  }
}

/** Distance from a moving point's segment to a combatant's vertical body axis. */
function segToAxisDistance(a: THREE.Vector3, b: THREE.Vector3, t: Combatant): number {
  const y0 = t.pos.y + 0.2 * t.char.scale;
  const y1 = t.pos.y + 1.7 * t.char.scale;
  let best = Infinity;
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    const z = a.z + (b.z - a.z) * k;
    const cy = Math.max(y0, Math.min(y1, y));
    const d = Math.hypot(x - t.pos.x, y - cy, z - t.pos.z);
    if (d < best) best = d;
  }
  return best;
}
