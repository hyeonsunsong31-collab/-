import { DIFFICULTIES, type Difficulty, type Stats, STAT_KEYS, statTotal } from './types.ts';
import { balanceFactor, basePowerLevel, totalForPowerLevel } from './powerLevel.ts';
import { distributePoints } from './progression.ts';
import { maxUnlockedTier } from './forms.ts';
import { Rng } from './rng.ts';

export const MATCH_MIN_DURATION_MS = 15000;
export const MATCH_MAX_DURATION_MS = 30 * 60 * 1000;

export type RivalStyle = 'brawler' | 'blaster' | 'tactician' | 'juggernaut';

export interface BotSpec {
  name: string;
  style: RivalStyle;
  level: number;
  stats: Stats;
  maxTier: number;
  skill: number;
  difficulty: Difficulty;
}

const STYLE_WEIGHTS: Record<RivalStyle, Partial<Record<(typeof STAT_KEYS)[number], number>>> = {
  brawler: { str: 2.2, agi: 1.4, imp: 1.3, vit: 1, ki: 0.7, foc: 0.8 },
  blaster: { ki: 2.4, foc: 1.4, agi: 1.1, str: 0.7, vit: 0.9, imp: 0.8 },
  tactician: { foc: 1.6, agi: 1.6, imp: 1.4, str: 1.1, ki: 1.1, vit: 1 },
  juggernaut: { vit: 2.2, str: 1.6, imp: 1.5, agi: 0.6, ki: 0.8, foc: 0.7 },
};

const RIVAL_NAMES = ['Kaelric', 'Vornhal', 'Sigrun', 'Draven', 'Ysolde', 'Brannoc', 'Thessaly', 'Corvin', 'Maelis', 'Roderic'];

/** Build a training-match rival whose base PL is the player's × difficulty ratio. */
export function generateRival(playerStats: Stats, playerLevel: number, difficulty: Difficulty, seed: number): BotSpec {
  const rng = new Rng(seed);
  const d = DIFFICULTIES[difficulty];
  const style = rng.pick<RivalStyle>(['brawler', 'blaster', 'tactician', 'juggernaut']);
  const targetPL = basePowerLevel(playerStats) * d.plRatio;
  // Iterate: distribute points with the style, then rescale total to hit the target PL.
  let total = statTotal(playerStats);
  let stats = distributePoints(Math.max(0, total - 60), STYLE_WEIGHTS[style]);
  for (let i = 0; i < 6; i++) {
    const need = totalForPowerLevel(targetPL, balanceFactor(stats));
    total = Math.max(60, Math.round(need));
    stats = distributePoints(total - 60, STYLE_WEIGHTS[style]);
  }
  const tier = Math.max(0, maxUnlockedTier(playerLevel) + d.formOffset);
  return {
    name: rng.pick(RIVAL_NAMES),
    style,
    level: Math.max(1, playerLevel + Math.round((d.plRatio - 1) * 10)),
    stats,
    maxTier: tier,
    skill: d.skill,
    difficulty,
  };
}
