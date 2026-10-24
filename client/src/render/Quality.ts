export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  level: QualityLevel;
  pixelRatio: number;
  cascades: number;
  shadowMapSize: number;
  shadowFar: number;
  /** Grass blades per m² near the camera. */
  grassDensity: number;
  grassRadius: number;
  treeNear: number;
  ao: boolean;
  godRays: boolean;
  smaa: boolean;
  bloomScale: number;
  particleScale: number;
  terrainLodBias: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low', pixelRatio: 0.75, cascades: 1, shadowMapSize: 1024, shadowFar: 90, grassDensity: 5, grassRadius: 42,
    treeNear: 110, ao: false, godRays: false, smaa: false, bloomScale: 0.5, particleScale: 0.5, terrainLodBias: 0.6,
  },
  medium: {
    level: 'medium', pixelRatio: 1, cascades: 2, shadowMapSize: 1024, shadowFar: 220, grassDensity: 12, grassRadius: 64,
    treeNear: 160, ao: false, godRays: true, smaa: true, bloomScale: 0.75, particleScale: 0.75, terrainLodBias: 0.8,
  },
  high: {
    level: 'high', pixelRatio: 1.25, cascades: 3, shadowMapSize: 2048, shadowFar: 420, grassDensity: 22, grassRadius: 84,
    treeNear: 220, ao: true, godRays: true, smaa: true, bloomScale: 1, particleScale: 1, terrainLodBias: 1,
  },
  ultra: {
    level: 'ultra', pixelRatio: 2, cascades: 4, shadowMapSize: 2048, shadowFar: 650, grassDensity: 34, grassRadius: 104,
    treeNear: 300, ao: true, godRays: true, smaa: true, bloomScale: 1, particleScale: 1.25, terrainLodBias: 1.25,
  },
};

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
}

export function defaultQuality(): QualityLevel {
  if (isTouchDevice()) return 'low';
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return mem <= 4 ? 'medium' : 'high';
}
