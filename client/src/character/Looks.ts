import { HERO_PROPORTIONS, type Proportions } from './Rig.ts';

export type OutfitKind = 'gi' | 'brigand' | 'knight' | 'imp' | 'golem' | 'robe';
export type WeaponKind = 'none' | 'club' | 'axe' | 'sword' | 'staff';

export interface Look {
  id: string;
  proportions: Proportions;
  skin: string;
  outfit: OutfitKind;
  top: string;
  trim: string;
  pants: string;
  sash: string;
  boots: string;
  wrap: string;
  bands: string;
  /** Base hair style (0..5) and colour; forms override. */
  hairStyle: number;
  hairColor: string;
  eyeColor: string;
  browColor: string;
  weapon: WeaponKind;
  shield: boolean;
  scar?: boolean;
  /** Face texture resolution. */
  faceRes: number;
  /** Sleeveless gi top. */
  sleeveless: boolean;
}

export const HERO_LOOK: Look = {
  id: 'hero',
  proportions: { ...HERO_PROPORTIONS, headScale: 1.08, muscle: 1.08 },
  skin: '#e7b38a',
  outfit: 'gi',
  top: '#c22a1f',
  trim: '#f2c64a',
  pants: '#c22a1f',
  sash: '#1e2f6e',
  boots: '#4a2f1e',
  wrap: '#1e2f6e',
  bands: '#1e2f6e',
  hairStyle: 0,
  hairColor: '#14110f',
  eyeColor: '#2a1b12',
  browColor: '#14110f',
  weapon: 'none',
  shield: false,
  faceRes: 512,
  sleeveless: true,
};

export const RIVAL_LOOK: Look = {
  ...HERO_LOOK,
  id: 'rival',
  proportions: { ...HERO_PROPORTIONS, height: 1.86, shoulder: 1.04, muscle: 1.06 },
  skin: '#d9a07a',
  top: '#1b1a24',
  trim: '#9b6bff',
  pants: '#2a2836',
  sash: '#a3121b',
  boots: '#141217',
  wrap: '#a3121b',
  bands: '#a3121b',
  hairStyle: 6,
  hairColor: '#1a1424',
  eyeColor: '#2a1630',
  browColor: '#1a1424',
  scar: true,
};

/** Arena herald: a tournament crier in the lord's blue and gold. */
export const HERALD_LOOK: Look = {
  ...HERO_LOOK,
  id: 'herald',
  proportions: { ...HERO_PROPORTIONS, height: 1.8, muscle: 0.86, girth: 1.0, shoulder: 0.95 },
  skin: '#e2b08c',
  outfit: 'gi',
  top: '#1f3f86',
  trim: '#e4b53a',
  pants: '#2a2b38',
  sash: '#e4b53a',
  boots: '#3a2516',
  wrap: '#1f3f86',
  bands: '#e4b53a',
  hairStyle: 7,
  hairColor: '#5a3a22',
  eyeColor: '#2a3b5a',
  browColor: '#5a3a22',
  weapon: 'none',
  sleeveless: false,
};

export const BRIGAND_LOOK: Look = {
  ...HERO_LOOK,
  id: 'brigand',
  proportions: { ...HERO_PROPORTIONS, height: 1.78, muscle: 0.92, girth: 1.08, shoulder: 0.96 },
  skin: '#d6a07c',
  outfit: 'brigand',
  top: '#5b4630',
  trim: '#2c2219',
  pants: '#3c3a2c',
  sash: '#7a1f1a',
  boots: '#2e2218',
  wrap: '#5a5040',
  bands: '#3a2a1c',
  hairStyle: 7,
  hairColor: '#3b2416',
  eyeColor: '#2a1b12',
  browColor: '#3b2416',
  weapon: 'axe',
  sleeveless: true,
};

export const KNIGHT_LOOK: Look = {
  ...HERO_LOOK,
  id: 'knight',
  proportions: { ...HERO_PROPORTIONS, height: 1.9, muscle: 1.0, girth: 1.12, shoulder: 1.08 },
  skin: '#e2b08e',
  outfit: 'knight',
  top: '#8a8f99',
  trim: '#c9a23a',
  pants: '#3a3f4a',
  sash: '#24457a',
  boots: '#5c616b',
  wrap: '#24457a',
  bands: '#6a6f79',
  hairStyle: -1,
  hairColor: '#2a1f18',
  eyeColor: '#2a3550',
  browColor: '#2a1f18',
  weapon: 'sword',
  shield: true,
  sleeveless: false,
};

export const IMP_LOOK: Look = {
  ...HERO_LOOK,
  id: 'imp',
  proportions: {
    height: 1.05,
    shoulder: 0.9,
    armLen: 1.25,
    legLen: 0.82,
    torsoLen: 0.95,
    hipWidth: 0.9,
    muscle: 0.7,
    girth: 1.05,
    headScale: 1.6,
    handScale: 1.35,
  },
  skin: '#5f9a3a',
  outfit: 'imp',
  top: '#3f6b26',
  trim: '#8ccf4a',
  pants: '#2f5520',
  sash: '#6b3a8a',
  boots: '#2a3a1a',
  wrap: '#2a3a1a',
  bands: '#6b3a8a',
  hairStyle: 8,
  hairColor: '#2f6b1f',
  eyeColor: '#ff2a2a',
  browColor: '#1f3a12',
  weapon: 'none',
  sleeveless: true,
};

export const GOLEM_LOOK: Look = {
  ...HERO_LOOK,
  id: 'golem',
  proportions: {
    height: 3.1,
    shoulder: 1.35,
    armLen: 1.12,
    legLen: 0.88,
    torsoLen: 1.05,
    hipWidth: 1.3,
    muscle: 1.6,
    girth: 1.5,
    headScale: 0.8,
    handScale: 1.5,
  },
  skin: '#7a7468',
  outfit: 'golem',
  top: '#6c665a',
  trim: '#ff8a2a',
  pants: '#5e594e',
  sash: '#ff8a2a',
  boots: '#4e4a42',
  wrap: '#4e4a42',
  bands: '#4e4a42',
  hairStyle: -1,
  hairColor: '#000000',
  eyeColor: '#ffb02a',
  browColor: '#3a362f',
  weapon: 'none',
  sleeveless: true,
};

export const WARLOCK_LOOK: Look = {
  ...HERO_LOOK,
  id: 'warlock',
  proportions: { ...HERO_PROPORTIONS, height: 1.82, muscle: 0.8, shoulder: 0.94 },
  skin: '#c99a80',
  outfit: 'robe',
  top: '#3a1f4f',
  trim: '#d4a63a',
  pants: '#2a1638',
  sash: '#d4a63a',
  boots: '#1e1626',
  wrap: '#1e1626',
  bands: '#d4a63a',
  hairStyle: -1,
  hairColor: '#ccc6bc',
  eyeColor: '#b46bff',
  browColor: '#ccc6bc',
  weapon: 'staff',
  sleeveless: false,
};
