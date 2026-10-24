import { STAT_KEYS, type Stats, statTotal } from './types.ts';

/**
 * Balance ratio = geometric mean / arithmetic mean of all stats.
 * 1.0 when every stat is equal; falls toward 0 as the build gets lopsided.
 */
export function balanceRatio(s: Stats): number {
  const n = STAT_KEYS.length;
  let logSum = 0;
  let sum = 0;
  for (const k of STAT_KEYS) {
    const v = Math.max(1, s[k]);
    logSum += Math.log(v);
    sum += v;
  }
  const gm = Math.exp(logSum / n);
  const am = sum / n;
  return Math.min(1, gm / am);
}

/** 0.55 .. 1.0 — how much of the raw stat mass converts into power. */
export function balanceFactor(s: Stats): number {
  const b = balanceRatio(s);
  return 0.55 + 0.45 * b * b;
}

/** Base power level from stat amount and balance (no form / buff multipliers). */
export function basePowerLevel(s: Stats): number {
  return Math.pow(statTotal(s), 1.5) * balanceFactor(s);
}

/** Displayed power level: base × form multiplier × buff multiplier. */
export function powerLevel(s: Stats, formMult = 1, buffMult = 1): number {
  return Math.round(basePowerLevel(s) * formMult * buffMult);
}

/** Inverse: the stat total needed to reach `targetPL` with a given balance factor. */
export function totalForPowerLevel(targetPL: number, factor: number): number {
  return Math.pow(Math.max(1, targetPL) / factor, 2 / 3);
}

export function formatPL(pl: number): string {
  return Math.round(pl).toLocaleString('en-US');
}
