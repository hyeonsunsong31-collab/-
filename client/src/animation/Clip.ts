import { BONES, type BoneName } from '../character/Rig.ts';
import { type Pose, bindValue } from './Pose.ts';
import { EASE, type EaseName } from './Easing.ts';

export const NB = BONES.length;
const ROOT_KEYS = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const;

export interface Key {
  t: number;
  p: Pose;
  /** Easing applied to the segment that starts at this key. */
  e?: EaseName;
  /** Zero tangent at this key: the motion arrives and leaves softly (contacts, holds, apexes). */
  stop?: boolean;
}

export interface ClipEvent {
  t: number;
  name: string;
  data?: Record<string, unknown>;
}

export interface ClipDef {
  name: string;
  dur: number;
  loop?: boolean;
  keys: Key[];
  events?: ClipEvent[];
  /** Named windows in seconds: hit, iframes, cancel, combo, armor, flash… */
  win?: Record<string, [number, number]>;
  /** Root motion samples: [t, forward z, lateral x, vertical y] cumulative meters. */
  move?: [number, number, number?, number?][];
  /** Authored travel speed for locomotion cycles (m/s). */
  speed?: number;
  /** Playback speed multiplier. */
  rate?: number;
}

/** Pre-baked, fast-to-sample clip. Values are semantic degrees per bone channel. */
export class CompiledClip {
  readonly name: string;
  readonly dur: number;
  readonly loop: boolean;
  readonly def: ClipDef;
  private times: Float32Array;
  private vals: Float32Array;
  private root: Float32Array;
  private tanV: Float32Array;
  private tanR: Float32Array;
  private ease: ((t: number) => number)[];
  private stop: Uint8Array;
  /** 1 for bones this clip actually drives. */
  readonly mask = new Uint8Array(NB);
  readonly hasRoot: boolean;
  private n: number;

  constructor(def: ClipDef) {
    this.def = def;
    this.name = def.name;
    this.dur = def.dur;
    this.loop = !!def.loop;
    const keys = [...def.keys].sort((a, b) => a.t - b.t);
    this.n = keys.length;
    this.times = new Float32Array(keys.map((k) => k.t));
    this.vals = new Float32Array(this.n * NB * 3);
    this.root = new Float32Array(this.n * 6);
    this.ease = keys.map((k) => EASE[k.e ?? 'linear']);
    this.stop = new Uint8Array(keys.map((k) => (k.stop ? 1 : 0)));
    let anyRoot = false;
    for (let bi = 0; bi < NB; bi++) {
      const b = BONES[bi] as BoneName;
      const has = keys.map((k) => k.p.b[b]);
      if (has.some((v) => v)) this.mask[bi] = 1;
      for (let k = 0; k < this.n; k++) {
        // Carry missing channels from the nearest key that defines them.
        let v = has[k];
        if (!v) {
          for (let d = 1; d < this.n && !v; d++) v = has[k - d] ?? has[k + d];
        }
        const val = v ?? bindValue(b);
        const o = (k * NB + bi) * 3;
        this.vals[o] = val[0];
        this.vals[o + 1] = val[1];
        this.vals[o + 2] = val[2];
      }
    }
    for (let k = 0; k < this.n; k++) {
      const r = keys[k].p.root ?? {};
      for (let c = 0; c < 6; c++) {
        let v = r[ROOT_KEYS[c]];
        if (v === undefined) {
          for (let d = 1; d < this.n && v === undefined; d++) v = keys[k - d]?.p.root?.[ROOT_KEYS[c]] ?? keys[k + d]?.p.root?.[ROOT_KEYS[c]];
        }
        if (v !== undefined) anyRoot = true;
        this.root[k * 6 + c] = v ?? 0;
      }
    }
    this.hasRoot = anyRoot;
    this.tanV = this.tangents(this.vals, NB * 3);
    this.tanR = this.tangents(this.root, 6);
  }

  /** Precompute per-key tangents (units per second) for every channel. */
  private tangents(arr: Float32Array, stride: number): Float32Array {
    const n = this.n;
    const T = this.times;
    const out = new Float32Array(arr.length);
    for (let k = 0; k < n; k++) {
      if (this.stop[k]) continue;
      let a = k - 1;
      let b = k + 1;
      let ta: number;
      let tb: number;
      if (this.loop) {
        if (a < 0) {
          a = n - 2;
          ta = T[a] - this.dur;
        } else ta = T[a];
        if (b > n - 1) {
          b = 1;
          tb = T[b] + this.dur;
        } else tb = T[b];
      } else {
        if (a < 0) a = 0;
        if (b > n - 1) b = n - 1;
        ta = T[a];
        tb = T[b];
      }
      const dt = tb - ta;
      if (dt <= 1e-6 || a < 0 || b < 0) continue;
      for (let c = 0; c < stride; c++) out[k * stride + c] = (arr[b * stride + c] - arr[a * stride + c]) / dt;
    }
    return out;
  }

  /** Locate segment and eased parameter for time t. */
  private segOut = { i: 0, u: 0 };
  private seg(t: number): { i: number; u: number } {
    const o = this.segOut;
    const n = this.n;
    o.i = 0;
    o.u = 0;
    if (n === 1) return o;
    if (this.loop) {
      t = ((t % this.dur) + this.dur) % this.dur;
    } else if (t <= this.times[0]) return o;
    else if (t >= this.times[n - 1]) {
      o.i = n - 2;
      o.u = 1;
      return o;
    }
    let i = 0;
    while (i < n - 2 && t >= this.times[i + 1]) i++;
    const t0 = this.times[i];
    const t1 = this.times[i + 1];
    const raw = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    o.i = i;
    o.u = this.ease[i](raw);
    return o;
  }

  /** Hermite with precomputed time-aware tangents (Catmull-Rom style); zero tangents at `stop` keys. */
  private interp(arr: Float32Array, tan: Float32Array, stride: number, off: number, i: number, u: number): number {
    const p1 = arr[i * stride + off];
    if (this.n === 1 || u <= 0) return p1;
    const p2 = arr[(i + 1) * stride + off];
    if (u >= 1) return p2;
    const h = this.times[i + 1] - this.times[i];
    const m1 = tan[i * stride + off] * h;
    const m2 = tan[(i + 1) * stride + off] * h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2;
  }

  sample(t: number, out: Float32Array, rootOut: Float32Array): void {
    const { i, u } = this.seg(t);
    const stride = NB * 3;
    for (let bi = 0; bi < NB; bi++) {
      const o = bi * 3;
      out[o] = this.interp(this.vals, this.tanV, stride, o, i, u);
      out[o + 1] = this.interp(this.vals, this.tanV, stride, o + 1, i, u);
      out[o + 2] = this.interp(this.vals, this.tanV, stride, o + 2, i, u);
    }
    for (let c = 0; c < 6; c++) rootOut[c] = this.interp(this.root, this.tanR, 6, c, i, u);
  }

  /** Cumulative root motion at time t: [z, x, y]. */
  motionAt(t: number, out: [number, number, number]): [number, number, number] {
    const m = this.def.move;
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (!m || m.length === 0) return out;
    if (t <= m[0][0]) {
      out[0] = m[0][1];
      out[1] = m[0][2] ?? 0;
      out[2] = m[0][3] ?? 0;
      return out;
    }
    for (let k = 0; k < m.length - 1; k++) {
      const a = m[k];
      const b = m[k + 1];
      if (t <= b[0]) {
        const r = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        // Smooth acceleration inside each segment.
        const s = r * r * (3 - 2 * r);
        out[0] = a[1] + (b[1] - a[1]) * s;
        out[1] = (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * s;
        out[2] = (a[3] ?? 0) + ((b[3] ?? 0) - (a[3] ?? 0)) * s;
        return out;
      }
    }
    const l = m[m.length - 1];
    out[0] = l[1];
    out[1] = l[2] ?? 0;
    out[2] = l[3] ?? 0;
    return out;
  }

  inWindow(name: string, t: number): boolean {
    const w = this.def.win?.[name];
    return !!w && t >= w[0] && t <= w[1];
  }
}
