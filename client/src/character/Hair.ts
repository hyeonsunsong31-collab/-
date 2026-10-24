import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '@ak/shared';

/**
 * Procedural DB-style hair. A style is a set of spikes (curved, flattened cones) rooted on the scalp plus a skull
 * cap under them. Coordinates are head-local meters for a hero-sized head (origin = head center, +Z forward).
 */

export interface Spike {
  /** Azimuth around Y (0 = front, +90 = character's left), elevation from horizontal (degrees). */
  az: number;
  el: number;
  /** Growth direction (head-local, normalized at build time). */
  dir: [number, number, number];
  len: number;
  /** Base half-width / half-thickness. */
  w: number;
  t: number;
  /** Bend vector added at mid-length (fraction of length). */
  bend?: [number, number, number];
  /** Long locks skinned to the back hair chain. */
  long?: boolean;
}

const D2R = Math.PI / 180;

/** Scalp ellipsoid point for an azimuth/elevation. */
function scalp(az: number, el: number): THREE.Vector3 {
  const a = az * D2R;
  const e = el * D2R;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e) * 0.088, Math.sin(e) * 0.118, Math.cos(a) * Math.cos(e) * (Math.cos(a) > 0 ? 0.1 : 0.106));
}

function spikeGeo(sp: Spike, k: number): THREE.BufferGeometry {
  const root = scalp(sp.az, sp.el).multiplyScalar(0.92);
  const dir = new THREE.Vector3(...sp.dir).normalize();
  const bend = new THREE.Vector3(...(sp.bend ?? [0, 0, 0]));
  const p0 = root;
  const p2 = root.clone().addScaledVector(dir, sp.len);
  const p1 = root.clone().addScaledVector(dir, sp.len * 0.5).addScaledVector(bend, sp.len);
  const steps = sp.long ? 9 : 6;
  const around = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  // Flat axis: perpendicular to growth and to the scalp normal (spikes fan out like DB hair).
  const nrm = root.clone().normalize();
  let flat = new THREE.Vector3().crossVectors(dir, nrm);
  if (flat.lengthSq() < 1e-4) flat = new THREE.Vector3(1, 0, 0);
  flat.normalize();
  const thick = new THREE.Vector3().crossVectors(flat, dir).normalize();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = new THREE.Vector3()
      .copy(p0)
      .multiplyScalar((1 - t) * (1 - t))
      .addScaledVector(p1, 2 * (1 - t) * t)
      .addScaledVector(p2, t * t);
    // Tapered profile with a slight belly near the root.
    const taper = Math.pow(1 - t, 0.85) * (1 + 0.25 * Math.sin(t * Math.PI));
    for (let j = 0; j < around; j++) {
      const a = (j / around) * Math.PI * 2;
      const v = c
        .clone()
        .addScaledVector(flat, Math.cos(a) * sp.w * 1.6 * taper)
        .addScaledVector(thick, Math.sin(a) * sp.t * 1.55 * taper);
      pos.push(v.x * k, v.y * k, v.z * k);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j;
      const b = i * around + ((j + 1) % around);
      idx.push(a, b, a + around, b, b + around, a + around);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Ensure outward winding: check one face against the radial direction.
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const p = g.getAttribute('position');
  const cnt = new THREE.Vector3(p.getX(around), p.getY(around), p.getZ(around));
  const center = new THREE.Vector3();
  for (let j = 0; j < around; j++) center.add(new THREE.Vector3(p.getX(around + j), p.getY(around + j), p.getZ(around + j)));
  center.multiplyScalar(1 / around);
  if (new THREE.Vector3(n.getX(around), n.getY(around), n.getZ(around)).dot(cnt.sub(center)) < 0) {
    const ix = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < ix.length; i += 3) {
      const tmp = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = tmp;
    }
    g.computeVertexNormals();
  }
  g.userData.long = !!sp.long;
  return g;
}

/** Skull cap that hides the scalp between spike roots; hairline varies around the head. */
function capGeo(k: number, style: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 32, 22);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * 0.093;
    const y = p.getY(i) * 0.123;
    const z = p.getZ(i) * (p.getZ(i) > 0 ? 0.105 : 0.112);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  const keep: number[] = [];
  const ix = g.index!.array;
  const hairline = (x: number, z: number): number => {
    const az = Math.atan2(x, z); // 0 front
    const front = Math.cos(az);
    // Front hairline high (forehead), temples, low at the back of the neck.
    const widowsPeak = style === 6 ? 0.012 * Math.exp(-Math.pow(az / 0.15, 2)) : 0;
    return front > 0 ? 0.045 * front - 0.012 * (1 - front) - widowsPeak : -0.012 + front * 0.06;
  };
  for (let t = 0; t < ix.length; t += 3) {
    let cy = 0;
    let cx = 0;
    let cz = 0;
    for (let j = 0; j < 3; j++) {
      cx += p.getX(ix[t + j]) / k;
      cy += p.getY(ix[t + j]) / k;
      cz += p.getZ(ix[t + j]) / k;
    }
    cx /= 3;
    cy /= 3;
    cz /= 3;
    if (cy > hairline(cx, cz)) keep.push(ix[t], ix[t + 1], ix[t + 2]);
  }
  g.setIndex(keep);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Spike sets for each style id. */
export function hairStyle(style: number): Spike[] {
  const rng = new Rng(100 + style);
  const S: Spike[] = [];
  // Global volume: DB hair is chunky — long spikes with broad, overlapping roots.
  const LEN = style <= 6 ? 1.3 : 1;
  const WID = style <= 6 ? 1.35 : 1;
  const add = (az: number, el: number, dir: [number, number, number], len: number, w = 0.032, t = 0.014, bend?: [number, number, number], long = false) =>
    S.push({ az: az + rng.range(-4, 4), el: el + rng.range(-3, 3), dir, len: len * rng.range(0.92, 1.08) * (long ? 1 : LEN), w: w * WID, t: t * WID, bend, long });
  switch (style) {
    case 0: {
      // Base: wild palm-crown spikes, side flares, back points, forehead bangs.
      add(180, 70, [0, 0.8, -0.6], 0.2, 0.04, 0.016, [0, 0.1, 0]);
      add(140, 62, [0.5, 0.75, -0.45], 0.19, 0.038);
      add(-140, 62, [-0.5, 0.75, -0.45], 0.19, 0.038);
      add(100, 55, [0.75, 0.62, -0.1], 0.17, 0.036);
      add(-100, 55, [-0.75, 0.62, -0.1], 0.17, 0.036);
      add(60, 60, [0.65, 0.75, 0.15], 0.15, 0.034);
      add(-60, 60, [-0.65, 0.75, 0.15], 0.15, 0.034);
      add(0, 75, [0.05, 0.95, 0.2], 0.16, 0.036);
      add(90, 25, [0.95, 0.3, -0.1], 0.14, 0.03, 0.013, [0, 0.12, 0]);
      add(-90, 25, [-0.95, 0.3, -0.1], 0.14, 0.03, 0.013, [0, 0.12, 0]);
      add(180, 20, [0, -0.2, -1], 0.13, 0.034);
      add(150, 10, [0.45, -0.25, -0.85], 0.12, 0.03);
      add(-150, 10, [-0.45, -0.25, -0.85], 0.12, 0.03);
      add(20, 42, [0.3, -0.35, 0.9], 0.085, 0.022, 0.01, [0, -0.25, 0]);
      add(-15, 42, [-0.2, -0.45, 0.88], 0.1, 0.024, 0.01, [0, -0.3, 0]);
      add(45, 36, [0.6, -0.3, 0.75], 0.075, 0.022, 0.01, [0, -0.2, 0]);
      add(-45, 36, [-0.6, -0.3, 0.75], 0.07, 0.022);
      break;
    }
    case 1: {
      // Golden Ascension: everything sweeps up, a single bang lock on the forehead.
      for (let i = 0; i < 9; i++) {
        const az = -160 + i * 40;
        const back = Math.cos((az * Math.PI) / 180) < 0 ? -0.35 : 0.05;
        add(az, 58 + rng.range(-6, 8), [Math.sin((az * Math.PI) / 180) * 0.42, 1, back], 0.2 + rng.range(0, 0.05), 0.038, 0.015, [0, 0.05, -0.05]);
      }
      add(0, 72, [0.0, 1, 0.12], 0.21, 0.04);
      add(180, 40, [0, 0.6, -0.8], 0.19, 0.038);
      add(120, 30, [0.7, 0.7, -0.4], 0.17, 0.034);
      add(-120, 30, [-0.7, 0.7, -0.4], 0.17, 0.034);
      add(90, 18, [0.85, 0.55, 0], 0.13, 0.03);
      add(-90, 18, [-0.85, 0.55, 0], 0.13, 0.03);
      add(-12, 44, [-0.15, -0.55, 0.82], 0.1, 0.02, 0.009, [0.02, -0.25, 0]);
      break;
    }
    case 2: {
      // Golden Storm: sharper, taller, a single loose strand.
      for (let i = 0; i < 10; i++) {
        const az = -165 + i * 37;
        const back = Math.cos((az * Math.PI) / 180) < 0 ? -0.25 : 0.08;
        add(az, 60 + rng.range(-5, 8), [Math.sin((az * Math.PI) / 180) * 0.32, 1, back], 0.25 + rng.range(0, 0.05), 0.03, 0.012);
      }
      add(0, 74, [0, 1, 0.1], 0.26, 0.032, 0.012);
      add(180, 42, [0, 0.75, -0.66], 0.23, 0.032, 0.012);
      add(95, 20, [0.85, 0.55, -0.05], 0.15, 0.026);
      add(-95, 20, [-0.85, 0.55, -0.05], 0.15, 0.026);
      add(-18, 44, [-0.1, -0.75, 0.6], 0.13, 0.012, 0.007, [0.03, -0.2, 0.05]);
      break;
    }
    case 3: {
      // Golden Mane: shorter top spikes, long locks down the back to the waist.
      for (let i = 0; i < 8; i++) {
        const az = -150 + i * 43;
        add(az, 62, [Math.sin((az * Math.PI) / 180) * 0.45, 1, -0.2], 0.15, 0.036, 0.014);
      }
      add(0, 70, [0, 0.9, 0.35], 0.14, 0.036);
      for (let i = 0; i < 9; i++) {
        const az = 180 + (i - 4) * 16;
        add(az, 35 - Math.abs(i - 4) * 4, [Math.sin((az * Math.PI) / 180) * 0.25, -1, -0.32], 0.62 + rng.range(-0.08, 0.1), 0.045, 0.016, [0, 0.0, -0.18], true);
      }
      add(100, 20, [0.6, -0.85, -0.2], 0.4, 0.04, 0.014, [0.1, 0, -0.1], true);
      add(-100, 20, [-0.6, -0.85, -0.2], 0.4, 0.04, 0.014, [-0.1, 0, -0.1], true);
      add(-10, 45, [-0.1, -0.6, 0.8], 0.11, 0.022, 0.01, [0, -0.25, 0]);
      break;
    }
    case 4: {
      // Crimson Divinity: slim, tidy, swept up and back.
      for (let i = 0; i < 7; i++) {
        const az = -135 + i * 45;
        add(az, 60, [Math.sin((az * Math.PI) / 180) * 0.35, 0.85, -0.45], 0.14, 0.03, 0.012, [0, 0.08, -0.05]);
      }
      add(180, 30, [0, 0.2, -1], 0.13, 0.03, 0.012);
      add(15, 46, [0.25, -0.4, 0.88], 0.07, 0.02, 0.009, [0, -0.2, 0]);
      add(-20, 46, [-0.3, -0.45, 0.85], 0.08, 0.02, 0.009, [0, -0.25, 0]);
      add(90, 25, [0.9, 0.35, -0.2], 0.1, 0.026);
      add(-90, 25, [-0.9, 0.35, -0.2], 0.1, 0.026);
      break;
    }
    case 5: {
      // Silver Instinct: wild upswept medium spikes, swept back.
      for (let i = 0; i < 12; i++) {
        const az = -170 + i * 31;
        add(az, 55 + rng.range(-10, 12), [Math.sin((az * Math.PI) / 180) * 0.5, 0.9, -0.35 + rng.range(-0.1, 0.1)], 0.17 + rng.range(0, 0.04), 0.034, 0.014, [rng.range(-0.05, 0.05), 0.06, -0.06]);
      }
      add(180, 25, [0, 0.1, -1], 0.15, 0.034);
      add(-15, 44, [-0.2, -0.5, 0.84], 0.09, 0.02, 0.009, [0, -0.25, 0]);
      break;
    }
    case 6: {
      // Rival: tall swept-back flame with a widow's peak.
      for (let i = 0; i < 9; i++) {
        const az = -160 + i * 40;
        add(az, 56 + rng.range(-4, 6), [Math.sin((az * Math.PI) / 180) * 0.3, 1, -0.55], 0.24 + rng.range(0, 0.06), 0.036, 0.014, [0, 0.1, -0.08]);
      }
      add(0, 66, [0, 1, -0.3], 0.27, 0.04, 0.015);
      add(180, 35, [0, 0.6, -0.8], 0.22, 0.036);
      break;
    }
    case 7: {
      // Brigand: short messy crop (a bandana is added as a separate band).
      for (let i = 0; i < 14; i++) {
        const az = rng.range(-180, 180);
        add(az, rng.range(20, 70), [Math.sin((az * Math.PI) / 180) * 0.6, 0.5, Math.cos((az * Math.PI) / 180) * 0.5 - 0.3], 0.06 + rng.range(0, 0.03), 0.028, 0.012);
      }
      break;
    }
    case 8: {
      // Imp: leafy sprouts.
      for (let i = 0; i < 4; i++) {
        const az = -60 + i * 40;
        add(az, 70, [Math.sin((az * Math.PI) / 180) * 0.6, 1, -0.2], 0.16, 0.05, 0.008, [0.1, 0, 0]);
      }
      break;
    }
    default:
      break;
  }
  return S;
}

export interface HairGeo {
  geometry: THREE.BufferGeometry;
  /** Vertex flag: 1 = long lock (skinned to the back hair chain). */
  longMask: Float32Array;
}

/** Build hair geometry for a style (head-local, unscaled); `k` scales to the character. */
export function buildHair(style: number, k: number): HairGeo | null {
  if (style < 0) return null;
  const parts: THREE.BufferGeometry[] = [];
  const masks: number[] = [];
  const cap = capGeo(k, style);
  parts.push(cap.toNonIndexed());
  for (let i = 0; i < parts[0].getAttribute('position').count; i++) masks.push(0);
  for (const sp of hairStyle(style)) {
    const g = spikeGeo(sp, k).toNonIndexed();
    parts.push(g);
    for (let i = 0; i < g.getAttribute('position').count; i++) masks.push(sp.long ? 1 : 0);
  }
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name);
  }
  const geometry = mergeGeometries(parts)!;
  return { geometry, longMask: new Float32Array(masks) };
}
