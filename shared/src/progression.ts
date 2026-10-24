import { STAT_KEYS, type Profile, type StatKey, type Stats, baseStats, cloneStats, statTotal, BASE_STAT } from './types.ts';
import { basePowerLevel } from './powerLevel.ts';

export const POINTS_PER_LEVEL = 5;
export const MATCH_WIN_LEVELS = 5;
export const MAX_LEVEL = 999;

export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(Math.max(1, level), 1.5));
}

export function newProfile(id: string, name: string, now = Date.now()): Profile {
  const stats = baseStats();
  return {
    id,
    name: sanitizeName(name),
    level: 1,
    xp: 0,
    unspent: 0,
    stats,
    wins: 0,
    losses: 0,
    bestPL: Math.round(basePowerLevel(stats)),
    createdAt: now,
    updatedAt: now,
  };
}

export function sanitizeName(name: string): string {
  const clean = String(name ?? '')
    .replace(/[^\p{L}\p{N} _\-']/gu, '')
    .trim()
    .slice(0, 16);
  return clean.length >= 2 ? clean : 'Wanderer';
}

/** Total points a profile at `level` has earned (spent + unspent). */
export function pointsEarned(level: number): number {
  return (Math.max(1, level) - 1) * POINTS_PER_LEVEL;
}

function touch(p: Profile, now: number): Profile {
  const pl = Math.round(basePowerLevel(p.stats));
  return { ...p, bestPL: Math.max(p.bestPL, pl), updatedAt: now };
}

/** Grant whole levels (each = +5 stat points). XP progress toward the next level is kept. */
export function grantLevels(p: Profile, levels: number, now = Date.now()): Profile {
  const n = Math.max(0, Math.floor(levels));
  const newLevel = Math.min(MAX_LEVEL, p.level + n);
  const gained = newLevel - p.level;
  return touch({ ...p, level: newLevel, unspent: p.unspent + gained * POINTS_PER_LEVEL }, now);
}

export interface XpResult {
  profile: Profile;
  levelsGained: number;
}

export function addXp(p: Profile, xp: number, now = Date.now()): XpResult {
  let level = p.level;
  let cur = p.xp + Math.max(0, Math.floor(xp));
  let gained = 0;
  while (level < MAX_LEVEL && cur >= xpToNext(level)) {
    cur -= xpToNext(level);
    level++;
    gained++;
  }
  if (level >= MAX_LEVEL) cur = 0;
  return {
    profile: touch({ ...p, level, xp: cur, unspent: p.unspent + gained * POINTS_PER_LEVEL }, now),
    levelsGained: gained,
  };
}

export type AllocationError = 'invalid' | 'insufficient' | 'empty';

/** Spend unspent points. Delta values must be non-negative integers. */
export function allocate(
  p: Profile,
  delta: Partial<Record<StatKey, number>>,
  now = Date.now(),
): { ok: true; profile: Profile } | { ok: false; error: AllocationError } {
  let sum = 0;
  const stats = cloneStats(p.stats);
  for (const [k, v] of Object.entries(delta)) {
    if (!(STAT_KEYS as readonly string[]).includes(k)) return { ok: false, error: 'invalid' };
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100000) return { ok: false, error: 'invalid' };
    stats[k as StatKey] += v;
    sum += v;
  }
  if (sum === 0) return { ok: false, error: 'empty' };
  if (sum > p.unspent) return { ok: false, error: 'insufficient' };
  return { ok: true, profile: touch({ ...p, stats, unspent: p.unspent - sum }, now) };
}

/** Refund all allocated points (free respec — lets players experiment with balance). */
export function respec(p: Profile, now = Date.now()): Profile {
  const refunded = statTotal(p.stats) - BASE_STAT * STAT_KEYS.length;
  return { ...p, stats: baseStats(), unspent: p.unspent + refunded, updatedAt: now };
}

/** Sanity check used by the server: allocated + unspent must equal what the level has earned. */
export function isConsistent(p: Profile): boolean {
  const allocated = statTotal(p.stats) - BASE_STAT * STAT_KEYS.length;
  if (allocated < 0 || p.unspent < 0) return false;
  for (const k of STAT_KEYS) if (p.stats[k] < BASE_STAT || !Number.isInteger(p.stats[k])) return false;
  return allocated + p.unspent === pointsEarned(p.level);
}

/** XP for defeating an enemy. Scales with its level and how strong it was relative to the player. */
export function killXp(enemyLevel: number, enemyPL: number, playerPL: number): number {
  const ratio = Math.max(0.25, Math.min(3, Math.pow(Math.max(1, enemyPL) / Math.max(1, playerPL), 0.6)));
  return Math.round((20 + enemyLevel * 8) * ratio);
}

/** Auto-distribute points for NPCs following a weighting personality. */
export function distributePoints(total: number, weights: Partial<Record<StatKey, number>>): Stats {
  const s = baseStats();
  let wsum = 0;
  for (const k of STAT_KEYS) wsum += weights[k] ?? 1;
  let left = Math.max(0, Math.floor(total));
  const keys = [...STAT_KEYS];
  for (const k of keys) {
    const share = Math.floor((total * (weights[k] ?? 1)) / wsum);
    s[k] += share;
    left -= share;
  }
  let i = 0;
  while (left > 0) {
    s[keys[i % keys.length]] += 1;
    left--;
    i++;
  }
  return s;
}
