import { describe, it, expect } from 'vitest';
import {
  baseStats,
  basePowerLevel,
  powerLevel,
  balanceRatio,
  newProfile,
  addXp,
  grantLevels,
  allocate,
  respec,
  isConsistent,
  xpToNext,
  POINTS_PER_LEVEL,
  MATCH_WIN_LEVELS,
  computeDamage,
  defFactor,
  COMBAT,
  BuffSet,
  maxUnlockedTier,
  nextForm,
  FORMS,
  generateRival,
  deriveStats,
  killXp,
  type Stats,
} from '../src/index.ts';

const stats = (o: Partial<Stats>): Stats => ({ ...baseStats(), ...o });

describe('power level', () => {
  it('level-1 hero is ~465', () => {
    expect(powerLevel(baseStats())).toBe(465);
  });

  it('rises with stat amount', () => {
    let prev = basePowerLevel(baseStats());
    for (let add = 5; add <= 500; add += 5) {
      const s = stats({ str: 10 + add / 6, ki: 10 + add / 6, vit: 10 + add / 6, agi: 10 + add / 6, imp: 10 + add / 6, foc: 10 + add / 6 });
      const pl = basePowerLevel(s);
      expect(pl).toBeGreaterThan(prev);
      prev = pl;
    }
  });

  it('rewards balance: same total, balanced build scores higher', () => {
    const balanced = stats({ str: 30, ki: 30, vit: 30, agi: 30, imp: 30, foc: 30 });
    const lopsided = stats({ str: 130, ki: 10, vit: 10, agi: 10, imp: 10, foc: 10 });
    expect(balanceRatio(balanced)).toBeCloseTo(1, 6);
    expect(balanceRatio(lopsided)).toBeLessThan(0.8);
    expect(basePowerLevel(balanced)).toBeGreaterThan(basePowerLevel(lopsided));
  });

  it('a lopsided build with more total can still out-power a smaller balanced one', () => {
    const bigLopsided = stats({ str: 400 });
    const smallBalanced = stats({ str: 20, ki: 20, vit: 20, agi: 20, imp: 20, foc: 20 });
    expect(basePowerLevel(bigLopsided)).toBeGreaterThan(basePowerLevel(smallBalanced));
  });

  it('applies form and buff multipliers', () => {
    const base = powerLevel(baseStats());
    expect(powerLevel(baseStats(), 50)).toBe(Math.round(basePowerLevel(baseStats()) * 50));
    expect(powerLevel(baseStats(), 1, 1.1)).toBeGreaterThan(base);
  });
});

describe('progression', () => {
  it('xp curve', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(4)).toBe(800);
  });

  it('1 level = +5 stat points', () => {
    const p = newProfile('a', 'Hero');
    const { profile, levelsGained } = addXp(p, xpToNext(1));
    expect(levelsGained).toBe(1);
    expect(profile.level).toBe(2);
    expect(profile.unspent).toBe(POINTS_PER_LEVEL);
    expect(isConsistent(profile)).toBe(true);
  });

  it('multi-level xp gain carries remainder', () => {
    const p = newProfile('a', 'Hero');
    const r = addXp(p, xpToNext(1) + xpToNext(2) + 7);
    expect(r.levelsGained).toBe(2);
    expect(r.profile.xp).toBe(7);
    expect(r.profile.unspent).toBe(10);
  });

  it('bot match win = +5 levels = +25 points', () => {
    const p = newProfile('a', 'Hero');
    const w = grantLevels(p, MATCH_WIN_LEVELS);
    expect(w.level).toBe(6);
    expect(w.unspent).toBe(25);
    expect(isConsistent(w)).toBe(true);
  });

  it('allocation validates', () => {
    const p = grantLevels(newProfile('a', 'Hero'), 2);
    expect(allocate(p, { str: 11 })).toEqual({ ok: false, error: 'insufficient' });
    expect(allocate(p, { str: -1 })).toEqual({ ok: false, error: 'invalid' });
    expect(allocate(p, { str: 1.5 })).toEqual({ ok: false, error: 'invalid' });
    expect(allocate(p, { hax: 1 } as never)).toEqual({ ok: false, error: 'invalid' });
    expect(allocate(p, {})).toEqual({ ok: false, error: 'empty' });
    const ok = allocate(p, { str: 4, foc: 6 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.profile.stats.str).toBe(14);
      expect(ok.profile.unspent).toBe(0);
      expect(isConsistent(ok.profile)).toBe(true);
      const r = respec(ok.profile);
      expect(r.unspent).toBe(10);
      expect(r.stats).toEqual(baseStats());
    }
  });

  it('kill xp scales with relative power', () => {
    expect(killXp(5, 2000, 1000)).toBeGreaterThan(killXp(5, 1000, 1000));
    expect(killXp(5, 10, 100000)).toBeGreaterThan(0);
  });
});

describe('combat math', () => {
  const base = {
    atk: 1000, skillMult: 1, dmgBonus: 0, crit: false, critDmg: 0.5, attackerLevel: 10, targetDef: 0, stunned: false,
  };
  it('def factor', () => {
    expect(defFactor(10, 0)).toBe(1);
    expect(defFactor(10, 200)).toBeCloseTo(0.5, 6);
  });
  it('crit, stun and block multipliers', () => {
    const plain = computeDamage(base);
    expect(plain).toBe(1000);
    expect(computeDamage({ ...base, crit: true })).toBe(1500);
    expect(computeDamage({ ...base, stunned: true })).toBe(Math.round(1000 * COMBAT.stunDamageMult));
    expect(computeDamage({ ...base, blocked: true })).toBe(300);
    expect(computeDamage({ ...base, targetDef: 200, defDown: 0.5 })).toBe(Math.round(1000 * defFactor(10, 100)));
  });
  it('derived stats grow with points', () => {
    const a = deriveStats(baseStats(), 1);
    const b = deriveStats(stats({ vit: 50, agi: 300, foc: 900 }), 1);
    expect(b.maxHp).toBeGreaterThan(a.maxHp);
    expect(b.moveSpeed).toBeLessThanOrEqual(1.4);
    expect(b.critRate).toBeLessThan(0.76);
  });
});

describe('buffs', () => {
  it('stacks up to max and sums modifiers', () => {
    const b = new BuffSet();
    for (let i = 0; i < 15; i++) b.add('momentum');
    expect(b.stacksOf('momentum')).toBe(10);
    expect(b.total('dmgPct')).toBeCloseTo(0.2, 6);
  });
  it('expire policy: all vs one', () => {
    const b = new BuffSet();
    b.add('momentum', 5);
    b.add('instinct', 3);
    b.update(3.01);
    expect(b.stacksOf('momentum')).toBe(0);
    expect(b.stacksOf('instinct')).toBe(3);
    b.update(5);
    expect(b.stacksOf('instinct')).toBe(2);
    b.update(8);
    expect(b.stacksOf('instinct')).toBe(1);
    b.update(8);
    expect(b.stacksOf('instinct')).toBe(0);
  });
  it('infinite buffs persist', () => {
    const b = new BuffSet();
    b.add('mastery', 3);
    b.update(1000);
    expect(b.stacksOf('mastery')).toBe(3);
    expect(b.total('drainPct')).toBeCloseTo(-0.15, 6);
  });
});

describe('forms', () => {
  it('unlock by level', () => {
    expect(maxUnlockedTier(1)).toBe(0);
    expect(maxUnlockedTier(10)).toBe(1);
    expect(maxUnlockedTier(149)).toBe(5);
    expect(maxUnlockedTier(150)).toBe(6);
  });
  it('next form requires level and surge', () => {
    expect(nextForm(0, 9, 3000)).toBeNull();
    expect(nextForm(0, 10, 999)).toBeNull();
    expect(nextForm(0, 10, 1000)?.id).toBe('asc1');
    expect(nextForm(6, 999, 3000)).toBeNull();
  });
  it('ladder is strictly escalating', () => {
    for (let i = 1; i < FORMS.length; i++) {
      expect(FORMS[i].plMult).toBeGreaterThan(FORMS[i - 1].plMult);
      expect(FORMS[i].unlockLevel).toBeGreaterThan(FORMS[i - 1].unlockLevel);
    }
  });
});

describe('rival generation', () => {
  it('scales bot PL to the difficulty ratio', () => {
    const player = stats({ str: 60, ki: 40, vit: 50, agi: 45, imp: 30, foc: 35 });
    const ppl = basePowerLevel(player);
    for (const [diff, ratio] of [
      ['easy', 0.8],
      ['normal', 1.0],
      ['hard', 1.25],
      ['elite', 1.6],
    ] as const) {
      const bot = generateRival(player, 30, diff, 1234);
      const bpl = basePowerLevel(bot.stats);
      expect(bpl / ppl).toBeGreaterThan(ratio * 0.93);
      expect(bpl / ppl).toBeLessThan(ratio * 1.07);
    }
  });
  it('is deterministic per seed', () => {
    expect(generateRival(baseStats(), 1, 'normal', 7)).toEqual(generateRival(baseStats(), 1, 'normal', 7));
  });
});
