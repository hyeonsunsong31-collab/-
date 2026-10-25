import * as THREE from 'three';

interface Trail {
  /** Sampled points (newest last) with their timestamps. */
  pts: THREE.Vector3[];
  times: number[];
  source: () => THREE.Vector3;
  color: THREE.Color;
  width: number;
  /** Seconds a point lives. */
  persist: number;
  active: boolean;
  dead: boolean;
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
    float across = exp(-y * y * 5.0);
    float core = exp(-y * y * 40.0);
    // vUv.x: 0 = oldest tail, 1 = head.
    float tail = pow(vUv.x, 1.6);
    vec3 c = vColor.rgb * across + vec3(1.0) * core * tail * 1.4;
    gl_FragColor = vec4(c * vColor.a * tail, 1.0);
  }
`;

const _side = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/** Swept ribbon trails following fists and feet through strikes (and dash streaks), additive. */
export class Trails {
  readonly mesh: THREE.Mesh;
  private trails: Trail[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private uv: Float32Array;
  private col: Float32Array;
  private maxQuads = 2400;
  private t = 0;

  constructor() {
    const m = this.maxQuads;
    this.pos = new Float32Array(m * 12);
    this.uv = new Float32Array(m * 8);
    this.col = new Float32Array(m * 16);
    const idx = new Uint32Array(m * 6);
    for (let q = 0; q < m; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
  }

  /** Start a trail sampling `source` each frame; returns a stopper. */
  start(source: () => THREE.Vector3, color: THREE.Color, width: number, persist = 0.16): () => void {
    const tr: Trail = { pts: [], times: [], source, color: color.clone(), width, persist, active: true, dead: false };
    this.trails.push(tr);
    return () => {
      tr.active = false;
    };
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    let q = 0;
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      if (tr.active) {
        const p = tr.source();
        const last = tr.pts[tr.pts.length - 1];
        if (!last || last.distanceToSquared(p) > 0.0004) {
          tr.pts.push(p.clone());
          tr.times.push(this.t);
        } else if (last) {
          tr.times[tr.times.length - 1] = this.t;
        }
      }
      while (tr.times.length && this.t - tr.times[0] > tr.persist) {
        tr.times.shift();
        tr.pts.shift();
      }
      if (!tr.active && tr.pts.length < 2) {
        this.trails.splice(i, 1);
        continue;
      }
      const n = tr.pts.length;
      for (let k = 1; k < n && q < this.maxQuads; k++) {
        const a = tr.pts[k - 1];
        const b = tr.pts[k];
        _seg.subVectors(b, a);
        _toCam.subVectors(camera.position, a);
        _side.crossVectors(_seg, _toCam);
        if (_side.lengthSq() < 1e-10) continue;
        _side.normalize();
        const ua = (k - 1) / (n - 1);
        const ub = k / (n - 1);
        const wa = tr.width * (0.25 + ua * 0.75);
        const wb = tr.width * (0.25 + ub * 0.75);
        const o = q * 12;
        this.pos[o] = a.x - _side.x * wa;
        this.pos[o + 1] = a.y - _side.y * wa;
        this.pos[o + 2] = a.z - _side.z * wa;
        this.pos[o + 3] = a.x + _side.x * wa;
        this.pos[o + 4] = a.y + _side.y * wa;
        this.pos[o + 5] = a.z + _side.z * wa;
        this.pos[o + 6] = b.x - _side.x * wb;
        this.pos[o + 7] = b.y - _side.y * wb;
        this.pos[o + 8] = b.z - _side.z * wb;
        this.pos[o + 9] = b.x + _side.x * wb;
        this.pos[o + 10] = b.y + _side.y * wb;
        this.pos[o + 11] = b.z + _side.z * wb;
        this.uv.set([ua, 0, ua, 1, ub, 0, ub, 1], q * 8);
        const c = q * 16;
        for (let v = 0; v < 4; v++) {
          this.col[c + v * 4] = tr.color.r;
          this.col[c + v * 4 + 1] = tr.color.g;
          this.col[c + v * 4 + 2] = tr.color.b;
          this.col[c + v * 4 + 3] = 1;
        }
        q++;
      }
    }
    this.geo.setDrawRange(0, q * 6);
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aUv') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}
