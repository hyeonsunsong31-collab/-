/**
 * Attack data for every damaging move. Keyed by the clip that performs it; multi-hit moves (rush barrage, beams)
 * reference their own entries from animation events or projectile ticks.
 */

export type HitKind =
  /** Flinch in place. */
  | 'light'
  /** Big stagger with a slide back. */
  | 'heavy'
  /** Pop the target into the air for juggles. */
  | 'launch'
  /** Blast the target off its feet onto its back. */
  | 'knockdown'
  /** Slam an airborne target into the ground. */
  | 'spike';

export type Limb = 'handL' | 'handR' | 'footL' | 'footR' | 'both' | 'body';

export interface AttackDef {
  id: string;
  /** Skill multiplier on ATK (or Ki ATK for ki attacks). */
  mult: number;
  /** Base Daze before the IMPACT stat. */
  daze: number;
  kind: HitKind;
  limb: Limb;
  /** Reach from the attacker's centre (m) and half-angle of the strike arc (deg). */
  reach: number;
  arc: number;
  /** Vertical band relative to the attacker's feet (m). */
  yMin: number;
  yMax: number;
  /** Horizontal knockback speed (m/s) and vertical launch speed. */
  knock: number;
  lift: number;
  /** Hitstop seconds, camera trauma, energy and surge gained on hit. */
  hitstop: number;
  shake: number;
  energy: number;
  ki?: boolean;
  /** Heavy-flagged hits on a stunned enemy start a Chain Attack. */
  heavy?: boolean;
  /** Telegraph flash for enemy attacks: gold = parryable, red = dodge only. */
  flash?: 'gold' | 'red';
  /** Visual impact tier for sparks / impact frames (1 light .. 4 cinematic). */
  tier: 1 | 2 | 3 | 4;
  /** Damage dealt to boulders, trees and the ground (crater radius). */
  crater?: number;
  /** Poise damage: interrupts enemies whose poise is below this. */
  poise: number;
}

const A = (d: Omit<AttackDef, 'yMin' | 'yMax' | 'arc' | 'lift' | 'poise'> & Partial<AttackDef>): AttackDef => ({
  yMin: -0.6,
  yMax: 2.6,
  arc: 70,
  lift: 0,
  poise: d.kind === 'light' ? 1 : 2,
  ...d,
});

export const ATTACKS: Record<string, AttackDef> = {
  light1: A({ id: 'light1', mult: 0.42, daze: 3, kind: 'light', limb: 'handL', reach: 2.3, knock: 1.2, hitstop: 0.045, shake: 0.12, energy: 1.2, tier: 1 }),
  light2: A({ id: 'light2', mult: 0.48, daze: 3.5, kind: 'light', limb: 'handR', reach: 2.4, knock: 1.4, hitstop: 0.05, shake: 0.14, energy: 1.3, tier: 1 }),
  light3: A({ id: 'light3', mult: 0.66, daze: 5, kind: 'light', limb: 'handL', reach: 2.5, arc: 95, knock: 2.2, hitstop: 0.065, shake: 0.2, energy: 1.6, tier: 2 }),
  light4: A({ id: 'light4', mult: 0.82, daze: 6.5, kind: 'heavy', limb: 'footR', reach: 2.7, arc: 100, knock: 2.4, hitstop: 0.08, shake: 0.28, energy: 2, tier: 2 }),
  light5: A({ id: 'light5', mult: 1.25, daze: 10, kind: 'launch', limb: 'both', reach: 2.8, knock: 3, lift: 11, hitstop: 0.11, shake: 0.45, energy: 3, ki: true, heavy: true, tier: 3 }),
  rush_hit: A({ id: 'rush_hit', mult: 0.16, daze: 1.6, kind: 'light', limb: 'both', reach: 2.4, knock: 0.35, hitstop: 0.025, shake: 0.08, energy: 0.6, tier: 1, poise: 1 }),
  rush_end: A({ id: 'rush_end', mult: 1.35, daze: 11, kind: 'knockdown', limb: 'handR', reach: 2.7, knock: 16, lift: 4, hitstop: 0.13, shake: 0.55, energy: 3, heavy: true, tier: 3, crater: 0 }),
  air1: A({ id: 'air1', mult: 0.44, daze: 3, kind: 'light', limb: 'handL', reach: 2.5, yMin: -1.5, yMax: 2.8, knock: 0.6, lift: 2.4, hitstop: 0.045, shake: 0.12, energy: 1.2, tier: 1 }),
  air2: A({ id: 'air2', mult: 0.5, daze: 3.5, kind: 'light', limb: 'handR', reach: 2.5, yMin: -1.5, yMax: 2.8, knock: 0.6, lift: 2.4, hitstop: 0.05, shake: 0.14, energy: 1.3, tier: 1 }),
  air3: A({ id: 'air3', mult: 0.7, daze: 5.5, kind: 'light', limb: 'footR', reach: 2.7, arc: 95, yMin: -1.5, yMax: 2.8, knock: 1, lift: 2.6, hitstop: 0.07, shake: 0.22, energy: 1.6, tier: 2 }),
  air4: A({ id: 'air4', mult: 1.2, daze: 10, kind: 'spike', limb: 'both', reach: 2.8, arc: 85, yMin: -2.2, yMax: 2.4, knock: 2, lift: -26, hitstop: 0.12, shake: 0.5, energy: 3, heavy: true, tier: 3, crater: 2.2 }),
  dash_attack: A({ id: 'dash_attack', mult: 0.8, daze: 6, kind: 'heavy', limb: 'body', reach: 2.6, knock: 6, hitstop: 0.08, shake: 0.3, energy: 2, tier: 2 }),
  dodge_counter: A({ id: 'dodge_counter', mult: 1.6, daze: 12, kind: 'heavy', limb: 'handR', reach: 2.8, arc: 110, knock: 7, hitstop: 0.12, shake: 0.45, energy: 4, heavy: true, tier: 3 }),
  parry_counter: A({ id: 'parry_counter', mult: 1.3, daze: 14, kind: 'heavy', limb: 'handR', reach: 2.6, knock: 8, hitstop: 0.12, shake: 0.45, energy: 4, ki: true, heavy: true, tier: 3 }),
  special: A({ id: 'special', mult: 1.1, daze: 9, kind: 'launch', limb: 'handR', reach: 2.6, arc: 80, yMax: 4, knock: 1.5, lift: 15, hitstop: 0.09, shake: 0.4, energy: 0, heavy: true, tier: 3 }),
  ex_special: A({ id: 'ex_special', mult: 3.2, daze: 22, kind: 'knockdown', limb: 'footR', reach: 4.6, arc: 180, yMin: -3, yMax: 3, knock: 9, lift: 6, hitstop: 0.17, shake: 0.85, energy: 0, heavy: true, tier: 4 }),
  /** Dragon Fist shockwave: a long narrow wave that carries far past arm's reach. */
  dragon_wave: A({ id: 'dragon_wave', mult: 1.0, daze: 8, kind: 'knockdown', limb: 'handR', reach: 8.5, arc: 20, knock: 16, lift: 3, hitstop: 0.06, shake: 0.4, energy: 1, ki: true, tier: 3, poise: 3 }),
  heavy_release: A({ id: 'heavy_release', mult: 2.4, daze: 18, kind: 'knockdown', limb: 'handR', reach: 3.4, arc: 60, knock: 22, lift: 3, hitstop: 0.16, shake: 0.75, energy: 3, heavy: true, tier: 4, poise: 3 }),
  /** Reaction inflicted on an attacker whose blow was perfectly parried (no damage, heavy Daze). */
  parried: A({ id: 'parried', mult: 0, daze: 22, kind: 'heavy', limb: 'body', reach: 0, knock: 3.5, hitstop: 0.13, shake: 0.45, energy: 0, tier: 3, poise: 4 }),
  /** Ki bolt projectile hit (per bolt). */
  ki_bolt: A({ id: 'ki_bolt', mult: 0.34, daze: 2.5, kind: 'light', limb: 'body', reach: 0, knock: 1.6, hitstop: 0.035, shake: 0.1, energy: 0.8, ki: true, tier: 1 }),
  /** Beam damage tick (several per second while the beam connects). */
  beam_tick: A({ id: 'beam_tick', mult: 0.12, daze: 2, kind: 'light', limb: 'body', reach: 0, knock: 4, hitstop: 0.0, shake: 0.12, energy: 0.4, ki: true, tier: 2, poise: 2 }),
  /** Beam end explosion. */
  beam_blast: A({ id: 'beam_blast', mult: 1.2, daze: 10, kind: 'knockdown', limb: 'body', reach: 0, knock: 14, lift: 5, hitstop: 0.1, shake: 0.6, energy: 2, ki: true, heavy: true, tier: 3, crater: 3.5 }),
  ultimate_tick: A({ id: 'ultimate_tick', mult: 0.24, daze: 4, kind: 'light', limb: 'body', reach: 0, knock: 3, hitstop: 0.0, shake: 0.2, energy: 0, ki: true, tier: 3, poise: 3 }),
  ultimate_blast: A({ id: 'ultimate_blast', mult: 2.4, daze: 40, kind: 'knockdown', limb: 'body', reach: 0, knock: 24, lift: 10, hitstop: 0.2, shake: 1, energy: 0, ki: true, heavy: true, tier: 4, crater: 9, poise: 3 }),
  /** Transformation burst shockwave. */
  burst: A({ id: 'burst', mult: 0.6, daze: 8, kind: 'knockdown', limb: 'body', reach: 6, arc: 180, yMin: -3, yMax: 4, knock: 18, lift: 6, hitstop: 0.08, shake: 0.6, energy: 0, ki: true, tier: 3, poise: 3 }),
  /** Chain-attack finishers. */
  chain_rush: A({ id: 'chain_rush', mult: 0.3, daze: 3, kind: 'light', limb: 'both', reach: 3, arc: 120, knock: 0.3, hitstop: 0.02, shake: 0.1, energy: 0.5, tier: 2, poise: 3 }),
  chain_rush_end: A({ id: 'chain_rush_end', mult: 2.2, daze: 18, kind: 'launch', limb: 'handR', reach: 3, arc: 120, knock: 2, lift: 14, hitstop: 0.16, shake: 0.7, energy: 2, heavy: true, tier: 4, poise: 3 }),
  chain_meteor: A({ id: 'chain_meteor', mult: 3, daze: 20, kind: 'knockdown', limb: 'footR', reach: 5, arc: 180, yMin: -4, yMax: 4, knock: 6, lift: 5, hitstop: 0.18, shake: 0.9, energy: 2, heavy: true, tier: 4, crater: 6, poise: 3 }),
  chain_thunder: A({ id: 'chain_thunder', mult: 2.8, daze: 22, kind: 'knockdown', limb: 'body', reach: 0, knock: 12, lift: 7, hitstop: 0.16, shake: 0.85, energy: 2, ki: true, heavy: true, tier: 4, crater: 4, poise: 3 }),
};

/* ------------------------------------------------------------------ mobs */

export const MOB_ATTACKS: Record<string, AttackDef> = {
  brig_slash: A({ id: 'brig_slash', mult: 0.9, daze: 0, kind: 'light', limb: 'handR', reach: 2.6, arc: 85, knock: 2.5, hitstop: 0.06, shake: 0.25, energy: 0, flash: 'gold', tier: 2 }),
  brig_backhand: A({ id: 'brig_backhand', mult: 0.8, daze: 0, kind: 'light', limb: 'handR', reach: 2.6, arc: 95, knock: 2.5, hitstop: 0.06, shake: 0.22, energy: 0, tier: 2 }),
  brig_overhead: A({ id: 'brig_overhead', mult: 1.8, daze: 0, kind: 'knockdown', limb: 'both', reach: 2.9, arc: 50, knock: 6, lift: 3, hitstop: 0.11, shake: 0.55, energy: 0, flash: 'red', tier: 3, crater: 1.4, poise: 2 }),
  brig_kick: A({ id: 'brig_kick', mult: 0.6, daze: 0, kind: 'heavy', limb: 'footR', reach: 2.2, arc: 60, knock: 5, hitstop: 0.06, shake: 0.2, energy: 0, tier: 1 }),
  knight_slash: A({ id: 'knight_slash', mult: 1.0, daze: 0, kind: 'light', limb: 'handR', reach: 2.9, arc: 90, knock: 2.5, hitstop: 0.06, shake: 0.25, energy: 0, flash: 'gold', tier: 2 }),
  knight_rising: A({ id: 'knight_rising', mult: 1.1, daze: 0, kind: 'launch', limb: 'handR', reach: 2.8, arc: 70, knock: 2, lift: 8, hitstop: 0.08, shake: 0.3, energy: 0, flash: 'gold', tier: 2 }),
  knight_thrust: A({ id: 'knight_thrust', mult: 1.6, daze: 0, kind: 'heavy', limb: 'handR', reach: 3.8, arc: 22, knock: 7, hitstop: 0.1, shake: 0.4, energy: 0, flash: 'red', tier: 3 }),
  knight_bash: A({ id: 'knight_bash', mult: 0.7, daze: 0, kind: 'heavy', limb: 'handL', reach: 2.3, arc: 70, knock: 8, hitstop: 0.09, shake: 0.35, energy: 0, flash: 'gold', tier: 2 }),
  imp_claw: A({ id: 'imp_claw', mult: 0.55, daze: 0, kind: 'light', limb: 'handL', reach: 1.9, arc: 80, yMax: 1.8, knock: 1.4, hitstop: 0.04, shake: 0.12, energy: 0, tier: 1 }),
  imp_claw2: A({ id: 'imp_claw2', mult: 0.55, daze: 0, kind: 'light', limb: 'handR', reach: 1.9, arc: 80, yMax: 1.8, knock: 1.8, hitstop: 0.04, shake: 0.12, energy: 0, tier: 1 }),
  imp_leap: A({ id: 'imp_leap', mult: 1.1, daze: 0, kind: 'heavy', limb: 'both', reach: 2.0, arc: 90, yMin: -1.5, yMax: 2.5, knock: 5, hitstop: 0.08, shake: 0.3, energy: 0, flash: 'gold', tier: 2 }),
  imp_blast: A({ id: 'imp_blast', mult: 2.4, daze: 0, kind: 'knockdown', limb: 'body', reach: 3.6, arc: 180, yMin: -2, yMax: 3, knock: 12, lift: 6, hitstop: 0.1, shake: 0.6, energy: 0, flash: 'red', tier: 3, crater: 2.4, poise: 3 }),
  golem_slam: A({ id: 'golem_slam', mult: 2.6, daze: 0, kind: 'knockdown', limb: 'both', reach: 4.8, arc: 55, yMax: 4, knock: 10, lift: 6, hitstop: 0.14, shake: 0.85, energy: 0, flash: 'red', tier: 4, crater: 3.2, poise: 3 }),
  golem_quake: A({ id: 'golem_quake', mult: 1.2, daze: 0, kind: 'launch', limb: 'body', reach: 0, arc: 180, yMin: -1, yMax: 0.8, knock: 6, lift: 7, hitstop: 0.06, shake: 0.6, energy: 0, flash: 'red', tier: 3, poise: 3 }),
  golem_swipe: A({ id: 'golem_swipe', mult: 2.0, daze: 0, kind: 'knockdown', limb: 'handR', reach: 4.6, arc: 120, yMax: 4, knock: 15, lift: 4, hitstop: 0.12, shake: 0.7, energy: 0, flash: 'gold', tier: 3, poise: 3 }),
  warlock_orb: A({ id: 'warlock_orb', mult: 0.9, daze: 0, kind: 'heavy', limb: 'body', reach: 0, knock: 4, hitstop: 0.05, shake: 0.25, energy: 0, ki: true, tier: 2 }),
  warlock_rune: A({ id: 'warlock_rune', mult: 1.7, daze: 0, kind: 'launch', limb: 'body', reach: 0, arc: 180, yMin: -1, yMax: 3, knock: 4, lift: 10, hitstop: 0.1, shake: 0.5, energy: 0, ki: true, flash: 'red', tier: 3, crater: 2.2, poise: 3 }),
};
Object.assign(ATTACKS, MOB_ATTACKS);

/** Light-combo chain on the ground and in the air. */
export const GROUND_CHAIN = ['light1', 'light2', 'light3', 'light4', 'light5'] as const;
export const AIR_CHAIN = ['air1', 'air2', 'air3', 'air4'] as const;
