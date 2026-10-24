import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '@ak/shared';

/** Rigid gear (weapons, armor plates, golem rocks) built as merged geometries with vertex colors. */

function colored(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

function xf(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    ),
  );
  return g;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list)!;
  g.computeBoundingSphere();
  return g;
}

/** Longsword along +Z from the grip (origin). */
export function sword(s: number): THREE.BufferGeometry {
  const blade = new THREE.BufferGeometry();
  const L = 0.95 * s;
  const W = 0.028 * s;
  const T = 0.006 * s;
  // Diamond-section blade with a point.
  const v = [
    [0, T, 0.1 * s], [W, 0, 0.1 * s], [0, -T, 0.1 * s], [-W, 0, 0.1 * s],
    [0, T, L], [W * 0.85, 0, L], [0, -T, L], [-W * 0.85, 0, L],
    [0, 0, L + 0.09 * s],
  ];
  const pos: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => pos.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  const tri = (a: number, b: number, c: number) => pos.push(...v[a], ...v[b], ...v[c]);
  quad(0, 1, 5, 4);
  quad(1, 2, 6, 5);
  quad(2, 3, 7, 6);
  quad(3, 0, 4, 7);
  tri(4, 5, 8);
  tri(5, 6, 8);
  tri(6, 7, 8);
  tri(7, 4, 8);
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.computeVertexNormals();
  const guard = xf(new THREE.BoxGeometry(0.2 * s, 0.03 * s, 0.03 * s), 0, 0, 0.09 * s);
  const grip = xf(new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.2 * s, 8), 0, 0, 0, Math.PI / 2);
  const pommel = xf(new THREE.SphereGeometry(0.03 * s, 8, 6), 0, 0, -0.11 * s);
  return merge([colored(blade, '#d9dde4'), colored(guard, '#c9a23a'), colored(grip, '#3a2618'), colored(pommel, '#c9a23a')]);
}

/** Bearded axe along +Z from the grip. */
export function axe(s: number): THREE.BufferGeometry {
  const haft = xf(new THREE.CylinderGeometry(0.02 * s, 0.024 * s, 0.85 * s, 8), 0, 0, 0.3 * s, Math.PI / 2);
  const head = new THREE.Shape();
  head.moveTo(0, 0);
  head.lineTo(0.2 * s, -0.06 * s);
  head.quadraticCurveTo(0.26 * s, 0.08 * s, 0.2 * s, 0.2 * s);
  head.lineTo(0.0, 0.12 * s);
  const hg = new THREE.ExtrudeGeometry(head, { depth: 0.014 * s, bevelEnabled: false });
  xf(hg, 0, 0, 0.6 * s, 0, -Math.PI / 2, 0);
  hg.translate(0, 0, 0);
  return merge([colored(haft, '#5a3a22'), colored(hg, '#9ca1a8')]);
}

/** Spiked club. */
export function club(s: number): THREE.BufferGeometry {
  const body = xf(new THREE.CylinderGeometry(0.06 * s, 0.025 * s, 0.75 * s, 8), 0, 0, 0.32 * s, Math.PI / 2);
  const spikes: THREE.BufferGeometry[] = [];
  const rng = new Rng(3);
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2);
    const z = rng.range(0.45, 0.68) * s;
    spikes.push(colored(xf(new THREE.ConeGeometry(0.012 * s, 0.05 * s, 5), Math.cos(a) * 0.055 * s, Math.sin(a) * 0.055 * s, z, 0, 0, a - Math.PI / 2), '#8a8f96'));
  }
  return merge([colored(body, '#6a4628'), ...spikes]);
}

/** Warlock staff with a crystal orb (orb returned separately so it can glow). */
export function staff(s: number): { shaft: THREE.BufferGeometry; orbPos: THREE.Vector3 } {
  const shaft = xf(new THREE.CylinderGeometry(0.018 * s, 0.022 * s, 1.7 * s, 8), 0, 0, 0.35 * s, Math.PI / 2);
  const claws: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    claws.push(colored(xf(new THREE.ConeGeometry(0.012 * s, 0.16 * s, 5), Math.cos(a) * 0.05 * s, Math.sin(a) * 0.05 * s, 1.24 * s, Math.PI / 2 - 0.3 * Math.cos(a), 0, 0), '#c9a23a'));
  }
  return { shaft: merge([colored(shaft, '#2a1a12'), ...claws]), orbPos: new THREE.Vector3(0, 0, 1.28 * s) };
}

/** Kite shield (local +Z is the outward face). */
export function shield(s: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.32 * s);
  shape.quadraticCurveTo(0.24 * s, 0.32 * s, 0.24 * s, 0.12 * s);
  shape.quadraticCurveTo(0.22 * s, -0.22 * s, 0, -0.42 * s);
  shape.quadraticCurveTo(-0.22 * s, -0.22 * s, -0.24 * s, 0.12 * s);
  shape.quadraticCurveTo(-0.24 * s, 0.32 * s, 0, 0.32 * s);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.04 * s, bevelEnabled: true, bevelThickness: 0.01 * s, bevelSize: 0.012 * s, bevelSegments: 2 });
  const boss = xf(new THREE.SphereGeometry(0.06 * s, 10, 8), 0, 0.02 * s, 0.05 * s, 0, 0, 0, 1, 1, 0.6);
  const stripe = xf(new THREE.BoxGeometry(0.06 * s, 0.7 * s, 0.01 * s), 0, -0.04 * s, 0.055 * s);
  return merge([colored(g, '#24457a'), colored(boss, '#c9a23a'), colored(stripe, '#e9dcc0')]);
}

/** Knight helmet (great helm) centered on the head. */
export function helmet(s: number): THREE.BufferGeometry {
  const dome = xf(new THREE.SphereGeometry(0.135 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 0.02 * s, 0);
  const cyl = xf(new THREE.CylinderGeometry(0.133 * s, 0.128 * s, 0.17 * s, 16, 1, true), 0, -0.06 * s, 0);
  const slit = xf(new THREE.BoxGeometry(0.17 * s, 0.014 * s, 0.03 * s), 0, 0.0, 0.122 * s);
  const ridge = xf(new THREE.BoxGeometry(0.014 * s, 0.2 * s, 0.24 * s), 0, 0.03 * s, 0);
  const plume = xf(new THREE.ConeGeometry(0.03 * s, 0.22 * s, 6), 0, 0.2 * s, -0.04 * s, -0.5);
  return merge([colored(dome, '#a6abb4'), colored(cyl, '#9aa0aa'), colored(slit, '#0c0d10'), colored(ridge, '#c9a23a'), colored(plume, '#a3121b')]);
}

export function breastplate(s: number): THREE.BufferGeometry {
  const g = xf(new THREE.SphereGeometry(0.2 * s, 16, 12, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.55), 0, 0, 0.0, 0, 0, 0, 1.05, 1.15, 0.78);
  const rim = xf(new THREE.TorusGeometry(0.19 * s, 0.012 * s, 6, 24), 0, -0.07 * s, 0, Math.PI / 2, 0, 0, 1.08, 0.8, 1);
  return merge([colored(g, '#a9aeb7'), colored(rim, '#c9a23a')]);
}

export function pauldron(s: number): THREE.BufferGeometry {
  const g = xf(new THREE.SphereGeometry(0.1 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0, 0, 0, 0, 0, 1, 0.75, 1.1);
  const g2 = xf(new THREE.SphereGeometry(0.095 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, -0.035 * s, 0, 0, 0, 0, 1.05, 0.6, 1.12);
  return merge([colored(g, '#a3a8b1'), colored(g2, '#8f949d')]);
}

export function bracer(s: number, len: number, r: number, color = '#9aa0aa'): THREE.BufferGeometry {
  const g = xf(new THREE.CylinderGeometry(r * s, r * 0.85 * s, len * s, 12, 1, true), 0, (len * s) / 2, 0);
  const band = xf(new THREE.TorusGeometry(r * 1.02 * s, 0.008 * s, 6, 16), 0, len * s * 0.95, 0, Math.PI / 2);
  return merge([colored(g, color), colored(band, '#c9a23a')]);
}

export function hood(s: number, color: string): THREE.BufferGeometry {
  const g = xf(new THREE.SphereGeometry(0.15 * s, 16, 12, -Math.PI * 0.85, Math.PI * 1.7, 0, Math.PI * 0.75), 0, 0.02 * s, -0.015 * s, 0, 0, 0, 1, 1.12, 1.08);
  const point = xf(new THREE.ConeGeometry(0.07 * s, 0.18 * s, 8), 0, 0.12 * s, -0.12 * s, -1.1);
  return merge([colored(g, color), colored(point, color)]);
}

export function bandana(s: number, color: string): THREE.BufferGeometry {
  const band = xf(new THREE.TorusGeometry(0.098 * s, 0.018 * s, 6, 24), 0, 0.03 * s, 0.0, Math.PI / 2 - 0.15, 0, 0, 1, 1.12, 1);
  const knot = xf(new THREE.ConeGeometry(0.03 * s, 0.12 * s, 5), 0, 0.0, -0.13 * s, 2.4);
  return merge([colored(band, color), colored(knot, color)]);
}

/** Craggy boulder for golem bodies (with optional glowing seam color). */
export function boulder(s: number, seed: number, color = '#7a7468'): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(s, 1);
  const p = g.getAttribute('position');
  // Displace by a hash of the (shared) vertex position so duplicated corners stay welded.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / s;
    const y = p.getY(i) / s;
    const z = p.getZ(i) / s;
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.618) * 43758.5453;
    const k = 0.8 + (h - Math.floor(h)) * 0.35;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return colored(ng, color);
}
