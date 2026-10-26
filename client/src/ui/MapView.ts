import * as THREE from 'three';
import { POIS, ROADS_SMOOTH, WORLD_HALF, WORLD_SIZE, WATER_LEVEL, type Poi } from '../world/layout.ts';
import type { World } from '../world/World.ts';
import './styles/map.css';

const MAP_N = 1024;
const M_PER_PX = WORLD_SIZE / MAP_N;

export interface MapMarker {
  x: number;
  z: number;
  kind: 'mob' | 'mobHot' | 'rival' | 'herald';
}

export interface CampInfo {
  id: string;
  name: string;
  x: number;
  z: number;
  level: [number, number];
}

/** Bake the whole world into a stylised relief map: hillshade, contours, forests, roads, water, snow. */
function bakeMap(world: World): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = MAP_N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(MAP_N, MAP_N);
  const d = world.data;
  const H = new Float32Array(MAP_N * MAP_N);
  for (let j = 0; j < MAP_N; j++)
    for (let i = 0; i < MAP_N; i++) H[j * MAP_N + i] = d.hf.heightAt(-WORLD_HALF + (i + 0.5) * M_PER_PX, -WORLD_HALF + (j + 0.5) * M_PER_PX);
  const hAt = (i: number, j: number) => H[Math.min(MAP_N - 1, Math.max(0, j)) * MAP_N + Math.min(MAP_N - 1, Math.max(0, i))];
  // Light from the north-west.
  const L = new THREE.Vector3(-0.55, 0.75, -0.45).normalize();
  for (let j = 0; j < MAP_N; j++) {
    for (let i = 0; i < MAP_N; i++) {
      const x = -WORLD_HALF + (i + 0.5) * M_PER_PX;
      const z = -WORLD_HALF + (j + 0.5) * M_PER_PX;
      const h = hAt(i, j);
      const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * M_PER_PX);
      const dz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * M_PER_PX);
      const nx = -dx;
      const nz = -dz;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const lambert = Math.max(0, (nx * L.x + L.y + nz * L.z) * inv);
      const slope = 1 - inv;
      let r: number;
      let g: number;
      let b: number;
      if (h < WATER_LEVEL - 0.15) {
        const deep = Math.min(1, (WATER_LEVEL - h) / 6);
        r = 70 - deep * 30;
        g = 128 - deep * 40;
        b = 168 - deep * 30;
      } else {
        // Meadow → hill olive → rock → snow by height and slope.
        const t = Math.min(1, Math.max(0, (h - 8) / 70));
        r = 128 + t * 30;
        g = 170 - t * 30;
        b = 82 - t * 10;
        const rock = Math.min(1, Math.max(0, slope * 2.4 - 0.5) + Math.max(0, (h - 70) / 40));
        r += (150 - r) * rock;
        g += (146 - g) * rock;
        b += (138 - b) * rock;
        const snow = Math.min(1, Math.max(0, (h - 125) / 25));
        r += (240 - r) * snow;
        g += (244 - g) * snow;
        b += (250 - b) * snow;
        const f = d.forestAt(x, z);
        r += (52 - r) * f * 0.85;
        g += (92 - g) * f * 0.85;
        b += (44 - b) * f * 0.85;
        const road = d.splatAt(x, z, 0);
        r += (206 - r) * road;
        g += (176 - g) * road;
        b += (120 - b) * road;
        const village = d.splatAt(x, z, 1);
        r += (214 - r) * village * 0.8;
        g += (198 - g) * village * 0.8;
        b += (160 - b) * village * 0.8;
        const sand = d.splatAt(x, z, 2);
        r += (224 - r) * sand * 0.7;
        g += (206 - g) * sand * 0.7;
        b += (150 - b) * sand * 0.7;
      }
      const shadeK = 0.55 + lambert * 0.6;
      r *= shadeK;
      g *= shadeK;
      b *= shadeK;
      // Ink contour lines every 15 m.
      const band = Math.floor(h / 15);
      if (h > WATER_LEVEL && (Math.floor(hAt(i + 1, j) / 15) !== band || Math.floor(hAt(i, j + 1) / 15) !== band)) {
        r *= 0.78;
        g *= 0.78;
        b *= 0.74;
      }
      const k = (j * MAP_N + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Roads as crisp strokes on top.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, col] of [
    [4.2, 'rgba(60,44,24,0.55)'],
    [2.4, '#e2c890'],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    for (const road of ROADS_SMOOTH) {
      ctx.beginPath();
      road.forEach(([x, z], idx) => {
        const px = (x + WORLD_HALF) / M_PER_PX;
        const pz = (z + WORLD_HALF) / M_PER_PX;
        if (idx === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }
  }
  return c;
}

const toMap = (x: number, z: number) => [(x + WORLD_HALF) / M_PER_PX, (z + WORLD_HALF) / M_PER_PX] as const;

function poiIcon(ctx: CanvasRenderingContext2D, p: Poi, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1.5, s * 0.16);
  ctx.strokeStyle = '#07080b';
  switch (p.kind) {
    case 'village': {
      ctx.fillStyle = '#f4efe2';
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, s * 0.45);
      ctx.lineTo(-s * 0.55, -s * 0.05);
      ctx.lineTo(0, -s * 0.55);
      ctx.lineTo(s * 0.55, -s * 0.05);
      ctx.lineTo(s * 0.55, s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'arena': {
      ctx.strokeStyle = '#07080b';
      ctx.lineWidth = s * 0.34;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.5 * sgn, -s * 0.5);
        ctx.lineTo(s * 0.5 * sgn, s * 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ffc21a';
      ctx.lineWidth = s * 0.18;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.5 * sgn, -s * 0.5);
        ctx.lineTo(s * 0.5 * sgn, s * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'camp': {
      ctx.fillStyle = '#e3324d';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.6);
      ctx.lineTo(s * 0.55, 0);
      ctx.lineTo(0, s * 0.6);
      ctx.lineTo(-s * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#07080b';
      ctx.beginPath();
      ctx.arc(-s * 0.15, -s * 0.05, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.15, -s * 0.05, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'castle':
    case 'ruin': {
      ctx.fillStyle = p.kind === 'castle' ? '#c8ccd6' : '#9a9488';
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, s * 0.5);
      ctx.lineTo(-s * 0.5, -s * 0.5);
      ctx.lineTo(-s * 0.25, -s * 0.5);
      ctx.lineTo(-s * 0.25, -s * 0.25);
      ctx.lineTo(0, -s * 0.25);
      ctx.lineTo(0, -s * 0.5);
      ctx.lineTo(s * 0.25, -s * 0.5);
      ctx.lineTo(s * 0.25, -s * 0.25);
      ctx.lineTo(s * 0.5, -s * 0.25);
      ctx.lineTo(s * 0.5, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/**
 * Corner minimap (camera-up, circular, compass ring) and the full world map (M): a baked relief map with crisp
 * POI icons, enemy-camp level bands, nearby foes, heralds, and the player arrow. The arena marker on the full map
 * offers travel to the Training Grounds.
 */
export class MapView {
  private map: HTMLCanvasElement;
  private mini: HTMLCanvasElement;
  private miniBox: HTMLDivElement;
  private full: HTMLDivElement;
  private fullCanvas: HTMLCanvasElement;
  private open_ = false;
  private camps: CampInfo[] = [];
  onTravelArena: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** View radius of the minimap in metres. */
  radius = 115;

  constructor(world: World, parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.map = bakeMap(world);
    this.miniBox = document.createElement('div');
    this.miniBox.className = 'ak-mini';
    this.miniBox.innerHTML = '<canvas></canvas><div class="ring"><b class="n">N</b><b class="e">E</b><b class="s">S</b><b class="w">W</b></div>';
    this.mini = this.miniBox.querySelector('canvas')!;
    parent.appendChild(this.miniBox);
    this.full = document.createElement('div');
    this.full.className = 'ak-wmap';
    this.full.innerHTML = `
      <div class="frame">
        <div class="head"><b>WORLD MAP</b><span>KINGDOM OF ASHFORD</span><button class="x" aria-label="Close">✕</button></div>
        <div class="body"><canvas></canvas><div class="pins"></div></div>
        <div class="legend">
          <span><i class="lg v"></i>Village</span><span><i class="lg c"></i>Enemy camp (levels)</span>
          <span><i class="lg a"></i>Training Grounds — click to travel</span><span><i class="lg p"></i>You</span>
        </div>
      </div>`;
    parent.appendChild(this.full);
    this.fullCanvas = this.full.querySelector('canvas')!;
    this.full.querySelector('.x')!.addEventListener('click', () => this.close());
    this.full.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (!this.open_) return;
      if (e.code === 'Escape' || e.code === 'KeyM') {
        e.preventDefault();
        this.close();
      }
    });
  }

  setCamps(c: CampInfo[]): void {
    this.camps = c;
  }

  get isOpen(): boolean {
    return this.open_;
  }

  set miniVisible(v: boolean) {
    this.miniBox.classList.toggle('off', !v);
  }

  /* ---------------------------------------------------------------- minimap */

  updateMini(px: number, pz: number, playerYaw: number, camYaw: number, markers: MapMarker[]): void {
    const c = this.mini;
    const cssSize = this.miniBox.clientWidth || 180;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.round(cssSize * dpr);
    if (c.width !== S) c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    // Camera forward (world xz) → up on screen.
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    const scale = S / 2 / (this.radius / M_PER_PX);
    const [mx, mz] = toMap(px, pz);
    ctx.translate(S / 2, S / 2);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-mx, -mz);
    ctx.imageSmoothingEnabled = true;
    // Only the square around the player that can rotate into view, not the whole 1024 px relief.
    const half = Math.ceil((this.radius / M_PER_PX) * Math.SQRT2) + 2;
    const sx = Math.max(0, Math.floor(mx - half));
    const sy = Math.max(0, Math.floor(mz - half));
    const sw = Math.min(this.map.width, Math.ceil(mx + half)) - sx;
    const sh = Math.min(this.map.height, Math.ceil(mz + half)) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(this.map, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
    // Icons (crisp, unrotated glyphs at rotated positions).
    const place = (x: number, z: number): [number, number] | null => {
      const dx = (x - px) / M_PER_PX;
      const dz = (z - pz) / M_PER_PX;
      const rx = dx * Math.cos(rot) - dz * Math.sin(rot);
      const rz = dx * Math.sin(rot) + dz * Math.cos(rot);
      return [S / 2 + rx * scale, S / 2 + rz * scale];
    };
    const R = S / 2 - 8 * dpr;
    const clampEdge = (p: [number, number]) => {
      const vx = p[0] - S / 2;
      const vy = p[1] - S / 2;
      const l = Math.hypot(vx, vy);
      if (l <= R) return { p, edge: false };
      return { p: [S / 2 + (vx / l) * R, S / 2 + (vy / l) * R] as [number, number], edge: true };
    };
    for (const poi of POIS) {
      if (poi.kind === 'lake' || poi.kind === 'forest' || poi.kind === 'meadow') continue;
      const pp = place(poi.x, poi.z);
      if (!pp) continue;
      const { p, edge } = clampEdge(pp);
      if (edge && poi.kind !== 'arena' && poi.kind !== 'village') continue;
      ctx.globalAlpha = edge ? 0.75 : 1;
      poiIcon(ctx, poi, p[0], p[1], (edge ? 9 : 12) * dpr);
    }
    ctx.globalAlpha = 1;
    for (const m of markers) {
      const pp = place(m.x, m.z);
      if (!pp) continue;
      const { p, edge } = clampEdge(pp);
      if (edge && m.kind !== 'herald' && m.kind !== 'rival') continue;
      ctx.beginPath();
      const r = (m.kind === 'mobHot' ? 4.2 : m.kind === 'rival' ? 5 : m.kind === 'herald' ? 4.5 : 3.2) * dpr;
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = m.kind === 'herald' ? '#ffc21a' : m.kind === 'rival' ? '#b06bff' : m.kind === 'mobHot' ? '#ff3b3b' : '#e3324d';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#07080b';
      ctx.stroke();
      if (m.kind === 'herald') {
        ctx.fillStyle = '#07080b';
        ctx.font = `bold ${7 * dpr}px Rajdhani, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('!', p[0], p[1] + 2.5 * dpr);
      }
    }
    // Player arrow: the facing direction carried through the same rotation as the map.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.atan2(Math.cos(playerYaw), Math.sin(playerYaw)) + rot + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr);
    ctx.lineTo(6 * dpr, 7 * dpr);
    ctx.lineTo(0, 3.5 * dpr);
    ctx.lineTo(-6 * dpr, 7 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#07080b';
    ctx.stroke();
    ctx.restore();
    // View cone.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.32);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, S * 0.32, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Compass letters ride the ring.
    const ring = this.miniBox.querySelector('.ring') as HTMLElement;
    ring.style.transform = `rotate(${rot}rad)`;
    ring.querySelectorAll<HTMLElement>('b').forEach((b) => (b.style.transform = `rotate(${-rot}rad)`));
  }

  /* ---------------------------------------------------------------- world map */

  open(px: number, pz: number, playerYaw: number): void {
    this.open_ = true;
    this.full.classList.add('on');
    this.drawFull(px, pz, playerYaw);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.full.classList.remove('on');
    this.onClose?.();
  }

  private drawFull(px: number, pz: number, playerYaw: number): void {
    const body = this.full.querySelector('.body') as HTMLElement;
    const size = Math.min(body.clientWidth || 700, body.clientHeight || 700);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.fullCanvas;
    c.width = c.height = Math.round(size * dpr);
    c.style.width = c.style.height = `${size}px`;
    const ctx = c.getContext('2d')!;
    const k = c.width / MAP_N;
    ctx.drawImage(this.map, 0, 0, c.width, c.height);
    // Vignette + paper tone.
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, c.width * 0.3, c.width / 2, c.height / 2, c.width * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(10,8,4,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const pins = this.full.querySelector('.pins') as HTMLElement;
    pins.innerHTML = '';
    pins.style.width = pins.style.height = `${size}px`;
    const label = (x: number, z: number, html: string, cls: string, click?: () => void) => {
      const el = document.createElement(click ? 'button' : 'div');
      el.className = `pin ${cls}`;
      el.innerHTML = html;
      const [mx, mz] = toMap(x, z);
      el.style.left = `${(mx / MAP_N) * 100}%`;
      el.style.top = `${(mz / MAP_N) * 100}%`;
      if (click) el.addEventListener('click', click);
      pins.appendChild(el);
    };
    for (const poi of POIS) {
      const [mx, mz] = toMap(poi.x, poi.z);
      if (poi.kind !== 'lake' && poi.kind !== 'forest' && poi.kind !== 'meadow') poiIcon(ctx, poi, mx * k, mz * k, 16 * dpr);
      const camp = this.camps.find((cp) => cp.id === poi.id);
      if (poi.kind === 'arena') {
        label(poi.x, poi.z, `<b>${poi.name.toUpperCase()}</b><small>RANKED SPAR · TRAVEL ▸</small>`, 'arena', () => {
          this.close();
          this.onTravelArena?.();
        });
      } else if (camp) {
        label(poi.x, poi.z, `<b>${poi.name}</b><small>LV ${camp.level[0]}–${camp.level[1]}</small>`, 'camp');
      } else {
        label(poi.x, poi.z, `<b>${poi.name}</b>`, poi.kind);
      }
    }
    for (const camp of this.camps) {
      if (POIS.some((p) => p.id === camp.id)) continue;
      const [mx, mz] = toMap(camp.x, camp.z);
      poiIcon(ctx, { id: camp.id, name: camp.name, x: camp.x, z: camp.z, flat: 0, kind: 'camp' }, mx * k, mz * k, 11 * dpr);
      label(camp.x, camp.z, `<small>LV ${camp.level[0]}–${camp.level[1]}</small>`, 'camp mini');
    }
    // Player.
    const [mx, mz] = toMap(px, pz);
    ctx.save();
    ctx.translate(mx * k, mz * k);
    // Facing (sin(yaw), cos(yaw)) in world xz → canvas angle.
    ctx.rotate(Math.atan2(Math.cos(playerYaw), Math.sin(playerYaw)) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -13 * dpr);
    ctx.lineTo(9 * dpr, 10 * dpr);
    ctx.lineTo(0, 5 * dpr);
    ctx.lineTo(-9 * dpr, 10 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#07080b';
    ctx.stroke();
    ctx.restore();
    label(px, pz, '<b>YOU</b>', 'you');
  }
}
