import * as THREE from 'three';
import { COMBAT, FORMS, type RivalStyle } from '@ak/shared';
import type { Hero } from '../gameplay/Hero.ts';
import type { Combatant } from '../combat/Combatant.ts';
import { ATTACKS } from '../combat/attacks.ts';
import type { BotControls } from './BotControls.ts';
import type { ActionHandle } from '../animation/Animator.ts';

type Plan = 'approach' | 'pressure' | 'reset' | 'zone' | 'circle' | 'power';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * The Rogue Ascendant's brain: reads the opponent (attack wind-ups → dodge or parry with skill-scaled odds and
 * reaction time), closes distance with sprints and dashes, strings light chains into rushes, EX and Dragon Fists,
 * zones with ki bolts and beams, follows into the sky, powers up and transforms, and fires the Ultimate.
 */
export class RivalAI {
  foe: Combatant | null = null;
  private plan: Plan = 'approach';
  private planT = 0;
  private think = 0;
  private reacted: ActionHandle | null = null;
  private presses = 0;
  private strafe = 1;
  private rand: () => number;

  constructor(
    public skill: number,
    public style: RivalStyle,
    rand: () => number = Math.random,
  ) {
    this.rand = rand;
  }

  /** Aggression and range preferences per fighting style. */
  private get prefs() {
    switch (this.style) {
      case 'blaster':
        return { range: 11, aggression: 0.45, ki: 0.75 };
      case 'juggernaut':
        return { range: 2.2, aggression: 0.85, ki: 0.2 };
      case 'tactician':
        return { range: 5, aggression: 0.6, ki: 0.45 };
      default:
        return { range: 2.2, aggression: 0.75, ki: 0.3 };
    }
  }

  step(hero: Hero, ctl: BotControls, dt: number): void {
    ctl.move.set(0, 0, 0);
    ctl.sprint = false;
    ctl.vertical = 0;
    ctl.flyDir = null;
    const foe = this.foe;
    if (!foe || !foe.alive || !hero.alive || hero.state !== 'normal') return;
    hero.target = foe;
    const to = _v.subVectors(foe.pos, hero.pos);
    const dy = to.y;
    to.y = 0;
    const dist = to.length();
    const dir = dist > 1e-3 ? to.divideScalar(dist) : hero.forward(to);
    ctl.aim = foe.chest(_v2.clone());
    this.planT += dt;

    // ---- Defense: read the foe's wind-up.
    const a = foe.action;
    const def = a ? ATTACKS[a.clip.name] : undefined;
    if (a && def && a !== this.reacted && foe.state === 'normal') {
      const win = a.clip.def.win?.hit;
      if (win) {
        const until = (win[0] - a.time) / Math.max(0.01, a.speed);
        const reach = def.reach + 1.2;
        // Reaction delay shrinks with skill; better bots wait for the right moment.
        const lead = 0.1 + (1 - this.skill) * 0.12;
        if (until > 0 && until < lead + 0.12 && dist < reach + 1.5) {
          this.reacted = a;
          const r = this.rand();
          if (r < this.skill * 0.6) {
            // Dodge sideways (perfect-dodge timing when skilled).
            const side = this.rand() < 0.5 ? 1 : -1;
            ctl.move.set(-dir.z * side, 0, dir.x * side);
            ctl.press('dodge');
            return;
          }
          if (r < this.skill * 0.85 && def.flash !== 'red') {
            ctl.press('block', 0.35 + this.rand() * 0.3);
            return;
          }
        }
      }
    }
    if (ctl.holding('block')) return;

    // Opportunistic punish: perfect-dodge counter window.
    if (hero.counterWindow > 0 || hero.parryWindow > 0) {
      ctl.press('light');
      return;
    }

    // ---- Follow into the sky / come back down.
    const foeAir = foe.move === 'fly' || dy > 3;
    if (foeAir && hero.move === 'ground' && this.rand() < dt * 3) {
      ctl.press('jump');
      ctl.press('jump');
    }
    if (hero.move === 'fly') {
      ctl.vertical = THREE.MathUtils.clamp(dy * 0.5, -1, 1);
      if (!foeAir && dy < -1) ctl.vertical = -1;
    }

    // ---- Big moves.
    if (hero.surge >= COMBAT.ultimateCost && dist > 6 && dist < 45 && this.rand() < dt * 0.5 * this.skill) {
      ctl.press('ki', 0.6);
      return;
    }
    const next = FORMS[hero.form.tier + 1];
    if (next && next.tier <= hero.maxTier && hero.surge >= next.surgeCost && dist > 7 && hero.power === 'none') {
      this.plan = 'power';
      this.planT = 0;
    }
    if (this.plan === 'power') {
      if (hero.power === 'none' && this.planT > 0.3 && hero.form.tier >= (next?.tier ?? 0)) this.plan = 'approach';
      else {
        ctl.press('transform', 0.25);
        if (this.planT > 4) this.plan = 'approach';
        return;
      }
    }

    // ---- Plan selection.
    this.think -= dt;
    const p = this.prefs;
    if (this.think <= 0) {
      this.think = 0.12 + (1 - this.skill) * 0.3 + this.rand() * 0.15;
      if (dist > 14) this.plan = this.rand() < p.ki ? 'zone' : 'approach';
      else if (dist > p.range + 1.5) this.plan = this.rand() < p.ki * 0.6 ? 'zone' : 'approach';
      else if (this.plan !== 'pressure' && this.plan !== 'reset') this.plan = this.rand() < p.aggression ? 'pressure' : 'circle';
      if (this.plan === 'pressure' && this.presses > 6 + Math.floor(this.rand() * 4)) {
        this.plan = 'reset';
        this.planT = 0;
        this.presses = 0;
      }
      if (this.plan === 'reset' && this.planT > 0.6 + this.rand() * 0.6) this.plan = 'circle';
      if (this.plan === 'circle' && this.planT > 1.2 && this.rand() < 0.5) this.plan = 'pressure';
      if (this.rand() < 0.2) this.strafe = -this.strafe;
    }

    switch (this.plan) {
      case 'approach':
        ctl.move.copy(dir);
        ctl.sprint = dist > 7;
        if (dist > 6 && dist < 12 && hero.move === 'ground' && this.rand() < dt * 1.5) ctl.press('dodge');
        if (hero.move === 'fly') ctl.flyDir = _v2.subVectors(foe.chest(_v2), hero.chest()).normalize();
        if (dist < p.range + 0.8) this.plan = 'pressure';
        break;
      case 'pressure':
        if (dist > 2.6) ctl.move.copy(dir);
        if ((dist < 3.2 && !hero.busy) || hero.actionWindow('combo')) {
          const r = this.rand();
          if (hero.energy >= COMBAT.exCost && r < 0.08 + this.skill * 0.06) ctl.press('heavy');
          else if (r < 0.06) ctl.press('heavy', 0.6 + this.rand() * 0.6);
          else {
            ctl.press('light', hero.actionName === 'light5' && this.rand() < 0.5 ? 1.2 : 0);
            this.presses++;
          }
        }
        break;
      case 'reset':
        ctl.move.copy(dir).negate();
        if (this.planT < 0.05) ctl.press('dodge');
        break;
      case 'circle':
        ctl.move.set(-dir.z * this.strafe, 0, dir.x * this.strafe).addScaledVector(dir, dist > p.range ? 0.6 : -0.2).normalize().multiplyScalar(0.7);
        if (this.rand() < dt * 1.2 * p.ki && hero.ki > 10) ctl.press('ki');
        break;
      case 'zone':
        if (dist > 22) ctl.move.copy(dir);
        else ctl.move.set(-dir.z * this.strafe, 0, dir.x * this.strafe).multiplyScalar(0.6);
        if (hero.ki > 40 && dist > 12 && this.rand() < dt * 0.35) ctl.press('ki', 0.9 + this.rand() * 0.8);
        else if (hero.ki > 6 && this.rand() < dt * 3.5) ctl.press('ki');
        if (this.planT > 2.5 && this.rand() < dt) this.plan = 'approach';
        break;
    }
    // Planning time resets on change.
    if (this.plan !== this.lastPlan) {
      this.planT = 0;
      this.lastPlan = this.plan;
    }
  }

  private lastPlan: Plan = 'approach';
}
