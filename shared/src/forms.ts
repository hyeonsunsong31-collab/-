/** Transformation ladder. Original names, classic DB look (see hair/aura descriptors). */
export type FormId = 'base' | 'asc1' | 'asc2' | 'asc3' | 'crimson' | 'azure' | 'silver';

export interface FormDef {
  id: FormId;
  tier: number;
  name: string;
  title: string;
  unlockLevel: number;
  /** DB-style display multiplier for power level. */
  plMult: number;
  atkMult: number;
  defMult: number;
  speedMult: number;
  /** Surge required to enter this form (from the previous tier). */
  surgeCost: number;
  /** Surge drained per second while in this form. */
  drainPerSec: number;
  /** Multiplies the perfect-dodge window. */
  dodgeWindowMult: number;
  hairColor: string;
  hairEmissive: number;
  eyeColor: string;
  auraColor: string;
  auraCore: string;
  /** Bio-electric arcs crackling around the body. */
  lightning: boolean;
  lightningColor: string;
  /** 0 = base spikes, 1 = upswept, 2 = sharper, 3 = waist-long, 4 = slim divine, 5 = wild silver */
  hairStyle: number;
  auraScale: number;
}

export const FORMS: FormDef[] = [
  {
    id: 'base', tier: 0, name: 'Base', title: 'BASE FORM', unlockLevel: 1, plMult: 1, atkMult: 1, defMult: 1, speedMult: 1,
    surgeCost: 0, drainPerSec: 0, dodgeWindowMult: 1, hairColor: '#14110f', hairEmissive: 0, eyeColor: '#1b1410',
    auraColor: '#cfe6ff', auraCore: '#ffffff', lightning: false, lightningColor: '#9fd8ff', hairStyle: 0, auraScale: 0.85,
  },
  {
    id: 'asc1', tier: 1, name: 'Golden Ascension', title: 'GOLDEN ASCENSION I', unlockLevel: 10, plMult: 50, atkMult: 1.25,
    defMult: 1.15, speedMult: 1.08, surgeCost: 1000, drainPerSec: 12, dodgeWindowMult: 1.1, hairColor: '#ffd23a',
    hairEmissive: 0.55, eyeColor: '#2fd8c8', auraColor: '#ffcf2e', auraCore: '#fff6c2', lightning: false,
    lightningColor: '#9fd8ff', hairStyle: 1, auraScale: 1.0,
  },
  {
    id: 'asc2', tier: 2, name: 'Golden Storm', title: 'GOLDEN STORM II', unlockLevel: 25, plMult: 100, atkMult: 1.4,
    defMult: 1.25, speedMult: 1.12, surgeCost: 1500, drainPerSec: 16, dodgeWindowMult: 1.15, hairColor: '#ffdc45',
    hairEmissive: 0.7, eyeColor: '#2fe0d0', auraColor: '#ffd83a', auraCore: '#fffbe0', lightning: true,
    lightningColor: '#7fd4ff', hairStyle: 2, auraScale: 1.12,
  },
  {
    id: 'asc3', tier: 3, name: 'Golden Mane', title: 'GOLDEN MANE III', unlockLevel: 45, plMult: 400, atkMult: 1.6,
    defMult: 1.3, speedMult: 1.1, surgeCost: 2000, drainPerSec: 26, dodgeWindowMult: 1.1, hairColor: '#ffd640',
    hairEmissive: 0.8, eyeColor: '#30e6d6', auraColor: '#ffd23a', auraCore: '#ffffff', lightning: true,
    lightningColor: '#8fdcff', hairStyle: 3, auraScale: 1.35,
  },
  {
    id: 'crimson', tier: 4, name: 'Crimson Divinity', title: 'CRIMSON DIVINITY', unlockLevel: 70, plMult: 1500,
    atkMult: 1.8, defMult: 1.5, speedMult: 1.18, surgeCost: 2200, drainPerSec: 14, dodgeWindowMult: 1.25,
    hairColor: '#e8223f', hairEmissive: 0.45, eyeColor: '#ff3a4e', auraColor: '#ff5a2a', auraCore: '#ffd2a0',
    lightning: false, lightningColor: '#ff9a7a', hairStyle: 4, auraScale: 1.05,
  },
  {
    id: 'azure', tier: 5, name: 'Azure Divinity', title: 'AZURE DIVINITY', unlockLevel: 100, plMult: 4000, atkMult: 2.1,
    defMult: 1.7, speedMult: 1.22, surgeCost: 2500, drainPerSec: 20, dodgeWindowMult: 1.35, hairColor: '#2fb8ff',
    hairEmissive: 0.65, eyeColor: '#3ad0ff', auraColor: '#2aa8ff', auraCore: '#e8fbff', lightning: false,
    lightningColor: '#bff0ff', hairStyle: 1, auraScale: 1.15,
  },
  {
    id: 'silver', tier: 6, name: 'Silver Instinct', title: 'SILVER INSTINCT', unlockLevel: 150, plMult: 12000,
    atkMult: 2.4, defMult: 1.8, speedMult: 1.3, surgeCost: 3000, drainPerSec: 30, dodgeWindowMult: 2.5,
    hairColor: '#e6ecf5', hairEmissive: 0.6, eyeColor: '#c8d4ff', auraColor: '#b8c4ff', auraCore: '#ffffff',
    lightning: false, lightningColor: '#d6c8ff', hairStyle: 5, auraScale: 1.1,
  },
];

export const FORM_BY_ID: Record<FormId, FormDef> = Object.fromEntries(FORMS.map((f) => [f.id, f])) as Record<
  FormId,
  FormDef
>;

/** Highest tier unlocked at a level. */
export function maxUnlockedTier(level: number): number {
  let t = 0;
  for (const f of FORMS) if (level >= f.unlockLevel) t = f.tier;
  return t;
}

export function formByTier(tier: number): FormDef {
  return FORMS[Math.max(0, Math.min(FORMS.length - 1, tier))];
}

/** The next form reachable from `currentTier` given level and surge, or null. */
export function nextForm(currentTier: number, level: number, surge: number): FormDef | null {
  const next = FORMS[currentTier + 1];
  if (!next) return null;
  if (level < next.unlockLevel) return null;
  if (surge < next.surgeCost) return null;
  return next;
}
