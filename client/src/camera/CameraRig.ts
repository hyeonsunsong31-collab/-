import * as THREE from 'three';
import type { World } from '../world/World.ts';
import type { Input } from '../input/Input.ts';

export interface CamCtx {
  /** Player chest-ish anchor. */
  anchor: THREE.Vector3;
  velocity: THREE.Vector3;
  flying: boolean;
  sprinting: boolean;
  /** Current lock-on / combat target (for framing). */
  target: THREE.Vector3 | null;
  /** True while attacking: tighter, punchier framing. */
  combat: boolean;
}

export interface CinematicShot {
  dur: number;
  /** Returns camera position + look target for normalized time u (0..1). */
  frame: (u: number, out: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number }) => void;
  blendIn?: number;
  blendOut?: number;
  onEnd?: () => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Third-person action camera: drag-orbit (or shift-lock pointer look), spring-arm collision, combat auto-framing,
 * trauma shake, FOV kicks, dutch roll, push-in/pull-out impulses and scripted cinematic shots with blending.
 */
export class CameraRig {
  yaw = Math.PI;
  pitch = -0.18;
  dist = 5.0;
  private distCur = 5.0;
  /** Extra downward look while flying forward so the superman pose reads from above-behind. */
  private flyTilt = 0;
  private anchor = new THREE.Vector3();
  private trauma = 0;
  private shakeT = 0;
  private fovKick = 0;
  private push = 0;
  private roll = 0;
  private rollTarget = 0;
  private fovCur = 62;
  baseFov = 62;
  private shot: CinematicShot | null = null;
  private shotT = 0;
  private shotFrame = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 62, roll: 0 };
  private blend = 0;
  private lastLook = new THREE.Vector3();
  private autoYawCooldown = 0;
  /** World-space yaw the player faces when shift-locked. */
  get forwardYaw(): number {
    return this.yaw + Math.PI;
  }

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private world: World | null,
  ) {}

  setWorld(w: World): void {
    this.world = w;
  }

  /** Add screen shake (0..1, stacks, decays). */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kickFov(deg: number): void {
    this.fovKick += deg;
  }

  /** Positive = pull out, negative = push in (meters), decays. */
  punch(meters: number): void {
    this.push += meters;
  }

  dutch(deg: number): void {
    this.rollTarget = deg;
  }

  play(shot: CinematicShot): void {
    this.shot = shot;
    this.shotT = 0;
  }

  /** Leave the current shot through its blend-out instead of cutting back to the follow camera. */
  releaseShot(): void {
    const s = this.shot;
    if (s) s.dur = Math.min(s.dur, this.shotT + (s.blendOut ?? 0.35));
  }

  get inCinematic(): boolean {
    return this.shot !== null;
  }

  stopShot(): void {
    if (this.shot) {
      const s = this.shot;
      this.shot = null;
      s.onEnd?.();
    }
  }

  /** Direction the camera looks along the ground plane (for camera-relative movement). */
  groundForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  update(realDt: number, input: Input, ctx: CamCtx): void {
    const dt = Math.min(realDt, 0.05);
    // Orbit input.
    const sens = 0.0042;
    if (input.cam.x !== 0 || input.cam.y !== 0) this.autoYawCooldown = 1.2;
    this.yaw -= input.cam.x * sens;
    this.pitch -= input.cam.y * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, ctx.flying ? -1.35 : -1.1, ctx.flying ? 1.1 : 0.7);
    this.autoYawCooldown -= dt;

    // Combat framing: gently swing behind the player so the target stays on screen.
    if (ctx.target && !input.shiftLock && this.autoYawCooldown <= 0) {
      const toT = _v.subVectors(ctx.target, ctx.anchor);
      toT.y = 0;
      if (toT.lengthSq() > 0.5) {
        // Swing behind the player but ~24° off the player→target line (on whichever side the camera already is),
        // so the target is framed beside the player instead of hidden behind it.
        const base = Math.atan2(toT.x, toT.z) + Math.PI;
        let rel = this.yaw - base;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const want = base + (rel >= 0 ? 1 : -1) * 0.42;
        let d = want - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.2);
      }
    }

    // Anchor follows with slight lag; the follow tightens with speed so fast flight never leaves the hero behind.
    const speed = ctx.velocity.length();
    const follow = 1 - Math.exp(-dt * ((ctx.flying ? 9 : 14) + speed * 0.55));
    this.anchor.lerp(ctx.anchor, follow);
    if (this.anchor.distanceToSquared(ctx.anchor) > 400) this.anchor.copy(ctx.anchor);

    // Distance: base + speed + combat separation.
    let want = this.dist + Math.min(speed * 0.06, ctx.flying ? 2.2 : 1.3);
    if (ctx.target) want = Math.max(want, Math.min(12, 4.5 + ctx.target.distanceTo(ctx.anchor) * 0.45));
    if (ctx.combat) want -= 0.4;
    want += this.push;
    this.distCur += (want - this.distCur) * (1 - Math.exp(-dt * 5));
    this.push *= Math.exp(-dt * 4);

    // Desired camera position (spring arm).
    const hs = Math.hypot(ctx.velocity.x, ctx.velocity.z);
    const tiltWant = ctx.flying ? THREE.MathUtils.smoothstep(hs, 4, 16) * 0.3 : 0;
    this.flyTilt += (tiltWant - this.flyTilt) * (1 - Math.exp(-dt * 2.5));
    const pitch = THREE.MathUtils.clamp(this.pitch - this.flyTilt, -1.4, 1.1);
    const cp = Math.cos(pitch);
    const dir = _v.set(Math.sin(this.yaw) * cp, -Math.sin(pitch), Math.cos(this.yaw) * cp);
    const shoulder = input.shiftLock ? 0.7 : 0.25;
    const right = _v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = new THREE.Vector3().copy(this.anchor).addScaledVector(right, shoulder);
    let d = this.distCur;
    if (this.world) {
      // Shorten for terrain and buildings.
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * d;
        const px = pivot.x + dir.x * t;
        const py = pivot.y + dir.y * t;
        const pz = pivot.z + dir.z * t;
        const g = this.world.terrainHeight(px, pz) + 0.45;
        if (py < g) {
          d = Math.max(1.2, t - 0.3);
          break;
        }
      }
      const end = _v2.copy(pivot).addScaledVector(dir, d);
      const hit = this.world.colliders.segment(pivot.x, pivot.y, pivot.z, end.x, end.y, end.z);
      if (hit < 1) d = Math.max(1.2, d * hit - 0.2);
    }
    const pos = new THREE.Vector3().copy(pivot).addScaledVector(dir, d);
    const look = new THREE.Vector3().copy(pivot).addScaledVector(dir, -2);
    if (ctx.target) look.lerp(ctx.target, 0.3);

    // FOV.
    let fov = this.baseFov + (ctx.sprinting ? 7 : 0) + (ctx.flying ? Math.min(16, speed * 0.35) : 0) + this.fovKick;
    this.fovKick *= Math.exp(-dt * 6);

    // Cinematic override with blending.
    if (this.shot) {
      this.shotT += realDt;
      const u = Math.min(1, this.shotT / this.shot.dur);
      this.shot.frame(u, this.shotFrame);
      const bi = this.shot.blendIn ?? 0.25;
      const bo = this.shot.blendOut ?? 0.35;
      const tIn = Math.min(1, this.shotT / Math.max(0.001, bi));
      const tOut = Math.min(1, (this.shot.dur - this.shotT) / Math.max(0.001, bo));
      this.blend = smooth(Math.min(tIn, tOut));
      if (u >= 1) this.stopShot();
    } else this.blend = Math.max(0, this.blend - realDt * 4);
    if (this.blend > 0) {
      pos.lerp(this.shotFrame.pos, this.blend);
      look.lerp(this.shotFrame.look, this.blend);
      fov = THREE.MathUtils.lerp(fov, this.shotFrame.fov, this.blend);
    }

    this.fovCur += (fov - this.fovCur) * (1 - Math.exp(-dt * 8));
    this.camera.fov = this.fovCur;
    this.camera.updateProjectionMatrix();

    // Shake (trauma², smooth noise) — runs on real time so it continues during hitstop.
    this.shakeT += realDt;
    this.trauma = Math.max(0, this.trauma - realDt * 1.6);
    const sh = this.trauma * this.trauma;
    const n = (o: number) => Math.sin(this.shakeT * 37 + o) * 0.5 + Math.sin(this.shakeT * 61 + o * 1.7) * 0.35 + Math.sin(this.shakeT * 97 + o * 3.1) * 0.15;
    pos.x += n(1) * sh * 0.35;
    pos.y += n(2) * sh * 0.3;
    pos.z += n(3) * sh * 0.35;

    this.camera.position.copy(pos);
    this.lastLook.copy(look);
    this.camera.lookAt(look);
    this.roll += (this.rollTarget + (this.blend > 0 ? this.shotFrame.roll * this.blend : 0) - this.roll) * (1 - Math.exp(-dt * 6));
    this.rollTarget *= Math.exp(-dt * 2.5);
    const totalRoll = this.roll + n(4) * sh * 4;
    if (Math.abs(totalRoll) > 0.01) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (totalRoll * Math.PI) / 180);
      this.camera.quaternion.multiply(_q);
    }
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
