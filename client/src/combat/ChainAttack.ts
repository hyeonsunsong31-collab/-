import * as THREE from 'three';
import { COMBAT } from '@ak/shared';
import type { Clock } from '../core/Clock.ts';
import type { CombatSystem } from './CombatSystem.ts';
import type { Combatant } from './Combatant.ts';
import type { Hero } from '../gameplay/Hero.ts';
import type { CameraRig } from '../camera/CameraRig.ts';
import type { Input } from '../input/Input.ts';
import { ChainPrompt, type ChainPick } from '../ui/ChainPrompt.ts';
import { chainShot } from '../camera/Shots.ts';

type Phase = 'none' | 'prompt' | 'exec';

/**
 * ZZZ Chain Attack: a heavy hit on a stunned foe freezes time and offers three cinematic finishers
 * (LMB Rush Barrage / E Meteor Smash / R Thunder Blast). A finisher that lands on a still-stunned foe can chain
 * again, up to three times.
 */
export class ChainAttack {
  phase: Phase = 'none';
  private count = 0;
  private timer = 0;
  private hero: Hero | null = null;
  private target: Combatant | null = null;
  private pick: ChainPick = 'rush';
  private t = 0;
  private again = false;
  private ui: ChainPrompt;
  private thunderAt = -1;

  constructor(
    private clock: Clock,
    private combat: CombatSystem,
    private cam: CameraRig,
    private input: Input,
  ) {
    this.ui = new ChainPrompt();
    this.ui.onPick = (p) => {
      if (this.phase === 'prompt') this.execute(p);
    };
    combat.onChainTrigger = (att, t) => this.trigger(att as Hero, t);
  }

  get active(): boolean {
    return this.phase !== 'none';
  }

  trigger(att: Hero, target: Combatant): void {
    if (this.phase === 'exec' && target === this.target) {
      // A finisher connected on a still-stunned foe: offer the next link once it ends.
      if (this.count < COMBAT.chainMax) this.again = true;
      return;
    }
    if (this.phase !== 'none') return;
    this.count = 0;
    this.hero = att;
    this.target = target;
    this.prompt();
  }

  private prompt(): void {
    if (!this.hero || !this.target) return;
    this.count++;
    this.phase = 'prompt';
    this.timer = 3;
    this.again = false;
    this.clock.freeze('chain', true, true);
    this.hero.scripted = true;
    // Keep the victim dazed through the whole sequence.
    this.target.stunTimer = Math.max(this.target.stunTimer, 2.5);
    this.cam.punch(-1.6);
    this.cam.dutch(-6);
    this.ui.show(this.count, this.input.touchMode);
    this.combat.emit({ type: 'chain', phase: 'prompt', attacker: this.hero, target: this.target, count: this.count });
  }

  private execute(p: ChainPick): void {
    const h = this.hero;
    const t = this.target;
    if (!h || !t) return this.end();
    this.ui.highlight(p);
    this.ui.hide();
    this.clock.freeze('chain', false, true);
    this.phase = 'exec';
    this.pick = p;
    this.t = 0;
    this.thunderAt = -1;
    h.scripted = true;
    h.target = t;
    h.stopCosmetic(0.05);
    h.endChainState();
    this.combat.addSurge(h, COMBAT.surge.chain);
    t.stunTimer = Math.max(t.stunTimer, 3);
    h.attackScale = 1 + (this.count - 1) * 0.25;
    // Blink to point-blank range in front of the target.
    const to = new THREE.Vector3().subVectors(h.pos, t.pos).setY(0);
    if (to.lengthSq() < 1e-4) to.set(0, 0, 1);
    to.normalize();
    const from = h.pos.clone();
    h.pos.set(t.pos.x + to.x * 1.8, t.pos.y, t.pos.z + to.z * 1.8);
    h.yaw = h.yawTo(t.pos);
    h.vel.set(0, 0, 0);
    this.combat.emit({ type: 'anim', who: h, name: 'vanish', data: { from, to: h.pos.clone() } });
    this.combat.emit({ type: 'chain', phase: 'start', attacker: h, target: t, count: this.count });
    if (p === 'rush') {
      h.defOverride = { rush_hit: 'chain_rush', rush_end: 'chain_rush_end' };
      h.playAction('rush', { fadeIn: 0.05, fadeOut: 0.1, speed: 1.25 });
      this.cam.play(chainShot(h, t, 1.55, 'rush'));
    } else if (p === 'meteor') {
      h.defOverride = { ex_special: 'chain_meteor' };
      h.playAction('ex_special', { fadeIn: 0.03, fadeOut: 0.2 });
      this.cam.play(chainShot(h, t, 1.3, 'meteor'));
    } else {
      // Thunder: leap high above and call lightning down through the hands.
      h.defOverride = null;
      h.pos.set(t.pos.x + to.x * 3, t.pos.y + 5.5 * h.char.scale, t.pos.z + to.z * 3);
      h.move = 'fly';
      h.playAction('beam_fire', { fadeIn: 0.06, fadeOut: 0.2 });
      this.thunderAt = 0.32;
      this.cam.play(chainShot(h, t, 1.4, 'thunder'));
    }
  }

  update(realDt: number, dt: number): void {
    if (this.phase === 'prompt') {
      this.timer -= realDt;
      this.ui.progress(this.timer / 3);
      const b = this.input;
      if (b.pressed('light')) this.execute('rush');
      else if (b.pressed('heavy')) this.execute('meteor');
      else if (b.pressed('ki')) this.execute('thunder');
      else if (this.timer <= 0 || !this.target?.alive) this.end();
      return;
    }
    if (this.phase !== 'exec') return;
    const h = this.hero!;
    const t = this.target!;
    this.t += dt;
    if (this.pick === 'rush') {
      if (h.actionName === 'rush' && this.t > 1.05) h.playAction('rush_end', { fadeIn: 0.04, fadeOut: 0.16 });
      if (h.actionName === 'rush_end' && h.actionDone) this.finish();
      if (!h.actionName) this.finish();
    } else if (this.pick === 'meteor') {
      if (h.actionDone || h.actionName !== 'ex_special') this.finish();
    } else {
      if (this.thunderAt >= 0 && this.t >= this.thunderAt) {
        this.thunderAt = -1;
        const hands = h.char.handWorld('L', new THREE.Vector3()).add(h.char.handWorld('R', new THREE.Vector3())).multiplyScalar(0.5);
        this.combat.emit({ type: 'anim', who: h, name: 'thunderStrike', data: { from: hands, to: t.chest(new THREE.Vector3()) } });
        this.combat.blast(h, 'chain_thunder', t.chest(new THREE.Vector3()), 4.5 * h.char.scale, h.attackScale);
      }
      if (this.t > 1.1) {
        h.stopAction(0.2);
        h.move = 'air';
        this.finish();
      }
    }
  }

  private finish(): void {
    const h = this.hero;
    if (h) {
      h.scripted = false;
      h.defOverride = null;
      h.attackScale = 1;
    }
    if (this.again && this.count < COMBAT.chainMax && this.target?.alive && this.target.stunned) {
      this.prompt();
      return;
    }
    this.end();
  }

  end(): void {
    if (this.phase === 'none') return;
    this.clock.freeze('chain', false, true);
    this.ui.hide();
    const h = this.hero;
    if (h) {
      h.scripted = false;
      h.defOverride = null;
      h.attackScale = 1;
    }
    if (h && this.target) this.combat.emit({ type: 'chain', phase: 'end', attacker: h, target: this.target, count: this.count });
    this.phase = 'none';
    this.hero = null;
    this.target = null;
    this.again = false;
  }
}
