import * as THREE from 'three';
import { Rng } from '@ak/shared';
import { Heightfield, HF_N, HF_RES } from './Heightfield.ts';
import { WORLD_HALF, WORLD_SIZE, POIS, LAKE, WATER_LEVEL } from './layout.ts';
import { smoothstep } from '../core/noise.ts';

export const SPLAT_N = 512;
const SPLAT_RES = WORLD_SIZE / SPLAT_N;

/**
 * Queue a partial upload of texels [i0, i1] on row j. three uploads each range as a one-row strip and counts four
 * components per texel whatever the format, so ranges are always expressed in texels × 4.
 */
function rowRange(tex: THREE.DataTexture, width: number, j: number, i0: number, i1: number): void {
  tex.addUpdateRange((j * width + i0) * 4, (i1 - i0 + 1) * 4);
}

/** Flags a texture once its first full upload has happened (partial updates need allocated storage). */
function trackUpload(tex: THREE.DataTexture): { live: boolean } {
  const state = { live: false };
  tex.onUpdate = () => (state.live = true);
  return state;
}

export interface Scatter {
  x: number;
  z: number;
  y: number;
  s: number;
  r: number;
  v: number;
}

/**
 * Derived world maps: splat (ground materials), forest density, height texture for GPU,
 * and deterministic scatter lists for trees / rocks / bushes.
 */
export class WorldData {
  readonly hf: Heightfield;
  /** RGBA: R road dirt, G village ground, B sand/wet bank, A forest floor. */
  readonly splat: Uint8Array;
  readonly splatTex: THREE.DataTexture;
  /** R: scorch, G: crack glow (dynamic, from combat). */
  readonly damage: Uint8Array;
  readonly damageTex: THREE.DataTexture;
  readonly heightTex: THREE.DataTexture;
  private heightHalf: Uint16Array;
  readonly forest: Float32Array;
  trees: Scatter[] = [];
  rocks: Scatter[] = [];
  bushes: Scatter[] = [];

  constructor(seed: number) {
    this.hf = new Heightfield(seed);
    this.splat = new Uint8Array(SPLAT_N * SPLAT_N * 4);
    this.forest = new Float32Array(SPLAT_N * SPLAT_N);
    this.damage = new Uint8Array(SPLAT_N * SPLAT_N * 4);
    this.buildSplat();
    this.splatTex = new THREE.DataTexture(this.splat, SPLAT_N, SPLAT_N, THREE.RGBAFormat);
    this.splatTex.magFilter = THREE.LinearFilter;
    this.splatTex.minFilter = THREE.LinearFilter;
    this.splatTex.needsUpdate = true;
    this.damageTex = new THREE.DataTexture(this.damage, SPLAT_N, SPLAT_N, THREE.RGBAFormat);
    this.damageTex.magFilter = THREE.LinearFilter;
    this.damageTex.minFilter = THREE.LinearFilter;
    this.damageTex.needsUpdate = true;
    this.heightHalf = new Uint16Array(HF_N * HF_N);
    this.heightTex = new THREE.DataTexture(this.heightHalf, HF_N, HF_N, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightLive = trackUpload(this.heightTex);
    this.damageLive = trackUpload(this.damageTex);
    this.syncHeightTex();
    this.scatter(seed);
  }

  private heightLive: { live: boolean };
  private damageLive: { live: boolean };

  /** Mirror the heightfield into the GPU height texture; with a world box (a crater), only the texels it covers. */
  syncHeightTex(box?: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    const d = this.hf.data;
    const h = this.heightHalf;
    if (!box || !this.heightLive.live) {
      for (let i = 0; i < d.length; i++) h[i] = THREE.DataUtils.toHalfFloat(d[i]);
      this.heightTex.clearUpdateRanges();
      this.heightTex.needsUpdate = true;
      return;
    }
    const cell = (v: number) => Math.min(HF_N - 1, Math.max(0, Math.floor((v + WORLD_HALF) / HF_RES)));
    const i0 = cell(box.minX);
    const i1 = Math.min(HF_N - 1, cell(box.maxX) + 1);
    const j0 = cell(box.minZ);
    const j1 = Math.min(HF_N - 1, cell(box.maxZ) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) h[j * HF_N + i] = THREE.DataUtils.toHalfFloat(d[j * HF_N + i]);
      rowRange(this.heightTex, HF_N, j, i0, i1);
    }
    this.heightTex.needsUpdate = true;
  }

  /** Upload changed damage texels (rows of a splat-space box) instead of the whole 512² map. */
  private damageRows(i0: number, i1: number, j0: number, j1: number): void {
    if (this.damageLive.live) for (let j = j0; j <= j1; j++) rowRange(this.damageTex, SPLAT_N, j, i0, i1);
    else this.damageTex.clearUpdateRanges();
    this.damageTex.needsUpdate = true;
  }

  private buildSplat(): void {
    const hf = this.hf;
    const n = hf.noise;
    for (let j = 0; j < SPLAT_N; j++) {
      for (let i = 0; i < SPLAT_N; i++) {
        const x = (i + 0.5) * SPLAT_RES - WORLD_HALF;
        const z = (j + 0.5) * SPLAT_RES - WORLD_HALF;
        const k = (j * SPLAT_N + i) * 4;
        const h = hf.heightAt(x, z);
        // Roads: dirt with wheel ruts softness.
        const rd = hf.roadDistance(x, z);
        const road = 1 - smoothstep(2.2, 4.8 + n.n2(x * 0.05, z * 0.05) * 1.2, rd);
        // Village ground (packed earth / cobble) inside settlements.
        let village = 0;
        for (const p of POIS) {
          if (p.kind !== 'village' && p.kind !== 'arena' && p.kind !== 'camp' && p.kind !== 'castle') continue;
          const d = Math.hypot(x - p.x, z - p.z);
          const r = p.kind === 'village' ? p.flat * 0.42 : p.kind === 'arena' ? p.flat * 0.75 : p.flat * 0.7;
          village = Math.max(village, 1 - smoothstep(r * 0.7, r + n.n2(x * 0.04, z * 0.04) * 8 + 6, d));
        }
        // Sand / wet banks near water.
        const riv = hf.riverDistance(x, z);
        const dl = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
        const bank = Math.max(1 - smoothstep(9, 17, riv), 1 - smoothstep(-2, 9, dl), h < WATER_LEVEL + 0.8 ? 1 : 0);
        // Forest density: Blackwood + groves.
        const bw = 1 - smoothstep(180, 360, Math.hypot(x + 560, z + 230));
        const groves = smoothstep(0.18, 0.42, n.fbm2(x * 0.0045 + 50, z * 0.0045 - 20, 4));
        const northWoods = smoothstep(-200, -500, z) * smoothstep(0.0, 0.3, n.fbm2(x * 0.006, z * 0.006, 3));
        let forest = Math.max(bw * (0.75 + 0.25 * n.n2(x * 0.02, z * 0.02)), groves * 0.75, northWoods * 0.8);
        forest *= 1 - Math.max(road, village, bank);
        // Keep the meadows open.
        forest *= smoothstep(140, 260, Math.hypot(x - 150, z - 420));
        // Keep mountains sparse.
        const slope = this.slope(x, z);
        forest *= 1 - smoothstep(0.55, 0.8, slope);
        forest *= 1 - smoothstep(60, 140, h);
        for (const p of POIS) if (p.flat > 0) forest *= smoothstep(p.flat * 0.9, p.flat * 1.4, Math.hypot(x - p.x, z - p.z));
        this.forest[j * SPLAT_N + i] = Math.max(0, forest);
        this.splat[k] = Math.round(road * 255);
        this.splat[k + 1] = Math.round(village * 255);
        this.splat[k + 2] = Math.round(bank * 255);
        this.splat[k + 3] = Math.round(smoothstep(0.25, 0.7, forest) * 255);
      }
    }
  }

  /** 0 = flat, 1 = vertical. */
  slope(x: number, z: number): number {
    const e = 2;
    const dx = this.hf.heightAt(x + e, z) - this.hf.heightAt(x - e, z);
    const dz = this.hf.heightAt(x, z + e) - this.hf.heightAt(x, z - e);
    return 1 - 1 / Math.sqrt(1 + (dx * dx + dz * dz) / (4 * e * e));
  }

  forestAt(x: number, z: number): number {
    const i = Math.floor((x + WORLD_HALF) / SPLAT_RES);
    const j = Math.floor((z + WORLD_HALF) / SPLAT_RES);
    if (i < 0 || j < 0 || i >= SPLAT_N || j >= SPLAT_N) return 0;
    return this.forest[j * SPLAT_N + i];
  }

  splatAt(x: number, z: number, ch: number): number {
    const i = Math.floor((x + WORLD_HALF) / SPLAT_RES);
    const j = Math.floor((z + WORLD_HALF) / SPLAT_RES);
    if (i < 0 || j < 0 || i >= SPLAT_N || j >= SPLAT_N) return 0;
    return this.splat[(j * SPLAT_N + i) * 4 + ch] / 255;
  }

  /** Is this spot open ground suitable for scattering props / spawning? */
  isOpenGround(x: number, z: number): boolean {
    if (Math.abs(x) > WORLD_HALF - 230 || Math.abs(z) > WORLD_HALF - 230) return false;
    const h = this.hf.heightAt(x, z);
    if (h < WATER_LEVEL + 0.6) return false;
    if (this.splatAt(x, z, 0) > 0.2 || this.splatAt(x, z, 1) > 0.2 || this.splatAt(x, z, 2) > 0.3) return false;
    return this.slope(x, z) < 0.35;
  }

  private scatter(seed: number): void {
    const rng = new Rng(seed ^ 0x5eed);
    const hf = this.hf;
    // Trees: jittered grid with density from the forest map.
    const cell = 7.5;
    for (let gz = -WORLD_HALF + 20; gz < WORLD_HALF - 20; gz += cell) {
      for (let gx = -WORLD_HALF + 20; gx < WORLD_HALF - 20; gx += cell) {
        const x = gx + rng.range(0, cell);
        const z = gz + rng.range(0, cell);
        const f = this.forestAt(x, z);
        // Very sparse lone trees in open fields too.
        const p = f * 0.92 + 0.0035;
        if (rng.next() > p) continue;
        const h = hf.heightAt(x, z);
        if (h < WATER_LEVEL + 0.9 || this.slope(x, z) > 0.5) continue;
        if (this.splatAt(x, z, 0) > 0.1 || this.splatAt(x, z, 1) > 0.05) continue;
        const north = smoothstep(-250, -650, z);
        const pineBias = Math.max(north, smoothstep(30, 90, h));
        const r = rng.next();
        const species = r < pineBias * 0.85 ? 1 : r < pineBias * 0.85 + 0.18 ? 2 : 0;
        this.trees.push({ x, z, y: h - 0.15, s: rng.range(0.78, 1.28), r: rng.range(0, Math.PI * 2), v: species * 10 + rng.int(0, 2) });
      }
    }
    // Rocks & boulders.
    for (let n = 0; n < 2600; n++) {
      const x = rng.range(-WORLD_HALF + 60, WORLD_HALF - 60);
      const z = rng.range(-WORLD_HALF + 60, WORLD_HALF - 60);
      const h = hf.heightAt(x, z);
      if (h < WATER_LEVEL + 0.2) continue;
      if (this.splatAt(x, z, 0) > 0.2 || this.splatAt(x, z, 1) > 0.3) continue;
      const sl = this.slope(x, z);
      if (rng.next() > 0.25 + sl * 1.4) continue;
      this.rocks.push({ x, z, y: h, s: rng.range(0.4, 1.0) * (1 + sl * 2.4) * (rng.chance(0.06) ? 2.6 : 1), r: rng.range(0, 6.28), v: rng.int(0, 3) });
    }
    // Bushes: forest edges and field margins.
    for (let n = 0; n < 9000; n++) {
      const x = rng.range(-WORLD_HALF + 200, WORLD_HALF - 200);
      const z = rng.range(-WORLD_HALF + 200, WORLD_HALF - 200);
      const f = this.forestAt(x, z);
      const edge = f > 0.05 && f < 0.6 ? 1 : 0.06;
      if (rng.next() > edge) continue;
      if (!this.isOpenGround(x, z)) continue;
      this.bushes.push({ x, z, y: hf.heightAt(x, z), s: rng.range(0.6, 1.4), r: rng.range(0, 6.28), v: rng.int(0, 2) });
    }
  }

  /** Paint scorch + crack glow into the damage map around a blast. */
  scorch(x: number, z: number, radius: number, strength = 1): void {
    const ci = (x + WORLD_HALF) / SPLAT_RES;
    const cj = (z + WORLD_HALF) / SPLAT_RES;
    const rr = (radius * 1.6) / SPLAT_RES;
    for (let j = Math.floor(cj - rr); j <= Math.ceil(cj + rr); j++) {
      for (let i = Math.floor(ci - rr); i <= Math.ceil(ci + rr); i++) {
        if (i < 0 || j < 0 || i >= SPLAT_N || j >= SPLAT_N) continue;
        const d = Math.hypot(i - ci, j - cj) / rr;
        if (d > 1) continue;
        const k = (j * SPLAT_N + i) * 4;
        const v = (1 - d) * strength;
        this.damage[k] = Math.min(255, this.damage[k] + Math.round(v * 220));
        this.damage[k + 1] = Math.min(255, Math.max(this.damage[k + 1], Math.round((1 - d) * 255 * strength)));
      }
    }
    this.markHot(ci, cj, rr);
    const r = this.hot[this.hot.length - 1];
    this.damageRows(r.i0, r.i1, r.j0, r.j1);
  }

  /** Crack glow cools over time (only inside regions that were recently hit). */
  coolDamage(dt: number): void {
    if (this.hot.length === 0) return;
    this.coolAcc += dt * 70;
    const g = Math.floor(this.coolAcc);
    if (g < 1) return;
    this.coolAcc -= g;
    const d = this.damage;
    for (let h = this.hot.length - 1; h >= 0; h--) {
      const r = this.hot[h];
      let any = false;
      for (let j = r.j0; j <= r.j1; j++) {
        for (let i = r.i0; i <= r.i1; i++) {
          const k = (j * SPLAT_N + i) * 4 + 1;
          if (d[k] > 0) {
            d[k] = Math.max(0, d[k] - g);
            any = true;
          }
        }
      }
      this.damageRows(r.i0, r.i1, r.j0, r.j1);
      if (!any) this.hot.splice(h, 1);
    }
  }

  private hot: { i0: number; i1: number; j0: number; j1: number }[] = [];
  private coolAcc = 0;

  private markHot(ci: number, cj: number, rr: number): void {
    this.hot.push({
      i0: Math.max(0, Math.floor(ci - rr)),
      i1: Math.min(SPLAT_N - 1, Math.ceil(ci + rr)),
      j0: Math.max(0, Math.floor(cj - rr)),
      j1: Math.min(SPLAT_N - 1, Math.ceil(cj + rr)),
    });
    if (this.hot.length > 24) this.hot.shift();
  }
}
