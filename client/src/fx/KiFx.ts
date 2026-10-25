import * as THREE from 'three';
import type { Bolt, Beam } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';
import { Shape, type Particles } from './Particles.ts';
import type { Lightning, LBolt } from './Lightning.ts';
import type { Shockwaves } from './Shockwaves.ts';
import type { World } from '../world/World.ts';

const CAPSULE_VERT = /* glsl */ `
  uniform vec3 uA;
  uniform vec3 uB;
  uniform float uR;
  varying vec2 vUv;
  void main() {
    // Camera-facing capsule billboard from uA (tail) to uB (head).
    vec3 axis = uB - uA;
    float len = length(axis);
    vec3 dir = len > 1e-5 ? axis / len : vec3(0.0, 0.0, 1.0);
    vec3 mid = (uA + uB) * 0.5;
    vec3 toCam = normalize(cameraPosition - mid);
    vec3 side = normalize(cross(dir, toCam));
    // position.x in [-0.5, 0.5] along, position.y across.
    vec3 p = mid + dir * position.x * (len + uR * 2.0) + side * position.y * uR * 2.0;
    vUv = position.xy + 0.5;
    vUv.x = vUv.x * (len + uR * 2.0) / max(uR * 2.0, 1e-4);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const CAPSULE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uT;
  uniform float uLenU;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // Distance to the capsule's centre line in radius units (x measured in radii from the tail end).
    float L = uLenU;
    float x = clamp(vUv.x, 0.5, L - 0.5);
    vec2 d = vec2(vUv.x - x, vUv.y - 0.5) * 2.0;
    float r = length(d);
    // Tail thins out: k = 0 at the tail, 1 at the head.
    float k = clamp((vUv.x - 0.5) / max(L - 1.0, 0.001), 0.0, 1.0);
    float thick = mix(0.35, 1.0, pow(k, 0.6));
    float n = vnoise(vec2(vUv.x * 1.6 - uT * 18.0, vUv.y * 4.0)) * 0.5 + vnoise(vec2(vUv.x * 4.0 - uT * 31.0, vUv.y * 9.0)) * 0.3;
    float rr = r / thick;
    float core = smoothstep(0.34, 0.0, rr + (n - 0.4) * 0.15);
    float glow = exp(-rr * rr * 2.2) * (0.75 + n * 0.5);
    vec3 c = uColor * glow * 1.3 + vec3(1.0, 0.99, 0.96) * core * 2.6;
    float a = max(glow, core) * uAlpha * (0.35 + 0.65 * k);
    if (a < 0.003) discard;
    gl_FragColor = vec4(c * a, 1.0);
  }
`;

const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uT;
  uniform float uLen;
  uniform float uCore;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));
    // Cylinder uv: x around, y along (0 = muzzle, 1 = end).
    float along = vUv.y * uLen;
    float n = vnoise(vec2(vUv.x * 10.0, along * 0.9 - uT * 42.0)) * 0.55 + vnoise(vec2(vUv.x * 24.0, along * 2.3 - uT * 70.0)) * 0.3;
    // Glow layer falls off toward the silhouette; core layer is a crisp white-hot rod.
    float body = mix(pow(facing, 1.4) * 0.8, pow(facing, 2.0), uCore);
    float streak = smoothstep(0.55, 0.95, n);
    vec3 c = mix(uColor * (0.8 + n * 0.8), vec3(1.0, 0.99, 0.96) * 2.6, uCore * smoothstep(0.35, 0.9, facing));
    c += vec3(1.0) * streak * 0.8 * (1.0 - uCore);
    // Bulge pulses travelling down the beam.
    float pulse = 0.85 + 0.15 * sin(along * 1.3 - uT * 30.0);
    float a = body * uAlpha * pulse * smoothstep(0.0, 0.02, vUv.y) * (0.75 + n * 0.5);
    if (a < 0.003) discard;
    gl_FragColor = vec4(c * a, 1.0);
  }
`;

interface BoltVis {
  bolt: Bolt;
  capsule: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  tendrils: LBolt[];
  paths: THREE.Vector3[][];
  t: number;
  phase: number;
  lastTrail: THREE.Vector3;
}

interface BeamVis {
  beam: Beam;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  coreMat: THREE.ShaderMaterial;
  glowMat: THREE.ShaderMaterial;
  helix: LBolt[];
  helixPaths: THREE.Vector3[][];
  dragons: LBolt[];
  dragonPaths: THREE.Vector3[][];
  t: number;
  fx: number;
  ending: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const SMOKE = new THREE.Color('#5d5852');

function frame(dir: THREE.Vector3, u: THREE.Vector3, w: THREE.Vector3): void {
  u.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) u.set(1, 0, 0);
  w.crossVectors(dir, u).normalize();
  u.crossVectors(w, dir).normalize();
}

/**
 * Ki visuals: the thick, dense electric ki bolt (white-hot capsule core, coloured glow, spiralling forked
 * lightning tendrils, plasma head, spark spray, afterglow), its electric impact (flash, shock rings, radial arcs,
 * arcs grounding into the terrain, arcs crawling over the victim, smoke), and beams / the Ultimate (noise-scrolled
 * core + glow cylinders, lightning helix, coiling thunder-dragons, muzzle flare, boiling end explosion).
 */
export class KiFx {
  readonly group = new THREE.Group();
  private bolts: BoltVis[] = [];
  private beams: BeamVis[] = [];
  private quad = new THREE.PlaneGeometry(1, 1);
  private cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 24, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private t = 0;

  constructor(
    private add: Particles,
    private alpha: Particles,
    private lightning: Lightning,
    private waves: Shockwaves,
    private world: World | null,
    private quality = 1,
  ) {}

  /* ------------------------------------------------------------------ bolts */

  spawnBolt(b: Bolt): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: b.pos.clone() },
        uB: { value: b.pos.clone() },
        uR: { value: 0.32 * b.scale },
        uColor: { value: b.color.clone().multiplyScalar(1.9) },
        uAlpha: { value: 1 },
        uT: { value: 0 },
        uLenU: { value: 2 },
      },
      vertexShader: CAPSULE_VERT,
      fragmentShader: CAPSULE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const capsule = new THREE.Mesh(this.quad, mat);
    capsule.frustumCulled = false;
    capsule.renderOrder = 22;
    this.group.add(capsule);
    const tendrils: LBolt[] = [];
    const paths: THREE.Vector3[][] = [];
    for (let i = 0; i < 3; i++) {
      const path = Array.from({ length: 10 }, () => b.pos.clone());
      paths.push(path);
      tendrils.push(
        this.lightning.add({ from: b.pos, to: b.pos, path, color: b.color.clone().lerp(WHITE, 0.25).multiplyScalar(1.4), width: 0.05 * b.scale, life: Infinity, jag: 0.08, segments: 12, branches: 1, regen: 0.04, intensity: 1.1 }),
      );
    }
    // Muzzle flash at the hand.
    this.add.emit({ pos: b.pos, life: 0.12, size: 1.1 * b.scale, size1: 0.2, color: _c.copy(b.color).multiplyScalar(3), shape: Shape.Glow });
    this.add.emit({ pos: b.pos, life: 0.1, size: 1.4 * b.scale, size1: 0.6, color: WHITE.clone().multiplyScalar(2.5), shape: Shape.Star, rot: Math.random() });
    this.bolts.push({ bolt: b, capsule, mat, tendrils, paths, t: 0, phase: Math.random() * 6, lastTrail: b.pos.clone() });
  }

  impactBolt(b: Bolt, pos: THREE.Vector3, normal: THREE.Vector3, target: Combatant | null): void {
    const vis = this.bolts.find((x) => x.bolt === b);
    if (vis) this.removeBolt(vis);
    const s = b.scale;
    const col = _c.copy(b.color);
    // Flash + plasma bloom.
    this.add.emit({ pos, life: 0.16, size: 4.2 * s, size1: 1.2, color: WHITE.clone().multiplyScalar(3), shape: Shape.Glow });
    this.add.emit({ pos, life: 0.22, size: 3.2 * s, size1: 5 * s, color: col.clone().multiplyScalar(2.2), shape: Shape.Glow });
    this.add.emit({ pos, life: 0.14, size: 4 * s, size1: 2, color: WHITE.clone().multiplyScalar(2), shape: Shape.Star, rot: Math.random() * 3 });
    this.waves.air(pos, normal, 2.6 * s, col.clone().multiplyScalar(1.5), 0.3, 1, 0.07);
    this.waves.shell(pos, 1.8 * s, col.clone().multiplyScalar(1.2), 0.25, 0.8);
    // Spark spray.
    const n = Math.round(22 * this.quality);
    for (let i = 0; i < n; i++) {
      const d = _v.randomDirection().addScaledVector(normal, 0.8).normalize();
      this.add.emit({ pos, vel: d.multiplyScalar(9 + Math.random() * 16), life: 0.25 + Math.random() * 0.3, size: 0.05 * s, color: col.clone().lerp(WHITE, 0.5).multiplyScalar(3), shape: Shape.Spark, stretch: 0.035, drag: 2.5, gravity: 9 });
    }
    // Radial electric arcs.
    for (let i = 0; i < 5; i++) {
      const to = _v.randomDirection().addScaledVector(normal, 0.5).normalize().multiplyScalar(1.4 + Math.random() * 1.6).add(pos);
      this.lightning.add({ from: pos, to, color: col.clone().multiplyScalar(1.6), width: 0.05 * s, life: 0.12 + Math.random() * 0.14, jag: 0.22, segments: 9, branches: 1, regen: 0.03 });
    }
    // Arcs grounding into the terrain.
    if (this.world) {
      const g = this.world.terrainHeight(pos.x, pos.z);
      if (pos.y - g < 4) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 1 + Math.random() * 2.2;
          const gx = pos.x + Math.cos(a) * r;
          const gz = pos.z + Math.sin(a) * r;
          this.lightning.add({ from: pos, to: new THREE.Vector3(gx, this.world.terrainHeight(gx, gz), gz), color: col.clone().multiplyScalar(1.5), width: 0.045 * s, life: 0.18 + Math.random() * 0.12, jag: 0.18, segments: 10, branches: 1, regen: 0.04 });
        }
        if (pos.y - g < 1.2) this.waves.ground(new THREE.Vector3(pos.x, g, pos.z), 3 * s, col.clone(), 0.4, 0.8);
      }
    }
    // Arcs crawling over the victim's body for a moment.
    if (target) this.crawl(target, col, 0.45, 4);
    // Smoke.
    for (let i = 0; i < 4; i++) {
      this.alpha.emit({ pos: _v.copy(pos).add(_v2.randomDirection().multiplyScalar(0.4)), vel: _v2.randomDirection().multiplyScalar(1.2).setY(1.4), life: 0.9 + Math.random() * 0.6, size: 0.9 * s, size1: 2.4 * s, color: SMOKE, alpha: 0.45, shape: Shape.Smoke, drag: 1.5 });
    }
  }

  /** Short-lived arcs between random points on a fighter's body. */
  crawl(target: Combatant, color: THREE.Color, dur: number, count: number): void {
    const ch = target.char;
    const bones = ['head', 'chest', 'hips', 'handL', 'handR', 'footL', 'footR', 'upperArmL', 'upperArmR', 'thighL', 'thighR'] as const;
    for (let i = 0; i < count; i++) {
      const a = ch.boneWorld(bones[Math.floor(Math.random() * bones.length)], new THREE.Vector3());
      const b = ch.boneWorld(bones[Math.floor(Math.random() * bones.length)], new THREE.Vector3());
      if (a.distanceTo(b) < 0.2) continue;
      this.lightning.add({ from: a, to: b, color: color.clone().multiplyScalar(1.5), width: 0.03, life: dur * (0.4 + Math.random() * 0.6), jag: 0.25, segments: 8, branches: 0, regen: 0.03 });
    }
  }

  private removeBolt(v: BoltVis): void {
    this.group.remove(v.capsule);
    v.mat.dispose();
    for (const t of v.tendrils) t.kill();
    this.bolts.splice(this.bolts.indexOf(v), 1);
  }

  /* ------------------------------------------------------------------ beams */

  startBeam(b: Beam): void {
    const mk = (core: number) =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: b.color.clone().multiplyScalar(core ? 2 : 1.3) }, uAlpha: { value: 0 }, uT: { value: 0 }, uLen: { value: 10 }, uCore: { value: core } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    const coreMat = mk(1);
    const glowMat = mk(0);
    const core = new THREE.Mesh(this.cyl, coreMat);
    const glow = new THREE.Mesh(this.cyl, glowMat);
    for (const m of [core, glow]) {
      m.frustumCulled = false;
      m.renderOrder = 22;
      this.group.add(m);
    }
    const helix: LBolt[] = [];
    const helixPaths: THREE.Vector3[][] = [];
    for (let i = 0; i < (b.ultimate ? 3 : 2); i++) {
      const path = Array.from({ length: 48 }, () => b.origin.clone());
      helixPaths.push(path);
      helix.push(this.lightning.add({ from: b.origin, to: b.origin, path, color: b.color.clone().lerp(WHITE, 0.2).multiplyScalar(1.5), width: (b.ultimate ? 0.09 : 0.06), life: Infinity, jag: 0.012, segments: 60, branches: 3, regen: 0.04 }));
    }
    const dragons: LBolt[] = [];
    const dragonPaths: THREE.Vector3[][] = [];
    if (b.ultimate) {
      for (let i = 0; i < 2; i++) {
        const path = Array.from({ length: 64 }, () => b.origin.clone());
        dragonPaths.push(path);
        dragons.push(this.lightning.add({ from: b.origin, to: b.origin, path, color: new THREE.Color(i ? '#ffc94a' : '#5fc8ff').multiplyScalar(1.25), width: 0.16, life: Infinity, jag: 0.004, segments: 80, branches: 5, regen: 0.05 }));
      }
    }
    this.waves.air(b.origin, b.dir, b.radius * 4, b.color.clone().multiplyScalar(1.6), 0.4, 1, 0.08);
    this.waves.shell(b.origin, b.radius * 3, WHITE.clone().multiplyScalar(1.5), 0.25, 1);
    this.beams.push({ beam: b, core, glow, coreMat, glowMat, helix, helixPaths, dragons, dragonPaths, t: 0, fx: 0, ending: -1 });
  }

  endBeam(b: Beam): void {
    const v = this.beams.find((x) => x.beam === b);
    if (v && v.ending < 0) v.ending = 0;
  }

  private removeBeam(v: BeamVis): void {
    for (const m of [v.core, v.glow]) this.group.remove(m);
    v.coreMat.dispose();
    v.glowMat.dispose();
    for (const h of [...v.helix, ...v.dragons]) h.kill();
    this.beams.splice(this.beams.indexOf(v), 1);
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    this.t += dt;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const v = this.bolts[i];
      const b = v.bolt;
      if (b.dead) {
        this.removeBolt(v);
        continue;
      }
      v.t += dt;
      const dir = _v.copy(b.vel).normalize();
      const len = Math.min(2.4 * b.scale, 0.3 + v.t * 40);
      const tail = _v2.copy(b.pos).addScaledVector(dir, -len);
      v.mat.uniforms.uA.value.copy(tail);
      v.mat.uniforms.uB.value.copy(b.pos);
      v.mat.uniforms.uT.value = this.t;
      v.mat.uniforms.uLenU.value = (len + 0.64 * b.scale) / (0.64 * b.scale);
      // Spiral tendrils hugging the bolt.
      frame(dir, _u, _w);
      for (let k = 0; k < v.paths.length; k++) {
        const path = v.paths[k];
        const ph = v.phase + k * ((Math.PI * 2) / v.paths.length) + this.t * 26;
        for (let j = 0; j < path.length; j++) {
          const f = j / (path.length - 1);
          const r = (0.42 + 0.12 * Math.sin(f * 9 + this.t * 40)) * b.scale * (0.5 + f * 0.6);
          const a = ph + f * 5.5;
          path[j].copy(tail).addScaledVector(dir, len * 1.1 * f).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_w, Math.sin(a) * r);
        }
      }
      // Plasma head and spark spray.
      this.add.emit({ pos: b.pos, life: 0.05, size: 1.25 * b.scale, color: _c.copy(b.color).multiplyScalar(2.4), shape: Shape.Glow });
      if (Math.random() < 0.8 * this.quality) {
        const sd = _w.clone().multiplyScalar(Math.random() - 0.5).addScaledVector(_u, Math.random() - 0.5).normalize();
        this.add.emit({ pos: b.pos, vel: sd.multiplyScalar(6 + Math.random() * 8).addScaledVector(dir, -10), life: 0.18, size: 0.035, color: _c.copy(b.color).lerp(WHITE, 0.5).multiplyScalar(3), shape: Shape.Spark, stretch: 0.03, drag: 3 });
      }
      // Afterglow trail.
      if (v.lastTrail.distanceToSquared(b.pos) > 0.6) {
        this.add.emit({ pos: b.pos, life: 0.3, size: 0.55 * b.scale, size1: 0.05, color: _c.copy(b.color).multiplyScalar(1.2), shape: Shape.Glow });
        v.lastTrail.copy(b.pos);
      }
      // Occasional fork lashing out.
      if (Math.random() < dt * 12) {
        const to = _v2.randomDirection().multiplyScalar(0.8 + Math.random() * 1.2).add(b.pos);
        this.lightning.add({ from: b.pos, to, color: _c.copy(b.color).multiplyScalar(1.6), width: 0.03 * b.scale, life: 0.06, jag: 0.25, segments: 6, branches: 0 });
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const v = this.beams[i];
      const b = v.beam;
      v.t += dt;
      let alpha = Math.min(1, v.t / 0.08);
      if (v.ending >= 0) {
        v.ending += dt;
        alpha *= Math.max(0, 1 - v.ending / 0.25);
        if (v.ending > 0.25) {
          this.removeBeam(v);
          continue;
        }
      }
      const len = Math.max(0.5, b.origin.distanceTo(b.end));
      const throb = 1 + Math.sin(this.t * 38) * 0.06 + Math.sin(this.t * 13) * 0.05;
      const grow = Math.min(1, v.t / 0.12);
      for (const [m, rk] of [
        [v.core, 0.42],
        [v.glow, 1.0],
      ] as const) {
        m.position.copy(b.origin);
        m.lookAt(_v.copy(b.origin).add(b.dir));
        m.scale.set(b.radius * rk * throb * grow, b.radius * rk * throb * grow, len);
      }
      for (const mat of [v.coreMat, v.glowMat]) {
        mat.uniforms.uAlpha.value = alpha;
        mat.uniforms.uT.value = this.t;
        mat.uniforms.uLen.value = len;
      }
      // Lightning helix around the beam.
      frame(b.dir, _u, _w);
      v.helixPaths.forEach((path, k) => {
        const ph = k * ((Math.PI * 2) / v.helixPaths.length) - this.t * 16;
        for (let j = 0; j < path.length; j++) {
          const f = j / (path.length - 1);
          const r = b.radius * (1.25 + 0.25 * Math.sin(f * 30 + this.t * 20));
          const a = ph + f * len * 0.55;
          path[j].copy(b.origin).addScaledVector(b.dir, len * f).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_w, Math.sin(a) * r);
        }
      });
      for (const h of v.helix) h.intensity = alpha;
      // Ultimate: two thunder-dragons coil around the beam toward the target.
      v.dragonPaths.forEach((path, k) => {
        const ph = k * Math.PI + this.t * 3;
        const reach = Math.min(1, v.t / 0.6);
        for (let j = 0; j < path.length; j++) {
          const f = (j / (path.length - 1)) * reach;
          const r = b.radius * (2.4 + Math.sin(f * 7 + this.t * 4 + k) * 0.9);
          const a = ph + f * len * 0.12 + Math.sin(f * 11 + this.t * 6) * 0.6;
          path[j].copy(b.origin).addScaledVector(b.dir, len * f).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_w, Math.sin(a) * r);
        }
        const head = path[path.length - 1];
        this.add.emit({ pos: head, life: 0.06, size: b.radius * 1.4, color: v.dragons[k].color.clone(), shape: Shape.Glow });
      });
      for (const d of v.dragons) d.intensity = alpha;
      if (alpha <= 0.01) continue;
      // Muzzle flare.
      this.add.emit({ pos: b.origin, life: 0.05, size: b.radius * 2.3 * throb, color: _c.copy(b.color).multiplyScalar(1.8), shape: Shape.Glow });
      this.add.emit({ pos: b.origin, life: 0.05, size: b.radius * 2.2, color: WHITE.clone().multiplyScalar(1.6), shape: Shape.Star, rot: this.t * 3 });
      // Boiling end explosion.
      v.fx -= dt;
      if (v.fx <= 0) {
        v.fx = 0.05;
        const e = b.end;
        this.add.emit({ pos: e, life: 0.16, size: b.radius * 2.4, size1: b.radius * 3.2, color: _c.copy(b.color).multiplyScalar(1.3), shape: Shape.Glow });
        this.add.emit({ pos: e, life: 0.08, size: b.radius * 1.5, color: WHITE.clone().multiplyScalar(1.6), shape: Shape.Glow });
        for (let k = 0; k < 4 * this.quality; k++) {
          const d = _v.randomDirection().addScaledVector(b.dir, -0.9).normalize();
          this.add.emit({ pos: e, vel: d.multiplyScalar(14 + Math.random() * 18), life: 0.3, size: 0.07, color: _c.copy(b.color).lerp(WHITE, 0.4).multiplyScalar(3), shape: Shape.Spark, stretch: 0.04, drag: 2, gravity: 10 });
        }
        if (Math.random() < 0.5) this.alpha.emit({ pos: e, vel: _v.randomDirection().multiplyScalar(2).setY(2.5), life: 1.2, size: b.radius * 2, size1: b.radius * 6, color: SMOKE, alpha: 0.4, shape: Shape.Smoke, drag: 1 });
        if (Math.random() < 0.35) this.waves.air(e, _v.copy(b.dir).negate(), b.radius * 5, _c.copy(b.color).multiplyScalar(1.4), 0.3, 0.8);
      }
    }
  }
}
