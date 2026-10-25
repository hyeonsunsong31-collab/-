import * as THREE from 'three';

/** Particle sprite shapes rendered by the shared particle shader. */
export const enum Shape {
  Glow = 0,
  Spark = 1,
  Smoke = 2,
  Star = 3,
  Ring = 4,
  Chip = 5,
  Flame = 6,
}

export interface EmitOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  /** Size at end of life (default = size). */
  size1?: number;
  color: THREE.Color;
  /** Colour at end of life (default = color). */
  color1?: THREE.Color;
  alpha?: number;
  gravity?: number;
  /** Exponential velocity damping per second. */
  drag?: number;
  shape?: Shape;
  /** Stretch along screen-space velocity (seconds of travel drawn). 0 = round sprite. */
  stretch?: number;
  rot?: number;
  spin?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Bounce off the ground plane given by `floor` (y). */
  floor?: number;
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iColor;
  attribute vec4 iParams; // size, rotation, stretch, shape
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShape;
  void main() {
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 c = position.xy;
    float size = iParams.x;
    if (iParams.z > 0.0) {
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      // Perspective-correct screen direction of motion.
      vec2 d = vv.xy - mv.xy * (vv.z / min(mv.z, -0.1));
      float l = length(vv.xy);
      vec2 dir = length(d) > 1e-5 ? normalize(d) : vec2(1.0, 0.0);
      float len = size + l * iParams.z;
      mv.xy += dir * c.x * len + vec2(-dir.y, dir.x) * c.y * size;
    } else {
      float cs = cos(iParams.y);
      float sn = sin(iParams.y);
      mv.xy += mat2(cs, sn, -sn, cs) * c * size;
    }
    gl_Position = projectionMatrix * mv;
    vUv = c + 0.5;
    vColor = iColor;
    vShape = iParams.w;
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShape;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    float a;
    vec3 col = vColor.rgb;
    int s = int(vShape + 0.5);
    if (s == 0) {
      // Soft glow with a hot core.
      a = exp(-r2 * 4.0);
      col *= 1.0 + exp(-r2 * 24.0) * 1.5;
    } else if (s == 1) {
      // Spark streak: thin bright line with soft ends.
      float across = exp(-p.y * p.y * 18.0);
      float along = smoothstep(1.0, 0.2, abs(p.x));
      a = across * along;
      col *= 1.0 + exp(-p.y * p.y * 80.0) * 1.2;
    } else if (s == 2) {
      // Smoke / dust puff with noisy edge.
      float n = vnoise(vUv * 5.0 + 3.1) * 0.5 + vnoise(vUv * 11.0) * 0.25;
      a = smoothstep(1.0, 0.25, sqrt(r2) + (n - 0.4) * 0.6);
    } else if (s == 3) {
      // Four-point star glint.
      float cross = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 1.6) + exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 1.6);
      float diag = exp(-abs(p.x + p.y) * 22.0) * exp(-abs(p.x - p.y) * 3.0) + exp(-abs(p.x - p.y) * 22.0) * exp(-abs(p.x + p.y) * 3.0);
      a = cross + diag * 0.35 + exp(-r2 * 30.0) * 1.5;
      col *= 1.0 + exp(-r2 * 40.0);
    } else if (s == 4) {
      // Thin ring.
      float r = sqrt(r2);
      a = exp(-pow((r - 0.8) * 9.0, 2.0)) * smoothstep(1.0, 0.95, r);
    } else if (s == 5) {
      // Debris chip: irregular opaque-ish fragment.
      float n = vnoise(vUv * 3.0 + 7.3);
      a = step(sqrt(r2) + (n - 0.5) * 0.7, 0.75);
    } else {
      // Flame tongue: teardrop with scrolling noise.
      float n = vnoise(vec2(vUv.x * 4.0, vUv.y * 3.0 - vColor.a * 6.0));
      float tear = smoothstep(1.0, 0.0, length(vec2(p.x * (1.3 + p.y * 0.6), (p.y + 0.2) * 0.8)) + (n - 0.5) * 0.7);
      a = tear;
      col *= 0.8 + smoothstep(0.4, 0.9, tear) * 1.2;
    }
    if (a < 0.003) discard;
    // rgb arrives premultiplied by the particle's alpha; alpha drives the over-blend of smoke and chips.
    gl_FragColor = vec4(col * a, a * vColor.a);
  }
`;

/**
 * CPU-simulated, GPU-instanced particles (camera-facing quads, velocity-stretched sparks, glints, rings, smoke,
 * flames and debris chips). One system per blend mode; the pool is a ring buffer so bursts never allocate.
 */
export class Particles {
  readonly mesh: THREE.Mesh;
  private max: number;
  private n = 0;
  // State (structure of arrays).
  private p: Float32Array;
  private v: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private sz: Float32Array;
  private life: Float32Array;
  private age: Float32Array;
  private misc: Float32Array; // gravity, drag, stretch, shape, rot, spin, fadeIn, floor
  private alpha: Float32Array;
  private seed: Float32Array;
  // GPU.
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aParams: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.sz = new Float32Array(max * 2);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.misc = new Float32Array(max * 8);
    this.alpha = new Float32Array(max);
    this.seed = new Float32Array(max);
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iVel', this.aVel);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iParams', this.aParams);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    if (!additive) {
      mat.blendEquation = THREE.AddEquation;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 19;
  }

  get count(): number {
    return this.n;
  }

  emit(o: EmitOpts): void {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else {
      // Replace the oldest-by-ratio particle.
      i = 0;
      let best = -1;
      for (let k = 0; k < this.max; k += 7) {
        const r = this.age[k] / this.life[k];
        if (r > best) {
          best = r;
          i = k;
        }
      }
    }
    const i3 = i * 3;
    this.p[i3] = o.pos.x;
    this.p[i3 + 1] = o.pos.y;
    this.p[i3 + 2] = o.pos.z;
    const v = o.vel;
    this.v[i3] = v ? v.x : 0;
    this.v[i3 + 1] = v ? v.y : 0;
    this.v[i3 + 2] = v ? v.z : 0;
    this.c0[i3] = o.color.r;
    this.c0[i3 + 1] = o.color.g;
    this.c0[i3 + 2] = o.color.b;
    const c1 = o.color1 ?? o.color;
    this.c1[i3] = c1.r;
    this.c1[i3 + 1] = c1.g;
    this.c1[i3 + 2] = c1.b;
    this.sz[i * 2] = o.size;
    this.sz[i * 2 + 1] = o.size1 ?? o.size;
    this.life[i] = Math.max(0.01, o.life);
    this.age[i] = 0;
    const m = i * 8;
    this.misc[m] = o.gravity ?? 0;
    this.misc[m + 1] = o.drag ?? 0;
    this.misc[m + 2] = o.stretch ?? 0;
    this.misc[m + 3] = o.shape ?? Shape.Glow;
    this.misc[m + 4] = o.rot ?? Math.random() * Math.PI * 2;
    this.misc[m + 5] = o.spin ?? 0;
    this.misc[m + 6] = o.fadeIn ?? 0.05;
    this.misc[m + 7] = o.floor ?? -1e9;
    this.alpha[i] = o.alpha ?? 1;
    this.seed[i] = Math.random();
  }

  update(dt: number): void {
    const P = this.p;
    const V = this.v;
    let w = 0;
    const pos = this.aPos.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const par = this.aParams.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const i3 = i * 3;
      const m = i * 8;
      const drag = this.misc[m + 1];
      if (drag > 0) {
        const k = Math.exp(-drag * dt);
        V[i3] *= k;
        V[i3 + 1] *= k;
        V[i3 + 2] *= k;
      }
      V[i3 + 1] -= this.misc[m] * dt;
      P[i3] += V[i3] * dt;
      P[i3 + 1] += V[i3 + 1] * dt;
      P[i3 + 2] += V[i3 + 2] * dt;
      const floor = this.misc[m + 7];
      if (P[i3 + 1] < floor) {
        P[i3 + 1] = floor;
        V[i3 + 1] = Math.abs(V[i3 + 1]) * 0.35;
        V[i3] *= 0.6;
        V[i3 + 2] *= 0.6;
      }
      this.misc[m + 4] += this.misc[m + 5] * dt;
      // Compact live particles to the front.
      if (w !== i) {
        const w3 = w * 3;
        const wm = w * 8;
        P[w3] = P[i3];
        P[w3 + 1] = P[i3 + 1];
        P[w3 + 2] = P[i3 + 2];
        V[w3] = V[i3];
        V[w3 + 1] = V[i3 + 1];
        V[w3 + 2] = V[i3 + 2];
        for (let k = 0; k < 3; k++) {
          this.c0[w3 + k] = this.c0[i3 + k];
          this.c1[w3 + k] = this.c1[i3 + k];
        }
        this.sz[w * 2] = this.sz[i * 2];
        this.sz[w * 2 + 1] = this.sz[i * 2 + 1];
        this.life[w] = this.life[i];
        this.age[w] = this.age[i];
        for (let k = 0; k < 8; k++) this.misc[wm + k] = this.misc[m + k];
        this.alpha[w] = this.alpha[i];
        this.seed[w] = this.seed[i];
      }
      const t = this.age[w] / this.life[w];
      const w3 = w * 3;
      const wm = w * 8;
      pos[w3] = P[w3];
      pos[w3 + 1] = P[w3 + 1];
      pos[w3 + 2] = P[w3 + 2];
      vel[w3] = V[w3];
      vel[w3 + 1] = V[w3 + 1];
      vel[w3 + 2] = V[w3 + 2];
      const fi = this.misc[wm + 6];
      const fade = (fi > 0 ? Math.min(1, t / fi) : 1) * (1 - t) * (1 - t * 0.35);
      const a = this.alpha[w] * fade;
      const w4 = w * 4;
      col[w4] = (this.c0[w3] + (this.c1[w3] - this.c0[w3]) * t) * 1;
      col[w4 + 1] = this.c0[w3 + 1] + (this.c1[w3 + 1] - this.c0[w3 + 1]) * t;
      col[w4 + 2] = this.c0[w3 + 2] + (this.c1[w3 + 2] - this.c0[w3 + 2]) * t;
      // Alpha channel carries alpha; shapes that need a per-particle seed fold it into the fractional part.
      col[w4 + 3] = Math.max(0.0001, a);
      const size = this.sz[w * 2] + (this.sz[w * 2 + 1] - this.sz[w * 2]) * t;
      par[w4] = size;
      par[w4 + 1] = this.misc[wm + 4];
      par[w4 + 2] = this.misc[wm + 2];
      par[w4 + 3] = this.misc[wm + 3];
      w++;
    }
    // Premultiply colour by alpha in the shader via a (we pass alpha in .a and multiply rgb there).
    for (let i = 0; i < w; i++) {
      const i4 = i * 4;
      const a = col[i4 + 3];
      col[i4] *= a;
      col[i4 + 1] *= a;
      col[i4 + 2] *= a;
    }
    this.n = w;
    this.geo.instanceCount = w;
    this.aPos.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aParams.needsUpdate = true;
    this.aPos.addUpdateRange(0, w * 3);
    this.aVel.addUpdateRange(0, w * 3);
    this.aColor.addUpdateRange(0, w * 4);
    this.aParams.addUpdateRange(0, w * 4);
  }
}
