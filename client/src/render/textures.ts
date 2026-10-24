import * as THREE from 'three';
import { Rng } from '@ak/shared';
import { Noise } from '../core/noise.ts';

/** Procedural canvas textures (no image assets anywhere in the game). */

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

export function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Height (greyscale canvas) → tangent-space normal map. */
export function normalFromHeight(src: HTMLCanvasElement, strength = 2): THREE.CanvasTexture {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      out.data[k] = ((dx / l) * 0.5 + 0.5) * 255;
      out.data[k + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[k + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return toTexture(c, false);
}

function fillNoise(ctx: CanvasRenderingContext2D, w: number, h: number, fn: (x: number, y: number) => [number, number, number]): void {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const k = (y * w + x) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Tileable noise using torus mapping of 4D-ish (two 2D samples) for seamless repeats. */
function tile(n: Noise, x: number, y: number, w: number, h: number, f: number): number {
  const a = (x / w) * Math.PI * 2;
  const b = (y / h) * Math.PI * 2;
  return n.n3(Math.cos(a) * f, Math.sin(a) * f + Math.cos(b) * f * 0.7, Math.sin(b) * f);
}

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

const cache = new Map<string, PbrSet>();

export function barkTexture(kind: 'oak' | 'pine' | 'birch'): PbrSet {
  const key = 'bark-' + kind;
  if (cache.has(key)) return cache.get(key)!;
  const w = 128;
  const h = 256;
  const n = new Noise(kind.length * 31);
  const [c, ctx] = canvas(w, h);
  const [hc, hctx] = canvas(w, h);
  const base = kind === 'birch' ? [214, 208, 196] : kind === 'pine' ? [92, 62, 44] : [86, 70, 54];
  const heights: number[] = [];
  fillNoise(hctx, w, h, (x, y) => {
    const ridges = Math.abs(tile(n, x * 3, y * 0.4, w * 3, h * 0.4, 1.6));
    const fine = tile(n, x, y, w, h, 6) * 0.5 + 0.5;
    let v = kind === 'birch' ? 0.8 - Math.max(0, tile(n, x * 0.3, y * 2, w * 0.3, h * 2, 3)) * 0.8 : 1 - ridges * 0.9;
    v = v * 0.75 + fine * 0.25;
    heights.push(v);
    const g = Math.round(v * 255);
    return [g, g, g];
  });
  let i = 0;
  fillNoise(ctx, w, h, () => {
    const v = heights[i++];
    if (kind === 'birch') {
      const dark = v < 0.35 ? 0.25 : 1;
      return [base[0] * dark * (0.85 + v * 0.2), base[1] * dark * (0.85 + v * 0.2), base[2] * dark * (0.85 + v * 0.2)];
    }
    const k = 0.45 + v * 0.75;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, kind === 'birch' ? 1.5 : 4) };
  cache.set(key, set);
  return set;
}

/** Leaf cluster card with alpha. */
export function leafTexture(kind: 'oak' | 'pine' | 'birch' | 'bush'): THREE.Texture {
  const key = 'leaf-' + kind;
  if (cache.has(key)) return cache.get(key)!.map;
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(kind.length * 977 + 3);
  ctx.clearRect(0, 0, S, S);
  const palette =
    kind === 'pine'
      ? ['#1e3a1a', '#25451d', '#2d5222', '#183014']
      : kind === 'birch'
        ? ['#6f9a2a', '#87ad34', '#5c8a22', '#9cbd45']
        : kind === 'bush'
          ? ['#3d6a1d', '#4b7a22', '#2f5717', '#5a8a2a']
          : ['#3f6b1c', '#4f7d22', '#365f18', '#5d8c2c'];
  if (kind === 'pine') {
    // Needle sprays: many thin strokes off a central twig.
    for (let b = 0; b < 7; b++) {
      const y0 = 30 + b * 30;
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(S / 2, y0);
      ctx.lineTo(S / 2 + rng.range(-10, 10), y0 + 40);
      ctx.stroke();
      for (let k = 0; k < 70; k++) {
        const t = rng.next();
        const x = S / 2 + rng.range(-4, 4);
        const y = y0 + t * 40;
        const ang = (rng.chance(0.5) ? -1 : 1) * rng.range(0.5, 1.3) + Math.PI / 2;
        const len = rng.range(18, 34) * (1 - t * 0.4);
        ctx.strokeStyle = rng.pick(palette);
        ctx.lineWidth = rng.range(1.2, 2.2);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * len * (rng.chance(0.5) ? 1 : -1), y + Math.sin(ang) * len * 0.35);
        ctx.stroke();
      }
    }
  } else {
    const count = kind === 'birch' ? 90 : 130;
    for (let k = 0; k < count; k++) {
      // Keep the cluster roughly round so card edges never read as squares.
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * S * 0.42;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      const len = kind === 'birch' ? rng.range(10, 16) : rng.range(14, 24);
      const wid = len * (kind === 'oak' ? 0.62 : 0.5);
      const rot = rng.range(0, Math.PI * 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const shade = 0.75 + (1 - r / (S * 0.42)) * 0.35;
      const col = new THREE.Color(rng.pick(palette)).multiplyScalar(shade);
      ctx.fillStyle = `#${col.getHexString()}`;
      ctx.beginPath();
      if (kind === 'oak') {
        // Lobed oak leaf.
        ctx.moveTo(0, -len / 2);
        for (let l = 0; l < 4; l++) {
          const yy = -len / 2 + ((l + 0.5) / 4) * len;
          ctx.quadraticCurveTo(wid * 0.75, yy - len * 0.08, wid * 0.45, yy + len * 0.1);
        }
        ctx.lineTo(0, len / 2);
        for (let l = 3; l >= 0; l--) {
          const yy = -len / 2 + ((l + 0.5) / 4) * len;
          ctx.quadraticCurveTo(-wid * 0.75, yy + len * 0.08, -wid * 0.45, yy - len * 0.1);
        }
      } else {
        ctx.ellipse(0, 0, wid / 2, len / 2, 0, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,30,10,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -len / 2);
      ctx.lineTo(0, len / 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  const t = toTexture(c, true, false);
  cache.set(key, { map: t, normalMap: t });
  return t;
}

export function rockTexture(): PbrSet {
  const key = 'rock';
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const n = new Noise(77);
  const [c, ctx] = canvas(S, S);
  const [hc, hctx] = canvas(S, S);
  const hs: number[] = [];
  fillNoise(hctx, S, S, (x, y) => {
    const v = tile(n, x, y, S, S, 2) * 0.5 + tile(n, x, y, S, S, 6) * 0.3 + tile(n, x, y, S, S, 16) * 0.2;
    const cr = Math.abs(tile(n, x + 50, y, S, S, 3));
    const hv = Math.max(0, Math.min(1, v * 0.5 + 0.5 - (cr < 0.04 ? 0.35 : 0)));
    hs.push(hv);
    return [hv * 255, hv * 255, hv * 255];
  });
  let i = 0;
  fillNoise(ctx, S, S, () => {
    const v = hs[i++];
    const lichen = v > 0.62 ? 1 : 0;
    const g = 95 + v * 90;
    return lichen ? [g * 0.82, g * 0.86, g * 0.62] : [g, g * 0.97, g * 0.92];
  });
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 5) };
  cache.set(key, set);
  return set;
}

export function plasterTexture(): PbrSet {
  const key = 'plaster';
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const n = new Noise(5);
  const [c, ctx] = canvas(S, S);
  const [hc, hctx] = canvas(S, S);
  const hs: number[] = [];
  fillNoise(hctx, S, S, (x, y) => {
    const v = tile(n, x, y, S, S, 3) * 0.35 + tile(n, x, y, S, S, 12) * 0.25 + 0.5;
    hs.push(v);
    return [v * 255, v * 255, v * 255];
  });
  let i = 0;
  fillNoise(ctx, S, S, () => {
    const v = hs[i++];
    const k = 0.86 + v * 0.18;
    return [214 * k, 200 * k, 172 * k];
  });
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 1.5) };
  cache.set(key, set);
  return set;
}

export function woodTexture(dark = true): PbrSet {
  const key = 'wood' + dark;
  if (cache.has(key)) return cache.get(key)!;
  const W = 64;
  const H = 256;
  const n = new Noise(dark ? 11 : 12);
  const [c, ctx] = canvas(W, H);
  const [hc, hctx] = canvas(W, H);
  const hs: number[] = [];
  fillNoise(hctx, W, H, (x, y) => {
    const grain = Math.sin(x * 0.9 + tile(n, x, y, W, H, 2) * 6) * 0.5 + 0.5;
    const v = grain * 0.6 + (tile(n, x, y, W, H, 8) * 0.5 + 0.5) * 0.4;
    hs.push(v);
    return [v * 255, v * 255, v * 255];
  });
  let i = 0;
  const base = dark ? [74, 50, 32] : [150, 112, 72];
  fillNoise(ctx, W, H, () => {
    const v = hs[i++];
    const k = 0.65 + v * 0.55;
    return [base[0] * k, base[1] * k, base[2] * k];
  });
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 2.5) };
  cache.set(key, set);
  return set;
}

export function stoneWallTexture(): PbrSet {
  const key = 'stonewall';
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const n = new Noise(21);
  const rng = new Rng(21);
  const [c, ctx] = canvas(S, S);
  const [hc, hctx] = canvas(S, S);
  ctx.fillStyle = '#6b665c';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#202020';
  hctx.fillRect(0, 0, S, S);
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rng.range(10, 30) : 0;
    while (x < S) {
      const w = rng.range(28, 52);
      const shade = rng.range(0.75, 1.15);
      const col = [128 * shade, 122 * shade, 110 * shade];
      for (const ox of [0, S, -S]) {
        ctx.fillStyle = `rgb(${col.map(Math.round).join(',')})`;
        ctx.beginPath();
        ctx.roundRect(x + 2 + ox, r * rh + 2, w - 4, rh - 4, 5);
        ctx.fill();
        const grd = hctx.createRadialGradient(x + w / 2 + ox, r * rh + rh / 2, 2, x + w / 2 + ox, r * rh + rh / 2, w * 0.6);
        grd.addColorStop(0, '#e0e0e0');
        grd.addColorStop(1, '#808080');
        hctx.fillStyle = grd;
        hctx.beginPath();
        hctx.roundRect(x + 2 + ox, r * rh + 2, w - 4, rh - 4, 5);
        hctx.fill();
      }
      x += w;
    }
  }
  // Grime noise.
  const img = ctx.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = (y * S + x) * 4;
      const v = 0.85 + tile(n, x, y, S, S, 8) * 0.15;
      img.data[k] *= v;
      img.data[k + 1] *= v;
      img.data[k + 2] *= v;
    }
  ctx.putImageData(img, 0, 0);
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 3) };
  cache.set(key, set);
  return set;
}

export function thatchTexture(): PbrSet {
  const key = 'thatch';
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const rng = new Rng(9);
  const [c, ctx] = canvas(S, S);
  const [hc, hctx] = canvas(S, S);
  ctx.fillStyle = '#7a6236';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#404040';
  hctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const len = rng.range(18, 40);
    const sh = rng.range(0.7, 1.25);
    ctx.strokeStyle = `rgb(${Math.round(176 * sh)},${Math.round(146 * sh)},${Math.round(84 * sh)})`;
    ctx.lineWidth = rng.range(1, 2.2);
    hctx.strokeStyle = `rgb(${Math.round(200 * sh)},${Math.round(200 * sh)},${Math.round(200 * sh)})`;
    hctx.lineWidth = ctx.lineWidth;
    for (const oy of [0, S, -S])
      for (const ox of [0, S, -S]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + rng.range(-3, 3), y + oy + len);
        ctx.stroke();
        hctx.beginPath();
        hctx.moveTo(x + ox, y + oy);
        hctx.lineTo(x + ox, y + oy + len);
        hctx.stroke();
      }
  }
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 3) };
  cache.set(key, set);
  return set;
}

export function roofTileTexture(): PbrSet {
  const key = 'rooftile';
  if (cache.has(key)) return cache.get(key)!;
  const S = 256;
  const rng = new Rng(13);
  const [c, ctx] = canvas(S, S);
  const [hc, hctx] = canvas(S, S);
  const rows = 10;
  const cols = 8;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const x = (k + (r % 2) * 0.5) * (S / cols);
      const y = r * (S / rows);
      const sh = rng.range(0.78, 1.15);
      const g = ctx.createLinearGradient(0, y, 0, y + S / rows);
      g.addColorStop(0, `rgb(${Math.round(150 * sh)},${Math.round(70 * sh)},${Math.round(48 * sh)})`);
      g.addColorStop(1, `rgb(${Math.round(105 * sh)},${Math.round(46 * sh)},${Math.round(32 * sh)})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 1, y, S / cols - 2, (S / rows) * 1.15, [0, 0, 10, 10]);
      ctx.fill();
      const hg = hctx.createLinearGradient(x, 0, x + S / cols, 0);
      hg.addColorStop(0, '#606060');
      hg.addColorStop(0.5, '#f0f0f0');
      hg.addColorStop(1, '#606060');
      hctx.fillStyle = hg;
      hctx.beginPath();
      hctx.roundRect(x + 1, y, S / cols - 2, (S / rows) * 1.15, [0, 0, 10, 10]);
      hctx.fill();
    }
  }
  const set = { map: toTexture(c), normalMap: normalFromHeight(hc, 3) };
  cache.set(key, set);
  return set;
}

/** Heraldic banner cloth. */
export function bannerTexture(color: string, sigil: 'sun' | 'dragon' | 'tower'): THREE.Texture {
  const key = `banner-${color}-${sigil}`;
  if (cache.has(key)) return cache.get(key)!.map;
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x < 128; x += 4) ctx.fillRect(x, 0, 1, 256);
  ctx.strokeStyle = '#e8c45a';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 112, 240);
  ctx.fillStyle = '#e8c45a';
  ctx.translate(64, 110);
  if (sigil === 'sun') {
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(-6, 20);
      ctx.lineTo(0, 44);
      ctx.lineTo(6, 20);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
  } else if (sigil === 'dragon') {
    ctx.beginPath();
    ctx.moveTo(-30, 30);
    ctx.bezierCurveTo(-40, -20, 10, -50, 30, -30);
    ctx.lineTo(18, -20);
    ctx.bezierCurveTo(0, -30, -20, -10, -10, 20);
    ctx.lineTo(20, 10);
    ctx.lineTo(-30, 40);
    ctx.fill();
  } else {
    ctx.fillRect(-16, -30, 32, 60);
    for (let i = -2; i <= 1; i++) ctx.fillRect(i * 10 + 1, -42, 8, 12);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Swallowtail notch.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(30, 256);
  ctx.lineTo(64, 216);
  ctx.lineTo(98, 256);
  ctx.fill();
  const t = toTexture(c, true, false);
  cache.set(key, { map: t, normalMap: t });
  return t;
}

export function clothTexture(color: string, stripes?: string): THREE.Texture {
  const key = `cloth-${color}-${stripes}`;
  if (cache.has(key)) return cache.get(key)!.map;
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 64);
  if (stripes) {
    ctx.fillStyle = stripes;
    for (let x = 0; x < 64; x += 16) ctx.fillRect(x, 0, 8, 64);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < 64; y += 2) ctx.fillRect(0, y, 64, 1);
  const t = toTexture(c);
  cache.set(key, { map: t, normalMap: t });
  return t;
}
