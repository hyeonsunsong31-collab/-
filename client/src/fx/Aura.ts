import * as THREE from 'three';
import type { FormDef } from '@ak/shared';
import type { Character } from '../character/Character.ts';
import { Shape, type Particles } from './Particles.ts';
import type { Lightning } from './Lightning.ts';
import type { Shockwaves } from './Shockwaves.ts';
import type { World } from '../world/World.ts';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);
const DUST = new THREE.Color('#8a7b62');
const BODY_BONES = ['hips', 'spine', 'chest', 'upperChest', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;

/**
 * A fighter's ki aura, layered: an inflated skinned fresnel shell with flames licking upward, DB-style flame
 * tongues streaming off the body, rising streaks, crackling bio-lightning for Storm-class forms, sparkles for the
 * divine forms, a ground dust ring with levitating pebbles while charging, and (for the player) a pulsing light.
 */
export class Aura {
  private shell: THREE.SkinnedMesh;
  private shellMat: THREE.ShaderMaterial;
  private light: THREE.PointLight | null;
  /** Current smoothed intensity 0..1 and the requested target. */
  level = 0;
  target = 0;
  color = new THREE.Color('#cfe6ff');
  core = new THREE.Color('#ffffff');
  lightningOn = false;
  lightningColor = new THREE.Color('#7fd4ff');
  sparkle = false;
  /** Charging a transformation: everything maxed + ground effects. */
  charging = 0;
  private emitAcc = 0;
  private boltAcc = 0;
  private dustAcc = 0;
  private t = 0;

  constructor(
    private ch: Character,
    private add: Particles,
    private alpha: Particles,
    private lightning: Lightning,
    private waves: Shockwaves,
    private world: World | null,
    withLight: boolean,
    private quality = 1,
  ) {
    this.shellMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uAlpha: { value: 0 }, uT: { value: 0 }, uPush: { value: 0.05 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <skinning_pars_vertex>
        uniform float uPush;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vW;
        void main() {
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <beginnormal_vertex>
          #include <skinnormal_vertex>
          #include <skinning_vertex>
          vec3 n = normalize(objectNormal);
          transformed += n * uPush;
          vec4 world = modelMatrix * vec4(transformed, 1.0);
          vW = world.xyz;
          vec4 mv = viewMatrix * world;
          vN = normalize(normalMatrix * n);
          vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uCore;
        uniform float uAlpha;
        uniform float uT;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vW;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float vnoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        void main() {
          // Clamped: rounding can push |dot| past 1, and pow() of a negative base is NaN on some GPUs.
          float fr = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
          vec3 q = vW * vec3(4.0, 2.2, 4.0) - vec3(0.0, uT * 5.5, 0.0);
          float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 4.0) * 0.4;
          float flame = smoothstep(0.45, 0.9, n + fr * 0.35);
          // Rim-dominant so the fighter stays readable inside the aura.
          float rim = pow(fr, 2.6);
          vec3 c = mix(uColor, uCore, pow(fr, 6.0)) * (0.7 + flame * 1.2);
          float a = (rim * 1.1 + flame * 0.22 * pow(fr, 1.3)) * uAlpha;
          gl_FragColor = vec4(c * a, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shell = new THREE.SkinnedMesh(ch.body.geometry, this.shellMat);
    this.shell.bind(ch.rig.skeleton, new THREE.Matrix4());
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 15;
    this.shell.visible = false;
    ch.group.add(this.shell);
    this.light = withLight ? new THREE.PointLight(0xffffff, 0, 9, 2) : null;
    if (this.light) ch.group.add(this.light);
  }

  /** Base-form ki is a pale, translucent aura; transformed auras burn denser. */
  private flameAlpha = 0.7;

  setForm(f: FormDef): void {
    this.flameAlpha = f.tier === 0 ? 0.7 : 1;
    this.color.set(f.tier === 0 ? '#8fc8ff' : f.auraColor);
    this.core.set(f.auraCore);
    this.lightningOn = f.lightning;
    this.lightningColor.set(f.lightningColor);
    this.sparkle = f.id === 'azure' || f.id === 'silver';
  }

  update(dt: number, velocity: THREE.Vector3, grounded: boolean): void {
    this.t += dt;
    const want = Math.max(this.target, this.charging);
    this.level += (want - this.level) * (1 - Math.exp(-dt * (want > this.level ? 8 : 3)));
    const L = this.level;
    const ch = this.ch;
    const s = ch.scale;
    this.shell.visible = L > 0.02;
    const u = this.shellMat.uniforms;
    u.uColor.value.copy(this.color).multiplyScalar(1.15);
    u.uCore.value.copy(this.core).multiplyScalar(1.4);
    u.uAlpha.value = Math.min(0.9, L * 0.85);
    u.uT.value = this.t;
    u.uPush.value = (0.035 + L * 0.06 + this.charging * 0.04) * s;
    if (this.light) {
      this.light.color.copy(this.color);
      this.light.intensity = L * (6 + this.charging * 10) * (0.85 + 0.15 * Math.sin(this.t * 23));
      this.light.position.set(0, 1.1 * s, 0);
    }
    if (L < 0.03) return;
    const center = ch.boneWorld('chest', _v);
    const feet = ch.group.position;
    const moving = velocity.lengthSq() > 4;
    // Flame tongues: DB aura silhouette from overlapping flames rising off the body.
    this.emitAcc += dt * (26 + L * 70 + this.charging * 60) * this.quality;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      // Flames start around the silhouette (outside the body) from the shins up and stream skyward.
      const bone = BODY_BONES[Math.floor(Math.random() * BODY_BONES.length)];
      const p = ch.boneWorld(bone, _v2);
      const a = Math.random() * Math.PI * 2;
      const r = (0.32 + Math.random() * 0.26) * s * (1 + this.charging * 0.5);
      p.x += Math.cos(a) * r;
      p.z += Math.sin(a) * r;
      const up = (2.6 + L * 2.5 + this.charging * 3) * s;
      const vel = _v3.set(Math.cos(a) * 0.6, up, Math.sin(a) * 0.6).addScaledVector(velocity, moving ? -0.15 : 0);
      this.add.emit({
        pos: p,
        vel,
        life: 0.32 + Math.random() * 0.25 + this.charging * 0.2,
        size: (0.55 + Math.random() * 0.55) * s * (0.7 + L * 0.6 + this.charging * 0.7),
        size1: 0.15 * s,
        color: _c.copy(this.color).multiplyScalar(0.42 + L * 0.3),
        color1: _c2.copy(this.core).multiplyScalar(0.25),
        alpha: (0.16 + L * 0.12) * this.flameAlpha,
        shape: Shape.Flame,
        rot: (Math.random() - 0.5) * 0.3,
        fadeIn: 0.2,
        drag: 1.2,
      });
    }
    // Rising streaks.
    if (Math.random() < dt * (10 + L * 30) * this.quality) {
      const p = _v2.copy(center).add(new THREE.Vector3((Math.random() - 0.5) * 0.9 * s, (Math.random() - 0.6) * 1.2 * s, (Math.random() - 0.5) * 0.9 * s));
      this.add.emit({ pos: p, vel: new THREE.Vector3(0, (6 + Math.random() * 6) * s, 0), life: 0.3, size: 0.04 * s, color: _c.copy(this.core).multiplyScalar(2.2), shape: Shape.Spark, stretch: 0.05 });
    }
    // Sparkles for the divine forms.
    if (this.sparkle && Math.random() < dt * 24 * L) {
      const p = _v2.copy(center).add(new THREE.Vector3((Math.random() - 0.5) * 1.4 * s, (Math.random() - 0.4) * 2 * s, (Math.random() - 0.5) * 1.4 * s));
      this.add.emit({ pos: p, vel: new THREE.Vector3(0, 1.2, 0), life: 0.5, size: 0.18 * s, size1: 0.02, color: WHITE.clone().multiplyScalar(2.2), shape: Shape.Star, spin: 3 });
    }
    // Bio-lightning crackling over the body.
    const arcRate = (this.lightningOn ? 9 * L : 0) + this.charging * 14;
    this.boltAcc += dt * arcRate;
    while (this.boltAcc >= 1) {
      this.boltAcc -= 1;
      const a = ch.boneWorld(BODY_BONES[Math.floor(Math.random() * BODY_BONES.length)], new THREE.Vector3());
      const b = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2 * s, (Math.random() - 0.3) * 1.2 * s, (Math.random() - 0.5) * 1.2 * s));
      this.lightning.add({ from: a, to: b, color: this.lightningColor.clone().multiplyScalar(1.6), width: 0.035 * s, life: 0.07 + Math.random() * 0.08, jag: 0.28, segments: 9, branches: 1, regen: 0.03 });
    }
    // Ground effects while powering up on the ground: dust ring, pebbles, small shock rings.
    if (grounded && (L > 0.5 || this.charging > 0)) {
      this.dustAcc += dt * (8 + this.charging * 30) * this.quality;
      while (this.dustAcc >= 1) {
        this.dustAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = (0.6 + Math.random() * 0.8) * s;
        const p = new THREE.Vector3(feet.x + Math.cos(a) * r, feet.y + 0.15, feet.z + Math.sin(a) * r);
        this.alpha.emit({ pos: p, vel: new THREE.Vector3(Math.cos(a) * (5 + this.charging * 6), 0.6, Math.sin(a) * (5 + this.charging * 6)), life: 0.8, size: 0.5 * s, size1: 1.8 * s, color: DUST, alpha: 0.32, shape: Shape.Smoke, drag: 2.2 });
        if (this.charging > 0.3 && Math.random() < 0.35) {
          const rr = (1 + Math.random() * 3) * s;
          const pp = new THREE.Vector3(feet.x + Math.cos(a) * rr, feet.y + 0.05, feet.z + Math.sin(a) * rr);
          this.alpha.emit({ pos: pp, vel: new THREE.Vector3(0, 1.5 + Math.random() * 2.5, 0), life: 1.4, size: 0.12 + Math.random() * 0.14, color: _c.set('#6c6256'), alpha: 1, shape: Shape.Chip, spin: (Math.random() - 0.5) * 4, drag: 0.6 });
        }
      }
      if (this.charging > 0.2 && Math.random() < dt * 2.5) this.waves.ground(feet, (3 + this.charging * 4) * s, _c.copy(this.color).multiplyScalar(0.9), 0.7, 0.6, 0.05);
    }
  }

  dispose(): void {
    this.ch.group.remove(this.shell);
    if (this.light) this.ch.group.remove(this.light);
    this.shellMat.dispose();
  }
}
