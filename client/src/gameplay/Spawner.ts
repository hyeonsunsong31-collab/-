import * as THREE from 'three';
import type { Lighting } from '../render/Lighting.ts';
import type { World } from '../world/World.ts';
import type { CombatSystem } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';
import type { CompiledClip } from '../animation/Clip.ts';
import { Character } from '../character/Character.ts';
import { Mob, MOB_KINDS, type MobKindId } from './Mob.ts';
import { MobAI, AttackDirector } from '../ai/MobAI.ts';
import { POI_BY_ID } from '../world/layout.ts';

interface CampSlot {
  kind: MobKindId;
  /** Offset from the camp centre. */
  dx: number;
  dz: number;
  mob: Mob | null;
  ai: MobAI | null;
  respawn: number;
}

interface Camp {
  id: string;
  name: string;
  x: number;
  z: number;
  level: [number, number];
  slots: CampSlot[];
  active: boolean;
}

const ACTIVATE = 150;
const DEACTIVATE = 230;
const RESPAWN = 75;

/** Camp roster: id/POI, level band, members. Danger rises with distance from Ashford. */
const CAMPS: { id: string; poi?: string; x?: number; z?: number; name: string; level: [number, number]; members: MobKindId[]; spread: number }[] = [
  { id: 'scouts_n', x: 30, z: 175, name: 'Bandit Scouts', level: [1, 2], members: ['brigand', 'brigand'], spread: 5 },
  { id: 'scouts_w', x: -150, z: -70, name: 'Bandit Scouts', level: [1, 3], members: ['brigand', 'imp', 'brigand'], spread: 6 },
  { id: 'meadow_imps', x: 170, z: 380, name: 'Meadow Imps', level: [2, 4], members: ['imp', 'imp', 'imp'], spread: 7 },
  { id: 'camp_brigand', poi: 'camp_brigand', name: 'Brigand Camp', level: [3, 6], members: ['brigand', 'brigand', 'brigand', 'brigand', 'imp'], spread: 9 },
  { id: 'camp_knight', poi: 'camp_knight', name: 'Knight Outpost', level: [7, 10], members: ['knight', 'knight', 'knight', 'brigand'], spread: 9 },
  { id: 'camp_imp', poi: 'camp_imp', name: 'Mandrake Hollow', level: [6, 9], members: ['imp', 'imp', 'imp', 'imp', 'imp'], spread: 8 },
  { id: 'camp_warlock', poi: 'camp_warlock', name: 'Warlock Shrine', level: [11, 14], members: ['warlock', 'warlock', 'knight', 'knight'], spread: 9 },
  { id: 'camp_golem', poi: 'camp_golem', name: 'Golem Quarry', level: [14, 18], members: ['golem', 'imp', 'imp', 'imp'], spread: 11 },
  { id: 'tower', poi: 'tower', name: 'Ruined Watchtower', level: [9, 12], members: ['warlock', 'brigand', 'brigand', 'knight'], spread: 9 },
];

/**
 * Populates the world's camps with level-banded mobs as the player approaches, runs their AI, removes the dead,
 * respawns cleared camps after a while and reports kills (for XP).
 */
export class Spawner {
  readonly camps: Camp[] = [];
  readonly director = new AttackDirector();
  readonly mobs: Mob[] = [];
  onSpawn: ((m: Mob) => void) | null = null;
  onDespawn: ((m: Mob) => void) | null = null;
  enabled = true;

  constructor(
    private scene: THREE.Scene,
    private lighting: Lighting,
    private world: World,
    private combat: CombatSystem,
    private clips: Map<string, CompiledClip>,
  ) {
    for (const c of CAMPS) {
      const poi = c.poi ? POI_BY_ID[c.poi] : null;
      const x = poi ? poi.x : c.x!;
      const z = poi ? poi.z : c.z!;
      const slots: CampSlot[] = c.members.map((kind, i) => {
        const a = (i / c.members.length) * Math.PI * 2 + 0.4;
        const r = i === 0 ? 1.5 : c.spread * (0.45 + ((i * 37) % 10) / 20);
        return { kind, dx: Math.cos(a) * r, dz: Math.sin(a) * r, mob: null, ai: null, respawn: 0 };
      });
      this.camps.push({ id: c.id, name: c.name, x, z, level: c.level, slots, active: false });
    }
  }

  /** Spawn one mob of a kind at a position (debug / arena use as well). */
  spawn(kind: MobKindId, pos: THREE.Vector3, level: number, home?: THREE.Vector3): { mob: Mob; ai: MobAI } {
    const k = MOB_KINDS[kind];
    const ch = new Character(k.look, this.lighting, this.clips);
    const m = new Mob(k, ch, this.world, level);
    const g = this.world.groundAt(pos.x, pos.z, this.world.terrainHeight(pos.x, pos.z) + 0.3);
    m.teleport(new THREE.Vector3(pos.x, g, pos.z), Math.random() * Math.PI * 2);
    m.home.copy(home ?? m.pos);
    this.scene.add(ch.group);
    this.combat.add(m);
    this.mobs.push(m);
    const ai = new MobAI(m, this.director);
    ai.skill = Math.min(0.95, 0.3 + level * 0.03);
    this.onSpawn?.(m);
    return { mob: m, ai };
  }

  private despawn(m: Mob): void {
    this.onDespawn?.(m);
    this.combat.remove(m);
    this.director.release(m);
    m.char.dispose();
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
  }

  /** Loose AIs for mobs spawned outside camps. */
  readonly extra: { mob: Mob; ai: MobAI }[] = [];
  /** Camp slots waiting to be filled; building a fighter costs a few ms, so a whole camp at once would hitch. */
  private pending: [Camp, CampSlot][] = [];

  update(dt: number, player: Combatant): void {
    const foes = [player];
    this.director.prune();
    const next = this.pending.shift();
    if (next && next[0].active && !next[1].mob) this.fill(next[0], next[1]);
    for (const c of this.camps) {
      const d = Math.hypot(player.pos.x - c.x, player.pos.z - c.z);
      if (!c.active && d < ACTIVATE && this.enabled) {
        c.active = true;
        for (const s of c.slots) if (!s.mob && s.respawn <= 0) this.pending.push([c, s]);
      } else if (c.active && d > DEACTIVATE) {
        c.active = false;
        for (const s of c.slots) {
          if (s.mob) this.despawn(s.mob);
          s.mob = null;
          s.ai = null;
        }
      }
      for (const s of c.slots) {
        if (s.respawn > 0) {
          s.respawn -= dt;
          if (s.respawn <= 0 && c.active && d > 45) this.fill(c, s);
        }
        const m = s.mob;
        if (!m) continue;
        s.ai!.step(dt, foes);
        m.update(dt);
        if (!m.alive) {
          if (m.dissolve >= 1 || m.deadT > 10) {
            this.despawn(m);
            s.mob = null;
            s.ai = null;
            s.respawn = RESPAWN;
          }
        }
      }
    }
    for (let i = this.extra.length - 1; i >= 0; i--) {
      const e = this.extra[i];
      e.ai.step(dt, foes);
      e.mob.update(dt);
      if (!e.mob.alive && (e.mob.dissolve >= 1 || e.mob.deadT > 10)) {
        this.despawn(e.mob);
        this.extra.splice(i, 1);
      }
    }
  }

  private fill(c: Camp, s: CampSlot): void {
    const lvl = c.level[0] + Math.floor(Math.random() * (c.level[1] - c.level[0] + 1));
    const p = new THREE.Vector3(c.x + s.dx, 0, c.z + s.dz);
    const { mob, ai } = this.spawn(s.kind, p, lvl, new THREE.Vector3(c.x + s.dx, 0, c.z + s.dz));
    mob.home.y = mob.pos.y;
    s.mob = mob;
    s.ai = ai;
  }

  /** Remove every mob (arena matches, debug). */
  clear(): void {
    this.pending.length = 0;
    for (const c of this.camps) {
      c.active = false;
      for (const s of c.slots) {
        if (s.mob) this.despawn(s.mob);
        s.mob = null;
        s.ai = null;
      }
    }
    for (const e of this.extra) this.despawn(e.mob);
    this.extra.length = 0;
  }
}
