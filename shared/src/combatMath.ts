/** ZZZ-style combat constants and damage math shared by client simulation and tests. */

export const COMBAT = {
  inputBuffer: 0.25,
  dodgeDuration: 0.25,
  dodgeIFrames: 0.18,
  perfectDodgeWindow: 0.2,
  slowMoWorldScale: 0.15,
  slowMoPlayerScale: 0.85,
  slowMoDuration: 0.9,
  dodgeCounterGrace: 1.0,
  parryWindow: 0.15,
  blockReduction: 0.7,
  guardMax: 100,
  flashLead: 0.3,
  stunDuration: 5,
  stunDamageMult: 1.5,
  chainMax: 3,
  energyMax: 120,
  exCost: 60,
  energyRegen: 1,
  surgeMax: 3000,
  ultimateCost: 2000,
  surge: {
    perfectDodge: 100,
    perfectParry: 150,
    stun: 250,
    chain: 200,
    hit: 2,
  },
} as const;

export interface DamageInput {
  atk: number;
  skillMult: number;
  dmgBonus: number;
  crit: boolean;
  critDmg: number;
  attackerLevel: number;
  targetDef: number;
  /** Fractional DEF reduction from debuffs (0..0.9). */
  defDown?: number;
  stunned: boolean;
  /** Extra stun multiplier bonus on top of the base 1.5x. */
  stunBonus?: number;
  formAtkMult?: number;
  formDefMult?: number;
  blocked?: boolean;
}

/** ZZZ-like DEF factor: (L·10+100) / (L·10+100 + DEF). */
export function defFactor(attackerLevel: number, def: number): number {
  const k = Math.max(1, attackerLevel) * 10 + 100;
  return k / (k + Math.max(0, def));
}

export function computeDamage(d: DamageInput): number {
  const atk = d.atk * (d.formAtkMult ?? 1);
  const def = d.targetDef * (d.formDefMult ?? 1) * (1 - Math.min(0.9, Math.max(0, d.defDown ?? 0)));
  let dmg = atk * d.skillMult * (1 + d.dmgBonus);
  if (d.crit) dmg *= 1 + d.critDmg;
  dmg *= defFactor(d.attackerLevel, def);
  if (d.stunned) dmg *= COMBAT.stunDamageMult + (d.stunBonus ?? 0);
  if (d.blocked) dmg *= 1 - COMBAT.blockReduction;
  return Math.max(1, Math.round(dmg));
}

export function dazeAmount(base: number, impact: number, bonusPct = 0): number {
  return base * impact * (1 + bonusPct);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
