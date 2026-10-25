import * as THREE from 'three';

export interface BoltOpts {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  /** Ribbon half-width (m). */
  width: number;
  /** Seconds alive (Infinity = until removed). */
  life: number;
  /** Lateral jaggedness as a fraction of length. */
  jag?: number;
  segments?: number;
  /** Number of forked side branches. */
  branches?: number;
  /** Re-randomise the shape every n seconds (flicker). */
  regen?: number;
  /** Overall intensity multiplier. */
  intensity?: number;
  /** Supply the base path yourself (helixes around a moving bolt); jitter is added on top. */
  path?: THREE.Vector3[];
}

interface Strand {
  /** Normalised samples: t along the parent axis, u/v lateral offsets in metres. */
  t: Float32Array;
  u: Float32Array;
  v: Float32Array;
  /** Branch origin parameter on the main strand and direction tilt. */
  at: number;
  width: number;
  len: number;
  tiltU: number;
  tiltV: number;
}

export class LBolt {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  width: number;
  life: number;
  age = 0;
  jag: number;
  segments: number;
  branches: number;
  regen: number;
  intensity: number;
  path: THREE.Vector3[] | null;
  dead = false;
  strands: Strand[] = [];
  private regenT = 0;

  constructor(o: BoltOpts) {
    this.from = o.from.clone();
    this.to = o.to.clone();
    this.color = o.color.clone();
    this.width = o.width;
    this.life = o.life;
    this.jag = o.jag ?? 0.16;
    this.segments = o.segments ?? 14;
    this.branches = o.branches ?? 2;
    this.regen = o.regen ?? 0.05;
    this.intensity = o.intensity ?? 1;
    this.path = o.path ?? null;
    this.reshape();
  }

  reshape(): void {
    const len = this.path ? 1 : this.from.distanceTo(this.to);
    this.strands = [makeStrand(this.segments, this.jag * len, 0, this.width, 1, 0, 0)];
    for (let b = 0; b < this.branches; b++) {
      const at = 0.2 + Math.random() * 0.6;
      this.strands.push(
        makeStrand(Math.max(3, Math.round(this.segments * 0.45)), this.jag * len * 0.5, at, this.width * 0.55, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6),
      );
    }
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
    this.regenT -= dt;
    if (this.regenT <= 0) {
      this.regenT = this.regen;
      this.reshape();
    }
  }

  kill(): void {
    this.dead = true;
  }
}

function makeStrand(n: number, amp: number, at: number, width: number, len: number, tiltU: number, tiltV: number): Strand {
  const t = new Float32Array(n + 1);
  const u = new Float32Array(n + 1);
  const v = new Float32Array(n + 1);
  // Midpoint-style displacement: a few octaves of random offsets, tapered at both ends.
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    t[i] = k;
    const taper = Math.sin(k * Math.PI);
    u[i] = (Math.random() - 0.5) * 2 * amp * taper;
    v[i] = (Math.random() - 0.5) * 2 * amp * taper;
  }
  // Smooth a little so the zigzag reads as a bolt, not noise.
  for (let pass = 0; pass < 1; pass++)
    for (let i = 1; i < n; i++) {
      u[i] = u[i] * 0.6 + (u[i - 1] + u[i + 1]) * 0.2;
      v[i] = v[i] * 0.6 + (v[i - 1] + v[i + 1]) * 0.2;
    }
  if (at === 0) {
    u[0] = v[0] = u[n] = v[n] = 0;
  } else {
    u[0] = v[0] = 0;
  }
  return { t, u, v, at, width, len, tiltU, tiltV };
}

const VERT = /* glsl */ `
  attribute vec2 aUv;
  attribute vec4 aColor;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = aUv;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float y = (vUv.y - 0.5) * 2.0;
    float core = exp(-y * y * 26.0);
    float halo = exp(-y * y * 3.2);
    vec3 c = vColor.rgb * halo * 0.9 + vec3(1.0, 0.98, 0.95) * core * 2.4;
    gl_FragColor = vec4(c * vColor.a, 1.0);
  }
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _bu = new THREE.Vector3();
const _bv = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/**
 * Procedural lightning: jagged forked bolts and jittered paths (helix tendrils, arcs crawling over bodies) built
 * as camera-facing ribbons each frame and drawn in one additive batch with a white-hot core and coloured halo.
 */
export class Lightning {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private uv: Float32Array;
  private col: Float32Array;
  private maxQuads: number;
  readonly bolts: LBolt[] = [];

  constructor(maxQuads = 6000) {
    this.maxQuads = maxQuads;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.uv = new Float32Array(maxQuads * 4 * 2);
    this.col = new Float32Array(maxQuads * 4 * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
  }

  add(o: BoltOpts): LBolt {
    const b = new LBolt(o);
    this.bolts.push(b);
    return b;
  }

  update(dt: number, camera: THREE.Camera): void {
    let q = 0;
    const camPos = camera.position;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.update(dt);
      if (b.dead) {
        this.bolts.splice(i, 1);
        continue;
      }
      // Fade in fast, flicker, fade out at the end of life.
      const lifeK = Number.isFinite(b.life) ? Math.min(1, (b.life - b.age) / Math.min(0.12, b.life * 0.5)) : 1;
      const flick = 0.75 + Math.random() * 0.25;
      const alpha = Math.max(0, lifeK) * flick * b.intensity;
      if (alpha <= 0.001) continue;
      for (const s of b.strands) {
        q = this.emitStrand(b, s, alpha, camPos, q);
        if (q >= this.maxQuads) break;
      }
    }
    this.geo.setDrawRange(0, q * 6);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aUv') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Point on the bolt's base curve at parameter t, with the local lateral frame. */
  private basePoint(b: LBolt, t: number, out: THREE.Vector3): THREE.Vector3 {
    if (b.path && b.path.length > 1) {
      const f = t * (b.path.length - 1);
      const i = Math.min(b.path.length - 2, Math.floor(f));
      return out.copy(b.path[i]).lerp(b.path[i + 1], f - i);
    }
    return out.copy(b.from).lerp(b.to, t);
  }

  private emitStrand(b: LBolt, s: Strand, alpha: number, camPos: THREE.Vector3, q: number): number {
    const n = s.t.length - 1;
    // Axis frame of the whole bolt (paths use the local tangent instead).
    _ax.subVectors(b.to, b.from);
    if (b.path && b.path.length > 1) _ax.subVectors(b.path[b.path.length - 1], b.path[0]);
    if (_ax.lengthSq() < 1e-8) _ax.set(0, 1, 0);
    _ax.normalize();
    _bu.set(0, 1, 0);
    if (Math.abs(_ax.y) > 0.9) _bu.set(1, 0, 0);
    _bv.crossVectors(_ax, _bu).normalize();
    _bu.crossVectors(_bv, _ax).normalize();
    const total = b.path ? 0 : b.from.distanceTo(b.to);
    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;
    for (let i = 0; i <= n; i++) {
      // Position of sample i.
      if (s.at === 0) {
        this.basePoint(b, s.t[i], _p);
      } else {
        // Branch: starts on the main strand at `at`, heads off along the axis tilted sideways.
        this.basePoint(b, s.at, _p);
        const along = s.t[i] * s.len * (total || 1);
        _p.addScaledVector(_ax, along * 0.8).addScaledVector(_bu, along * s.tiltU * 0.6).addScaledVector(_bv, along * s.tiltV * 0.6);
      }
      _p.addScaledVector(_bu, s.u[i]).addScaledVector(_bv, s.v[i]);
      if (i > 0 && q < this.maxQuads) {
        _a.set(prevX, prevY, prevZ);
        _b.copy(_p);
        _q.subVectors(_b, _a);
        _toCam.subVectors(camPos, _a);
        _side.crossVectors(_q, _toCam);
        if (_side.lengthSq() < 1e-10) _side.set(0, 1, 0);
        // Taper the width toward the strand's end (branches thin out).
        const k0 = 1 - ((i - 1) / n) * (s.at === 0 ? 0.25 : 0.85);
        const k1 = 1 - (i / n) * (s.at === 0 ? 0.25 : 0.85);
        _side.normalize();
        const w0 = s.width * k0;
        const w1 = s.width * k1;
        const o = q * 12;
        this.pos[o] = _a.x - _side.x * w0;
        this.pos[o + 1] = _a.y - _side.y * w0;
        this.pos[o + 2] = _a.z - _side.z * w0;
        this.pos[o + 3] = _a.x + _side.x * w0;
        this.pos[o + 4] = _a.y + _side.y * w0;
        this.pos[o + 5] = _a.z + _side.z * w0;
        this.pos[o + 6] = _b.x - _side.x * w1;
        this.pos[o + 7] = _b.y - _side.y * w1;
        this.pos[o + 8] = _b.z - _side.z * w1;
        this.pos[o + 9] = _b.x + _side.x * w1;
        this.pos[o + 10] = _b.y + _side.y * w1;
        this.pos[o + 11] = _b.z + _side.z * w1;
        const u = q * 8;
        this.uv.set([0, 0, 0, 1, 1, 0, 1, 1], u);
        const c = q * 16;
        const a = alpha * (s.at === 0 ? 1 : 0.75);
        for (let v = 0; v < 4; v++) {
          this.col[c + v * 4] = b.color.r;
          this.col[c + v * 4 + 1] = b.color.g;
          this.col[c + v * 4 + 2] = b.color.b;
          this.col[c + v * 4 + 3] = a;
        }
        q++;
      }
      prevX = _p.x;
      prevY = _p.y;
      prevZ = _p.z;
    }
    return q;
  }
}
