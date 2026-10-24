import * as THREE from 'three';
import type { RigInstance } from '../character/Rig.ts';
import { UPPER_BODY, BONES } from '../character/Rig.ts';
import { CompiledClip, NB } from './Clip.ts';
import { semanticToQuat } from './Pose.ts';

export type Layer = 'action' | 'overlay';

export interface PlayOpts {
  fadeIn?: number;
  fadeOut?: number;
  speed?: number;
  /** 'upper' restricts the clip to upper-body bones; 'auto' uses the bones the clip defines. */
  mask?: 'full' | 'upper' | 'auto';
  layer?: Layer;
  /** Keep the last frame instead of fading out when a one-shot finishes. */
  hold?: boolean;
  start?: number;
}

export interface ActionHandle {
  clip: CompiledClip;
  time: number;
  speed: number;
  weight: number;
  target: number;
  fadeIn: number;
  fadeOut: number;
  mask: Uint8Array;
  hold: boolean;
  layer: Layer;
  done: boolean;
  /** Set when a one-shot reached its end. */
  ended: boolean;
}

interface LocoEntry {
  clip: CompiledClip;
  w: number;
  target: number;
  sync: boolean;
  time: number;
  rate: number;
}

export type AnimEventFn = (clip: string, name: string, data?: Record<string, unknown>) => void;

const UPPER_MASK = new Uint8Array(NB);
BONES.forEach((b, i) => (UPPER_MASK[i] = UPPER_BODY.has(b) ? 1 : 0));

/**
 * Layered pose blender working in semantic joint space:
 *   locomotion blend space (phase-synced cycles) → action layer (crossfaded one-shots/loops, optional mask)
 *   → overlay layer (e.g. guard on the upper body) → additive procedural offsets → quaternions on the rig.
 */
export class Animator {
  private clips: Map<string, CompiledClip>;
  private loco = new Map<string, LocoEntry>();
  private phase = 0;
  private actions: ActionHandle[] = [];
  private tmp = new Float32Array(NB * 3);
  private tmpRoot = new Float32Array(6);
  private acc = new Float32Array(NB * 3);
  private accRoot = new Float32Array(6);
  private q = new THREE.Quaternion();
  /** Additive semantic offsets, cleared after every evaluate. */
  readonly additive = new Float32Array(NB * 3);
  readonly additiveRoot = new Float32Array(6);
  /** Final blended root transform [x,y,z,rx,ry,rz]. */
  readonly root = new Float32Array(6);
  /** Final semantic pose (degrees) after blending — useful for tests / IK. */
  readonly pose = new Float32Array(NB * 3);
  private listeners: AnimEventFn[] = [];
  locoRate = 1;

  constructor(
    private rig: RigInstance,
    clips: Map<string, CompiledClip>,
  ) {
    this.clips = clips;
  }

  clip(name: string): CompiledClip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`Unknown clip ${name}`);
    return c;
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  onEvent(fn: AnimEventFn): void {
    this.listeners.push(fn);
  }

  private emit(clip: CompiledClip, from: number, to: number): void {
    const evs = clip.def.events;
    if (!evs || to <= from) return;
    for (const e of evs) if (e.t > from && e.t <= to) for (const fn of this.listeners) fn(clip.name, e.name, e.data);
  }

  /** Set locomotion targets: names → target weights. Unlisted entries fade to 0. */
  setLoco(targets: Record<string, number>, blendTime = 0.18, syncNames?: Set<string>): void {
    for (const [name, w] of Object.entries(targets)) {
      let e = this.loco.get(name);
      if (!e) {
        const clip = this.clip(name);
        e = { clip, w: 0, target: 0, sync: syncNames ? syncNames.has(name) : !!clip.def.speed, time: 0, rate: 1 };
        this.loco.set(name, e);
      }
      e.target = w;
    }
    for (const [name, e] of this.loco) if (!(name in targets)) e.target = 0;
    this.blendTime = blendTime;
  }

  private blendTime = 0.18;

  setLocoRate(name: string, rate: number): void {
    const e = this.loco.get(name);
    if (e) e.rate = rate;
  }

  /** Normalized phase of the synced locomotion cycle (0..1) — used for footstep timing and gallery. */
  get locoPhase(): number {
    return this.phase;
  }

  set locoPhase(v: number) {
    this.phase = v;
  }

  play(name: string, opts: PlayOpts = {}): ActionHandle {
    const clip = this.clip(name);
    const layer = opts.layer ?? 'action';
    for (const a of this.actions) {
      if (a.layer === layer && !a.done) {
        a.target = 0;
        a.fadeOut = Math.max(0.03, opts.fadeIn ?? 0.1);
      }
    }
    let mask: Uint8Array;
    if (opts.mask === 'upper') mask = UPPER_MASK;
    else if (opts.mask === 'auto') mask = clip.mask;
    else mask = new Uint8Array(NB).fill(1);
    const h: ActionHandle = {
      clip,
      time: opts.start ?? 0,
      speed: opts.speed ?? clip.def.rate ?? 1,
      weight: (opts.fadeIn ?? 0.1) <= 0 ? 1 : 0,
      target: 1,
      fadeIn: Math.max(0.0001, opts.fadeIn ?? 0.1),
      fadeOut: opts.fadeOut ?? 0.15,
      mask,
      hold: !!opts.hold,
      layer,
      done: false,
      ended: false,
    };
    this.actions.push(h);
    return h;
  }

  /** Fade out everything on a layer. */
  stop(layer: Layer = 'action', fade = 0.15): void {
    for (const a of this.actions) {
      if (a.layer === layer) {
        a.target = 0;
        a.fadeOut = Math.max(0.01, fade);
      }
    }
  }

  current(layer: Layer = 'action'): ActionHandle | null {
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const a = this.actions[i];
      if (a.layer === layer && a.target > 0 && !a.done) return a;
    }
    return null;
  }

  isPlaying(name: string): boolean {
    return this.actions.some((a) => a.clip.name === name && a.target > 0 && !a.done);
  }

  update(dt: number): void {
    const lerpW = (cur: number, target: number, time: number) => {
      if (time <= 0) return target;
      const step = dt / time;
      return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    };

    // ---- Locomotion ----
    let wsum = 0;
    let freq = 0;
    for (const e of this.loco.values()) {
      e.w = lerpW(e.w, e.target, this.blendTime);
      if (e.sync && e.w > 0) {
        freq += (e.w / e.clip.dur) * e.rate;
        wsum += e.w;
      }
    }
    const prevPhase = this.phase;
    if (wsum > 0) this.phase = (this.phase + (dt * this.locoRate * freq) / wsum) % 1;
    this.acc.fill(0);
    this.accRoot.fill(0);
    let total = 0;
    for (const [name, e] of this.loco) {
      if (e.w <= 0.0001) {
        if (e.target === 0) this.loco.delete(name);
        continue;
      }
      const prevT = e.time;
      if (e.sync) {
        e.time = this.phase * e.clip.dur;
        const pt = prevPhase * e.clip.dur;
        if (e.time >= pt) this.emit(e.clip, pt, e.time);
        else {
          this.emit(e.clip, pt, e.clip.dur);
          this.emit(e.clip, -1e-6, e.time);
        }
      } else {
        e.time += dt * e.rate * this.locoRate;
        if (e.clip.loop && e.time > e.clip.dur) {
          this.emit(e.clip, prevT, e.clip.dur);
          e.time %= e.clip.dur;
          this.emit(e.clip, -1e-6, e.time);
        } else this.emit(e.clip, prevT, e.time);
      }
      e.clip.sample(e.time, this.tmp, this.tmpRoot);
      for (let i = 0; i < NB * 3; i++) this.acc[i] += this.tmp[i] * e.w;
      for (let c = 0; c < 6; c++) this.accRoot[c] += this.tmpRoot[c] * e.w;
      total += e.w;
    }
    if (total > 0) {
      for (let i = 0; i < NB * 3; i++) this.acc[i] /= total;
      for (let c = 0; c < 6; c++) this.accRoot[c] /= total;
    } else {
      // No locomotion: bind pose with arms down.
      for (let i = 0; i < NB; i++) if (BONES[i].startsWith('upperArm')) this.acc[i * 3 + 2] = 90;
    }

    // ---- Action + overlay layers (in insertion order, overlay last) ----
    const ordered = [...this.actions.filter((a) => a.layer === 'action'), ...this.actions.filter((a) => a.layer === 'overlay')];
    for (const a of ordered) {
      if (a.target > a.weight) a.weight = lerpW(a.weight, a.target, a.fadeIn);
      else a.weight = lerpW(a.weight, a.target, a.fadeOut);
      const prevT = a.time;
      a.time += dt * a.speed;
      const c = a.clip;
      if (c.loop) {
        if (a.time > c.dur) {
          this.emit(c, prevT, c.dur);
          a.time %= c.dur;
          this.emit(c, -1e-6, a.time);
        } else this.emit(c, prevT, a.time);
      } else {
        this.emit(c, prevT, Math.min(a.time, c.dur));
        if (a.time >= c.dur) {
          a.time = c.dur;
          if (!a.ended) {
            a.ended = true;
            if (!a.hold) a.target = 0;
          }
        }
      }
      if (a.weight <= 0.0001 && a.target === 0) {
        a.done = true;
        continue;
      }
      c.sample(a.time, this.tmp, this.tmpRoot);
      const w = a.weight;
      for (let i = 0; i < NB; i++) {
        if (!a.mask[i]) continue;
        const o = i * 3;
        this.acc[o] += (this.tmp[o] - this.acc[o]) * w;
        this.acc[o + 1] += (this.tmp[o + 1] - this.acc[o + 1]) * w;
        this.acc[o + 2] += (this.tmp[o + 2] - this.acc[o + 2]) * w;
      }
      if (c.hasRoot && a.mask !== UPPER_MASK) {
        for (let k = 0; k < 3; k++) this.accRoot[k] += (this.tmpRoot[k] - this.accRoot[k]) * w;
        // Rotations blend along the shortest arc so spins/flips (e.g. -360°) fade out without unwinding.
        for (let k = 3; k < 6; k++) {
          let d = (this.tmpRoot[k] - this.accRoot[k]) % 360;
          if (d > 180) d -= 360;
          else if (d < -180) d += 360;
          this.accRoot[k] += d * w;
        }
      }
    }
    this.actions = this.actions.filter((a) => !a.done);

    // ---- Additive procedural ----
    for (let i = 0; i < NB * 3; i++) {
      this.pose[i] = this.acc[i] + this.additive[i];
      this.additive[i] = 0;
    }
    for (let c = 0; c < 6; c++) {
      this.root[c] = this.accRoot[c] + this.additiveRoot[c];
      this.additiveRoot[c] = 0;
    }
    this.apply();
  }

  /** Write the semantic pose into bone quaternions. */
  apply(): void {
    const { bones, restLocal } = this.rig;
    for (let i = 0; i < NB; i++) {
      const o = i * 3;
      semanticToQuat(i, this.pose[o], this.pose[o + 1], this.pose[o + 2], this.q);
      bones[i].quaternion.copy(restLocal[i]).multiply(this.q);
    }
  }

  /** Directly evaluate one clip at a time (gallery / tests). */
  evaluateClip(name: string, t: number): void {
    const c = this.clip(name);
    c.sample(t, this.pose, this.root);
    this.apply();
  }
}
