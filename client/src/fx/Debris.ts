import * as THREE from 'three';
import type { Lighting } from '../render/Lighting.ts';
import type { World } from '../world/World.ts';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/**
 * Physical rubble: instanced, lit rock chunks thrown by craters, slams and explosions. They tumble, bounce off the
 * heightfield with friction, settle, then sink and shrink away.
 */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private max: number;
  private n = 0;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private s: Float32Array;
  private life: Float32Array;
  private age: Float32Array;

  constructor(
    lighting: Lighting,
    private world: World | null,
    max = 360,
  ) {
    this.max = max;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    // Chip the sphere into an angular rock.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 0.72 + (Math.sin(x * 12.9 + y * 78.2 + z * 37.7) * 0.5 + 0.5) * 0.45;
      pos.setXYZ(i, x * k, y * k * 0.78, z * k);
    }
    geo.computeVertexNormals();
    const mat = lighting.register(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), undefined, 'debris');
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color('#888'));
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.w = new Float32Array(max * 3);
    this.s = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
  }

  /** Burst of chunks from `pos` with outward/upward speed. */
  burst(pos: THREE.Vector3, count: number, speed: number, size: number, color: THREE.ColorRepresentation, up = 1): void {
    const base = new THREE.Color(color);
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      let i = this.n;
      if (i >= this.max) {
        // Recycle the oldest.
        i = 0;
        let best = -1;
        for (let j = 0; j < this.max; j++) {
          const r = this.age[j] / this.life[j];
          if (r > best) {
            best = r;
            i = j;
          }
        }
      } else this.n++;
      const a = Math.random() * Math.PI * 2;
      const h = (0.35 + Math.random() * 0.9) * up;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.p.set([pos.x + Math.cos(a) * 0.4, pos.y + 0.2, pos.z + Math.sin(a) * 0.4], i * 3);
      this.v.set([Math.cos(a) * sp, sp * h + 2, Math.sin(a) * sp], i * 3);
      this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.w.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14], i * 3);
      this.s[i] = size * (0.35 + Math.random() * Math.random() * 1.3);
      this.life[i] = 3 + Math.random() * 2.5;
      this.age[i] = 0;
      c.copy(base).multiplyScalar(0.7 + Math.random() * 0.5);
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      const i3 = i * 3;
      const P = this.p;
      const V = this.v;
      if (t < 1) {
        V[i3 + 1] -= 26 * dt;
        P[i3] += V[i3] * dt;
        P[i3 + 1] += V[i3 + 1] * dt;
        P[i3 + 2] += V[i3 + 2] * dt;
        const g = this.world ? this.world.terrainHeight(P[i3], P[i3 + 2]) : 0;
        const rad = this.s[i] * 0.6;
        if (P[i3 + 1] - rad < g) {
          P[i3 + 1] = g + rad;
          if (V[i3 + 1] < 0) V[i3 + 1] = -V[i3 + 1] * 0.28;
          V[i3] *= 0.62;
          V[i3 + 2] *= 0.62;
          for (let k = 0; k < 3; k++) this.w[i3 + k] *= 0.6;
          if (Math.abs(V[i3 + 1]) < 0.6) V[i3 + 1] = 0;
        }
        for (let k = 0; k < 3; k++) this.r[i3 + k] += this.w[i3 + k] * dt;
        any = true;
      }
      const shrink = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
      _s.setScalar(this.s[i] * shrink);
      _e.set(this.r[i3], this.r[i3 + 1], this.r[i3 + 2]);
      _q.setFromEuler(_e);
      _m.compose(_t.set(this.p[i3], this.p[i3 + 1] - (1 - shrink) * this.s[i], this.p[i3 + 2]), _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    // Trim fully dead tail.
    while (this.n > 0 && this.age[this.n - 1] >= this.life[this.n - 1]) this.n--;
    this.mesh.count = this.n;
    if (any || this.n) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _t = new THREE.Vector3();
