import * as THREE from 'three';
import { Rng } from '@ak/shared';
import { GeoBuilder, type Collider } from './GeoBuilder.ts';
import type { WorldData } from './WorldData.ts';
import type { Lighting } from '../render/Lighting.ts';
import { POI_BY_ID, BRIDGE, ROADS_SMOOTH } from './layout.ts';
import {
  plasterTexture,
  woodTexture,
  stoneWallTexture,
  thatchTexture,
  roofTileTexture,
  slateTexture,
  bannerTexture,
  clothTexture,
  rockTexture,
  flagstoneTexture,
} from '../render/textures.ts';
import { windUniforms } from './Grass.ts';

export interface ArenaInfo {
  x: number;
  z: number;
  y: number;
  /** Half size of the square fighting stage. */
  stageHalf: number;
  stageTop: number;
  yaw: number;
}

export interface Torch {
  x: number;
  y: number;
  z: number;
}

/**
 * Procedural medieval settlements: half-timbered houses, a church, tavern, smithy, market, windmill,
 * a tournament colosseum (training grounds), Highmere castle, a ruined watchtower, a stone bridge and camps.
 */
export class Settlements {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly torches: Torch[] = [];
  arena!: ArenaInfo;
  private windmillSails: THREE.Object3D[] = [];
  private banners: THREE.Mesh[] = [];
  private gb = new GeoBuilder();
  private rng = new Rng(2024);

  constructor(
    private data: WorldData,
    private lighting: Lighting,
  ) {
    this.buildVillage('ashford', 22, true);
    this.buildVillage('brookhollow', 8, false);
    this.buildArena();
    this.buildCastle();
    this.buildTower();
    this.buildBridge();
    for (const id of ['camp_brigand', 'camp_knight', 'camp_imp', 'camp_golem', 'camp_warlock']) this.buildCamp(id);
    this.buildFences();

    const mats = this.materials();
    this.gb.build(mats, this.group);
    this.colliders.push(...this.gb.colliders);
  }

  private h(x: number, z: number): number {
    return this.data.hf.heightAt(x, z);
  }

  private materials(): Record<string, THREE.Material> {
    const L = this.lighting;
    const std = (o: THREE.MeshStandardMaterialParameters, key: string) => L.register(new THREE.MeshStandardMaterial(o), undefined, key);
    const pl = plasterTexture();
    const wd = woodTexture(true);
    const wl = woodTexture(false);
    const st = stoneWallTexture();
    const th = thatchTexture();
    const tl = roofTileTexture();
    const sl = slateTexture();
    const rk = rockTexture();
    const fl = flagstoneTexture();
    return {
      plaster: std({ map: pl.map, normalMap: pl.normalMap, roughness: 0.92 }, 'plaster'),
      timber: std({ map: wd.map, normalMap: wd.normalMap, roughness: 0.85 }, 'timber'),
      wood: std({ map: wl.map, normalMap: wl.normalMap, roughness: 0.8 }, 'wood'),
      stone: std({ map: st.map, normalMap: st.normalMap, roughness: 0.9 }, 'stone'),
      rough: std({ map: rk.map, normalMap: rk.normalMap, roughness: 0.92, color: '#b8b2a6' }, 'rough'),
      thatch: std({ map: th.map, normalMap: th.normalMap, roughness: 0.97 }, 'thatch'),
      tile: std({ map: tl.map, normalMap: tl.normalMap, roughness: 0.75 }, 'tile'),
      slate: std({ map: sl.map, normalMap: sl.normalMap, roughness: 0.62 }, 'slate'),
      glass: std({ color: '#1d2a33', roughness: 0.15, metalness: 0.2, emissive: '#3a2a10', emissiveIntensity: 0.25 }, 'glass'),
      iron: std({ color: '#3a3b3e', roughness: 0.45, metalness: 0.85 }, 'iron'),
      clothRed: std({ map: clothTexture('#a8231d', '#e9dcc0'), roughness: 0.9, side: THREE.DoubleSide }, 'clothRed'),
      clothBlue: std({ map: clothTexture('#24457a', '#e9dcc0'), roughness: 0.9, side: THREE.DoubleSide }, 'clothBlue'),
      canvas: std({ map: clothTexture('#cbbd98'), roughness: 0.95, side: THREE.DoubleSide }, 'canvas'),
      hay: std({ map: th.map, normalMap: th.normalMap, roughness: 1, color: '#e6cf86' }, 'hay'),
      gold: std({ color: '#c99a2e', roughness: 0.35, metalness: 0.9 }, 'gold'),
      sand: std({ color: '#cdb98d', roughness: 1, map: rk.map }, 'sand'),
      flag: std({ map: fl.map, normalMap: fl.normalMap, roughness: 0.78 }, 'flag'),
    };
  }

  /* ---------------------------------- houses ---------------------------------- */

  private house(x: number, z: number, yaw: number, opts: { w: number; d: number; floors: number; roof: 'thatch' | 'tile'; big?: boolean }): void {
    const gb = this.gb;
    const rng = this.rng;
    const y = this.minHeightUnder(x, z, opts.w, opts.d, yaw);
    gb.pushTRS(x, y, z, yaw);
    const { w, d, floors } = opts;
    const plinth = 0.6;
    const h1 = 2.9;
    const h2 = 2.6;
    const jet = floors > 1 ? 0.45 : 0;
    gb.box('stone', w + 0.3, plinth + 1.2, d + 0.3, 0, plinth / 2 - 0.6, 0);
    gb.box('plaster', w, h1, d, 0, plinth + h1 / 2, 0);
    this.frame(w, h1, d, plinth);
    let top = plinth + h1;
    if (floors > 1) {
      // Jetty joist ends.
      for (let i = -w / 2 + 0.3; i <= w / 2 - 0.3; i += 0.6) {
        gb.box('timber', 0.16, 0.18, d + jet * 2 + 0.1, i, top + 0.05, 0);
      }
      gb.box('plaster', w + jet * 2, h2, d + jet * 2, 0, top + 0.15 + h2 / 2, 0);
      this.frame(w + jet * 2, h2, d + jet * 2, top + 0.15);
      top += 0.15 + h2;
    }
    const rw = w + jet * 2;
    const rd = d + jet * 2;
    const pitch = opts.roof === 'thatch' ? 0.95 : 0.82;
    const rh = (rw / 2) * Math.tan(pitch);
    const over = opts.roof === 'thatch' ? 0.7 : 0.45;
    this.gableRoof(opts.roof, rw, rd, top, pitch, over, opts.roof === 'thatch' ? 0.5 : 0.22);
    // Gable ends with timber.
    gb.gable('plaster', rw, rh, rd - 0.02, 0, top, 0, 0);
    gb.box('timber', 0.18, rh * 0.9, 0.14, 0, top + rh * 0.45, rd / 2 + 0.02);
    gb.box('timber', 0.18, rh * 0.9, 0.14, 0, top + rh * 0.45, -rd / 2 - 0.02);
    gb.box('timber', rw * 0.7, 0.16, 0.14, 0, top + rh * 0.3, rd / 2 + 0.02);
    gb.box('timber', rw * 0.7, 0.16, 0.14, 0, top + rh * 0.3, -rd / 2 - 0.02);
    gb.box('timber', 0.22, 0.22, rd + over * 2 + 0.2, 0, top + rh + 0.02, 0);
    // Chimney.
    if (rng.chance(0.75)) {
      const cxp = rng.range(-w * 0.25, w * 0.25);
      const czp = rng.chance(0.5) ? d * 0.3 : -d * 0.3;
      gb.box('stone', 0.9, rh + 2.2, 0.9, cxp, top + (rh + 2.2) / 2 - 0.3, czp);
      gb.box('stone', 1.1, 0.25, 1.1, cxp, top + rh + 1.9, czp);
    }
    // Door + step on the front (+z) side.
    const doorX = rng.range(-w * 0.25, w * 0.25);
    gb.box('wood', 1.15, 2.1, 0.12, doorX, plinth + 1.05, d / 2 + 0.03);
    gb.box('timber', 1.45, 0.18, 0.2, doorX, plinth + 2.2, d / 2 + 0.06);
    gb.box('iron', 0.08, 0.08, 0.08, doorX + 0.4, plinth + 1.05, d / 2 + 0.12);
    gb.box('stone', 1.6, 0.35, 0.8, doorX, 0.2, d / 2 + 0.5);
    // Windows with shutters, both floors.
    const winRow = (yy: number, ww: number, dd: number) => {
      for (const side of [1, -1]) {
        const n = Math.max(1, Math.floor(ww / 2.4));
        for (let i = 0; i < n; i++) {
          const wx = -ww / 2 + (ww / n) * (i + 0.5);
          if (side === 1 && Math.abs(wx - doorX) < 1.3 && yy < 2) continue;
          this.window(wx, yy, (side * dd) / 2, side === 1 ? 0 : Math.PI);
        }
      }
      for (const side of [1, -1]) this.window((side * ww) / 2, yy, 0, (side * Math.PI) / 2);
    };
    winRow(plinth + 1.6, w, d);
    if (floors > 1) winRow(plinth + h1 + 1.5, w + jet * 2, d + jet * 2);
    // Flower box / barrel / bench extras.
    if (rng.chance(0.5)) this.barrel(w / 2 + 0.6, 0, d / 2 - 0.6);
    if (rng.chance(0.4)) gb.box('wood', 1.8, 0.1, 0.45, -doorX * 0.5 - w * 0.2, 0.55, d / 2 + 0.4);
    gb.colliderBox(0, 0, (w + jet * 2) / 2 + 0.15, (d + jet * 2) / 2 + 0.15, -1, top + rh);
    gb.pop();
  }

  /** Two roof slabs meeting at a ridge along local z; eaves overhang by `over`. */
  private gableRoof(key: string, w: number, d: number, top: number, pitch: number, over: number, thick: number): void {
    const run = w / 2 + over;
    const rise = (w / 2) * Math.tan(pitch);
    const drop = over * Math.tan(pitch);
    const slabW = Math.hypot(run, rise + drop) + thick * 0.5;
    for (const s of [-1, 1]) {
      const cx = (s * run) / 2;
      const cy = top + (rise - drop) / 2 + (thick * 0.5) / Math.cos(pitch);
      this.gb.box(key, slabW, thick, d + over * 2, cx, cy, 0, 0, 0, -s * pitch, 0.35);
    }
  }

  private window(x: number, y: number, z: number, ry: number): void {
    const gb = this.gb;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    gb.push(m);
    gb.box('glass', 0.8, 1.0, 0.08, 0, 0, 0.02);
    gb.box('timber', 1.0, 0.12, 0.16, 0, 0.56, 0.05);
    gb.box('timber', 1.0, 0.14, 0.22, 0, -0.56, 0.08);
    gb.box('timber', 0.1, 1.1, 0.14, -0.45, 0, 0.05);
    gb.box('timber', 0.1, 1.1, 0.14, 0.45, 0, 0.05);
    gb.box('timber', 0.06, 1.0, 0.1, 0, 0, 0.06);
    // Open shutters.
    gb.box('wood', 0.45, 1.0, 0.05, -0.72, 0, 0.3, 0, 0.9, 0);
    gb.box('wood', 0.45, 1.0, 0.05, 0.72, 0, 0.3, 0, -0.9, 0);
    gb.pop();
  }

  /** Half-timber frame on the 4 walls of a box. */
  private frame(w: number, h: number, d: number, y0: number): void {
    const gb = this.gb;
    const t = 0.2;
    const o = 0.04;
    for (const [len, along, sideOff] of [
      [w, 'x', d / 2],
      [w, 'x', -d / 2],
      [d, 'z', w / 2],
      [d, 'z', -w / 2],
    ] as [number, 'x' | 'z', number][]) {
      const posts = Math.max(2, Math.round(len / 1.6) + 1);
      for (let i = 0; i < posts; i++) {
        const a = -len / 2 + (len / (posts - 1)) * i;
        if (along === 'x') gb.box('timber', t, h, 0.12, a, y0 + h / 2, sideOff + Math.sign(sideOff) * o);
        else gb.box('timber', 0.12, h, t, sideOff + Math.sign(sideOff) * o, y0 + h / 2, a);
      }
      // Sill, rail, header.
      for (const yy of [y0 + 0.1, y0 + h * 0.45, y0 + h - 0.1]) {
        if (along === 'x') gb.box('timber', len + 0.1, 0.18, 0.13, 0, yy, sideOff + Math.sign(sideOff) * o);
        else gb.box('timber', 0.13, 0.18, len + 0.1, sideOff + Math.sign(sideOff) * o, yy, 0);
      }
      // Diagonal braces at the corners.
      const bl = Math.hypot(1.4, h * 0.45);
      const ang = Math.atan2(h * 0.45, 1.4);
      for (const s of [-1, 1]) {
        const a = s * (len / 2 - 0.75);
        if (along === 'x') gb.box('timber', bl, 0.16, 0.11, a, y0 + h * 0.72, sideOff + Math.sign(sideOff) * o, 0, 0, s * ang);
        else gb.box('timber', 0.11, 0.16, bl, sideOff + Math.sign(sideOff) * o, y0 + h * 0.72, a, s * ang, 0, 0);
      }
    }
  }

  private barrel(x: number, y: number, z: number): void {
    this.gb.cylinder('wood', 0.38, 0.33, 0.95, x, y + 0.47, z, 10);
    this.gb.cylinder('iron', 0.39, 0.39, 0.06, x, y + 0.2, z, 10, true);
    this.gb.cylinder('iron', 0.39, 0.39, 0.06, x, y + 0.75, z, 10, true);
  }

  private crate(x: number, y: number, z: number, s = 0.8, ry = 0): void {
    this.gb.box('wood', s, s, s, x, y + s / 2, z, 0, ry, 0);
    this.gb.box('timber', s + 0.04, 0.08, s + 0.04, x, y + s - 0.06, z, 0, ry, 0);
    this.gb.box('timber', s + 0.04, 0.08, s + 0.04, x, y + 0.06, z, 0, ry, 0);
  }

  private minHeightUnder(x: number, z: number, w: number, d: number, yaw: number): number {
    let m = Infinity;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [a, b] of [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
      [0, 0],
    ]) {
      const wx = x + a * c + b * s;
      const wz = z - a * s + b * c;
      m = Math.min(m, this.h(wx, wz));
    }
    return m;
  }

  /* ---------------------------------- villages ---------------------------------- */

  private buildVillage(id: string, count: number, main: boolean): void {
    const poi = POI_BY_ID[id];
    const rng = this.rng;
    const gb = this.gb;
    const placed: { x: number; z: number; r: number }[] = [];
    const cy = this.h(poi.x, poi.z);
    // Central square: well + market.
    gb.pushTRS(poi.x, cy, poi.z, 0);
    this.well(0, 0);
    if (main) {
      const stalls: [number, number, number][] = [
        [9, 6, -0.4],
        [-9, 7, 0.5],
        [8, -8, 2.5],
        [-8, -7, -2.6],
      ];
      stalls.forEach(([sx, sz, ry], i) => this.stall(sx, sz, ry, i % 2 === 0 ? 'clothRed' : 'clothBlue'));
      this.statue(0, -14);
    }
    gb.pop();
    placed.push({ x: poi.x, z: poi.z, r: main ? 17 : 9 });

    if (main) {
      this.church(poi.x - 2, poi.z - 46, 0);
      placed.push({ x: poi.x - 2, z: poi.z - 46, r: 16 });
      this.tavern(poi.x + 30, poi.z + 22, -Math.PI * 0.75);
      placed.push({ x: poi.x + 30, z: poi.z + 22, r: 10 });
      this.smithy(poi.x - 32, poi.z + 18, Math.PI * 0.6);
      placed.push({ x: poi.x - 32, z: poi.z + 18, r: 8 });
      this.windmill(poi.x + 92, poi.z - 70);
      placed.push({ x: poi.x + 92, z: poi.z - 70, r: 9 });
    }

    // Houses around the square, facing it, avoiding roads.
    let attempts = 0;
    let built = 0;
    while (built < count && attempts < count * 60) {
      attempts++;
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(main ? 20 : 12, poi.flat * (main ? 0.82 : 0.75));
      const x = poi.x + Math.cos(ang) * dist;
      const z = poi.z + Math.sin(ang) * dist;
      const w = rng.range(5, 7.5);
      const d = rng.range(6.5, 9.5);
      const r = Math.hypot(w, d) / 2 + 2.2;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
      if (this.data.hf.roadDistance(x, z) < r + 1.5) continue;
      // Face the square (front door is +z local).
      const yaw = Math.atan2(poi.x - x, poi.z - z) + rng.range(-0.25, 0.25);
      this.house(x, z, yaw, { w, d, floors: rng.chance(main ? 0.6 : 0.35) ? 2 : 1, roof: rng.chance(0.5) ? 'thatch' : 'tile' });
      placed.push({ x, z, r });
      built++;
      // Yard props.
      if (rng.chance(0.5)) this.hayBale(x + Math.cos(ang) * (r + 1.5), z + Math.sin(ang) * (r + 1.5));
      if (rng.chance(0.35)) this.cart(x - Math.sin(ang) * (r + 1), z + Math.cos(ang) * (r + 1), ang);
    }
    // Torches around the square.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const tx = poi.x + Math.cos(a) * (main ? 15 : 8);
      const tz = poi.z + Math.sin(a) * (main ? 15 : 8);
      this.torchPost(tx, tz);
    }
  }

  private torchPost(x: number, z: number): void {
    const y = this.h(x, z);
    this.gb.cylinder('timber', 0.08, 0.1, 2.6, x, y + 1.3, z, 6);
    this.gb.cylinder('iron', 0.16, 0.08, 0.3, x, y + 2.7, z, 8);
    this.torches.push({ x, y: y + 2.95, z });
    this.gb.colliderCircle(x - 0, z - 0, 0.15, y, y + 2.8);
  }

  private well(x: number, z: number): void {
    const gb = this.gb;
    gb.cylinder('stone', 1.35, 1.45, 1.0, x, 0.5, z, 16);
    gb.cylinder('glass', 1.1, 1.1, 0.05, x, 0.85, z, 16);
    gb.box('timber', 0.18, 2.4, 0.18, x - 1.2, 1.7, z);
    gb.box('timber', 0.18, 2.4, 0.18, x + 1.2, 1.7, z);
    gb.box('timber', 2.7, 0.15, 0.15, x, 2.6, z);
    gb.gable('tile', 3.2, 0.9, 2.2, x, 2.75, z, Math.PI / 2);
    gb.cylinder('wood', 0.22, 0.2, 0.35, x, 1.6, z, 8);
    gb.colliderCircle(x, z, 1.45, 0, 2.5);
  }

  private stall(x: number, z: number, ry: number, cloth: string): void {
    const gb = this.gb;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    gb.push(m);
    for (const [px, pz, ph] of [
      [-1.5, -1, 2.6],
      [1.5, -1, 2.6],
      [-1.5, 1, 2.2],
      [1.5, 1, 2.2],
    ])
      gb.box('timber', 0.12, ph, 0.12, px, ph / 2, pz);
    gb.box('wood', 3.2, 0.12, 1.4, 0, 0.9, 0.2);
    gb.box(cloth, 3.6, 0.05, 2.6, 0, 2.45, 0, -0.18, 0, 0);
    this.crate(-1.0, 0.96, 0.2, 0.5);
    this.crate(0.6, 0.96, 0.3, 0.45, 0.4);
    gb.box('hay', 0.7, 0.25, 0.5, 0.0, 1.08, 0.1);
    gb.colliderBox(0, 0.2, 1.7, 0.85, 0, 2.6);
    gb.pop();
  }

  private statue(x: number, z: number): void {
    const gb = this.gb;
    gb.box('stone', 3, 1.2, 3, x, 0.6, z);
    gb.box('stone', 2.2, 1.4, 2.2, x, 1.9, z);
    // A stylised warrior in a fighting stance (honoring legendary martial artists).
    gb.cylinder('rough', 0.35, 0.42, 1.2, x, 3.3, z, 10);
    gb.add('rough', new THREE.SphereGeometry(0.28, 12, 8), new THREE.Matrix4().makeTranslation(x, 4.15, z));
    gb.box('rough', 0.22, 0.9, 0.22, x - 0.5, 3.6, z + 0.3, 0.9, 0, 0.6);
    gb.box('rough', 0.22, 0.9, 0.22, x + 0.5, 3.7, z - 0.2, -0.4, 0, -0.9);
    gb.box('rough', 0.26, 1.1, 0.26, x - 0.25, 2.4, z + 0.2, 0.2, 0, 0.15);
    gb.box('rough', 0.26, 1.1, 0.26, x + 0.25, 2.4, z - 0.15, -0.25, 0, -0.1);
    gb.colliderCircle(x, z, 1.6, 0, 4.5);
  }

  private church(x: number, z: number, yaw: number): void {
    const gb = this.gb;
    const y = this.minHeightUnder(x, z, 12, 22, yaw);
    gb.pushTRS(x, y, z, yaw);
    gb.box('stone', 11, 8, 20, 0, 3.6, 0);
    const rh = 5.2;
    this.gableRoof('slate', 11, 20, 7.6, Math.atan2(rh, 5.5), 0.5, 0.3);
    gb.gable('stone', 11, rh, 19.9, 0, 7.6, 0, 0);
    // Tower with spire.
    gb.box('stone', 6, 16, 6, 0, 8, 12);
    gb.box('stone', 6.6, 0.6, 6.6, 0, 16.2, 12);
    for (const [cx, cz] of [
      [-2.7, 9.3],
      [2.7, 9.3],
      [-2.7, 14.7],
      [2.7, 14.7],
    ])
      gb.box('stone', 0.9, 1.0, 0.9, cx, 17, cz);
    gb.cone('slate', 3.4, 9, 0, 21.4, 12, 4);
    gb.box('gold', 0.12, 1.6, 0.12, 0, 26.6, 12);
    gb.box('gold', 0.9, 0.12, 0.12, 0, 26.9, 12);
    // Rose window + doors.
    gb.cylinder('glass', 1.3, 1.3, 0.1, 0, 10.5, 15.06, 16);
    gb.box('wood', 2.0, 3.4, 0.2, 0, 1.7, 15.05);
    gb.box('stone', 2.8, 0.6, 0.4, 0, 3.7, 15.1);
    // Buttresses + tall windows.
    for (let i = -3; i <= 3; i++) {
      for (const s of [-1, 1]) {
        gb.box('stone', 0.8, 6, 1.0, s * 5.8, 3, i * 2.8, 0, 0, 0);
        if (i < 3) gb.box('glass', 0.1, 3.0, 1.0, s * 5.52, 4.4, i * 2.8 + 1.4);
      }
    }
    gb.colliderBox(0, 0, 5.8, 10.4, 0, 12);
    gb.colliderBox(0, 12, 3.3, 3.3, 0, 26);
    gb.pop();
  }

  private tavern(x: number, z: number, yaw: number): void {
    this.house(x, z, yaw, { w: 9, d: 12, floors: 2, roof: 'tile', big: true });
    // Hanging sign.
    const gb = this.gb;
    const y = this.h(x, z);
    gb.pushTRS(x, y, z, yaw);
    gb.box('timber', 0.12, 0.12, 1.8, 3.2, 3.6, 6.9);
    gb.box('wood', 0.08, 0.9, 1.2, 3.2, 3.0, 7.4);
    for (let i = 0; i < 3; i++) this.barrel(-4.6 + i * 0.9, 0, 6.8);
    gb.box('wood', 2.6, 0.08, 1.0, -2, 0.85, 8.4);
    gb.pop();
  }

  private smithy(x: number, z: number, yaw: number): void {
    const gb = this.gb;
    const y = this.minHeightUnder(x, z, 7, 7, yaw);
    gb.pushTRS(x, y, z, yaw);
    gb.box('stone', 7, 0.4, 7, 0, 0.2, 0);
    for (const [px, pz] of [
      [-3.2, -3.2],
      [3.2, -3.2],
      [-3.2, 3.2],
      [3.2, 3.2],
    ])
      gb.box('timber', 0.3, 3.4, 0.3, px, 2.1, pz);
    this.gableRoof('thatch', 7, 7, 3.8, 0.62, 0.4, 0.45);
    gb.box('stone', 2.2, 1.6, 1.8, -1.8, 1.2, -2.2);
    gb.box('stone', 1.0, 3.6, 1.0, -1.8, 3.2, -2.6);
    gb.box('iron', 0.9, 0.5, 0.4, 1.2, 1.15, 0.2);
    gb.box('iron', 0.4, 0.5, 0.35, 1.2, 0.65, 0.2);
    this.barrel(2.4, 0.4, 2.4);
    this.torches.push({ x: x + Math.cos(yaw) * -1.8 + Math.sin(yaw) * -2.2, y: y + 2.2, z: z - Math.sin(yaw) * -1.8 + Math.cos(yaw) * -2.2 });
    gb.colliderBox(-1.8, -2.2, 1.2, 1.1, 0, 4);
    gb.colliderBox(1.2, 0.2, 0.5, 0.3, 0, 1.5);
    gb.pop();
  }

  private windmill(x: number, z: number): void {
    const gb = this.gb;
    const y = this.h(x, z);
    gb.pushTRS(x, y, z, -0.6);
    gb.cylinder('stone', 3.2, 4.2, 12, 0, 5.5, 0, 16);
    gb.cone('thatch', 3.9, 4.5, 0, 13.7, 0, 16);
    gb.box('wood', 1.3, 2.2, 0.2, 0, 1.6, 4.1, -0.08, 0, 0);
    gb.colliderCircle(0, 0, 4.1, 0, 14);
    gb.pop();
    // Sails: a separate rotating object.
    const sails = new THREE.Group();
    const wd = woodTexture(false);
    const sailMat = this.lighting.register(new THREE.MeshStandardMaterial({ map: wd.map, roughness: 0.85 }), undefined, 'sailwood');
    const canvasMat = this.lighting.register(
      new THREE.MeshStandardMaterial({ map: clothTexture('#ddd0b0'), roughness: 0.95, side: THREE.DoubleSide }),
      undefined,
      'sailcloth',
    );
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 9.5, 0.2), sailMat);
      spar.position.y = 4.9;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 7.4), canvasMat);
      sail.position.set(1.05, 5.6, 0.05);
      for (const m of [spar, sail]) {
        m.castShadow = true;
        arm.add(m);
      }
      sails.add(arm);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.8, 10), sailMat);
    hub.rotation.x = Math.PI / 2;
    sails.add(hub);
    const anchor = new THREE.Group();
    anchor.position.set(x, y + 11.5, z);
    anchor.rotation.y = -0.6;
    sails.position.set(0, 0, 4.4);
    anchor.add(sails);
    this.group.add(anchor);
    this.windmillSails.push(sails);
  }

  private hayBale(x: number, z: number): void {
    const y = this.h(x, z);
    const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 14);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.72, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.rng.range(0, 3), Math.PI / 2)), new THREE.Vector3(1, 1, 1));
    this.gb.add('hay', g, m, 0.6);
    this.gb.colliderCircle(x, z, 0.8, y, y + 1.5);
  }

  private cart(x: number, z: number, yaw: number): void {
    const y = this.h(x, z);
    const gb = this.gb;
    gb.pushTRS(x, y, z, yaw);
    gb.box('wood', 1.6, 0.12, 2.6, 0, 0.85, 0);
    gb.box('wood', 0.08, 0.5, 2.6, -0.78, 1.15, 0);
    gb.box('wood', 0.08, 0.5, 2.6, 0.78, 1.15, 0);
    gb.box('wood', 1.6, 0.5, 0.08, 0, 1.15, -1.28);
    for (const s of [-1, 1]) {
      const wheel = new THREE.TorusGeometry(0.55, 0.07, 6, 14);
      gb.add('timber', wheel, new THREE.Matrix4().compose(new THREE.Vector3(s * 0.9, 0.6, 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)));
      gb.box('timber', 0.06, 1.0, 0.06, s * 0.9, 0.6, 0.3);
      gb.box('timber', 0.06, 0.06, 1.0, s * 0.9, 0.6, 0.3);
    }
    gb.box('timber', 0.08, 0.08, 2.0, -0.4, 0.75, 2.1, 0.25, 0, 0);
    gb.box('timber', 0.08, 0.08, 2.0, 0.4, 0.75, 2.1, 0.25, 0, 0);
    gb.box('hay', 1.4, 0.5, 2.2, 0, 1.15, 0);
    gb.colliderBox(0, 0, 1.0, 1.4, 0, 1.6);
    gb.pop();
  }

  /* ------------------------------- training grounds ------------------------------- */

  private buildArena(): void {
    const poi = POI_BY_ID.arena;
    const gb = this.gb;
    const y = this.h(poi.x, poi.z);
    const yaw = Math.atan2(0 - poi.x, 0 - poi.z); // gate faces Ashford
    gb.pushTRS(poi.x, y, poi.z, yaw);
    const R = 58;
    // Fighting stage: raised square of stone tiles (ring-out outside).
    const half = 15;
    gb.box('stone', half * 2 + 1.2, 1.4, half * 2 + 1.2, 0, 0.2, 0, 0, 0, 0, 0.25);
    // Flagstone surface: one texture repeat = 10 m = 4×4 slabs of 2.5 m, aligned with the stage edges.
    gb.box('flag', half * 2, 0.2, half * 2, 0, 0.98, 0, 0, 0, 0, 0.1);
    // The stage is solid ground to stand on; falling off it onto the sand is a ring-out.
    gb.colliderBox(0, 0, half + 0.6, half + 0.6, -0.6, 1.08);
    // Steps up to the stage (each rise is low enough to walk up).
    for (let s = 0; s < 3; s++) {
      gb.box('stone', 6, 0.35, 1.0, 0, 0.17 + s * 0.3, half + 1.6 - s * 0.5);
      gb.colliderBox(0, half + 1.6 - s * 0.5, 3, 0.5, -0.6, 0.345 + s * 0.3);
    }
    // Sand floor of the arena bowl.
    gb.cylinder('sand', R - 6, R - 6, 0.15, 0, -0.02, 0, 48);
    // Tiered stands (rings of steps).
    for (let t = 0; t < 6; t++) {
      const r0 = R - 5 + t * 1.6;
      // Gap at local +z for the gate (ring θ=1.5π maps to +z after rotateX; cylinder θ=0 is +z).
      const ring = new THREE.RingGeometry(r0, r0 + 1.6, 64, 1, Math.PI * 1.62, Math.PI * 1.76);
      ring.rotateX(-Math.PI / 2);
      gb.add('stone', ring, new THREE.Matrix4().makeTranslation(0, 1.0 + t * 0.9, 0), 0.4);
      const wall = new THREE.CylinderGeometry(r0, r0, 0.9, 64, 1, true, Math.PI * 0.12, Math.PI * 1.76);
      gb.add('stone', wall, new THREE.Matrix4().makeTranslation(0, 0.55 + t * 0.9, 0), 0.4);
    }
    // Outer wall with arches and crenellations.
    const outerR = R + 5;
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // Leave the gate open toward +z (local front).
      const front = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
      if (front < 0.14) continue;
      const px = Math.cos(a) * outerR;
      const pz = Math.sin(a) * outerR;
      const segLen = ((Math.PI * 2 * outerR) / segs) * 1.02;
      const yawSeg = -a + Math.PI / 2;
      gb.box('stone', segLen, 9, 1.6, px, 4.5, pz, 0, yawSeg, 0, 0.35);
      if (i % 2 === 0) gb.box('stone', segLen * 0.5, 1.0, 1.8, px, 9.5, pz, 0, yawSeg, 0);
      // Arch recess.
      gb.box('glass', segLen * 0.42, 3.4, 0.2, Math.cos(a) * (outerR + 0.82), 2.6, Math.sin(a) * (outerR + 0.82), 0, yawSeg, 0);
      // Banners every few segments.
      if (i % 5 === 2) this.banner(Math.cos(a) * (outerR - 1.0), 7.5, Math.sin(a) * (outerR - 1.0), yawSeg + Math.PI, i % 2 ? '#8e1b1b' : '#1c3d73', i % 3 === 0 ? 'dragon' : 'sun');
      gb.colliderBox(px, pz, segLen / 2, 0.9, 0, 10, yawSeg);
    }
    // Gate towers.
    for (const s of [-1, 1]) {
      const gx = s * 6.5;
      gb.cylinder('stone', 3.0, 3.2, 14, gx, 7, outerR, 16);
      gb.cone('slate', 3.6, 5, gx, 16.5, outerR, 16);
      gb.colliderCircle(gx, outerR, 3.2, 0, 14);
      this.torches.push(new THREE.Vector3(gx * 0.7, 3.2, outerR + 3.2).applyMatrix4(gb.matrix) as unknown as Torch);
    }
    gb.box('stone', 10, 2.4, 3.2, 0, 12.3, outerR);
    // Torch braziers around the stage.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = Math.cos(a) * (half + 4);
      const bz = Math.sin(a) * (half + 4);
      gb.cylinder('iron', 0.5, 0.25, 1.4, bx, 0.7, bz, 10);
      gb.cylinder('iron', 0.7, 0.55, 0.3, bx, 1.5, bz, 10);
      const wp = new THREE.Vector3(bx, 1.75, bz).applyMatrix4(gb.matrix);
      this.torches.push({ x: wp.x, y: wp.y, z: wp.z });
      gb.colliderCircle(bx, bz, 0.6, 0, 1.8);
    }
    gb.pop();
    this.arena = { x: poi.x, z: poi.z, y, stageHalf: half, stageTop: y + 1.08, yaw };
  }

  private banner(x: number, y: number, z: number, ry: number, color: string, sigil: 'sun' | 'dragon' | 'tower'): void {
    const tex = bannerTexture(color, sigil);
    const mat = this.lighting.register(
      new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
      (s) => {
        Object.assign(s.uniforms, windUniforms);
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float k = (1.0 - uv.y);
            transformed.z += sin(uTime * 2.4 + position.y * 1.6 + position.x * 0.8) * 0.18 * k;
            transformed.x += sin(uTime * 1.7 + position.y * 2.0) * 0.06 * k;`,
          );
      },
      `banner-${color}-${sigil}`,
    );
    const g = new THREE.PlaneGeometry(1.8, 3.6, 4, 10);
    const mesh = new THREE.Mesh(g, mat);
    const wp = new THREE.Vector3(x, y, z).applyMatrix4(this.gb.matrix);
    mesh.position.copy(wp);
    const e = new THREE.Euler().setFromRotationMatrix(this.gb.matrix, 'YXZ');
    mesh.rotation.y = e.y + ry;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.banners.push(mesh);
  }

  /* ---------------------------------- castle ---------------------------------- */

  private buildCastle(): void {
    const poi = POI_BY_ID.castle;
    const gb = this.gb;
    const y = this.h(poi.x, poi.z) - 0.5;
    gb.pushTRS(poi.x, y, poi.z, 0.35);
    const S = 26;
    // Curtain walls.
    for (const [x, z, w, d] of [
      [0, -S, S * 2, 2.4],
      [0, S, S * 2, 2.4],
      [-S, 0, 2.4, S * 2],
      [S, 0, 2.4, S * 2],
    ]) {
      const gate = z === S;
      if (gate) {
        gb.box('stone', S - 4, 11, d, -S / 2 - 2, 5.5, z);
        gb.box('stone', S - 4, 11, d, S / 2 + 2, 5.5, z);
        gb.box('stone', 8, 4, d + 0.4, 0, 9, z);
        gb.box('wood', 6, 7, 0.3, 0, 3.5, z + 0.6, 0.0, 0, 0);
        gb.colliderBox(-S / 2 - 2, z, (S - 4) / 2, 1.3, 0, 11);
        gb.colliderBox(S / 2 + 2, z, (S - 4) / 2, 1.3, 0, 11);
      } else {
        gb.box('stone', w, 11, d, x, 5.5, z, 0, 0, 0, 0.3);
        gb.colliderBox(x, z, w / 2 + 0.2, d / 2 + 0.2, 0, 11);
      }
      // Crenellations.
      const len = Math.max(w, d);
      for (let i = -len / 2 + 1; i < len / 2; i += 2.2) {
        if (w > d) gb.box('stone', 1.1, 1.2, d + 0.2, x + i, 11.6, z);
        else gb.box('stone', d + 0.2, 1.2, 1.1, x, 11.6, z + i);
      }
    }
    // Corner towers.
    for (const [x, z] of [
      [-S, -S],
      [S, -S],
      [-S, S],
      [S, S],
    ]) {
      gb.cylinder('stone', 4.2, 4.6, 17, x, 8.5, z, 18);
      gb.cylinder('stone', 4.8, 4.8, 1.2, x, 17.4, z, 18);
      gb.cone('slate', 5.2, 8, x, 22, z, 18);
      gb.colliderCircle(x, z, 4.6, 0, 18);
      this.flag(x, 26.5, z);
    }
    // Keep.
    gb.box('stone', 16, 24, 14, 0, 12, -6);
    for (let i = -7; i <= 7; i += 2.3) {
      gb.box('stone', 1.1, 1.4, 1.1, i, 24.6, -13);
      gb.box('stone', 1.1, 1.4, 1.1, i, 24.6, 1);
    }
    gb.cylinder('stone', 3, 3, 30, 6.5, 15, -11, 14);
    gb.cone('slate', 3.6, 7, 6.5, 33.5, -11, 14);
    this.flag(6.5, 38.5, -11);
    for (let i = 0; i < 4; i++) gb.box('glass', 1.2, 2.4, 0.2, -5 + i * 3.3, 16, 1.05);
    gb.colliderBox(0, -6, 8.2, 7.2, 0, 25);
    gb.pop();
  }

  private flag(x: number, y: number, z: number): void {
    this.gb.box('timber', 0.12, 4, 0.12, x, y - 1.5, z);
    this.banner(x + 1.0, y - 0.8, z, Math.PI / 2, '#1c3d73', 'tower');
  }

  private buildTower(): void {
    const poi = POI_BY_ID.tower;
    const gb = this.gb;
    const y = this.h(poi.x, poi.z);
    gb.pushTRS(poi.x, y, poi.z, 0);
    const R = 5.5;
    const segs = 22;
    const rng = new Rng(5);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const hgt = 18 * (0.35 + 0.65 * Math.abs(Math.sin(a * 1.3 + 0.5))) + rng.range(-2, 2);
      if (i === 5) continue; // doorway / breach
      const seg = ((Math.PI * 2 * R) / segs) * 1.05;
      gb.box('stone', seg, hgt, 1.4, Math.cos(a) * R, hgt / 2, Math.sin(a) * R, 0, -a + Math.PI / 2, 0, 0.35);
      gb.colliderBox(Math.cos(a) * R, Math.sin(a) * R, seg / 2, 0.8, 0, hgt, -a + Math.PI / 2);
    }
    // Rubble.
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(R + 1, R + 9);
      const s = rng.range(0.4, 1.3);
      gb.box('stone', s * 1.3, s * 0.8, s, Math.cos(a) * r, s * 0.3, Math.sin(a) * r, rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4));
    }
    gb.pop();
  }

  private buildBridge(): void {
    const gb = this.gb;
    const x = BRIDGE.x;
    const z = BRIDGE.z;
    // Align with the road direction across the river.
    const road = ROADS_SMOOTH[2];
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < road.length; i++) {
      const d = Math.hypot(road[i][0] - x, road[i][1] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const a = road[Math.max(0, best - 2)];
    const b = road[Math.min(road.length - 1, best + 2)];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const L = 34;
    const y0 = Math.max(this.h(x + Math.sin(yaw) * L * 0.5, z + Math.cos(yaw) * L * 0.5), this.h(x - Math.sin(yaw) * L * 0.5, z - Math.cos(yaw) * L * 0.5));
    gb.pushTRS(x, 0, z, yaw);
    const deckY = Math.max(y0, 2.2) + 0.4;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const t0 = i / N - 0.5;
      const t1 = (i + 1) / N - 0.5;
      const zc = ((t0 + t1) / 2) * L;
      const arch = Math.cos(((t0 + t1) / 2) * Math.PI) * 1.4;
      const segL = L / N + 0.05;
      gb.box('stone', 5, 0.6, segL, 0, deckY + arch, zc, 0, 0, 0, 0.35);
      gb.box('stone', 0.5, 1.1, segL, -2.6, deckY + arch + 0.8, zc);
      gb.box('stone', 0.5, 1.1, segL, 2.6, deckY + arch + 0.8, zc);
      // Arched underside.
      const u = Math.min(1, Math.abs((2 * zc) / L));
      const archLine = -2.5 + Math.sqrt(Math.max(0, 1 - u * u)) * (deckY + 0.9);
      const under = Math.max(0.6, deckY + arch - archLine);
      gb.box('stone', 4.6, under, segL, 0, deckY + arch - under / 2, zc);
    }
    gb.colliderBox(-2.6, 0, 0.3, L / 2, -5, deckY + 3);
    gb.colliderBox(2.6, 0, 0.3, L / 2, -5, deckY + 3);
    gb.pop();
    this.bridgeInfo = { x, z, yaw, len: L, deckY };
  }

  bridgeInfo = { x: 0, z: 0, yaw: 0, len: 0, deckY: 0 };

  /** Walkable height of the bridge deck at a point, or null. */
  bridgeHeight(px: number, pz: number): number | null {
    const b = this.bridgeInfo;
    const dx = px - b.x;
    const dz = pz - b.z;
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > 2.4 || Math.abs(lz) > b.len / 2) return null;
    return b.deckY + Math.cos((lz / b.len) * Math.PI) * 1.4 + 0.3;
  }

  /* ---------------------------------- camps ---------------------------------- */

  private buildCamp(id: string): void {
    const poi = POI_BY_ID[id];
    const gb = this.gb;
    const rng = new Rng(id.length * 131);
    const y = this.h(poi.x, poi.z);
    gb.pushTRS(poi.x, y, poi.z, rng.range(0, 6));
    // Campfire ring + logs.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      gb.box('rough', 0.45, 0.3, 0.35, Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0, 0, a, 0);
    }
    for (let i = 0; i < 3; i++) gb.box('timber', 0.18, 0.18, 1.3, 0, 0.2, 0, 0.2, (i / 3) * Math.PI, 0);
    const wp = new THREE.Vector3(0, 0.4, 0).applyMatrix4(gb.matrix);
    this.torches.push({ x: wp.x, y: wp.y, z: wp.z });
    // Tents.
    const tents = id === 'camp_golem' ? 1 : 4;
    for (let i = 0; i < tents; i++) {
      const a = (i / tents) * Math.PI * 2 + 0.6;
      const r = rng.range(8, 11);
      const tx = Math.cos(a) * r;
      const tz = Math.sin(a) * r;
      gb.cone(id === 'camp_knight' ? 'clothBlue' : id === 'camp_warlock' ? 'clothRed' : 'canvas', 2.6, 3.4, tx, 1.7, tz, 6);
      gb.box('timber', 0.1, 3.8, 0.1, tx, 1.9, tz);
      gb.colliderCircle(tx, tz, 2.3, 0, 3);
    }
    // Palisade stakes on part of the perimeter.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 1.5 + 2.2;
      const r = poi.flat * 0.68;
      const sx = Math.cos(a) * r;
      const sz = Math.sin(a) * r;
      gb.cylinder('timber', 0.05, 0.16, 2.6, sx, 1.1, sz, 5);
      gb.colliderCircle(sx, sz, 0.25, 0, 2.4);
    }
    for (let i = 0; i < 4; i++) this.crate(rng.range(-5, 5), 0, rng.range(-5, 5), rng.range(0.6, 0.9), rng.range(0, 3));
    if (id === 'camp_golem') {
      // Quarry: big cut stone blocks.
      for (let i = 0; i < 14; i++) {
        const s = rng.range(1.5, 3.4);
        const bx = rng.range(-16, 16);
        const bz = rng.range(-16, 16);
        gb.box('rough', s * 1.4, s, s, bx, s * 0.45, bz, 0, rng.range(0, 3), rng.range(-0.15, 0.15));
        gb.colliderCircle(bx, bz, s * 0.7, 0, s);
      }
    }
    if (id === 'camp_warlock') {
      // Standing stones circle.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        gb.box('rough', 1.2, 4.2, 0.8, Math.cos(a) * 7, 2.0, Math.sin(a) * 7, rng.range(-0.08, 0.08), -a, rng.range(-0.06, 0.06));
        gb.colliderCircle(Math.cos(a) * 7, Math.sin(a) * 7, 0.8, 0, 4);
      }
    }
    gb.pop();
  }

  /** Split-rail fences along roads near villages. */
  private buildFences(): void {
    const gb = this.gb;
    for (const road of ROADS_SMOOTH) {
      for (let i = 2; i < road.length - 2; i += 1) {
        const [x0, z0] = road[i];
        const [x1, z1] = road[i + 1];
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        const nearVillage =
          Math.hypot(mx - POI_BY_ID.ashford.x, mz - POI_BY_ID.ashford.z) < 230 && Math.hypot(mx - POI_BY_ID.ashford.x, mz - POI_BY_ID.ashford.z) > 120;
        if (!nearVillage || this.rng.chance(0.25)) continue;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        const nx = -dz / len;
        const nz = dx / len;
        for (const side of [-1, 1]) {
          const fx0 = x0 + nx * 5.5 * side;
          const fz0 = z0 + nz * 5.5 * side;
          const fx1 = x1 + nx * 5.5 * side;
          const fz1 = z1 + nz * 5.5 * side;
          const ya = this.h(fx0, fz0);
          const yb = this.h(fx1, fz1);
          gb.box('timber', 0.14, 1.3, 0.14, fx0, ya + 0.55, fz0);
          const yaw = Math.atan2(fx1 - fx0, fz1 - fz0);
          const pitch = Math.atan2(yb - ya, len);
          for (const hh of [0.55, 0.95]) gb.box('timber', 0.08, 0.1, len, (fx0 + fx1) / 2, (ya + yb) / 2 + hh, (fz0 + fz1) / 2, -pitch, yaw, 0);
        }
      }
    }
  }

  update(dt: number): void {
    for (const s of this.windmillSails) s.rotation.z -= dt * 0.55;
  }
}
