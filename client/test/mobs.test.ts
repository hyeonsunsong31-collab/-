import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STAT_KEYS, statTotal } from '@ak/shared';
import { AttackDirector } from '../src/ai/MobAI.ts';
import { CombatSystem } from '../src/combat/CombatSystem.ts';
import { Clock } from '../src/core/Clock.ts';
import { MOB_KINDS, mobStats } from '../src/gameplay/Mob.ts';
import { ATTACKS } from '../src/combat/attacks.ts';
import { allClipDefs } from '../src/animation/clips/index.ts';
import type { Mob } from '../src/gameplay/Mob.ts';
import type { Combatant } from '../src/combat/Combatant.ts';

const mob = (id: string) => ({ kind: { id }, alive: true, state: 'normal' }) as unknown as Mob;

describe('AttackDirector', () => {
  it('lets at most two enemies swing at once', () => {
    const d = new AttackDirector();
    const [a, b, c] = [mob('brigand'), mob('knight'), mob('imp')];
    expect(d.request(a)).toBe(true);
    expect(d.request(b)).toBe(true);
    expect(d.request(c)).toBe(false);
    // Re-requesting a held token is free.
    expect(d.request(a)).toBe(true);
    d.release(a);
    expect(d.request(c)).toBe(true);
  });

  it('counts a golem as two attackers', () => {
    const d = new AttackDirector();
    const g = mob('golem');
    expect(d.request(mob('imp'))).toBe(true);
    expect(d.request(g)).toBe(false);
    const d2 = new AttackDirector();
    expect(d2.request(g)).toBe(true);
    expect(d2.request(mob('imp'))).toBe(false);
  });

  it('frees tokens held by the dead or reeling', () => {
    const d = new AttackDirector();
    const a = mob('brigand');
    const b = mob('brigand');
    d.request(a);
    d.request(b);
    (a as unknown as { state: string }).state = 'hurt';
    d.prune();
    expect(d.request(mob('imp'))).toBe(true);
  });
});

describe('mob data', () => {
  it('stat budgets follow the level (+5 points per level)', () => {
    for (const k of Object.keys(MOB_KINDS) as (keyof typeof MOB_KINDS)[]) {
      const s1 = mobStats(MOB_KINDS[k], 1);
      const s10 = mobStats(MOB_KINDS[k], 10);
      expect(statTotal(s10) - statTotal(s1)).toBe(45);
      for (const key of STAT_KEYS) expect(s10[key]).toBeGreaterThanOrEqual(10);
    }
  });

  it('every mob attack clip exists and has attack data or an event-driven effect', () => {
    const clips = new Map(allClipDefs().map((c) => [c.name, c]));
    for (const k of Object.values(MOB_KINDS)) {
      for (const at of k.attacks) {
        const clip = clips.get(at.clip);
        expect(clip, at.clip).toBeDefined();
        const melee = !!ATTACKS[at.clip];
        const evented = (clip!.events ?? []).length > 0;
        expect(melee || evented, at.clip).toBe(true);
        expect(at.min).toBeLessThan(at.max);
      }
    }
  });
});

describe('body separation', () => {
  function body(x: number, z: number, scale = 1) {
    return {
      pos: new THREE.Vector3(x, 0, z),
      radius: 0.38 * scale,
      height: 1.8 * scale,
      alive: true,
      movable: true,
      busy: false,
      char: { scale },
      action: null,
      state: 'normal',
      actionWindow: () => false,
    };
  }

  it('pushes overlapping fighters apart over a few frames, heavier ones less', () => {
    const cs = new CombatSystem(new Clock(), null);
    const small = body(0, 0);
    const big = body(0.2, 0, 2);
    cs.add(small as unknown as Combatant);
    cs.add(big as unknown as Combatant);
    for (let i = 0; i < 60; i++) cs.update(1 / 60, 1 / 60);
    const gap = small.pos.distanceTo(big.pos);
    expect(gap).toBeGreaterThan(small.radius + big.radius - 0.02);
    // The light one moved much further than the golem-sized one.
    expect(Math.abs(small.pos.x)).toBeGreaterThan(Math.abs(big.pos.x - 0.2) * 4);
  });

  it('lets dashes (i-frames) slip through', () => {
    const cs = new CombatSystem(new Clock(), null);
    const a = body(0, 0);
    const b = { ...body(0.1, 0), actionWindow: (n: string) => n === 'iframes' };
    cs.add(a as unknown as Combatant);
    cs.add(b as unknown as Combatant);
    cs.update(1 / 60, 1 / 60);
    expect(a.pos.x).toBe(0);
    expect(b.pos.x).toBe(0.1);
  });
});
