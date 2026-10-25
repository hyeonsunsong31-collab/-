import * as THREE from 'three';
import type { Mob } from '../gameplay/Mob.ts';
import type { Combatant } from '../combat/Combatant.ts';
import { ATTACKS } from '../combat/attacks.ts';

type State = 'idle' | 'wander' | 'alert' | 'chase' | 'engage' | 'attack' | 'return';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Hands out attack tokens so only a couple of enemies swing at the player at once (the rest circle at a
 * respectful distance and wait their turn), like a fighting-game crowd.
 */
export class AttackDirector {
  private holders = new Set<Mob>();
  maxAttackers = 2;

  request(m: Mob): boolean {
    if (this.holders.has(m)) return true;
    // Heavies (golems) count double.
    let used = 0;
    for (const h of this.holders) used += h.kind.id === 'golem' ? 2 : 1;
    const cost = m.kind.id === 'golem' ? 2 : 1;
    if (used + cost > this.maxAttackers) return false;
    this.holders.add(m);
    return true;
  }

  release(m: Mob): void {
    this.holders.delete(m);
  }

  prune(): void {
    for (const h of this.holders) if (!h.alive || h.state !== 'normal') this.holders.delete(h);
  }
}

/**
 * Behaviour for every mob archetype: idle/wander at the camp, notice (with a short "alert" beat), chase, engage
 * (strafe and hold distance until the director grants a token), pick an attack by range/weight/cooldown,
 * archetype tricks (knights raise shields against frontal attacks, warlocks kite and blink away, imps leap in and
 * self-destruct when cornered, golems shrug off hits), and leash back home when dragged too far.
 */
export class MobAI {
  state: State = 'idle';
  private t = 0;
  private think = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private wanderTo = new THREE.Vector3();
  private blockT = 0;
  private hasToken = false;
  /** 0..1 aggression/skill scaling from the region's danger. */
  skill = 0.5;

  constructor(
    readonly mob: Mob,
    private director: AttackDirector,
    private rand: () => number = Math.random,
  ) {}

  private setState(s: State): void {
    if (this.state === s) return;
    this.state = s;
    this.t = 0;
  }

  step(dt: number, foes: Combatant[]): void {
    const m = this.mob;
    const k = m.kind;
    this.t += dt;
    m.intent.dir.set(0, 0, 0);
    m.intent.sprint = false;
    m.face = null;
    if (!m.alive || m.state !== 'normal') {
      this.dropToken();
      return;
    }
    // Pick / keep a target.
    let tgt = m.target && m.target.alive ? m.target : null;
    const size = m.size;
    if (!tgt || tgt.pos.distanceTo(m.pos) > k.aggro * 1.8) {
      tgt = null;
      let best = Infinity;
      for (const f of foes) {
        if (!f.alive) continue;
        const d = f.pos.distanceTo(m.pos);
        // Getting hit always draws aggro.
        const r = m.sinceHit < 2 ? k.aggro * 3 : k.aggro;
        if (d < r && d < best) {
          best = d;
          tgt = f;
        }
      }
    }
    m.target = tgt;
    const homeD = _v.subVectors(m.home, m.pos).setY(0).length();
    if (!tgt) {
      this.dropToken();
      if (homeD > 6) this.setState('return');
      else if (this.state !== 'wander') this.setState('idle');
    } else if (this.state === 'idle' || this.state === 'wander' || this.state === 'return') {
      this.setState('alert');
    }
    if (tgt && homeD > k.aggro * 3.2 && m.sinceHit > 3) {
      // Leashed: give up and walk home.
      m.target = null;
      this.dropToken();
      this.setState('return');
    }

    switch (this.state) {
      case 'idle':
        if (this.t > 3 + this.rand() * 4) {
          this.wanderTo.set(m.home.x + (this.rand() - 0.5) * 10, 0, m.home.z + (this.rand() - 0.5) * 10);
          this.setState('wander');
        }
        return;
      case 'wander': {
        const to = _v.subVectors(this.wanderTo, m.pos).setY(0);
        if (to.length() < 0.8 || this.t > 8) this.setState('idle');
        else m.intent.dir.copy(to.normalize()).multiplyScalar(0.35);
        return;
      }
      case 'return': {
        const to = _v.subVectors(m.home, m.pos).setY(0);
        if (to.length() < 1.5) {
          this.setState('idle');
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5);
        } else {
          m.intent.dir.copy(to.normalize());
          m.intent.sprint = true;
        }
        return;
      }
      case 'alert':
        if (tgt) m.face = m.yawTo(tgt.pos);
        if (this.t > 0.45 - this.skill * 0.25) this.setState('chase');
        return;
    }
    if (!tgt) return;
    const foe = tgt;

    const to = _v.subVectors(foe.pos, m.pos);
    const dy = to.y;
    to.y = 0;
    const dist = to.length();
    const dir = dist > 1e-3 ? to.divideScalar(dist) : m.forward(to);
    m.face = Math.atan2(dir.x, dir.z);

    // Knights: raise the shield when the foe winds up in front of them.
    if (k.blocks) {
      this.blockT -= dt;
      const a = tgt.action;
      const threat = a && ATTACKS[a.clip.name] && dist < 5 && !m.busy;
      if (threat && !m.guarding && this.rand() < (0.3 + this.skill * 0.5) * dt * 8) {
        m.startBlock();
        this.blockT = 0.9 + this.rand() * 0.8;
      }
      if (m.guarding) {
        if (this.blockT <= 0 || m.guard < 30) m.stopBlock();
        return;
      }
    }

    // Imps: corner-case suicide bomb when badly hurt and close.
    if (k.id === 'imp' && m.hp < m.maxHp * 0.35 && dist < 3 && !m.busy && this.rand() < dt * 0.8) {
      m.startBomb();
      return;
    }
    // Warlocks blink away when crowded.
    if (k.id === 'warlock' && dist < 3.5 && !m.busy && (m.cooldowns.get('warlock_blink') ?? 0) <= 0 && this.rand() < dt * 2.5) {
      m.cooldowns.set('warlock_blink', 6);
      m.playAction('warlock_blink', { fadeIn: 0.05 });
      return;
    }

    if (m.busy) return;
    const reach = (k.keep + tgt.radius) * size;
    const airborne = dy > 2.5;

    // Choose an attack when in range and holding a token.
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.18 + (1 - this.skill) * 0.3 + this.rand() * 0.15;
      const options = k.attacks.filter((at) => dist >= at.min * size && dist <= at.max * size + foe.radius && (m.cooldowns.get(at.clip) ?? 0) <= 0 && !airborne);
      if (options.length) {
        if (this.hasToken || this.director.request(m)) {
          this.hasToken = true;
          let sum = 0;
          for (const o of options) sum += o.weight;
          let r = this.rand() * sum;
          let pick = options[0];
          for (const o of options) {
            r -= o.weight;
            if (r <= 0) {
              pick = o;
              break;
            }
          }
          m.want = pick.clip;
          this.setState('attack');
          return;
        }
      }
    }
    if (this.state === 'attack' && this.t > 0.2) {
      // Swing finished: give someone else a turn and back off a little.
      this.dropToken();
      this.setState('engage');
    }

    // Movement: close in to the preferred distance, then circle.
    if (dist > reach + 6 * size) {
      this.setState('chase');
      m.intent.dir.copy(dir);
      m.intent.sprint = true;
    } else if (dist > reach + 0.4 * size && (this.hasToken || dist > reach + 3 * size || k.keep > 4)) {
      m.intent.dir.copy(dir).multiplyScalar(k.keep > 4 ? 0.4 : 0.85);
      this.setState('engage');
    } else {
      this.setState('engage');
      if (this.rand() < dt * 0.5) this.strafe = -this.strafe;
      const waiting = !this.hasToken;
      const back = dist < reach * (waiting ? 1.4 : 0.8) ? -0.5 : 0;
      m.intent.dir.set(-dir.z * this.strafe, 0, dir.x * this.strafe).multiplyScalar(waiting ? 0.35 : 0.25).addScaledVector(dir, back * 0.6);
    }
  }

  private dropToken(): void {
    if (this.hasToken) this.director.release(this.mob);
    this.hasToken = false;
  }
}
