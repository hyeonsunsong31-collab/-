import type { ClipDef } from '../Clip.ts';
import { CompiledClip } from '../Clip.ts';
import { P, STAND, STANCE } from '../poses.ts';
import { LOCOMOTION } from './locomotion.ts';
import { COMBAT } from './combat.ts';
import { SPECIAL } from './special.ts';
import { MOBS } from './mobs.ts';
import { NPC } from './npc.ts';

export const BASE_CLIPS: ClipDef[] = [
  { name: 'tpose', dur: 1, keys: [{ t: 0, p: P({}) }] },
  { name: 'stand', dur: 1, keys: [{ t: 0, p: STAND }] },
  { name: 'stance', dur: 1, keys: [{ t: 0, p: STANCE }] },
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
