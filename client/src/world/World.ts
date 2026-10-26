import * as THREE from 'three';
import { WorldData } from './WorldData.ts';
import { Terrain } from './Terrain.ts';
import { Grass, windUniforms, MAX_BENDERS } from './Grass.ts';
import { Vegetation } from './Vegetation.ts';
import { Settlements } from './Settlements.ts';
import { Water } from './Water.ts';
import { Colliders } from './Colliders.ts';
import type { Lighting } from '../render/Lighting.ts';
import type { QualityPreset } from '../render/Quality.ts';
import { WATER_LEVEL } from './layout.ts';

export interface Bender {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

/** Owns every static/ambient part of the open world and answers spatial queries for gameplay. */
export class World {
  readonly data: WorldData;
  readonly terrain: Terrain;
  readonly grass: Grass;
  readonly vegetation: Vegetation;
  readonly settlements: Settlements;
  readonly water: Water;
  readonly colliders = new Colliders();
  readonly group = new THREE.Group();
  private benders: Bender[] = [];
  private tmpN = { x: 0, y: 1, z: 0 };

  constructor(
    seed: number,
    lighting: Lighting,
    quality: QualityPreset,
    renderer: THREE.WebGLRenderer,
    env: THREE.Texture,
  ) {
    this.data = new WorldData(seed);
    this.terrain = new Terrain(this.data, lighting, quality.terrainLodBias);
    this.grass = new Grass(this.data, lighting, quality.grassDensity, quality.grassRadius);
    this.vegetation = new Vegetation(this.data, lighting, renderer, quality.treeNear);
    this.settlements = new Settlements(this.data, lighting);
    this.water = new Water(this.data, lighting.sunDir, env);
    this.group.add(this.terrain.group, this.grass.group, this.vegetation.group, this.settlements.group, this.water.group);
    for (const c of this.settlements.colliders) this.colliders.add(c);
    for (const t of this.vegetation.trunkColliders) this.colliders.add({ kind: 'circle', x: t.x, z: t.z, r: t.r, y0: t.tree.y - 1, y1: t.tree.y + 9 });
    for (const r of this.data.rocks) if (r.s > 0.9) this.colliders.add({ kind: 'circle', x: r.x, z: r.z, r: r.s * 1.0, y0: r.y - 1, y1: r.y + r.s * 0.55 });
  }

  /** Ground height including bridge decks and walkable tops of props/buildings below `fromY`. */
  groundAt(x: number, z: number, fromY = Infinity): number {
    let g = this.data.hf.heightAt(x, z);
    const b = this.settlements.bridgeHeight(x, z);
    if (b !== null && b <= fromY + 0.6) g = Math.max(g, b);
    if (Number.isFinite(fromY)) {
      const top = this.colliders.topUnder(x, z, fromY + 0.45);
      if (top > g) g = top;
    }
    return g;
  }

  terrainHeight(x: number, z: number): number {
    return this.data.hf.heightAt(x, z);
  }

  normalAt(x: number, z: number): { x: number; y: number; z: number } {
    this.data.hf.normalAt(x, z, this.tmpN);
    return this.tmpN;
  }

  isWater(x: number, z: number): boolean {
    return this.data.hf.heightAt(x, z) < WATER_LEVEL - 0.15;
  }

  /** Register a grass bender for this frame. */
  bend(b: Bender): void {
    this.benders.push(b);
  }

  /** Blast a crater, scorch the ground and fell nearby trees. Returns felled trees for debris. */
  crater(x: number, z: number, radius: number, depth: number) {
    const box = this.data.hf.crater(x, z, radius, depth);
    this.terrain.invalidate(box.minX, box.maxX, box.minZ, box.maxZ);
    this.data.syncHeightTex(box);
    this.data.scorch(x, z, radius, 1);
    const felled = this.vegetation.blast(x, z, radius * 1.15);
    const rocks = this.vegetation.shatterRocks(x, z, radius);
    const gone = [...felled, ...rocks];
    if (gone.length) this.colliders.remove((c) => c.kind === 'circle' && gone.some((t) => t.x === c.x && t.z === c.z));
    return { felled, rocks };
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    windUniforms.uTime.value += dt;
    const arr = windUniforms.uBenders.value;
    this.benders.sort((a, b) => b.strength * b.radius - a.strength * a.radius);
    for (let i = 0; i < MAX_BENDERS; i++) {
      const b = this.benders[i];
      if (b) arr[i].set(b.x, b.z, b.radius, b.strength);
      else arr[i].set(0, 0, 0, 0);
    }
    this.benders.length = 0;
    this.terrain.uniforms.uTime.value += dt;
    this.terrain.update(camera.position);
    this.grass.update(camera);
    this.vegetation.update(camera.position);
    this.vegetation.animate(dt);
    this.settlements.update(dt);
    this.water.update(dt);
    this.data.coolDamage(dt);
  }
}
