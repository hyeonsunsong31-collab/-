import * as THREE from 'three';
import { COMBAT, FORMS, maxUnlockedTier, type Stats } from '@ak/shared';
import { Combatant, type Team } from '../combat/Combatant.ts';
import type { Beam } from '../combat/CombatSystem.ts';
import { AIR_CHAIN, ATTACKS, GROUND_CHAIN } from '../combat/attacks.ts';
import type { MoveIntent } from './Fighter.ts';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import type { ActionState } from '../input/ActionState.ts';
import { dashClipFor, type DashDir } from '../input/dash.ts';
import { EASE } from '../animation/Easing.ts';

/** What drives a hero: the player's input + camera, or a bot brain. */
export interface HeroControls {
  readonly buttons: ActionState;
  /** World-space desired horizontal move direction, length 0..1. */
  readonly move: THREE.Vector3;
  /** Free 3D flight direction (length 0..1); null = use `move`. */
  flyDir: THREE.Vector3 | null;
  /** Flight climb intent -1..1. */
  vertical: number;
  /** Face this yaw while moving (shift-lock); null = face the movement direction. */
  faceYaw: number | null;
  /** Camera forward yaw (null for bots): out of a fight, dashes square up to it so each key maps to its clip. */
  viewYaw: number | null;
  /** Sprint held / toggled. */
  sprint: boolean;
  /** Fallback aim point for ki attacks when there is no target (camera centre / bot focus). */
  aim: THREE.Vector3 | null;
  /** Refresh vectors from the underlying device / brain. */
  refresh(hero: Hero, dt: number): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const KI_COLOR = new THREE.Color('#3fb2ff');

type PowerState = 'none' | 'powerup' | 'charging' | 'burst';

/**
 * The full Ascendant moveset on top of `Combatant`, shared by the player and the rival bot:
 * movement (run, ninja sprint, jump with apex hang, Space×2 flight, boost, landings), Q dashes with i-frames and
 * dash→sprint flow, the ZZZ-style light chain with buffered combo windows and a rush barrage, an air chain, dash
 * attack, dodge counter after a perfect dodge, guard/perfect parry/parry counter, Special / EX Meteor Crash,
 * charged Dragon Fist, alternating ki bolts, charged beam, the Ultimate, power-up and the transformation ladder.
 */
export class Hero extends Combatant {
  controls: HeroControls;
  protected intent: MoveIntent = { dir: new THREE.Vector3(), sprint: false, vertical: 0, flyDir: null, faceYaw: null };
  // Movement.
  private jumpPrep = -1;
  private flyAfterJump = false;
  protected jumping = false;
  private dashSprint = false;
  private dashChain = 0;
  private dashRest = 0;
  private dashCooldown = 0;
  protected dashWorld = new THREE.Vector3();
  private dashRel: DashDir = 'f';
  private sinceDashF = 9;
  private airDashUsed = false;
  private landCancelAt = -1;
  // Combat.
  /** Soft lock-on target. */
  target: Combatant | null = null;
  private targetTimer = 0;
  private comboIdx = -1;
  private airIdx = -1;
  private sinceAttack = 9;
  /** Dodge-counter window after a perfect dodge (s). */
  counterWindow = 0;
  /** Parry-counter window after a perfect parry (s). */
  parryWindow = 0;
  private heavyHeld = false;
  private heavyT = 0;
  private kiHeldT = 0;
  private kiHeld = false;
  private boltSide: 'l' | 'r' = 'r';
  private boltCd = 0;
  private rushT = 0;
  beam: Beam | null = null;
  private beamCharge = 0;
  private beamT = 0;
  private beamDur = 0;
  private ultimateBeam = false;
  /** Power-up / transformation sequence. */
  power: PowerState = 'none';
  private powerT = 0;
  private pendingTier = 0;
  /** Hair style of the base form (forms swap styles; reverting restores it). */
  readonly baseHairStyle: number;
  /** Highest form tier this hero may use (from level). */
  maxTier = 0;
  /** Recently in a fight (camera framing, idle stance). */
  inCombat = false;
  /** Driven by a script (chain attacks, cutscenes): input is ignored, physics/animation keep running. */
  scripted = false;
  private exHeight = 0;
  private exGround = 0;

  constructor(char: Character, world: World, name: string, team: Team, level: number, stats: Stats, controls: HeroControls) {
    super(char, world, name, team, level, stats);
    this.controls = controls;
    this.canPerfectDodge = true;
    this.baseHairStyle = char.look.hairStyle;
    this.maxTier = maxUnlockedTier(level);
    char.animator.onEvent((clip, name, data) => this.onAnimEvent(clip, name, data));
    char.animator.setLoco({ idle: 1 }, 0);
  }

  override setStats(level: number, stats: Stats, heal = true): void {
    super.setStats(level, stats, heal);
    this.maxTier = maxUnlockedTier(level);
  }

  get flying(): boolean {
    return this.move === 'fly';
  }

  get sprinting(): boolean {
    return this.move === 'ground' && Math.hypot(this.vel.x, this.vel.z) > this.runSpeed * this.speedMult * 1.2;
  }

  /** Presentation hook (camera kicks, sounds); `fx` also publishes on the combat bus. */
  protected onFx(_name: string, _data?: Record<string, unknown>): void {}

  /** Outside listeners for presentation beats (HUD title cards, audio). */
  readonly fxHooks: ((name: string, data?: Record<string, unknown>) => void)[] = [];

  protected fx(name: string, data?: Record<string, unknown>): void {
    this.onFx(name, data);
    for (const fn of this.fxHooks) fn(name, data);
    this.combat?.emit({ type: 'anim', who: this, name, data });
  }

  private onWater(): boolean {
    return this.world.isWater(this.pos.x, this.pos.z) && this.pos.y < 0.3;
  }

  /* ------------------------------------------------------------------ animation events */

  private onAnimEvent(clip: string, name: string, data?: Record<string, unknown>): void {
    switch (name) {
      case 'step':
        if (this.move !== 'ground') return;
        this.fx('step', { foot: data?.foot, dust: data?.dust ?? 0, water: this.onWater(), pos: this.char.footWorld((data?.foot as 'L' | 'R') ?? 'L', new THREE.Vector3()) });
        return;
      case 'kiBolt':
        this.fireBolt((data?.hand as 'L' | 'R') ?? 'R');
        return;
      case 'rushHit':
        this.combat?.meleeBurst(this, 'rush_hit');
        break;
      case 'vanish':
        this.vanish(!!data?.above);
        break;
      case 'meteorImpact':
        this.combat?.crater(new THREE.Vector3(this.pos.x, this.world.terrainHeight(this.pos.x, this.pos.z), this.pos.z), 4.2 * this.char.scale);
        break;
      case 'dragonFist':
        // The fist's shockwave carries far beyond arm's reach.
        this.combat?.meleeBurst(this, 'dragon_wave', 1 + this.heavyCharge01 * 0.8);
        break;
      case 'burst':
        this.transformBurst();
        break;
      case 'ultFire':
        this.startBeamNow(1, true);
        break;
      case 'ultEnd':
        if (this.beam) this.beam.ending = true;
        break;
    }
    this.combat?.emit({ type: 'anim', who: this, name, data: { ...data, clip } });
  }

  private heavyCharge01 = 0;

  /* ------------------------------------------------------------------ hooks from the combat system */

  override onPerfectDodge(): void {
    this.counterWindow = COMBAT.slowMoDuration + COMBAT.dodgeCounterGrace;
    this.fx('perfectDodge');
  }

  override onParry(): void {
    this.parryWindow = 0.7;
    this.playAction('parry', { fadeIn: 0.02, fadeOut: 0.12 });
    this.fx('parry');
  }

  override onGuardBreak(att: Combatant): void {
    super.onGuardBreak(att);
    this.fx('guardBreak');
  }

  protected override jumpReset(): void {
    this.jumping = false;
    this.jumpPrep = -1;
    this.gravityScale = 1;
    this.kinematicY = false;
    this.endBeam(false);
    this.endPower();
    this.guarding = false;
    this.heavyHeld = false;
  }

  /* ------------------------------------------------------------------ intent */

  private buildIntent(): MoveIntent {
    const c = this.controls;
    const it = this.intent;
    // Scripted sequences (chain finishers, arena intros) own the fighter: no stick movement.
    if (this.scripted) it.dir.set(0, 0, 0);
    else it.dir.copy(c.move);
    const moving = it.dir.lengthSq() > 0.01;
    if (!moving) this.dashSprint = false;
    it.sprint = moving && (c.sprint || this.dashSprint);
    it.vertical = this.move === 'fly' ? c.vertical : 0;
    it.flyDir = this.move === 'fly' ? c.flyDir : null;
    it.faceYaw = c.faceYaw;
    return it;
  }

  /* ------------------------------------------------------------------ attacks */

  /** Start an attack clip: pick a target, face it and stretch root motion to close the gap (attack magnetism). */
  private beginAttack(clip: string, opts: { speed?: number; fadeIn?: number; magnet?: boolean } = {}): void {
    const dir = this.intent.dir.lengthSq() > 0.04 ? this.intent.dir : null;
    const t = this.combat?.acquireTarget(this, dir) ?? null;
    if (t) this.target = t;
    this.stopCosmetic(0.05);
    const speed = (opts.speed ?? 1) * this.derived.attackSpeed * (1 + this.buffs.total('atkSpdPct'));
    this.playAction(clip, { fadeIn: opts.fadeIn ?? 0.05, fadeOut: 0.16, speed });
    this.attackScale = clip === 'heavy_release' ? 1 + this.heavyCharge01 * 1.2 : 1;
    this.sinceAttack = 0;
    this.inCombat = true;
    if (t && opts.magnet !== false) {
      const to = _v.subVectors(t.pos, this.pos).setY(0);
      const d = to.length();
      if (d > 1e-3) this.yaw = Math.atan2(to.x, to.z);
      const c = this.char.animator.clip(clip);
      const m = c.def.move ? c.motionAt(c.dur, [0, 0, 0])[0] * this.char.scale : 0;
      const def = ATTACKS[clip];
      const want = d - (def ? Math.min(def.reach * 0.55, 1.5) : 1.2) - t.radius;
      if (m > 0.1) this.motionScale = THREE.MathUtils.clamp(want / m, 0.15, 3.2);
    }
  }

  private lightPressed(): boolean {
    return this.controls.buttons.buffered('light', COMBAT.inputBuffer);
  }

  private consumeLight(): void {
    this.controls.buttons.consume('light', COMBAT.inputBuffer);
  }

  private tryLight(): boolean {
    if (!this.lightPressed()) return false;
    const a = this.action;
    const busy = this.busy;
    // Counters take priority.
    if (this.counterWindow > 0 && (!busy || this.actionWindow('cancel') || this.actionName.startsWith('dash_'))) {
      this.consumeLight();
      this.counterWindow = 0;
      this.beginAttack('dodge_counter', { fadeIn: 0.02, magnet: false });
      this.comboIdx = 1;
      return true;
    }
    if (this.parryWindow > 0 && (this.actionName === 'parry' || !busy)) {
      this.consumeLight();
      this.parryWindow = 0;
      this.beginAttack('parry_counter', { fadeIn: 0.03 });
      this.comboIdx = 2;
      return true;
    }
    const air = this.move !== 'ground';
    if (air) {
      const inChain = a && (AIR_CHAIN as readonly string[]).includes(a.clip.name);
      if (busy && !(inChain && this.actionWindow('combo')) && !this.actionWindow('cancel')) return false;
      if (inChain && !this.actionWindow('combo') && !a.ended) return false;
      this.airIdx = inChain ? this.airIdx + 1 : 0;
      if (this.airIdx >= AIR_CHAIN.length) this.airIdx = 0;
      this.consumeLight();
      if (this.move === 'air') this.jumping = false;
      this.vel.y = 0;
      this.floatTimer = this.airIdx === AIR_CHAIN.length - 1 ? 0.3 : 0.45;
      this.beginAttack(AIR_CHAIN[this.airIdx], { fadeIn: 0.04 });
      return true;
    }
    // Dash attack out of a sprint or right after a forward dash.
    if ((!busy || this.actionWindow('cancel')) && (this.sprinting || this.sinceDashF < 0.3) && this.comboIdx < 0) {
      this.consumeLight();
      this.beginAttack('dash_attack', { fadeIn: 0.03 });
      this.comboIdx = 1;
      return true;
    }
    const inChain = a && ((GROUND_CHAIN as readonly string[]).includes(a.clip.name) || a.clip.name === 'dash_attack' || a.clip.name.endsWith('_counter'));
    if (busy) {
      if (!(inChain && this.actionWindow('combo')) && !this.actionWindow('cancel')) return false;
      if (a && a.clip.name.startsWith('dash_') && !this.actionWindow('combo')) return false;
    }
    let next: number;
    if (inChain) next = this.comboIdx + 1;
    else if (a && a.clip.name.startsWith('dash_') && this.actionWindow('combo')) next = Math.max(0, this.comboIdx);
    else next = this.sinceAttack < 0.45 && this.comboIdx >= 0 ? this.comboIdx + 1 : 0;
    if (next >= GROUND_CHAIN.length) next = 0;
    this.comboIdx = next;
    this.consumeLight();
    this.beginAttack(GROUND_CHAIN[next]);
    return true;
  }

  private updateRush(dt: number): void {
    const b = this.controls.buttons;
    if (this.actionName === 'light5' && this.actionWindow('hold') && b.held('light') && b.holdTime('light') > 0.2) {
      this.playAction('rush', { fadeIn: 0.06, fadeOut: 0.1 });
      this.rushT = 0;
    }
    if (this.actionName === 'rush') {
      this.rushT += dt;
      // Keep the barrage glued to the target.
      if (this.target?.alive) {
        const to = _v.subVectors(this.target.pos, this.pos).setY(0);
        const d = to.length();
        this.turnToward(Math.atan2(to.x, to.z), 10, dt);
        if (d > 1.7) this.pos.addScaledVector(to.normalize(), Math.min(d - 1.6, 8 * dt));
      }
      if (!b.held('light') || this.rushT > 1.8) {
        this.beginAttack('rush_end', { fadeIn: 0.04 });
        this.comboIdx = -1;
      }
    }
  }

  private tryHeavy(dt: number): void {
    const b = this.controls.buttons;
    if (this.heavyHeld) {
      this.heavyT += dt;
      if (this.actionName === 'heavy_charge') {
        this.heavyCharge01 = Math.min(1, Math.max(0, (this.heavyT - 0.22) / 1.0));
        if (this.heavyT > 0.22) this.char.tremble = 0.25 + this.heavyCharge01 * 0.6;
        if (this.target?.alive) this.turnToward(this.yawTo(this.target.pos), 6, dt);
      }
      if (!b.held('heavy') || this.actionName !== 'heavy_charge') {
        this.heavyHeld = false;
        this.char.tremble = 0;
        if (this.actionName !== 'heavy_charge') return;
        if (this.heavyT < 0.22) this.special();
        else {
          this.beginAttack('heavy_release', { fadeIn: 0.02 });
          this.fx('dragonFist', { charge: this.heavyCharge01 });
        }
      }
      return;
    }
    if (!b.buffered('heavy', COMBAT.inputBuffer)) return;
    if (this.busy && !this.actionWindow('cancel') && !this.actionWindow('combo')) return;
    b.consume('heavy', COMBAT.inputBuffer);
    if (this.move !== 'ground') {
      // Airborne: EX Meteor Crash if affordable, else the spike.
      if (this.energy >= COMBAT.exCost) this.exSpecial();
      else {
        this.airIdx = AIR_CHAIN.length - 1;
        this.vel.y = 0;
        this.floatTimer = 0.3;
        this.beginAttack('air4');
      }
      return;
    }
    this.heavyHeld = true;
    this.heavyT = 0;
    this.heavyCharge01 = 0;
    this.stopCosmetic(0.05);
    this.playAction('heavy_charge', { fadeIn: 0.06, fadeOut: 0.08 });
  }

  private special(): void {
    if (this.energy >= COMBAT.exCost) this.exSpecial();
    else {
      this.beginAttack('special', { fadeIn: 0.03 });
      this.kinematicY = true;
    }
    this.comboIdx = -1;
  }

  private exSpecial(): void {
    this.energy -= COMBAT.exCost;
    this.beginAttack('ex_special', { fadeIn: 0.03, magnet: false });
    this.exGround = this.pos.y;
    this.exHeight = 0;
    this.fx('exSpecial');
  }

  private vanish(above: boolean): void {
    const t = this.target?.alive ? this.target : this.combat?.acquireTarget(this, null, 12, 180) ?? null;
    if (above) {
      // Meteor Crash: reappear high above the target, slightly in front of it.
      const base = t ? t.pos : _v.copy(this.pos).addScaledVector(this.forward(_v2), 3);
      const back = t ? _v3.subVectors(this.pos, t.pos).setY(0) : this.forward(_v3).negate();
      if (back.lengthSq() < 1e-4) back.set(0, 0, -1);
      back.normalize();
      const from = this.pos.clone();
      this.pos.set(base.x + back.x * 1.3, base.y, base.z + back.z * 1.3);
      this.exGround = Math.max(this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1), -0.02);
      this.exHeight = 5.5 * this.char.scale;
      if (t) this.yaw = this.yawTo(t.pos);
      this.fx('vanish', { from, to: this.pos.clone() });
      return;
    }
    if (!t) return;
    // Dodge counter: blink behind the attacker.
    const from = this.pos.clone();
    const tb = t.forward(_v).negate();
    this.pos.set(t.pos.x + tb.x * 1.5, t.pos.y, t.pos.z + tb.z * 1.5);
    const out = { x: 0, z: 0 };
    if (this.world.colliders.resolve(this.pos.x, this.pos.z, this.radius, this.pos.y, this.height, out)) {
      this.pos.x = out.x;
      this.pos.z = out.z;
    }
    this.yaw = this.yawTo(t.pos);
    this.fx('vanish', { from, to: this.pos.clone() });
  }

  /* ------------------------------------------------------------------ ki */

  private kiAimDir(from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    if (this.target?.alive && this.target.pos.distanceTo(this.pos) < 60) return out.subVectors(this.target.chest(_v3), from).normalize();
    if (this.controls.aim) return out.subVectors(this.controls.aim, from).normalize();
    return this.forward(out);
  }

  private fireBolt(hand: 'L' | 'R'): void {
    if (!this.combat) return;
    const from = this.char.handWorld(hand, new THREE.Vector3());
    const dir = this.kiAimDir(from, new THREE.Vector3());
    from.addScaledVector(dir, 0.25);
    const col = this.form.tier > 0 ? new THREE.Color(this.form.auraColor) : KI_COLOR;
    const t = this.target?.alive ? this.target : null;
    this.combat.spawnBolt(this, from, dir, t, col, 1 + this.form.tier * 0.08);
  }

  private tryKi(dt: number): void {
    const b = this.controls.buttons;
    this.boltCd = Math.max(0, this.boltCd - dt);
    if (b.pressed('ki')) {
      this.kiHeld = true;
      this.kiHeldT = 0;
    }
    if (this.kiHeld) {
      this.kiHeldT += dt;
      const free = !this.busy || this.actionWindow('cancel') || this.actionWindow('combo');
      if (this.kiHeldT > 0.3 && b.held('ki') && free && !this.beam && this.actionName !== 'beam_charge') {
        this.kiHeld = false;
        if (this.surge >= COMBAT.ultimateCost) this.ultimate();
        else if (this.ki >= 25) {
          this.ki -= 25;
          this.beamCharge = 0;
          this.stopCosmetic(0.05);
          this.playAction('beam_charge', { fadeIn: 0.1, fadeOut: 0.08 });
          this.fx('beamCharge');
          this.inCombat = true;
        }
        return;
      }
      if (b.released('ki') || !b.held('ki')) {
        this.kiHeld = false;
        if (this.kiHeldT <= 0.3 && this.boltCd <= 0 && this.ki >= 3) this.bolt();
      }
    }
    // Beam charge → fire on release.
    if (this.actionName === 'beam_charge') {
      this.beamCharge = Math.min(1, this.beamCharge + dt / 1.6);
      this.char.tremble = 0.15 + this.beamCharge * 0.5;
      if (this.target?.alive) this.turnToward(this.yawTo(this.target.pos), 5, dt);
      if (!b.held('ki')) {
        this.char.tremble = 0;
        this.playAction('beam_fire', { fadeIn: 0.03, fadeOut: 0.1 });
        this.startBeamNow(this.beamCharge, false);
      }
    }
    if (this.beam && !this.ultimateBeam) {
      this.beamT += dt;
      this.ki = Math.max(0, this.ki - 10 * dt);
      if (this.beamT >= this.beamDur) this.endBeam(true);
    }
  }

  private bolt(): void {
    this.ki -= 3;
    this.boltCd = 0.13;
    this.boltSide = this.boltSide === 'l' ? 'r' : 'l';
    this.inCombat = true;
    const t = this.combat?.acquireTarget(this, this.intent.dir.lengthSq() > 0.04 ? this.intent.dir : null, 40, 60, 8) ?? null;
    if (t) this.target = t;
    const air = this.move !== 'ground';
    const moving = this.intent.dir.lengthSq() > 0.04 || air;
    const name = `ki_bolt_${air ? 'air_' : ''}${this.boltSide}`;
    if (moving || this.busy) {
      // Fire on the run / in the air: upper-body overlay, legs keep going.
      this.char.animator.play(name, { layer: 'overlay', mask: 'upper', fadeIn: 0.03, fadeOut: 0.12, speed: 1.15 });
    } else {
      if (t) this.yaw = this.yawTo(t.pos);
      this.stopCosmetic(0.04);
      this.playAction(name, { fadeIn: 0.03, fadeOut: 0.14, speed: 1.1 });
    }
  }

  private startBeamNow(power: number, ultimate: boolean): void {
    if (!this.combat) return;
    const hands = this.char.handWorld('L', new THREE.Vector3()).add(this.char.handWorld('R', _v)).multiplyScalar(0.5);
    const dir = this.kiAimDir(hands, new THREE.Vector3());
    const col = ultimate ? (this.form.tier > 0 ? new THREE.Color(this.form.auraColor) : new THREE.Color('#3aa8ff')) : this.form.tier > 0 ? new THREE.Color(this.form.auraColor) : KI_COLOR;
    this.beam = this.combat.startBeam(this, hands, dir, power, col, ultimate);
    this.ultimateBeam = ultimate;
    this.beamT = 0;
    this.beamDur = 0.9 + power * 1.1;
    this.fx(ultimate ? 'ultimateFire' : 'beamFire', { power });
  }

  private updateBeamAim(dt: number): void {
    const b = this.beam;
    if (!b) return;
    const hands = this.char.handWorld('L', _v2).add(this.char.handWorld('R', _v)).multiplyScalar(0.5);
    b.origin.copy(hands);
    const want = this.kiAimDir(hands, _v3);
    b.dir.lerp(want, 1 - Math.exp(-dt * (this.ultimateBeam ? 1.5 : 3))).normalize();
    if (this.target?.alive) this.turnToward(this.yawTo(this.target.pos), 2.5, dt);
  }

  private endBeam(playEnd: boolean): void {
    if (this.beam) {
      this.beam.ending = true;
      this.beam = null;
      if (playEnd && this.actionName === 'beam_fire') this.playAction('beam_end', { fadeIn: 0.08, fadeOut: 0.18 });
    }
    this.ultimateBeam = false;
  }

  private ultimate(): void {
    this.surge -= COMBAT.ultimateCost;
    this.stopCosmetic(0.05);
    const t = this.combat?.acquireTarget(this, null, 60, 120, 20) ?? null;
    if (t) {
      this.target = t;
      this.yaw = this.yawTo(t.pos);
    }
    this.playAction('ultimate', { fadeIn: 0.12, fadeOut: 0.2 });
    this.fx('ultimate');
  }

  /* ------------------------------------------------------------------ power-up / transformation */

  private tryPower(dt: number): void {
    const b = this.controls.buttons;
    if (b.doubleTapped('transform') && this.form.tier > 0 && this.power === 'none') {
      this.revertForm();
      return;
    }
    if (this.power === 'none') {
      if (b.held('transform') && b.holdTime('transform') > 0.12 && (!this.busy || this.actionWindow('cancel')) && this.move !== 'air') {
        this.power = 'powerup';
        this.powerT = 0;
        this.stopCosmetic(0.05);
        this.playAction('powerup', { fadeIn: 0.15, fadeOut: 0.2 });
        this.fx('powerStart');
      }
      return;
    }
    this.powerT += dt;
    if (this.power === 'powerup') {
      this.ki = Math.min(this.derived.maxKi, this.ki + 45 * dt);
      this.combat?.addSurge(this, 130 * dt);
      this.char.tremble = Math.min(0.5, this.powerT * 0.4);
      this.char.glow = Math.min(1, this.powerT * 1.5);
      const next = FORMS[this.form.tier + 1];
      if (next && next.tier <= this.maxTier && this.surge >= next.surgeCost && this.powerT > 0.7) {
        this.power = 'charging';
        this.powerT = 0;
        this.pendingTier = next.tier;
        this.playAction('transform_charge', { fadeIn: 0.12, fadeOut: 0.1 });
        this.char.setExpression('shout');
        this.fx('transformCharge', { tier: next.tier });
        return;
      }
      if (!b.held('transform') || this.actionName !== 'powerup') this.endPower();
      return;
    }
    if (this.power === 'charging') {
      this.char.tremble = 0.5 + Math.min(1, this.powerT / 1.3) * 0.9;
      this.char.glow = 1;
      if (this.powerT > 1.35) {
        this.power = 'burst';
        this.powerT = 0;
        this.playAction('transform_burst', { fadeIn: 0.02, fadeOut: 0.25 });
      }
      return;
    }
    if (this.power === 'burst') {
      this.char.tremble = Math.max(0, 1 - this.powerT * 1.6);
      if (this.actionDone || this.actionWindow('cancel')) this.endPower();
    }
  }

  private transformBurst(): void {
    const f = FORMS[this.pendingTier] ?? this.form;
    this.form = f;
    this.char.setForm(f, this.baseHairStyle);
    this.char.setExpression('angry');
    this.char.glowColor.set(f.auraColor);
    this.combat?.blast(this, 'burst', this.chest(new THREE.Vector3()), 6.5 * this.char.scale);
    this.combat?.crater(new THREE.Vector3(this.pos.x, this.world.terrainHeight(this.pos.x, this.pos.z), this.pos.z), 5.5 * this.char.scale);
    this.fx('transformBurst', { tier: f.tier });
  }

  revertForm(): void {
    if (this.form.tier === 0) return;
    this.form = FORMS[0];
    this.char.setForm(FORMS[0], this.baseHairStyle);
    this.char.setExpression('neutral');
    this.fx('revert');
  }

  /** Drop any in-flight charge / beam / guard state (scripted sequences take over). */
  endChainState(): void {
    this.endBeam(false);
    this.endPower();
    this.guarding = false;
    this.heavyHeld = false;
    this.kiHeld = false;
    this.char.tremble = 0;
  }

  /** Fresh start for an arena round: base form, empty Energy/Surge, full Ki, no charge/beam/guard in flight. */
  resetForMatch(): void {
    this.endChainState();
    if (this.form.tier > 0) this.setFormTier(0);
    this.energy = 0;
    this.surge = 0;
    this.ki = this.derived.maxKi;
    this.buffs.clear();
    this.counterWindow = 0;
    this.parryWindow = 0;
    this.target = null;
  }

  /** Instantly set a form (debug, arena bot setup). */
  setFormTier(tier: number): void {
    this.form = FORMS[Math.max(0, Math.min(FORMS.length - 1, tier))];
    this.char.setForm(this.form, this.baseHairStyle, true);
  }

  private endPower(): void {
    if (this.power === 'none') return;
    this.power = 'none';
    this.powerT = 0;
    this.char.tremble = 0;
    this.char.glow = this.form.tier > 0 ? 0.35 : 0;
    if (this.actionName === 'powerup' || this.actionName === 'transform_charge') this.stopAction(0.25);
    this.char.setExpression(this.form.tier > 0 ? 'angry' : 'neutral');
    this.fx('powerEnd');
  }

  /* ------------------------------------------------------------------ guard */

  private tryGuard(): void {
    const b = this.controls.buttons;
    const wants = b.held('block');
    if (wants && !this.guarding && (!this.busy || this.actionWindow('cancel') || this.actionName === 'guard_hit')) {
      this.guarding = true;
      this.guardAge = 0;
      this.stopCosmetic(0.05);
      this.playAction('guard', { fadeIn: 0.06, fadeOut: 0.15 });
      this.inCombat = true;
    } else if (wants && this.guarding && this.actionName !== 'guard' && this.actionName !== 'guard_hit' && this.actionName !== 'parry') {
      this.guarding = false;
    }
    if (!wants && this.guarding) {
      this.guarding = false;
      if (this.actionName === 'guard') this.stopAction(0.15);
    }
    if (this.guarding && this.actionName === 'guard_hit' && this.actionDone) this.playAction('guard', { fadeIn: 0.08 });
  }

  /* ------------------------------------------------------------------ movement actions */

  private tryDash(): boolean {
    if (this.dashCooldown > 0) return false;
    const cancellable = this.actionWindow('cancel') || this.actionName === 'guard' || this.actionName === 'heavy_charge' || this.actionName === 'beam_charge' || this.actionName === 'powerup';
    if (this.busy && !cancellable) return false;
    if (this.move === 'air' && this.airDashUsed) return false;
    const it = this.intent;
    const mag = it.dir.length();
    if (mag > 0.2 && this.move !== 'fly') {
      // Square up before picking the clip: to a nearby foe in a fight (side dashes circle it), otherwise to the
      // camera, so W+Q is always the forward lunge, S+Q the back hop and A/D+Q the side slides.
      const foe = this.target?.alive && this.target.pos.distanceTo(this.pos) < 16 ? this.target : null;
      const ref = foe ? this.yawTo(foe.pos) : this.controls.viewYaw;
      if (ref !== null) this.yaw = ref;
    }
    if (mag > 0.2) this.dashWorld.copy(it.dir).normalize();
    else this.dashWorld.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const pick = dashClipFor(this.dashWorld.x, this.dashWorld.z, this.yaw);
    const dir: DashDir = mag <= 0.2 ? 'b' : pick.dir;
    this.dashRel = dir;
    const air = this.move !== 'ground';
    this.stopCosmetic(0.05);
    this.endBeam(false);
    this.endPower();
    this.guarding = false;
    this.heavyHeld = false;
    this.char.tremble = 0;
    this.playAction(`dash_${dir}`, { fadeIn: 0.04, fadeOut: 0.16, mask: air ? 'upper' : 'full' });
    this.motionYawOffset = mag > 0.2 ? pick.offset : 0;
    this.motionScale = (this.move === 'fly' ? 2.2 : air ? 1.3 : 1) * Math.min(1.25, this.speed);
    if (air) {
      this.vel.y = 0;
      this.floatTimer = 0.3;
      if (this.move === 'air') this.airDashUsed = true;
    }
    this.dashAge = 0;
    this.perfectDodged = false;
    this.dashChain++;
    this.dashRest = 0;
    if (this.dashChain >= 3) {
      this.dashCooldown = 0.5 - this.derived.dodgeRecovery;
      this.dashChain = 0;
    }
    this.jumpPrep = -1;
    if (dir === 'f') this.sinceDashF = 0;
    this.fx('dash', { pos: this.pos.clone(), dir: this.dashWorld.clone(), air, rel: dir });
    return true;
  }

  private onDashEnd(): void {
    const moving = this.intent.dir.lengthSq() > 0.04;
    if (this.move === 'fly') {
      this.vel.copy(this.dashWorld).multiplyScalar(this.flySpeed * (moving ? 1.2 : 0.5));
      return;
    }
    if (moving) {
      // ZZZ flow: a dash with the stick held rolls straight into a sprint.
      this.dashSprint = this.dashRel !== 'b';
      const spd = (this.dashSprint ? this.sprintSpeed * 0.9 : this.runSpeed * 0.7) * this.speedMult;
      this.vel.x = this.dashWorld.x * spd;
      this.vel.z = this.dashWorld.z * spd;
    } else {
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
  }

  private startJump(): void {
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > this.runSpeed * 1.1) {
      this.launch();
      return;
    }
    this.jumpPrep = 0.075;
    this.playCosmetic('jump_start', { fadeIn: 0.03, speed: 1.4, hold: true });
  }

  private launch(): void {
    this.jumpPrep = -1;
    this.jump();
    this.jumping = true;
    this.airDashUsed = false;
    this.playCosmetic('jump_rise', { fadeIn: 0.04, hold: true, start: 0.02 });
    this.fx('jump', { pos: this.pos.clone(), water: this.onWater() });
    if (this.flyAfterJump) {
      this.flyAfterJump = false;
      this.enterFlight();
    }
  }

  enterFlight(): void {
    this.startFlight();
    this.jumping = false;
    this.gravityScale = 1;
    this.stopCosmetic(0.25);
    this.vel.y = Math.max(this.vel.y, 5);
    this.fx('flight', { on: true, pos: this.pos.clone() });
  }

  exitFlight(): void {
    this.stopFlight();
    this.airCarry = Math.hypot(this.vel.x, this.vel.z);
    this.airDashUsed = false;
    this.fx('flight', { on: false, pos: this.pos.clone() });
  }

  protected override landed(impact: number): void {
    this.jumping = false;
    this.gravityScale = 1;
    this.airDashUsed = false;
    this.airIdx = -1;
    const water = this.onWater();
    if (this.busy) {
      // Landing mid-attack (air spike, EX) keeps the attack going.
      this.fx('land', { pos: this.pos.clone(), hard: impact > 21, water, impact });
      return;
    }
    if (impact > 21) {
      this.playAction('land_hard', { fadeIn: 0.03, fadeOut: 0.25 });
      this.vel.x *= 0.1;
      this.vel.z *= 0.1;
      this.fx('land', { pos: this.pos.clone(), hard: true, water, impact });
    } else {
      const moving = this.intent.dir.lengthSq() > 0.04;
      this.playCosmetic('land', { fadeIn: 0.03, fadeOut: moving ? 0.14 : 0.2, speed: moving ? 1.6 : 1 });
      this.landCancelAt = moving ? 0.1 : -1;
      this.fx('land', { pos: this.pos.clone(), hard: false, water, impact });
    }
  }

  /* ------------------------------------------------------------------ update */

  private updateTarget(dt: number): void {
    this.targetTimer -= dt;
    if (this.target && (!this.target.alive || this.target.pos.distanceTo(this.pos) > 30)) this.target = null;
    if (this.targetTimer <= 0) {
      this.targetTimer = 0.25;
      const near = this.combat?.acquireTarget(this, null, 22, 180, 22) ?? null;
      if (!this.busy && near) this.target = near;
      if (!near && !this.busy) this.target = null;
    }
    this.inCombat = !!this.target || this.sinceHit < 4 || this.sinceAttack < 3;
  }

  update(dt: number): void {
    this.updateCombat(dt);
    this.controls.refresh(this, dt);
    const it = this.buildIntent();
    this.speedMult = this.speed;
    this.updateTarget(dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.parryWindow = Math.max(0, this.parryWindow - dt);
    this.sinceAttack += dt;
    this.sinceDashF += dt;
    // Surge drains while transformed; at zero the form fades.
    if (this.form.tier > 0 && this.power === 'none') {
      const drain = this.form.drainPerSec * (1 + this.buffs.total('drainPct'));
      this.surge = Math.max(0, this.surge - drain * dt);
      if (this.surge <= 0) this.revertForm();
      this.char.glow = 0.35;
      this.char.glowColor.set(this.form.auraColor);
    }

    if (this.state !== 'normal') {
      // Reeling / downed / stunned / dead: physics only.
      this.kinematicY = false;
      this.integrate(dt, null);
      this.driveLocomotion(dt, null, true);
      this.syncCharacter(dt);
      return;
    }

    const moving = it.dir.lengthSq() > 0.01;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (!this.busy) {
      this.dashRest += dt;
      if (this.dashRest > 0.6) this.dashChain = 0;
    }

    // Finished locking action → hand back to locomotion.
    if (this.action && this.action.ended && this.power === 'none') {
      const name = this.actionName;
      const wasDash = name.startsWith('dash_');
      const keepGuard = name === 'guard_hit' && this.guarding;
      if (!keepGuard) {
        this.stopAction(this.move === 'fly' ? 0.2 : 0.14);
        if (wasDash) this.onDashEnd();
        if ((GROUND_CHAIN as readonly string[]).includes(name) || name === 'rush_end') this.sinceAttack = 0;
        if (name === 'light5' || name === 'rush_end') this.comboIdx = -1;
        if ((AIR_CHAIN as readonly string[]).includes(name) && name === AIR_CHAIN[AIR_CHAIN.length - 1]) this.airIdx = -1;
      }
    }
    this.kinematicY = this.busy && (this.actionName === 'special' || this.actionName === 'ex_special');
    // Cancel windows: moving out of recoveries.
    if (this.busy && this.actionWindow('cancel') && moving && !this.actionName.startsWith('dash_') && !this.guarding && !this.beam) {
      this.stopAction(0.18);
      if (this.sinceAttack < 0.6) this.comboIdx = -1;
    }
    if (this.cosmetic && this.landCancelAt >= 0 && this.cosmetic.time >= this.landCancelAt) {
      this.stopCosmetic(0.14);
      this.landCancelAt = -1;
    }
    if (this.sinceAttack > 0.8 && !this.busy) this.comboIdx = -1;

    const b = this.controls.buttons;
    if (!this.scripted) {
      // Dash (Q) beats everything.
      if (b.buffered('dodge', 0.2) && this.tryDash()) b.consume('dodge', 0.2);
      this.tryPower(dt);
      if (this.power === 'none') {
        this.tryGuard();
        if (!this.guarding) {
          this.tryKi(dt);
          this.tryHeavy(dt);
          if (!this.heavyHeld) this.tryLight();
          this.updateRush(dt);
        }
      }
    }
    this.updateBeamAim(dt);

    // Jump / flight (Space, Space×2).
    if (!this.scripted && b.pressed('jump') && this.power === 'none' && !this.guarding) {
      if (this.move === 'ground') {
        if (this.jumpPrep >= 0) {
          if (b.doubleTapped('jump')) this.flyAfterJump = true;
        } else if (!this.busy || this.actionWindow('cancel')) {
          if (this.busy) this.stopAction(0.08);
          this.startJump();
        }
      } else if (b.doubleTapped('jump') && !this.busy) {
        if (this.move === 'fly') this.exitFlight();
        else this.enterFlight();
      }
    }
    if (this.jumpPrep >= 0) {
      this.jumpPrep -= dt;
      if (this.jumpPrep < 0) this.launch();
    }
    if (this.move === 'air' && this.jumping && b.released('jump') && this.vel.y > 5) this.vel.y *= 0.6;
    if (this.move === 'air' && this.jumping) {
      const vy = this.vel.y;
      this.gravityScale = vy < 2.3 && vy > -1.4 ? 0.5 : 1;
      if (this.cosmetic && this.cosmetic.clip.name === 'jump_rise' && vy < -2) this.stopCosmetic(0.35);
    } else this.gravityScale = 1;

    // Touch down from flight when descending onto the ground.
    if (this.move === 'fly' && !this.busy) {
      const g = Math.max(this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5), -0.02);
      if (this.pos.y - g < 0.45 && (it.vertical < 0 || this.vel.y < -6)) {
        const impact = Math.max(-this.vel.y, Math.hypot(this.vel.x, this.vel.z) * 0.5);
        this.move = 'ground';
        this.grounded = true;
        this.pos.y = g;
        this.vel.y = 0;
        this.fx('flight', { on: false, pos: this.pos.clone() });
        this.landed(impact);
      }
    }

    // EX Meteor Crash: scripted arc above the target, axe kick down into the ground.
    if (this.actionName === 'ex_special' && this.action) {
      const t = this.action.time;
      let k = 0;
      if (t >= 0.08 && t < 0.48) k = 1 + Math.sin(((t - 0.08) / 0.4) * Math.PI) * 0.12;
      else if (t >= 0.48 && t < 0.62) k = 1 - EASE.in((t - 0.48) / 0.14);
      this.pos.y = this.exGround + this.exHeight * k;
      if (t >= 0.62 && this.move !== 'ground') {
        this.move = 'ground';
        this.grounded = true;
        this.vel.y = 0;
      } else if (k > 0.05) this.move = 'air';
    }

    // Facing.
    // Only the forward lunge steers with the stick; side slides and back hops keep the facing they started with.
    const freeToTurn = !this.busy || this.actionName === 'dash_f';
    if (freeToTurn) {
      if (it.faceYaw !== null) this.turnToward(it.faceYaw, 20, dt);
      else if (this.move === 'fly') {
        const hv = Math.hypot(this.vel.x, this.vel.z);
        const fd = it.flyDir;
        const want = fd && Math.hypot(fd.x, fd.z) > 0.15 ? Math.atan2(fd.x, fd.z) : hv > 2 ? Math.atan2(this.vel.x, this.vel.z) : null;
        if (want !== null) this.turnToward(want, 5.5, dt);
      } else if (moving) {
        const rate = this.move === 'air' ? 7 : it.sprint ? 8 : 13;
        this.turnToward(Math.atan2(it.dir.x, it.dir.z), rate, dt);
      }
    } else if (this.target?.alive && this.action && ATTACKS[this.actionName]) {
      // Track the target through the wind-up of an attack and glide in if it was knocked out of reach, so
      // chains keep connecting (ZZZ-style magnetism).
      const hw = this.action.clip.def.win?.hit;
      const def = ATTACKS[this.actionName];
      if (hw && this.action.time < hw[1]) {
        this.turnToward(this.yawTo(this.target.pos), 9, dt);
        const to = _v.subVectors(this.target.pos, this.pos).setY(0);
        const d = to.length();
        const keep = def.reach * 0.62 + this.target.radius;
        if (d > keep && d < def.reach + 4.5 && this.move === 'ground' && this.target.move === 'ground') {
          this.pos.addScaledVector(to.normalize(), Math.min(d - keep, 11 * dt));
        }
      }
    }

    const locked = this.jumpPrep >= 0 || this.power !== 'none';
    this.integrate(dt, locked ? null : it);
    this.driveLocomotion(dt, it, this.inCombat);
    if (this.target?.alive && !this.busy) this.char.lookTarget = this.target.chest(new THREE.Vector3());
    this.syncCharacter(dt);
  }
}
