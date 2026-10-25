import type { ClipDef } from '../Clip.ts';
import { CompiledClip } from '../Clip.ts';
import { P, STAND, STANCE, merge, hands } from '../poses.ts';
import { LOCOMOTION } from './locomotion.ts';
import { COMBAT } from './combat.ts';
import { SPECIAL } from './special.ts';
import { MOBS } from './mobs.ts';
import { NPC } from './npc.ts';

export const BASE_CLIPS: ClipDef[] = [
  { name: 'tpose', dur: 1, keys: [{ t: 0, p: P({}) }] },
  { name: 'stand', dur: 1, keys: [{ t: 0, p: STAND }] },
  { name: 'stance', dur: 1, keys: [{ t: 0, p: STANCE }] },
  // Calibration poses (dev only).
  { name: 'lab_r0', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmR: [86, 0, 6], foreArmR: [3, 0, 0], upperArmL: [86, 0, 6], foreArmL: [3, 0, 0] })) }] },
  { name: 'lab_r82', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmR: [86, 82, 6], foreArmR: [3, 0, 0], upperArmL: [86, 82, 6], foreArmL: [3, 0, 0] })) }] },
  { name: 'lab_back', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [-60, 0, 10], upperArmR: [60, 0, 10] })) }] },
  { name: 'lab_pitch', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [-60, 0, 10], upperArmR: [60, 0, 10] }, { rx: 30 })) }] },
  { name: 'lab_a', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [50, 40, 5], foreArmL: [110, 0, 0], upperArmR: [50, -40, 5], foreArmR: [110, 0, 0] })) }] },
  { name: 'lab_b', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [50, 0, 5], foreArmL: [110, 40, 0], upperArmR: [50, 0, 5], foreArmR: [110, -40, 0] })) }] },
  { name: 'lab_c', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [90, 0, 0], foreArmL: [0, 0, 0], upperArmR: [0, 0, 90], foreArmR: [90, 0, 0] })) }] },
  { name: 'lab_fist', dur: 1, keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [90, 0, 0], foreArmL: [0, 0, 0], upperArmR: [90, 0, 0], foreArmR: [0, 0, 0], ...hands('fist', 'open') })) }] },
  ...([
    ['th_x+', [60, 0, 0]],
    ['th_x-', [-60, 0, 0]],
    ['th_y+', [0, 60, 0]],
    ['th_y-', [0, -60, 0]],
    ['th_z+', [0, 0, 60]],
    ['th_z-', [0, 0, -60]],
  ] as [string, [number, number, number]][]).map(([n, v]) => ({
    name: n,
    dur: 1,
    keys: [{ t: 0, p: merge(STAND, P({ upperArmL: [90, 0, 0], foreArmL: [0, 0, 0], ...hands('fist', 'fist'), thumb1L: v, thumb2L: [0, 0, 0] })) }],
  })),
];

let compiled: Map<string, CompiledClip> | null = null;

export function allClipDefs(): ClipDef[] {
  return [...BASE_CLIPS, ...LOCOMOTION, ...COMBAT, ...SPECIAL, ...MOBS, ...NPC];
}

export function clipLibrary(): Map<string, CompiledClip> {
  if (compiled) return compiled;
  compiled = new Map();
  for (const def of allClipDefs()) compiled.set(def.name, new CompiledClip(def));
  return compiled;
}
