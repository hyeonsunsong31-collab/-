import * as THREE from 'three';
import { type BoneName, BONE_INDEX, BONES, PARENT, type RigInstance } from './Rig.ts';
import type { Look } from './Looks.ts';

/**
 * Procedural skinned body. Every part is lofted from cross-section rings in bind (T-pose) space, weighted to an
 * allowed set of bones by distance to their segments (smooth inverse-square falloff, top-4 normalized), then merged
 * into one geometry with material groups.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface Ring {
  c: THREE.Vector3;
  /** Cross-section axes. */
  u: THREE.Vector3;
  v: THREE.Vector3;
  ru: number;
  rv: number;
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  e?: number;
  /** Radius multiplier by angle (θ measured from +u toward +v). */
  bump?: (th: number) => number;
  /** Separate +v / −v radii (front/back depth). */
  rvNeg?: number;
}

interface Part {
  pos: number[];
  idx: number[];
  col: number[];
  uv: number[];
  allowed: BoneName[];
  group: string;
  /** Optional per-vertex fixed weights (bone name → weight) overriding distance weighting. */
  fixed?: { bone: BoneName; w: number }[][];
  /** Skip normal recompute (already provided). */
  nrm?: number[];
}

export interface BuiltBody {
  geometry: THREE.BufferGeometry;
  groups: string[];
  face: THREE.BufferGeometry;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class BodyBuilder {
  private parts: Part[] = [];
  private segs: Record<string, [THREE.Vector3, THREE.Vector3]> = {};
  private s: number;
  private m: number;
  private g: number;
  readonly pos: Record<BoneName, THREE.Vector3>;
  readonly hipY: number;

  constructor(
    private rig: RigInstance,
    private look: Look,
  ) {
    const p = look.proportions;
    this.s = p.height / 1.84;
    this.m = p.muscle;
    this.g = p.girth;
    this.pos = rig.bindWorld;
    this.hipY = this.pos.hips.y;
    for (const b of BONES) this.segs[b] = this.segmentOf(b);
  }

  private segmentOf(b: BoneName): [THREE.Vector3, THREE.Vector3] {
    const p = this.pos;
    const a = p[b].clone();
    const kids = BONES.filter((c) => PARENT[c] === b && !c.startsWith('sash') && !c.startsWith('hair'));
    let end: THREE.Vector3;
    if (b === 'hips') end = p.spine.clone();
    else if (b === 'upperChest') end = p.neck.clone();
    else if (b.startsWith('clavicle')) end = p[b.replace('clavicle', 'upperArm') as BoneName].clone();
    else if (b.startsWith('hand')) end = p[b.replace('hand', 'middle1') as BoneName].clone();
    else if (b === 'head') end = a.clone().add(V(0, 0.22 * this.s, 0.02 * this.s));
    else if (b.startsWith('toe')) end = a.clone().add(V(0, 0, 0.08 * this.s));
    else if (kids.length === 1) end = p[kids[0]].clone();
    else if (kids.length > 1) end = p[kids[0]].clone();
    else {
      const parent = PARENT[b]!;
      const dir = a.clone().sub(p[parent]).normalize();
      const len = b.startsWith('thumb') ? 0.035 : /^(index|middle|ring)/.test(b) ? 0.032 : 0.14;
      end = a.clone().addScaledVector(dir, len * this.s);
    }
    if (b.startsWith('sash') || b.startsWith('hair')) {
      const child = BONES.find((c) => PARENT[c] === b);
      if (child) end = p[child].clone();
      else {
        const parent = PARENT[b]!;
        end = a.clone().addScaledVector(a.clone().sub(p[parent]).normalize(), 0.16 * this.s);
      }
    }
    return [a, end];
  }

  /* ------------------------------------------------------------------ primitives */

  /** Loft rings into a tube. Returns the part for further edits. */
  tube(rings: Ring[], segs: number, group: string, color: THREE.ColorRepresentation, allowed: BoneName[], capStart = false, capEnd = false): Part {
    const pos: number[] = [];
    const idx: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const c = new THREE.Color(color);
    for (let r = 0; r < rings.length; r++) {
      const R = rings[r];
      const e = R.e ?? 2;
      for (let k = 0; k < segs; k++) {
        const th = (k / segs) * Math.PI * 2;
        const cu = Math.cos(th);
        const sv = Math.sin(th);
        const pu = Math.sign(cu) * Math.pow(Math.abs(cu), 2 / e);
        const pv = Math.sign(sv) * Math.pow(Math.abs(sv), 2 / e);
        const bump = R.bump ? R.bump(th) : 1;
        const rv = sv < 0 && R.rvNeg !== undefined ? R.rvNeg : R.rv;
        tmpA.copy(R.c).addScaledVector(R.u, pu * R.ru * bump).addScaledVector(R.v, pv * rv * bump);
        pos.push(tmpA.x, tmpA.y, tmpA.z);
        col.push(c.r, c.g, c.b);
        uv.push(k / segs, r / (rings.length - 1));
      }
    }
    // Determine winding so normals face outward regardless of tube direction / ring axes.
    let flipSide = false;
    if (rings.length > 1) {
      const p0 = V(pos[0], pos[1], pos[2]);
      const p1 = V(pos[3], pos[4], pos[5]);
      const axis = rings[1].c.clone().sub(rings[0].c);
      const tangent = p1.clone().sub(p0);
      const radial = p0.clone().sub(rings[0].c);
      flipSide = new THREE.Vector3().crossVectors(axis, tangent).dot(radial) < 0;
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < segs; k++) {
        const a = r * segs + k;
        const b = r * segs + ((k + 1) % segs);
        const c2 = a + segs;
        const d = b + segs;
        if (flipSide) idx.push(a, b, c2, b, d, c2);
        else idx.push(a, c2, b, b, c2, d);
      }
    }
    const cap = (ri: number, flip: boolean) => {
      const R = rings[ri];
      const ci = pos.length / 3;
      // Domed cap: pull the center slightly outward along the tube direction.
      const dir = ri === 0 ? rings[0].c.clone().sub(rings[1].c).normalize() : rings[ri].c.clone().sub(rings[ri - 1].c).normalize();
      const center = R.c.clone().addScaledVector(dir, Math.min(R.ru, R.rv) * 0.45);
      pos.push(center.x, center.y, center.z);
      col.push(c.r, c.g, c.b);
      uv.push(0.5, ri === 0 ? 0 : 1);
      // Orient so the cap faces away from the tube interior.
      const pa = V(pos[ri * segs * 3], pos[ri * segs * 3 + 1], pos[ri * segs * 3 + 2]);
      const pb = V(pos[(ri * segs + 1) * 3], pos[(ri * segs + 1) * 3 + 1], pos[(ri * segs + 1) * 3 + 2]);
      const nrm = new THREE.Vector3().crossVectors(pa.clone().sub(center), pb.clone().sub(center));
      const outward = nrm.dot(dir) > 0;
      void flip;
      for (let k = 0; k < segs; k++) {
        const a = ri * segs + k;
        const b = ri * segs + ((k + 1) % segs);
        if (outward) idx.push(ci, a, b);
        else idx.push(ci, b, a);
      }
    };
    if (capStart) cap(0, false);
    if (capEnd) cap(rings.length - 1, true);
    const part: Part = { pos, idx, col, uv, allowed, group };
    this.parts.push(part);
    return part;
  }

  /**
   * Tube whose rings may be open arcs (θ from arc[0] to arc[1], segs+1 vertices, no wrap) — used for garments
   * with clean openings (V-necks). Returns the part plus the first/last vertex positions per ring (edges).
   */
  openTube(
    rings: (Ring & { arc: [number, number] })[],
    segs: number,
    group: string,
    color: THREE.ColorRepresentation,
    allowed: BoneName[],
  ): { part: Part; edgeA: THREE.Vector3[]; edgeB: THREE.Vector3[] } {
    const pos: number[] = [];
    const idx: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const c = new THREE.Color(color);
    const edgeA: THREE.Vector3[] = [];
    const edgeB: THREE.Vector3[] = [];
    const n = segs + 1;
    for (let r = 0; r < rings.length; r++) {
      const R = rings[r];
      const e = R.e ?? 2;
      for (let k = 0; k < n; k++) {
        const th = R.arc[0] + ((R.arc[1] - R.arc[0]) * k) / segs;
        const cu = Math.cos(th);
        const sv = Math.sin(th);
        const pu = Math.sign(cu) * Math.pow(Math.abs(cu), 2 / e);
        const pv = Math.sign(sv) * Math.pow(Math.abs(sv), 2 / e);
        const bump = R.bump ? R.bump(th) : 1;
        const rv = sv < 0 && R.rvNeg !== undefined ? R.rvNeg : R.rv;
        tmpA.copy(R.c).addScaledVector(R.u, pu * R.ru * bump).addScaledVector(R.v, pv * rv * bump);
        pos.push(tmpA.x, tmpA.y, tmpA.z);
        col.push(c.r, c.g, c.b);
        uv.push(k / segs, r / (rings.length - 1));
        if (k === 0) edgeA.push(tmpA.clone());
        if (k === n - 1) edgeB.push(tmpA.clone());
      }
    }
    let flipSide = false;
    {
      const p0 = V(pos[3], pos[4], pos[5]);
      const p1 = V(pos[6], pos[7], pos[8]);
      const axis = rings[1].c.clone().sub(rings[0].c);
      const radial = p0.clone().sub(rings[0].c);
      flipSide = new THREE.Vector3().crossVectors(axis, p1.clone().sub(p0)).dot(radial) < 0;
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < segs; k++) {
        const a = r * n + k;
        const b = a + 1;
        const c2 = a + n;
        const d = b + n;
        if (flipSide) idx.push(a, b, c2, b, d, c2);
        else idx.push(a, c2, b, b, c2, d);
      }
    }
    const part: Part = { pos, idx, col, uv, allowed, group };
    this.parts.push(part);
    return { part, edgeA, edgeB };
  }

  /** Add an existing geometry (positions in bind space). */
  geometry(geo: THREE.BufferGeometry, group: string, color: THREE.ColorRepresentation, allowed: BoneName[], keepNormals = false): Part {
    const g = geo.index ? geo : geo;
    const p = g.getAttribute('position');
    const pos = Array.from(p.array as Float32Array);
    const idx = g.index ? Array.from(g.index.array) : [...Array(p.count).keys()];
    const c = new THREE.Color(color);
    const col: number[] = [];
    const uvA = g.getAttribute('uv');
    const uv: number[] = [];
    for (let i = 0; i < p.count; i++) {
      col.push(c.r, c.g, c.b);
      uv.push(uvA ? uvA.getX(i) : 0, uvA ? uvA.getY(i) : 0);
    }
    const part: Part = { pos, idx, col, uv, allowed, group };
    if (keepNormals) part.nrm = Array.from(g.getAttribute('normal').array as Float32Array);
    this.parts.push(part);
    return part;
  }

  /** Remove triangles whose centroid satisfies `pred` (used for the V-neck). */
  cut(part: Part, pred: (x: number, y: number, z: number) => boolean): void {
    const keep: number[] = [];
    for (let i = 0; i < part.idx.length; i += 3) {
      const a = part.idx[i] * 3;
      const b = part.idx[i + 1] * 3;
      const c = part.idx[i + 2] * 3;
      const x = (part.pos[a] + part.pos[b] + part.pos[c]) / 3;
      const y = (part.pos[a + 1] + part.pos[b + 1] + part.pos[c + 1]) / 3;
      const z = (part.pos[a + 2] + part.pos[b + 2] + part.pos[c + 2]) / 3;
      if (!pred(x, y, z)) keep.push(part.idx[i], part.idx[i + 1], part.idx[i + 2]);
    }
    part.idx = keep;
  }

  /** Paint vertex colors by predicate. */
  paint(part: Part, color: THREE.ColorRepresentation, pred: (x: number, y: number, z: number) => boolean): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < part.pos.length; i += 3) {
      if (pred(part.pos[i], part.pos[i + 1], part.pos[i + 2])) {
        part.col[i] = c.r;
        part.col[i + 1] = c.g;
        part.col[i + 2] = c.b;
      }
    }
  }

  /* ------------------------------------------------------------------ body parts */

  /** Muscular torso skin (pelvis → neck base) with pecs, abs, lats and traps. */
  torso(group = 'skin', color = this.look.skin): Part {
    const s = this.s;
    const m = this.m;
    const g = this.g;
    const sh = this.look.proportions.shoulder;
    const H = this.hipY;
    const T = this.look.proportions.torsoLen;
    // [yRel, halfWidth, frontDepth, backDepth, e]
    const rows: [number, number, number, number, number][] = [
      [-0.11, 0.148, 0.098, 0.112, 2.4],
      [0.0, 0.152, 0.1, 0.106, 2.3],
      [0.1, 0.138 * g, 0.098 * g, 0.098, 2.2],
      [0.18, 0.15 * g, 0.108 * g, 0.1, 2.3],
      [0.26, 0.172, 0.122, 0.105, 2.4],
      [0.33, 0.188, 0.132, 0.11, 2.5],
      [0.4, 0.196, 0.126, 0.108, 2.5],
      [0.44, 0.19, 0.11, 0.1, 2.4],
      [0.485, 0.158, 0.088, 0.094, 2.3],
      [0.525, 0.118, 0.074, 0.082, 2.2],
      [0.56, 0.08, 0.066, 0.07, 2.0],
    ];
    const rings: Ring[] = rows.map(([y, a, bf, bb, e]) => {
      const yy = H + y * T * s;
      const wide = y > 0.2 ? sh * (0.85 + 0.15 * m) : 1;
      const yRel = y;
      return {
        c: V(0, yy, -0.008 * s),
        u: V(1, 0, 0),
        v: V(0, 0, 1),
        ru: a * s * wide,
        rv: bf * s * (y > 0.25 ? 0.9 + 0.1 * m : 1),
        rvNeg: bb * s,
        e,
        bump: (th: number) => {
          // Pecs (front, either side of the sternum), lats (sides), subtle abs.
          const x = Math.cos(th);
          const z = Math.sin(th);
          let k = 1;
          if (z > 0 && yRel > 0.27 && yRel < 0.42) {
            const pec = Math.exp(-Math.pow((Math.abs(x) - 0.45) / 0.28, 2)) * Math.exp(-Math.pow((yRel - 0.345) / 0.05, 2));
            k += pec * 0.11 * m;
            // Sternum groove.
            k -= Math.exp(-Math.pow(x / 0.07, 2)) * 0.03 * m * (yRel > 0.28 ? 1 : 0);
          }
          if (z > 0 && yRel > 0.06 && yRel < 0.27) {
            const ab = Math.exp(-Math.pow(x / 0.32, 2)) * (0.025 + 0.02 * Math.cos(yRel * 95)) * m;
            k += ab;
          }
          if (Math.abs(x) > 0.75 && yRel > 0.22 && yRel < 0.42) k += 0.05 * m * Math.exp(-Math.pow((yRel - 0.32) / 0.07, 2));
          return k;
        },
      };
    });
    return this.tube(rings, 40, group, color, ['hips', 'spine', 'chest', 'upperChest', 'neck', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR'], true, false);
  }

  neck(): void {
    const s = this.s;
    const H = this.hipY;
    const T = this.look.proportions.torsoLen;
    const r = 0.063 * s * (0.85 + 0.15 * this.m);
    const rings: Ring[] = [
      { c: V(0, H + 0.49 * T * s, -0.015 * s), u: V(1, 0, 0), v: V(0, 0, 1), ru: r * 1.35, rv: r * 1.08 },
      { c: V(0, H + 0.56 * T * s, -0.012 * s), u: V(1, 0, 0), v: V(0, 0, 1), ru: r, rv: r * 0.95 },
      { c: V(0, H + 0.635 * T * s, -0.005 * s), u: V(1, 0, 0), v: V(0, 0, 1), ru: r * 0.92, rv: r * 0.9 },
      { c: V(0, H + 0.68 * T * s, 0.0), u: V(1, 0, 0), v: V(0, 0, 1), ru: r * 0.85, rv: r * 0.85 },
    ];
    this.tube(rings, 20, 'skin', this.look.skin, ['upperChest', 'neck', 'head']);
  }

  /** Arm radius (vertical, front/back) at arm parameter t (0 shoulder .. 1 wrist). */
  armRadius(t: number): [number, number] {
    const prof = BodyBuilder.ARM_PROFILE;
    let i = 0;
    while (i < prof.length - 2 && t > prof[i + 1][0]) i++;
    const a = prof[i];
    const b = prof[i + 1];
    const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const mm = (t < 0.92 ? this.m : 1) * 1.12 * this.s;
    return [(a[1] + (b[1] - a[1]) * k) * mm, (a[2] + (b[2] - a[2]) * k) * mm];
  }

  static readonly ARM_PROFILE: [number, number, number, number][] = [
    [-0.16, 0.078, 0.08, 0],
    [-0.04, 0.094, 0.088, 0],
    [0.08, 0.088, 0.08, 0.02],
    [0.2, 0.068, 0.07, 0.07],
    [0.34, 0.062, 0.067, 0.11],
    [0.46, 0.051, 0.054, 0.04],
    [0.53, 0.046, 0.05, 0],
    [0.6, 0.053, 0.055, 0],
    [0.72, 0.048, 0.05, 0],
    [0.85, 0.04, 0.043, 0],
    [0.95, 0.031, 0.037, 0],
    [1.01, 0.028, 0.036, 0],
  ];

  /** Arm from inside the deltoid to the wrist, with muscle profile. */
  arm(side: 1 | -1, sleeve: string | null): void {
    const s = this.s;
    const m = this.m;
    const P = this.pos;
    const L = side === 1 ? 'L' : 'R';
    const sh = P[`upperArm${L}` as BoneName];
    const wrist = P[`hand${L}` as BoneName];
    const len = wrist.x - sh.x;
    const prof = BodyBuilder.ARM_PROFILE;
    const rings: Ring[] = prof.map(([t, ru, rv, bic]) => {
      const mm = (t < 0.92 ? m : 1) * 1.12;
      return {
        c: V(sh.x + len * t, sh.y - (t < 0 ? 0.005 * s : 0), sh.z),
        u: V(0, 1, 0),
        v: V(0, 0, 1),
        ru: ru * s * mm,
        rv: rv * s * mm,
        e: 2.1,
        bump: (th: number) => {
          const up = Math.cos(th);
          const fwd = Math.sin(th);
          let k = 1;
          // Biceps on the front, triceps horseshoe on the back, deltoid cap on top.
          k += bic * Math.max(0, fwd) * Math.max(0, fwd) * 1.4;
          if (t > 0.15 && t < 0.45) k += 0.05 * m * Math.max(0, -fwd) * Math.exp(-Math.pow((t - 0.28) / 0.12, 2));
          if (t < 0.1) k += 0.06 * m * Math.max(0, up);
          // Forearm brachioradialis bulge (top-front).
          if (t > 0.55 && t < 0.8) k += 0.08 * m * Math.max(0, up * 0.7 + fwd * 0.7) * Math.exp(-Math.pow((t - 0.63) / 0.08, 2));
          return k;
        },
      };
    });
    const allowed: BoneName[] = [`clavicle${L}`, `upperArm${L}`, `foreArm${L}`, `hand${L}`, 'upperChest'] as BoneName[];
    const part = this.tube(rings, 22, 'skin', this.look.skin, allowed);
    if (sleeve) {
      // Long sleeve for armored / robed archetypes: a looser cloth tube over the arm.
      const sl = rings.slice(0, 10).map((r) => ({ ...r, c: r.c.clone(), ru: r.ru * 1.22 + 0.006, rv: r.rv * 1.22 + 0.006, bump: undefined }));
      this.tube(sl, 18, 'top', sleeve, allowed);
    }
    void part;
  }

  /** Palm + 4 fingers (pinky rides the ring chain) + thumb. */
  hand(side: 1 | -1, color = this.look.skin, claws = false): void {
    const s = this.s;
    const P = this.pos;
    const L = side === 1 ? 'L' : 'R';
    const hs = this.look.proportions.handScale;
    const wrist = P[`hand${L}` as BoneName];
    const knuckleX = P[`middle1${L}` as BoneName].x;
    const palmRows: [number, number, number][] = [
      [0.0, 0.017, 0.034],
      [0.35, 0.019, 0.042],
      [0.75, 0.018, 0.046],
      [1.0, 0.015, 0.045],
    ];
    const rings: Ring[] = palmRows.map(([t, ru, rv]) => ({
      c: V(wrist.x + (knuckleX - wrist.x) * t, wrist.y - 0.002 * s, wrist.z - 0.004 * s * hs),
      u: V(0, 1, 0),
      v: V(0, 0, 1),
      ru: ru * s * hs,
      rv: rv * s * hs,
      e: 3.2,
    }));
    this.tube(rings, 16, 'skin', color, [`foreArm${L}`, `hand${L}`, `index1${L}`, `middle1${L}`, `ring1${L}`] as BoneName[], false, true);
    const finger = (b1: BoneName, b2: BoneName, r0: number, offset?: THREE.Vector3, lenK = 1) => {
      const a = P[b1].clone().add(offset ?? V(0, 0, 0));
      const b = P[b2].clone().add(offset ?? V(0, 0, 0));
      const dir = b.clone().sub(a).normalize();
      const l2 = 0.034 * s * hs * lenK;
      const tip = b.clone().addScaledVector(dir, l2);
      const back = a.clone().addScaledVector(dir, -0.012 * s * hs);
      const up = V(0, 1, 0);
      const fv = new THREE.Vector3().crossVectors(dir, up).normalize();
      const r = r0 * s * hs;
      const ringsF: Ring[] = [
        { c: back, u: up, v: fv, ru: r * 1.05, rv: r * 1.05 },
        { c: a, u: up, v: fv, ru: r, rv: r },
        { c: a.clone().lerp(b, 0.5), u: up, v: fv, ru: r * 0.92, rv: r * 0.95 },
        { c: b, u: up, v: fv, ru: r * 0.9, rv: r * 0.9 },
        { c: b.clone().lerp(tip, 0.6), u: up, v: fv, ru: r * 0.78, rv: r * 0.82 },
        { c: tip, u: up, v: fv, ru: r * (claws ? 0.3 : 0.62), rv: r * (claws ? 0.3 : 0.7) },
      ];
      if (claws) ringsF.push({ c: tip.clone().addScaledVector(dir, 0.025 * s * hs).add(V(0, -0.006 * s, 0)), u: up, v: fv, ru: r * 0.06, rv: r * 0.06 });
      const part = this.tube(ringsF, 8, 'skin', color, [`hand${L}`, b1, b2], false, true);
      if (claws) this.paint(part, '#e8e0c8', (x) => Math.abs(x) > Math.abs(tip.x) - 0.004 * s);
    };
    finger(`index1${L}` as BoneName, `index2${L}` as BoneName, 0.0102);
    finger(`middle1${L}` as BoneName, `middle2${L}` as BoneName, 0.0108, undefined, 1.12);
    finger(`ring1${L}` as BoneName, `ring2${L}` as BoneName, 0.0102);
    finger(`ring1${L}` as BoneName, `ring2${L}` as BoneName, 0.0088, V(-0.012 * s * side, -0.002 * s, -0.022 * s * hs), 0.78);
    finger(`thumb1${L}` as BoneName, `thumb2${L}` as BoneName, 0.0125, undefined, 0.95);
  }

  /** DB-style head: strong jaw, cheekbones, brow ridge, small nose; ears; returns the face decal geometry. */
  head(scaleK = 1, imp = false): THREE.BufferGeometry {
    const s = this.s * this.look.proportions.headScale * scaleK;
    const hb = this.pos.head;
    const cy = hb.y + 0.105 * s;
    const cz = hb.z + 0.012 * s;
    const geo = new THREE.SphereGeometry(1, 40, 30, -Math.PI / 2, Math.PI * 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      // Unit-head coordinates in meters for a 1.84 m hero, scaled at the end.
      let x = p.getX(i) * 0.087;
      let y = p.getY(i) * 0.117;
      let z = p.getZ(i) * (p.getZ(i) < 0 ? 0.106 : 0.1);
      const yr = y;
      // Jaw: narrow + square chin below the cheekbones.
      if (yr < -0.015) {
        const t = Math.min(1, (-0.015 - yr) / 0.1);
        const front = Math.max(0, z) / 0.1;
        x *= 1 - t * (0.3 + 0.12 * front);
        if (z > 0) z = z * (1 - t * 0.08) + t * 0.008;
        if (yr < -0.09) y = -0.09 - (-0.09 - yr) * 0.55;
      }
      // Cheekbones.
      if (z > 0.02 && yr > -0.035 && yr < 0.01) x *= 1 + 0.06 * Math.exp(-Math.pow((yr + 0.012) / 0.02, 2));
      // Brow ridge.
      if (z > 0.06 && yr > 0.012 && yr < 0.05) z += 0.009 * Math.exp(-Math.pow((yr - 0.028) / 0.012, 2)) * Math.max(0, 1 - Math.abs(x) / 0.07);
      // Eye sockets (slight recess).
      if (z > 0.06 && Math.abs(Math.abs(x) - 0.032) < 0.022 && yr > -0.01 && yr < 0.018) z -= 0.004;
      // Nose wedge.
      if (z > 0.07 && Math.abs(x) < 0.016) {
        const ny = Math.exp(-Math.pow((yr + 0.022) / 0.022, 2));
        z += 0.02 * ny * (1 - Math.abs(x) / 0.016) * (yr < 0.01 ? 1 : 0.4);
      }
      // Fuller back of the skull.
      if (z < 0 && yr > -0.02) z *= 1.04;
      if (imp) {
        x *= 1.12;
        if (yr < -0.04) x *= 0.85;
      }
      p.setXYZ(i, x * s, y * s + cy, z * s + cz);
    }
    geo.computeVertexNormals();
    this.geometry(geo, 'skin', this.look.skin, ['head']);
    // Ears.
    for (const side of [1, -1]) {
      const ear = new THREE.SphereGeometry(1, 10, 8);
      ear.scale(0.011 * s, (imp ? 0.05 : 0.028) * s, (imp ? 0.03 : 0.019) * s);
      if (imp) ear.rotateZ(side * -0.9);
      ear.translate(side * 0.088 * s, cy - 0.006 * s + (imp ? 0.02 * s : 0), cz - 0.008 * s);
      ear.computeVertexNormals();
      this.geometry(ear, 'skin', this.look.skin, ['head']);
    }
    // Face decal: the front of the head, offset outward, with planar UVs for the drawn features.
    const pos = p.array as Float32Array;
    const nrm = geo.getAttribute('normal').array as Float32Array;
    const idx = geo.index!.array;
    const fx = 0.082 * s;
    const fy0 = -0.12 * s;
    const fy1 = 0.065 * s;
    const keepV = new Map<number, number>();
    const dpos: number[] = [];
    const duv: number[] = [];
    const dnrm: number[] = [];
    const didx: number[] = [];
    const vert = (i: number) => {
      let k = keepV.get(i);
      if (k !== undefined) return k;
      k = dpos.length / 3;
      keepV.set(i, k);
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const nx = nrm[i * 3];
      const ny = nrm[i * 3 + 1];
      const nz = nrm[i * 3 + 2];
      dpos.push(x + nx * 0.0012 * s, y + ny * 0.0012 * s, z + nz * 0.0012 * s);
      dnrm.push(nx, ny, nz);
      duv.push((x + fx) / (2 * fx), (y - cy - fy0) / (fy1 - fy0));
      return k;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      let ok = true;
      for (const v of [a, b, c]) {
        const x = pos[v * 3];
        const y = pos[v * 3 + 1] - cy;
        const z = pos[v * 3 + 2] - cz;
        if (z < 0.03 * s || Math.abs(x) > fx || y < fy0 || y > fy1) ok = false;
      }
      if (ok) didx.push(vert(a), vert(b), vert(c));
    }
    const face = new THREE.BufferGeometry();
    face.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
    face.setAttribute('normal', new THREE.Float32BufferAttribute(dnrm, 3));
    face.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
    face.setIndex(didx);
    return face;
  }

  /** Sleeveless gi top with a clean V-neck (open-arc rings), gold trim edges and a flap flaring below the sash. */
  giTop(color = this.look.top, trim = this.look.trim, open = false): void {
    const s = this.s;
    const H = this.hipY;
    const T = this.look.proportions.torsoLen;
    const sh = this.look.proportions.shoulder;
    const m = this.m;
    const g = this.g;
    // [yRel, halfWidth, frontDepth, backDepth]
    const rows: [number, number, number, number][] = [
      [-0.11, 0.232, 0.168, 0.168],
      [-0.06, 0.2, 0.145, 0.145],
      [0.0, 0.168, 0.12, 0.124],
      [0.1, 0.158 * g, 0.118 * g, 0.116],
      [0.18, 0.168 * g, 0.126 * g, 0.116],
      [0.26, 0.19, 0.142, 0.122],
      [0.33, 0.205, 0.152, 0.126],
      [0.4, 0.206, 0.146, 0.124],
      [0.44, 0.198, 0.124, 0.114],
      [0.485, 0.166, 0.098, 0.104],
      [0.53, 0.124, 0.084, 0.092],
    ];
    const vStart = open ? -0.2 : 0.2;
    const vw = (yRel: number) => (open ? 0.045 + Math.max(0, yRel) * 0.11 : yRel > vStart ? (yRel - vStart) * 0.6 + 0.006 : 0);
    const front = Math.PI / 2;
    const rings = rows.map(([y, a, bf, bb]) => {
      const wide = y > 0.2 ? sh * (0.85 + 0.15 * m) : 1;
      const ru = Math.min(a * s * wide, y > 0.38 ? 0.182 * s * wide : 9);
      const e = 2.5;
      const w = vw(y) * s;
      const delta = w > 0 ? Math.asin(Math.min(0.97, Math.pow(Math.min(1, w / ru), e / 2))) : 0;
      return {
        c: V(0, H + y * T * s, -0.008 * s),
        u: V(1, 0, 0),
        v: V(0, 0, 1),
        ru,
        rv: bf * s * (y > 0.25 ? 0.92 + 0.08 * m : 1),
        rvNeg: bb * s,
        e,
        arc: [front + delta, front + Math.PI * 2 - delta] as [number, number],
        bump: (th: number) => {
          const x = Math.cos(th);
          return 1 + 0.01 * Math.sin(th * 7 + y * 30) + (y > 0.26 && y < 0.42 && Math.sin(th) > 0 ? 0.06 * m * Math.exp(-Math.pow((Math.abs(x) - 0.45) / 0.3, 2)) : 0);
        },
      };
    });
    const allowed: BoneName[] = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR', 'thighL', 'thighR'];
    const { edgeA, edgeB } = this.openTube(rings, 52, 'top', color, allowed);
    // Gold trim exactly along the V edges.
    const first = rows.findIndex((r) => r[0] > vStart);
    for (const edge of [edgeA, edgeB]) {
      const pts = edge.slice(Math.max(0, first - 1));
      const rs: Ring[] = pts.map((p) => {
        const out = V(p.x, 0, p.z + 0.008 * s).normalize();
        return { c: p.clone().addScaledVector(out, 0.004 * s), u: V(0, 1, 0), v: out, ru: 0.013 * s, rv: 0.005 * s };
      });
      if (rs.length > 1) this.tube(rs, 6, 'trim', trim, allowed.slice(0, 7), true, true);
    }
  }

  /** Thick knotted sash with two hanging tails on spring bones. */
  sash(color = this.look.sash): void {
    const s = this.s;
    const H = this.hipY;
    const a = 0.172 * s * this.g;
    const bf = 0.125 * s * this.g;
    const bb = 0.128 * s;
    const ring: Ring[] = [];
    for (let k = 0; k <= 56; k++) {
      const th = (k / 56) * Math.PI * 2;
      const z = Math.sin(th) > 0 ? bf : bb;
      ring.push({
        c: V(Math.cos(th) * a, H + 0.03 * s, Math.sin(th) * z - 0.008 * s),
        u: V(0, 1, 0),
        v: V(Math.cos(th), 0, Math.sin(th)),
        ru: 0.034 * s,
        rv: 0.012 * s,
        e: 3,
      });
    }
    this.tube(ring, 8, 'sash', color, ['hips', 'spine']);
    // Knot.
    const knot = new THREE.SphereGeometry(1, 12, 8);
    knot.scale(0.04 * s, 0.034 * s, 0.026 * s);
    knot.translate(0.13 * s, H + 0.035 * s, 0.1 * s);
    knot.computeVertexNormals();
    this.geometry(knot, 'sash', color, ['hips']);
    // Tails: flat ribbons along the sash chains.
    for (const [a1, a2, a3, w] of [
      ['sashA1', 'sashA2', 'sashA3', 0.07],
      ['sashB1', 'sashB2', 'sashB3', 0.06],
    ] as [BoneName, BoneName, BoneName, number][]) {
      const P = this.pos;
      const end = P[a3].clone().add(V(0.005, -0.08 * s, 0));
      const pts = [P[a1], P[a1].clone().lerp(P[a2], 0.5), P[a2], P[a2].clone().lerp(P[a3], 0.5), P[a3], end];
      const rs: Ring[] = pts.map((c, i) => ({ c: c.clone(), u: V(1, 0, 0.15).normalize(), v: V(0, 0, 1), ru: w * s * (1 - i * 0.05), rv: 0.006 * s, e: 4 }));
      this.tube(rs, 8, 'sash', color, [a1, a2, a3], false, true);
    }
  }

  /** Baggy gi trousers (one tube per leg, overlapping at the crotch, tucked into boots). */
  pants(color = this.look.pants, short = false): void {
    const s = this.s;
    const H = this.hipY;
    const P = this.pos;
    const g = this.g;
    for (const side of [1, -1] as const) {
      const L = side === 1 ? 'L' : 'R';
      const thigh = P[`thigh${L}` as BoneName];
      const knee = P[`shin${L}` as BoneName];
      const ankle = P[`foot${L}` as BoneName];
      const rows: [number, number, number, number][] = [
        // y, centerX, r, frontBulge
        [H + 0.04 * s, 0.07, 0.135, 0],
        [H - 0.06 * s, 0.085, 0.13, 0],
        [H - 0.2 * s, thigh.x / s, 0.13, 0.03],
        [H - 0.33 * s, thigh.x / s, 0.124, 0.03],
        [knee.y + 0.06 * s, knee.x / s, 0.112, 0.02],
        [knee.y - 0.06 * s, knee.x / s, 0.106, 0],
        [knee.y - 0.2 * s, (knee.x + ankle.x) / 2 / s, 0.1, 0],
        [ankle.y + 0.2 * s, ankle.x / s, 0.085, 0],
        [ankle.y + 0.13 * s, ankle.x / s, 0.066, 0],
      ];
      const use = short ? rows.slice(0, 4) : rows;
      const rings: Ring[] = use.map(([y, cx, r, fb]) => ({
        c: V(side * Math.abs(cx) * s, y, (y < knee.y ? 0.01 : 0.004) * s),
        u: V(1, 0, 0),
        v: V(0, 0, 1),
        ru: r * s * g,
        rv: r * s * g * 0.95,
        rvNeg: r * s * g * 0.98,
        e: 2.1,
        bump: (th: number) => 1 + fb * Math.max(0, Math.sin(th)) + 0.02 * Math.sin(th * 5 + y * 23),
      }));
      this.tube(rings, 26, 'pants', color, ['hips', `thigh${L}` as BoneName, `shin${L}` as BoneName], false, short);
    }
  }

  /** Bare legs from under short trousers down into the boots: knee, calf and shin profile in skin colour. */
  bareLegs(color = this.look.skin): void {
    const s = this.s;
    const H = this.hipY;
    const P = this.pos;
    const g = this.g;
    for (const side of [1, -1] as const) {
      const L = side === 1 ? 'L' : 'R';
      const thigh = P[`thigh${L}` as BoneName];
      const knee = P[`shin${L}` as BoneName];
      const ankle = P[`foot${L}` as BoneName];
      const rows: [number, number, number, number][] = [
        // y, centerX, r, calf (back bulge)
        [H - 0.26 * s, thigh.x / s, 0.11, 0],
        [H - 0.36 * s, (thigh.x * 0.6 + knee.x * 0.4) / s, 0.1, 0],
        [knee.y + 0.05 * s, knee.x / s, 0.083, 0],
        [knee.y - 0.01 * s, knee.x / s, 0.078, 0.02],
        [knee.y - 0.09 * s, knee.x / s, 0.084, 0.16],
        [knee.y - 0.2 * s, (knee.x * 0.6 + ankle.x * 0.4) / s, 0.075, 0.1],
        [ankle.y + 0.3 * s, ankle.x / s, 0.06, 0.02],
        [ankle.y + 0.22 * s, ankle.x / s, 0.054, 0],
      ];
      // Girth thickens the thigh and calf but the ankle must still fit inside the boot shaft.
      const rings: Ring[] = rows.map(([y, cx, r, calf], i) => {
        const k = i < 5 ? g : 1 + (g - 1) * 0.25;
        return {
          c: V(side * Math.abs(cx) * s, y, (y < knee.y ? 0.0 : 0.006) * s),
          u: V(1, 0, 0),
          v: V(0, 0, 1),
          ru: r * s * k,
          rv: r * s * k,
          rvNeg: r * s * k * (1 + calf),
          e: 2.0,
        };
      });
      this.tube(rings, 20, 'skin', color, [`thigh${L}` as BoneName, `shin${L}` as BoneName], false, false);
    }
  }

  /** Leather boots with a shaped foot and strap wraps. */
  boots(color = this.look.boots, wrap = this.look.wrap): void {
    const s = this.s;
    const P = this.pos;
    for (const side of [1, -1] as const) {
      const L = side === 1 ? 'L' : 'R';
      const ankle = P[`foot${L}` as BoneName];
      const x = ankle.x;
      const shaft: Ring[] = [
        [0.36, 0.074],
        [0.3, 0.07],
        [0.2, 0.064],
        [0.12, 0.058],
        [0.075, 0.06],
      ].map(([y, r]) => ({ c: V(x, y * s, -0.012 * s), u: V(1, 0, 0), v: V(0, 0, 1), ru: r * s, rv: r * s * 1.05 }));
      this.tube(shaft, 20, 'boots', color, [`shin${L}` as BoneName, `foot${L}` as BoneName], false, false);
      // Strap wraps.
      for (const [y, r] of [
        [0.33, 0.077],
        [0.25, 0.071],
        [0.17, 0.066],
      ]) {
        const tor = new THREE.TorusGeometry(r * s, 0.008 * s, 6, 20);
        tor.rotateX(Math.PI / 2);
        tor.rotateZ(0.08 * side);
        tor.translate(x, y * s, -0.012 * s);
        tor.computeVertexNormals();
        this.geometry(tor, 'wrap', wrap, [`shin${L}` as BoneName]);
      }
      const foot: [number, number, number, number][] = [
        // z, cy, halfWidth, halfHeight
        [-0.085, 0.056, 0.038, 0.052],
        [-0.05, 0.06, 0.047, 0.06],
        [0.02, 0.058, 0.05, 0.058],
        [0.09, 0.045, 0.053, 0.045],
        [0.15, 0.036, 0.049, 0.036],
        [0.2, 0.03, 0.04, 0.028],
        [0.225, 0.028, 0.024, 0.02],
      ];
      const rings: Ring[] = foot.map(([z, cy, w, h]) => ({ c: V(x, cy * s, z * s), u: V(1, 0, 0), v: V(0, 1, 0), ru: w * s, rv: h * s, e: 2.8 }));
      const part = this.tube(rings, 18, 'boots', color, [`foot${L}` as BoneName, `toe${L}` as BoneName, `shin${L}` as BoneName], true, true);
      this.paint(part, '#1a120c', (_x, y) => y < 0.012 * s);
    }
  }

  wristbands(color = this.look.bands): void {
    const s = this.s;
    const P = this.pos;
    for (const side of [1, -1] as const) {
      const L = side === 1 ? 'L' : 'R';
      const sh = P[`upperArm${L}` as BoneName];
      const w = P[`hand${L}` as BoneName];
      const rings: Ring[] = [0.79, 0.81, 0.97, 0.995].map((t, i) => {
        const [ru, rv] = this.armRadius(t);
        const pad = (i === 0 || i === 3 ? 0.003 : 0.008) * s;
        return { c: V(sh.x + (w.x - sh.x) * t, sh.y, sh.z), u: V(0, 1, 0), v: V(0, 0, 1), ru: ru + pad, rv: rv + pad };
      });
      this.tube(rings, 20, 'bands', color, [`foreArm${L}` as BoneName, `hand${L}` as BoneName]);
    }
  }

  /** Brigand leather vest: open-front torso shell with fur collar. */
  vest(color: string, trim: string): void {
    this.giTop(color, trim, true);
  }

  /** Long robe for warlocks: from chest to ankles, flaring; weighted across both legs. */
  robe(color: string, trim: string): void {
    const s = this.s;
    const H = this.hipY;
    const rows: [number, number, number][] = [
      [H + 0.5 * s, 0.17, 0.12],
      [H + 0.3 * s, 0.2, 0.15],
      [H + 0.05 * s, 0.19, 0.15],
      [H - 0.2 * s, 0.24, 0.2],
      [H * 0.5, 0.3, 0.25],
      [0.08 * s, 0.36, 0.3],
    ];
    const rings: Ring[] = rows.map(([y, a, b]) => ({ c: V(0, y, 0), u: V(1, 0, 0), v: V(0, 0, 1), ru: a * s, rv: b * s, bump: (th: number) => 1 + 0.03 * Math.sin(th * 9 + y * 4) }));
    const part = this.tube(rings, 40, 'top', color, ['hips', 'spine', 'chest', 'upperChest', 'thighL', 'thighR']);
    this.paint(part, trim, (_x, y, z) => (y < 0.16 * s) || (z > 0 && Math.abs(_x) < 0.025 * s));
  }

  /* ------------------------------------------------------------------ assembly */

  weightsFor(p: THREE.Vector3, allowed: BoneName[], soft: number): { idx: number[]; w: number[] } {
    const cands: { i: number; w: number }[] = [];
    for (const b of allowed) {
      const [a, e] = this.segs[b];
      tmpB.subVectors(e, a);
      const len2 = tmpB.lengthSq();
      let t = len2 > 0 ? tmpA.subVectors(p, a).dot(tmpB) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d2 = tmpA.copy(a).addScaledVector(tmpB, t).distanceToSquared(p);
      const w = 1 / Math.pow(d2 + soft, 2);
      cands.push({ i: BONE_INDEX[b], w });
    }
    cands.sort((x, y) => y.w - x.w);
    const top = cands.slice(0, 4);
    let sum = 0;
    for (const c of top) sum += c.w;
    // Drop tiny influences to keep limbs crisp.
    const idx: number[] = [];
    const w: number[] = [];
    for (const c of top) {
      const nw = c.w / sum;
      idx.push(c.i);
      w.push(nw < 0.02 ? 0 : nw);
    }
    const s2 = w.reduce((a, b) => a + b, 0);
    while (idx.length < 4) {
      idx.push(0);
      w.push(0);
    }
    return { idx, w: w.map((x) => x / s2) };
  }

  build(): BuiltBody & { groupOrder: string[] } {
    const groupOrder = [...new Set(this.parts.map((p) => p.group))];
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const si: number[] = [];
    const sw: number[] = [];
    const idx: number[] = [];
    const geo = new THREE.BufferGeometry();
    const soft = Math.pow(0.03 * this.s, 2);
    const v = new THREE.Vector3();
    for (const group of groupOrder) {
      const start = idx.length;
      for (const part of this.parts.filter((p) => p.group === group)) {
        const base = pos.length / 3;
        let normals = part.nrm;
        if (!normals) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
          g.setIndex(part.idx);
          g.computeVertexNormals();
          normals = Array.from(g.getAttribute('normal').array as Float32Array);
        }
        for (let i = 0; i < part.pos.length; i += 3) {
          v.set(part.pos[i], part.pos[i + 1], part.pos[i + 2]);
          const { idx: bi, w } = this.weightsFor(v, part.allowed, soft);
          si.push(...bi);
          sw.push(...w);
        }
        pos.push(...part.pos);
        nrm.push(...normals);
        col.push(...part.col);
        uv.push(...part.uv);
        for (const k of part.idx) idx.push(k + base);
      }
      geo.addGroup(start, idx.length - start, groupOrder.indexOf(group));
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return { geometry: geo, groups: groupOrder, groupOrder, face: new THREE.BufferGeometry() };
  }

  /** Skin a standalone geometry (face decal, hair) rigidly/softly to bones. */
  skin(geo: THREE.BufferGeometry, allowed: BoneName[]): THREE.BufferGeometry {
    const p = geo.getAttribute('position');
    const si: number[] = [];
    const sw: number[] = [];
    const v = new THREE.Vector3();
    const soft = Math.pow(0.03 * this.s, 2);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const { idx, w } = this.weightsFor(v, allowed, soft);
      si.push(...idx);
      sw.push(...w);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.computeBoundingSphere();
    return geo;
  }

  get scale(): number {
    return this.s;
  }
}
