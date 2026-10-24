/** Core stat keys. Every stat starts at 10 and grows with allocated points. */
export const STAT_KEYS = ['str', 'ki', 'vit', 'agi', 'imp', 'foc'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STAT_INFO: Record<StatKey, { label: string; short: string; desc: string }> = {
  str: { label: 'Strength', short: 'STR', desc: 'Melee attack power.' },
  ki: { label: 'Ki Power', short: 'KI', desc: 'Ki blast / beam power and ki pool.' },
  vit: { label: 'Vitality', short: 'VIT', desc: 'Max HP and defense.' },
  agi: { label: 'Agility', short: 'AGI', desc: 'Move speed, attack speed and dodge recovery.' },
  imp: { label: 'Impact', short: 'IMP', desc: 'Daze dealt — stun enemies faster.' },
  foc: { label: 'Focus', short: 'FOC', desc: 'Crit rate / crit damage, Energy and Surge gain.' },
};

export const BASE_STAT = 10;

export function baseStats(): Stats {
  return { str: BASE_STAT, ki: BASE_STAT, vit: BASE_STAT, agi: BASE_STAT, imp: BASE_STAT, foc: BASE_STAT };
}

export function cloneStats(s: Stats): Stats {
  return { str: s.str, ki: s.ki, vit: s.vit, agi: s.agi, imp: s.imp, foc: s.foc };
}

export function statTotal(s: Stats): number {
  let t = 0;
  for (const k of STAT_KEYS) t += s[k];
  return t;
}

export interface Profile {
  id: string;
  name: string;
  level: number;
  /** XP accumulated toward the next level. */
  xp: number;
  /** Unallocated stat points. */
  unspent: number;
  stats: Stats;
  wins: number;
  losses: number;
  /** Highest base power level ever reached (no form multiplier). */
  bestPL: number;
  createdAt: number;
  updatedAt: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'elite';

export const DIFFICULTIES: Record<Difficulty, { label: string; plRatio: number; formOffset: number; skill: number }> = {
  easy: { label: 'Apprentice', plRatio: 0.8, formOffset: -1, skill: 0.25 },
  normal: { label: 'Warrior', plRatio: 1.0, formOffset: 0, skill: 0.5 },
  hard: { label: 'Champion', plRatio: 1.25, formOffset: 0, skill: 0.72 },
  elite: { label: 'Ascendant', plRatio: 1.6, formOffset: 0, skill: 0.92 },
};
