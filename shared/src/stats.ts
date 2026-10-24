import { type Stats } from './types.ts';

/** Gameplay values derived from core stats + level. All combat code reads these. */
export interface Derived {
  maxHp: number;
  def: number;
  atk: number;
  kiAtk: number;
  maxKi: number;
  critRate: number;
  critDmg: number;
  /** Multiplier on Daze dealt. */
  impact: number;
  moveSpeed: number;
  attackSpeed: number;
  energyRegen: number;
  surgeGain: number;
  /** Seconds removed from dodge recovery. */
  dodgeRecovery: number;
}

/** Soft cap: linear early, asymptotic toward `cap`. */
export function softCap(x: number, cap: number, k: number): number {
  return cap * (1 - Math.exp(-x / k));
}

export function deriveStats(s: Stats, level: number): Derived {
  const L = Math.max(1, level);
  return {
    maxHp: Math.round(600 + s.vit * 55 + L * 12),
    def: Math.round(20 + s.vit * 4.2 + L * 1.5),
    atk: Math.round(40 + s.str * 6.5 + L * 2),
    kiAtk: Math.round(40 + s.ki * 6.8 + L * 2),
    maxKi: Math.round(100 + s.ki * 2),
    critRate: 0.05 + softCap(s.foc, 0.7, 260),
    critDmg: 0.5 + s.foc * 0.008,
    impact: 1 + s.imp * 0.012,
    moveSpeed: 1 + softCap(s.agi, 0.4, 220),
    attackSpeed: 1 + softCap(s.agi, 0.3, 260),
    energyRegen: 1 + s.foc * 0.01,
    surgeGain: 1 + s.foc * 0.006,
    dodgeRecovery: softCap(s.agi, 0.12, 200),
  };
}
