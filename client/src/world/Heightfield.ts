import { Noise, smoothstep, lerp } from '../core/noise.ts';
import {
  WORLD_HALF,
  WORLD_SIZE,
  POIS,
  RIVER_SMOOTH,
  ROADS_SMOOTH,
  LAKE,
  distToPolyline,
  type Vec2,
} from './layout.ts';

/** Meters between height samples. */
export const HF_RES = 2;
export const HF_N = WORLD_SIZE / HF_RES + 1;

/** Spatial grid over polylines for fast distance queries during generation. */
class PolyIndex {
  private cells = new Map<number, Vec2[][]>();
  private cell = 64;
  constructor(lines: Vec2[][], pad: number) {
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const seg: Vec2[] = [line[i], line[i + 1]];
        const minx = Math.min(seg[0][0], seg[1][0]) - pad;
        const maxx = Math.max(seg[0][0], seg[1][0]) + pad;
        const minz = Math.min(seg[0][1], seg[1][1]) - pad;
        const maxz = Math.max(seg[0][1], seg[1][1]) + pad;
        for (let cx = Math.floor(minx / this.cell); cx <= Math.floor(maxx / this.cell); cx++) {
          for (let cz = Math.floor(minz / this.cell); cz <= Math.floor(maxz / this.cell); cz++) {
            const k = cx * 4096 + cz;
            let arr = this.cells.get(k);
            if (!arr) this.cells.set(k, (arr = []));
            arr.push(seg);
          }
        }
      }
    }
  }
  dist(x: number, z: number): number {
    const arr = this.cells.get(Math.floor(x / this.cell) * 4096 + Math.floor(z / this.cell));
    if (!arr) return Infinity;
    let best = Infinity;
    for (const seg of arr) {
      const d = distToPolyline(x, z, seg).d;
      if (d < best) best = d;
    }
    return best;
  }
}

/**
 * The terrain height data. Heights are generated once from noise + the authored layout, can be
 * deformed at runtime (craters), and are queried with the exact triangle interpolation the LOD0 mesh uses.
 */
export class Heightfield {
  readonly data = new Float32Array(HF_N * HF_N);
  readonly noise: Noise;
  private riverIdx: PolyIndex;
  private roadIdx: PolyIndex;
  private plateau = new Map<string, number>();
  /** Incremented whenever data changes (for GPU texture sync). */
  version = 0;

  constructor(seed: number) {
    this.noise = new Noise(seed);
    this.riverIdx = new PolyIndex([RIVER_SMOOTH], 260);
    this.roadIdx = new PolyIndex(ROADS_SMOOTH, 40);
    for (const p of POIS) if (p.flat > 0) this.plateau.set(p.id, Math.max(3.2, this.natural(p.x, p.z)));
    for (let j = 0; j < HF_N; j++) {
      const z = j * HF_RES - WORLD_HALF;
      for (let i = 0; i < HF_N; i++) {
        const x = i * HF_RES - WORLD_HALF;
        this.data[j * HF_N + i] = this.generate(x, z);
      }
    }
  }

  /** Natural rolling terrain before layout shaping. */
  private natural(x: number, z: number): number {
    const n = this.noise;
    let h = 8;
    h += n.fbm2(x * 0.0017, z * 0.0017, 5) * 20;
    h += n.fbm2(x * 0.0062 + 100, z * 0.0062 - 40, 4) * 4.5;
    h += n.fbm2(x * 0.031, z * 0.031, 3) * 0.45;
    // Northern highlands with ridged crests.
    const north = smoothstep(-260, -820, z);
    h += n.ridged2(x * 0.0032 + 7, z * 0.0032) * 85 * north;
    // Enclosing mountain ring at the map border.
    const edge = smoothstep(760, 1010, Math.max(Math.abs(x), Math.abs(z)));
    h += edge * (110 + n.ridged2(x * 0.004, z * 0.004 + 31) * 190);
    // Castle hill and watchtower hill.
    h += hill(x, z, 540, -470, 190, 44);
    h += hill(x, z, -390, -540, 120, 30);
    // Soft floor so low spots form shallow dells rather than accidental ponds.
    if (h < 2.6) h = 2.6 - (2.6 - h) * 0.15;
    return h;
  }

  private generate(x: number, z: number): number {
    let h = this.natural(x, z);
    // River valley + bed.
    const dr = this.riverIdx.dist(x, z);
    if (dr < 260) {
      const valley = 1 - smoothstep(0, 230, dr);
      h -= valley * Math.max(0, h - 2.5) * 0.55;
      const halfW = 8 + this.noise.n2(x * 0.01, z * 0.01) * 2.5;
      const bed = -2.4 + smoothstep(0, halfW, dr) * 2.2;
      h = lerp(Math.min(h, bed), h, smoothstep(halfW * 0.6, halfW + 20, dr));
    }
    // Lake basin.
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    const lr = LAKE.r + this.noise.n2(x * 0.02, z * 0.02) * 9;
    if (dl < lr + 60) {
      const bed = -4.2 + smoothstep(lr * 0.2, lr, dl) * 3.6;
      h = lerp(Math.min(h, bed), h, smoothstep(lr - 4, lr + 50, dl));
    }
    // Flatten building plateaus.
    for (const p of POIS) {
      if (p.flat <= 0) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.flat * 1.9) {
        const target = this.plateau.get(p.id)! + this.noise.n2(x * 0.02, z * 0.02) * 0.25;
        h = lerp(target, h, smoothstep(p.flat * 0.75, p.flat * 1.9, d));
      }
    }
    // Roads: gentle cut + smoothing.
    const dd = this.roadIdx.dist(x, z);
    if (dd < 14) h -= (1 - smoothstep(2, 14, dd)) * 0.18;
    return h;
  }

  private idx(i: number, j: number): number {
    return Math.min(HF_N - 1, Math.max(0, j)) * HF_N + Math.min(HF_N - 1, Math.max(0, i));
  }

  sample(i: number, j: number): number {
    return this.data[this.idx(i, j)];
  }

  /** Height matching the LOD0 triangulation exactly (diagonal from (i+1,j) to (i,j+1)). */
  heightAt(x: number, z: number): number {
    const gx = (x + WORLD_HALF) / HF_RES;
    const gz = (z + WORLD_HALF) / HF_RES;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.sample(i, j);
    const b = this.sample(i + 1, j);
    const c = this.sample(i, j + 1);
    const d = this.sample(i + 1, j + 1);
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  normalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
    const e = HF_RES;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    let nx = hl - hr;
    let ny = 2 * e;
    let nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    nx /= l;
    ny /= l;
    nz /= l;
    out.x = nx;
    out.y = ny;
    out.z = nz;
  }

  /** Grid-space smooth normal (central differences) for mesh building. */
  gridNormal(i: number, j: number, step: number, out: Float32Array, o: number): void {
    const hl = this.sample(i - step, j);
    const hr = this.sample(i + step, j);
    const hd = this.sample(i, j - step);
    const hu = this.sample(i, j + step);
    let nx = hl - hr;
    let ny = 2 * step * HF_RES;
    let nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out[o] = nx / l;
    out[o + 1] = ny / l;
    out[o + 2] = nz / l;
  }

  roadDistance(x: number, z: number): number {
    return this.roadIdx.dist(x, z);
  }

  riverDistance(x: number, z: number): number {
    return this.riverIdx.dist(x, z);
  }

  /**
   * Blast a crater: bowl with a raised rim. Returns the affected world-space bounds.
   */
  crater(x: number, z: number, radius: number, depth: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const rim = radius * 1.45;
    const i0 = Math.floor((x - rim + WORLD_HALF) / HF_RES);
    const i1 = Math.ceil((x + rim + WORLD_HALF) / HF_RES);
    const j0 = Math.floor((z - rim + WORLD_HALF) / HF_RES);
    const j1 = Math.ceil((z + rim + WORLD_HALF) / HF_RES);
    for (let j = Math.max(0, j0); j <= Math.min(HF_N - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(HF_N - 1, i1); i++) {
        const wx = i * HF_RES - WORLD_HALF;
        const wz = j * HF_RES - WORLD_HALF;
        const d = Math.hypot(wx - x, wz - z) / radius;
        let dh = 0;
        if (d < 1) dh = -depth * (1 - d * d) * (0.85 + 0.15 * this.noise.n2(wx * 0.3, wz * 0.3));
        else if (d < 1.45) dh = depth * 0.22 * Math.sin(((d - 1) / 0.45) * Math.PI);
        const k = j * HF_N + i;
        // Never carve below the bedrock floor near water.
        this.data[k] = Math.max(-6, this.data[k] + dh);
      }
    }
    this.version++;
    return { minX: x - rim, maxX: x + rim, minZ: z - rim, maxZ: z + rim };
  }
}

function hill(x: number, z: number, cx: number, cz: number, r: number, h: number): number {
  const d = Math.hypot(x - cx, z - cz) / r;
  if (d >= 1) return 0;
  const t = 1 - d * d;
  return h * t * t;
}
