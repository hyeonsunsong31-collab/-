import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { BuffSet, COMBAT, FORMS, baseStats, deriveStats } from '@ak/shared';
import { Clock } from '../src/core/Clock.ts';
import { CombatSystem } from '../src/combat/CombatSystem.ts';
import { ATTACKS } from '../src/combat/attacks.ts';
import type { Combatant } from '../src/combat/Combatant.ts';
import { allClipDefs } from '../src/animation/clips/index.ts';

/** Minimal stand-in exposing exactly what the combat system reads and calls. */
function fake(team: 'hero' | 'foe', x: number, z: number, yaw = 0) {
  const c = {
    team,
    pos: new THREE.Vector3(x, 0, z),
    yaw,
    radius: 0.38,
    height: 1.8,
    alive: true,
    state: 'normal',
    invulnerable: false,
    dashAge: 9,
    canPerfectDodge: team === 'hero',
    perfectDodged: false,
    guarding: false,
    guardAge: 9,
    canAct: true,
    guard: COMBAT.guardMax as number,
    hp: 1000,
    maxHp: 1000,
    energy: 0,
    surge: 0,
    level: 1,
    atk: 100,
    kiAtk: 100,
    def: 50,
    critRate: 0,
    critDmg: 0.5,
    stunned: false,
    attackScale: 1,
    defOverride: null,
    form: FORMS[0],
    buffs: new BuffSet(),
    derived: deriveStats(baseStats(), 1),
    knock: new THREE.Vector3(),
    action: null,
    char: {
      scale: 1,
      handWorld: (_s: string, out: THREE.Vector3) => out.copy(c.pos).add(new THREE.Vector3(Math.sin(c.yaw) * 0.6, 1.4, Math.cos(c.yaw) * 0.6)),
      footWorld: (_s: string, out: THREE.Vector3) => out.copy(c.pos),
    },
    forward(out = new THREE.Vector3()) {
      return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    },
    chest(out = new THREE.Vector3()) {
      return out.copy(this.pos).setY(this.pos.y + 1.3);
    },
    applyHit: vi.fn((_h: unknown, dmg: number) => {
      c.hp -= dmg;
    }),
    onBlocked: vi.fn(),
    onParry: vi.fn(),
    onGuardBreak: vi.fn(),
    onPerfectDodge: vi.fn(),
    startFlash: vi.fn(),
  };
  return c;
}
const as = (c: ReturnType<typeof fake>) => c as unknown as Combatant;

function setup() {
  const clock = new Clock();
  const cs = new CombatSystem(clock, null);
  cs.rand = () => 0.99; // never crit
  const hero = fake('hero', 0, 0, 0);
  const foe = fake('foe', 0, 1.6, Math.PI);
  cs.add(as(hero));
  cs.add(as(foe));
  cs.player = as(hero);
  return { clock, cs, hero, foe };
}

describe('combat resolution', () => {
  it('lands a hit, deals damage and feeds the attacker gauges', () => {
    const { cs, hero, foe } = setup();
    const res = cs.resolveHit(as(hero), as(foe), ATTACKS.light2);
    expect(res).not.toBeNull();
    expect(res!.dmg).toBeGreaterThan(0);
    expect(foe.applyHit).toHaveBeenCalledOnce();
    expect(hero.energy).toBeGreaterThan(0);
    expect(hero.surge).toBeGreaterThan(0);
    expect(hero.buffs.stacksOf('momentum')).toBe(1);
  });

  it('perfect dodge: dash inside the window avoids the hit, slows time and grants Surge + Instinct', () => {
    const { cs, clock, hero, foe } = setup();
    hero.dashAge = COMBAT.perfectDodgeWindow * 0.5;
    const res = cs.resolveHit(as(foe), as(hero), ATTACKS.light4);
    expect(res).toBeNull();
    expect(hero.onPerfectDodge).toHaveBeenCalledOnce();
    expect(clock.slowmoActive).toBe(true);
    expect(hero.surge).toBeCloseTo(COMBAT.surge.perfectDodge * hero.derived.surgeGain, 5);
    expect(hero.buffs.stacksOf('instinct')).toBe(1);
    // Only once per dash.
    cs.resolveHit(as(foe), as(hero), ATTACKS.light4);
    expect(hero.onPerfectDodge).toHaveBeenCalledOnce();
  });

  it('late dodge: i-frames still avoid damage but give no perfect dodge', () => {
    const { cs, clock, hero, foe } = setup();
    hero.invulnerable = true;
    hero.dashAge = 0.5;
    expect(cs.resolveHit(as(foe), as(hero), ATTACKS.light4)).toBeNull();
    expect(hero.onPerfectDodge).not.toHaveBeenCalled();
    expect(clock.slowmoActive).toBe(false);
  });

  it('foes cannot perfect-dodge', () => {
    const { cs, hero, foe } = setup();
    foe.dashAge = 0.01;
    expect(cs.resolveHit(as(hero), as(foe), ATTACKS.light1)).not.toBeNull();
  });

  it('perfect parry staggers the attacker with heavy Daze and Guard Crack', () => {
    const { cs, hero, foe } = setup();
    hero.guarding = true;
    hero.guardAge = 0.05;
    const res = cs.resolveHit(as(foe), as(hero), ATTACKS.light2);
    expect(res?.parried).toBe(true);
    expect(hero.applyHit).not.toHaveBeenCalled();
    expect(foe.applyHit).toHaveBeenCalledOnce();
    expect(foe.buffs.stacksOf('guardCrack')).toBe(1);
    expect(hero.surge).toBeGreaterThan(0);
    expect(hero.onParry).toHaveBeenCalledOnce();
  });

  it('block: late guard absorbs 70% and drains guard; facing away does not block', () => {
    const a = setup();
    const open = a.cs.resolveHit(as(a.foe), as(a.hero), ATTACKS.light2)!.dmg;
    const b = setup();
    b.hero.guarding = true;
    b.hero.guardAge = 1;
    const res = b.cs.resolveHit(as(b.foe), as(b.hero), ATTACKS.light2)!;
    expect(res.blocked).toBe(true);
    expect(res.dmg).toBeLessThan(open * 0.4);
    expect(b.hero.guard).toBeLessThan(COMBAT.guardMax);
    expect(b.hero.onBlocked).toHaveBeenCalledOnce();
    const c = setup();
    c.hero.guarding = true;
    c.hero.guardAge = 1;
    c.hero.yaw = Math.PI; // back to the attacker
    expect(c.cs.resolveHit(as(c.foe), as(c.hero), ATTACKS.light2)!.blocked).toBe(false);
  });

  it('red (unblockable) attacks break the guard', () => {
    const { cs, hero, foe } = setup();
    hero.guarding = true;
    hero.guardAge = 0.02;
    const res = cs.resolveHit(as(foe), as(hero), { ...ATTACKS.heavy_release, flash: 'red' })!;
    expect(res.guardBroken).toBe(true);
    expect(res.parried).toBe(false);
    expect(hero.onGuardBreak).toHaveBeenCalledOnce();
  });

  it('heavy hit on a stunned foe by the player triggers a Chain Attack', () => {
    const { cs, hero, foe } = setup();
    const chain = vi.fn();
    cs.onChainTrigger = chain;
    foe.stunned = true;
    cs.resolveHit(as(hero), as(foe), ATTACKS.light2);
    expect(chain).not.toHaveBeenCalled();
    cs.resolveHit(as(hero), as(foe), ATTACKS.light5);
    expect(chain).toHaveBeenCalledOnce();
  });

  it('stunned targets take 1.5x damage', () => {
    const a = setup();
    const normal = a.cs.resolveHit(as(a.hero), as(a.foe), ATTACKS.light3)!.dmg;
    const b = setup();
    b.foe.stunned = true;
    const stunned = b.cs.resolveHit(as(b.hero), as(b.foe), ATTACKS.light3)!.dmg;
    expect(stunned / normal).toBeCloseTo(COMBAT.stunDamageMult, 1);
  });
});

describe('strike volumes and targeting', () => {
  it('inStrike respects reach, arc and height', () => {
    const { cs, hero, foe } = setup();
    expect(cs.inStrike(as(hero), as(foe), ATTACKS.light1)).toBe(true);
    foe.pos.set(0, 0, -1.6);
    expect(cs.inStrike(as(hero), as(foe), ATTACKS.light1)).toBe(false);
    foe.pos.set(0, 0, 4);
    expect(cs.inStrike(as(hero), as(foe), ATTACKS.light1)).toBe(false);
    foe.pos.set(0, 5, 1.5);
    expect(cs.inStrike(as(hero), as(foe), ATTACKS.light1)).toBe(false);
  });

  it('acquireTarget prefers the foe in the requested direction', () => {
    const { cs, hero, foe } = setup();
    const other = fake('foe', 3, 0, 0);
    cs.add(as(other));
    foe.pos.set(0, 0, 3);
    expect(cs.acquireTarget(as(hero), new THREE.Vector3(0, 0, 1))).toBe(as(foe));
    expect(cs.acquireTarget(as(hero), new THREE.Vector3(1, 0, 0))).toBe(as(other));
  });
});

describe('attack data', () => {
  const clips = new Map(allClipDefs().map((c) => [c.name, c]));
  it('every clip-driven attack has a hit window', () => {
    for (const id of Object.keys(ATTACKS)) {
      const clip = clips.get(id);
      if (!clip) continue; // event / projectile driven
      expect(clip.win?.hit, id).toBeDefined();
    }
  });
  it('values are sane', () => {
    for (const a of Object.values(ATTACKS)) {
      expect(a.mult).toBeGreaterThanOrEqual(0);
      expect(a.daze).toBeGreaterThanOrEqual(0);
      expect(a.hitstop).toBeLessThanOrEqual(0.25);
      expect(a.arc).toBeGreaterThan(0);
    }
  });
});
