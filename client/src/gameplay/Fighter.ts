import * as THREE from 'three';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import type { ActionHandle, PlayOpts } from '../animation/Animator.ts';
import { WATER_LEVEL, WORLD_HALF } from '../world/layout.ts';

export type MoveState = 'ground' | 'air' | 'fly';

export interface MoveIntent {
  /** World-space desired horizontal direction (unit or zero) scaled by stick magnitude. */
  dir: THREE.Vector3;
  sprint: boolean;
  /** Flight vertical intent -1..1 and free-look 3D direction for forward flight. */
  vertical: number;
  flyDir: THREE.Vector3 | null;
  /** Face this yaw (shift-lock / lock-on); null = face movement. */
  faceYaw: number | null;
}

export const GRAVITY = 28;
export const JUMP_VEL = 11.2;

const _v = new THREE.Vector3();
const _m = [0, 0, 0] as [number, number, number];

/**
 * Shared body of every fighter (player, rival, mobs): kinematic movement on the heightfield with colliders,
 * jumping, flight, root-motion actions, facing, locomotion blending and procedural lean.
 */
export class Fighter {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Knockback / external push (m/s), integrated even during actions and decayed by friction. */
  readonly knock = new THREE.Vector3();
  yaw = 0;
  move: MoveState = 'ground';
  grounded = true;
  /** Current movement-locking action (attack, dash, reaction...). */
  action: ActionHandle | null = null;
  actionName = '';
  /** Cosmetic one-shot that does not lock movement (jump takeoff, soft landing). */
  cosmetic: ActionHandle | null = null;
  /** Multiplier on gravity (apex hang, slow fall). */
  gravityScale = 1;
  /** Horizontal speed carried through a jump (sprint jumps keep their momentum). */
  airCarry = 0;
  private actionPrevMotion: [number, number, number] = [0, 0, 0];
  private prevYaw = 0;
  private prevVel = new THREE.Vector3();
  private relaxTimer = 0;
  private flyPitchAdj = 0;
  /** Extra yaw applied to root motion (directional dashes that do not line up exactly with a clip axis). */
  motionYawOffset = 0;
  /** Scale on root motion distance (flight dashes travel further). */
  motionScale = 1;
  /** Seconds since leaving the ground (coyote time / landing). */
  airTime = 0;
  /** Gameplay speed multipliers. */
  walkSpeed = 1.7;
  runSpeed = 7.2;
  sprintSpeed = 14.5;
  flySpeed = 17;
  flyBoost = 38;
  speedMult = 1;
  radius = 0.38;
  height = 1.8;
  /** Freeze voluntary movement (attacks, stun...). */
  rooted = false;
  /** Gravity disabled (hit-launch hang, special moves). */
  floatTimer = 0;
  /** Vertical position is driven by script / root motion this frame (no gravity or ground snapping). */
  kinematicY = false;
  combatTimer = 0;

  constructor(
    readonly char: Character,
    protected world: World,
  ) {
    this.radius = 0.38 * char.scale;
    this.height = 1.8 * char.scale;
  }

  get object(): THREE.Object3D {
    return this.char.group;
  }

  /** Chest-height point in world space. */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).add(_v.set(0, 1.3 * this.char.scale, 0));
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  teleport(p: THREE.Vector3, yaw?: number): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.char.group.position.copy(p);
  }

  /* ------------------------------------------------------------------ actions */

  playAction(name: string, opts: PlayOpts = {}): ActionHandle {
    this.action = this.char.animator.play(name, { fadeIn: 0.06, fadeOut: 0.14, ...opts });
    this.actionName = name;
    this.actionPrevMotion = [0, 0, 0];
    this.motionYawOffset = 0;
    this.motionScale = 1;
    this.cosmetic = null;
    return this.action;
  }

  /** Play a clip on the action layer that leaves movement free. */
  playCosmetic(name: string, opts: PlayOpts = {}): ActionHandle {
    this.action = null;
    this.actionName = '';
    this.cosmetic = this.char.animator.play(name, { fadeIn: 0.06, fadeOut: 0.2, ...opts });
    return this.cosmetic;
  }

  stopCosmetic(fade = 0.2): void {
    if (this.cosmetic && !this.action) this.char.animator.stop('action', fade);
    this.cosmetic = null;
  }

  stopAction(fade = 0.12): void {
    if (this.action) this.char.animator.stop('action', fade);
    this.action = null;
    this.actionName = '';
  }

  /** True while a movement-locking action is running. */
  get busy(): boolean {
    return !!this.action && !this.action.ended;
  }

  /** Time within the current action (s). */
  get actionTime(): number {
    return this.action?.time ?? 0;
  }

  actionWindow(name: string): boolean {
    return !!this.action && this.action.clip.inWindow(name, this.action.time);
  }

  get actionDone(): boolean {
    return !this.action || this.action.ended;
  }

  /** Apply this frame's root motion of the current action (forward/lateral/vertical in facing space). */
  protected applyRootMotion(): void {
    const a = this.action;
    if (!a || !a.clip.def.move) return;
    const m = a.clip.motionAt(a.time, _m);
    const dz = m[0] - this.actionPrevMotion[0];
    const dx = m[1] - this.actionPrevMotion[1];
    const dy = m[2] - this.actionPrevMotion[2];
    this.actionPrevMotion = [m[0], m[1], m[2]];
    const s = Math.sin(this.yaw + this.motionYawOffset);
    const c = Math.cos(this.yaw + this.motionYawOffset);
    const k = this.char.scale * this.motionScale;
    this.pos.x += (s * dz + c * dx) * k;
    this.pos.z += (c * dz - s * dx) * k;
    this.pos.y += dy * k;
  }

  /* ------------------------------------------------------------------ movement */

  jump(vel = JUMP_VEL): void {
    if (this.move !== 'ground') return;
    this.vel.y = vel;
    this.move = 'air';
    this.grounded = false;
    this.airTime = 0;
    this.airCarry = Math.hypot(this.vel.x, this.vel.z);
  }

  startFlight(): void {
    this.move = 'fly';
    this.grounded = false;
    this.vel.y = Math.max(this.vel.y, 3);
  }

  stopFlight(): void {
    if (this.move === 'fly') this.move = 'air';
  }

  /** Integrate movement for this frame. */
  protected integrate(dt: number, intent: MoveIntent | null): void {
    const hasAction = this.busy;
    const sp = this.speedMult;
    if (this.move === 'fly') {
      let target = _v.set(0, 0, 0);
      if (intent && !this.rooted) {
        const boost = intent.sprint;
        const spd = (boost ? this.flyBoost : this.flySpeed) * sp;
        if (intent.flyDir) target.copy(intent.flyDir).multiplyScalar(spd);
        else target.copy(intent.dir).multiplyScalar(spd);
        target.y += intent.vertical * spd * 0.75;
      }
      const acc = target.lengthSq() > this.vel.lengthSq() ? 26 : 18;
      this.vel.lerp(target, 1 - Math.exp(-dt * acc * 0.25));
      if (!hasAction) this.pos.addScaledVector(this.vel, dt);
    } else {
      const grounded = this.move === 'ground';
      let tx = 0;
      let tz = 0;
      if (intent && !this.rooted && !hasAction) {
        const mag = Math.min(1, intent.dir.length());
        let spd = (intent.sprint && mag > 0.6 ? this.sprintSpeed : mag < 0.45 ? this.walkSpeed : this.runSpeed) * sp;
        if (!grounded) spd = Math.max(spd, this.airCarry);
        const unit = mag > 1e-4 ? spd / mag : 0;
        tx = intent.dir.x * unit * Math.min(1, mag * 1.6);
        tz = intent.dir.z * unit * Math.min(1, mag * 1.6);
      }
      let accel: number;
      if (grounded) accel = tx * tx + tz * tz > this.vel.x * this.vel.x + this.vel.z * this.vel.z ? 34 : 46;
      else accel = tx * tx + tz * tz > 0.01 ? 12 : 2.5;
      const k = 1 - Math.exp(-dt * accel * 0.22);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
      if (!grounded && !this.kinematicY) {
        if (this.floatTimer > 0) {
          this.floatTimer -= dt;
          this.vel.y *= Math.exp(-dt * 6);
        } else this.vel.y -= GRAVITY * this.gravityScale * dt;
        this.airTime += dt;
        this.airCarry = Math.max(0, this.airCarry - dt * 2);
      }
      if (!hasAction) {
        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
      }
      if (!grounded && !this.kinematicY) this.pos.y += this.vel.y * dt;
    }
    if (hasAction) this.applyRootMotion();
    if (this.knock.lengthSq() > 1e-4) {
      this.pos.x += this.knock.x * dt;
      this.pos.z += this.knock.z * dt;
      const fr = this.move === 'ground' ? 7 : this.move === 'fly' ? 3 : 0.6;
      this.knock.multiplyScalar(Math.exp(-dt * fr));
    }

    // Collisions with props / buildings / trunks.
    const out = { x: 0, z: 0 };
    if (this.world.colliders.resolve(this.pos.x, this.pos.z, this.radius, this.pos.y, this.height, out)) {
      this.pos.x = out.x;
      this.pos.z = out.z;
    }
    // World bounds (mountain ring).
    const lim = WORLD_HALF - 250;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);

    // Ground contact. Fighters can skim over water like solid ground (anime style).
    let g = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    g = Math.max(g, WATER_LEVEL - 0.02);
    if (this.kinematicY) {
      if (this.pos.y < g) this.pos.y = g;
    } else if (this.move === 'fly') {
      if (this.pos.y < g + 0.05) {
        this.pos.y = g + 0.05;
        if (this.vel.y < 0) this.vel.y = 0;
      }
      this.pos.y = Math.min(this.pos.y, 900);
    } else if (this.move === 'ground') {
      // Follow the ground; walk off ledges into the air.
      if (this.pos.y - g > 0.6) {
        this.move = 'air';
        this.grounded = false;
        this.airTime = 0;
        this.vel.y = 0;
      } else {
        this.pos.y = g;
        this.vel.y = 0;
      }
    } else if (this.move === 'air') {
      if (this.pos.y <= g && this.vel.y <= 0) {
        this.pos.y = g;
        const impact = -this.vel.y;
        this.vel.y = 0;
        this.move = 'ground';
        this.grounded = true;
        this.onLand(impact);
      }
    }
  }

  /** Override for landing reactions. */
  protected onLand(_impact: number): void {}

  /** Smoothly turn toward a yaw (rad/s). */
  turnToward(yaw: number, rate: number, dt: number): void {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = rate * dt;
    this.yaw += Math.abs(d) < step ? d : Math.sign(d) * step;
  }

  faceInstant(yaw: number): void {
    this.yaw = yaw;
  }

  yawTo(p: THREE.Vector3): number {
    return Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  /* ------------------------------------------------------------------ animation */

  /** Locomotion clip names (mobs swap in their own idles / gaits). */
  loco = { idle: 'idle', relaxed: 'idle_relaxed', walk: 'walk', run: 'run', sprint: 'sprint', walkSpeed: 1.6, runSpeed: 5.5 };

  /** Choose locomotion blend weights from the movement state. */
  protected driveLocomotion(dt: number, intent: MoveIntent | null, inCombat: boolean): void {
    const A = this.char.animator;
    const s = this.char.scale;
    const hv = Math.hypot(this.vel.x, this.vel.z) / s;
    if (this.move === 'fly') {
      // Local velocity in facing space.
      const sn = Math.sin(this.yaw);
      const cs = Math.cos(this.yaw);
      const vf = (this.vel.x * sn + this.vel.z * cs) / s;
      const vr = (this.vel.x * cs - this.vel.z * sn) / s;
      const vy = this.vel.y / s;
      const fast = THREE.MathUtils.smoothstep(vf, 20, 30);
      const fwd = THREE.MathUtils.smoothstep(vf, 3, 10) * (1 - fast);
      const back = THREE.MathUtils.smoothstep(-vf, 2, 6);
      const up = THREE.MathUtils.smoothstep(vy, 3, 8) * (1 - fwd - fast);
      const down = THREE.MathUtils.smoothstep(-vy, 3, 8) * (1 - fwd - fast);
      const left = THREE.MathUtils.smoothstep(-vr, 3, 8) * (1 - fwd - fast) * 0.9;
      const right = THREE.MathUtils.smoothstep(vr, 3, 8) * (1 - fwd - fast) * 0.9;
      const hover = Math.max(0, 1 - fwd - fast - back - up - down - left - right);
      A.setLoco({ hover, fly_fwd: fwd, fly_fast: fast, fly_back: back, fly_up: up, fly_down: down, fly_left: left, fly_right: right }, 0.3, new Set());
      // Nose follows the climb/dive angle while flying forward (superman pose stays aligned with the flight path).
      const climb = (Math.atan2(vy, Math.max(0.5, Math.hypot(vf, vr))) * 180) / Math.PI;
      this.flyPitchAdj = THREE.MathUtils.clamp(-climb, -70, 70) * Math.min(1, fwd + fast);
    } else if (this.move === 'air') {
      A.setLoco({ jump_fall: 1 }, 0.25, new Set());
    } else {
      // Ground.
      const face = intent?.faceYaw ?? null;
      if (face !== null && hv > 0.5) {
        // Shift-lock / lock-on strafing.
        const sn = Math.sin(this.yaw);
        const cs = Math.cos(this.yaw);
        const vf = (this.vel.x * sn + this.vel.z * cs) / s;
        const vr = (this.vel.x * cs - this.vel.z * sn) / s;
        const ah = Math.atan2(vr, vf);
        const wF = Math.max(0, Math.cos(ah));
        const wB = Math.max(0, -Math.cos(ah));
        const wL = Math.max(0, -Math.sin(ah));
        const wR = Math.max(0, Math.sin(ah));
        const runK = THREE.MathUtils.smoothstep(hv, 2.5, 5);
        A.setLoco({ advance: wF * (1 - runK), run: wF * runK, backpedal: wB, strafe_left: wL, strafe_right: wR, idle: 0 }, 0.15);
        A.setLocoRate('run', hv / 5.5);
        A.setLocoRate('advance', Math.max(0.6, hv / 3));
        A.setLocoRate('backpedal', Math.max(0.6, hv / 2.8));
        A.setLocoRate('strafe_left', Math.max(0.6, hv / 3.2));
        A.setLocoRate('strafe_right', Math.max(0.6, hv / 3.2));
      } else {
        const L = this.loco;
        const idleName = inCombat || this.relaxTimer < 6 || L.relaxed === L.idle ? L.idle : L.relaxed;
        if (hv < 0.3 && !inCombat) this.relaxTimer += dt;
        else this.relaxTimer = 0;
        const wWalk = THREE.MathUtils.smoothstep(hv, 0.25, 1.4) * (1 - THREE.MathUtils.smoothstep(hv, 2.5, 4.5));
        const wRun = THREE.MathUtils.smoothstep(hv, 2.5, 4.5) * (1 - THREE.MathUtils.smoothstep(hv, 9, 12));
        const wSprint = THREE.MathUtils.smoothstep(hv, 9, 12);
        const wIdle = Math.max(0, 1 - wWalk - wRun - wSprint);
        const w: Record<string, number> = {};
        const addW = (n: string, v: number) => (w[n] = (w[n] ?? 0) + v);
        addW(idleName, wIdle);
        addW(L.walk, wWalk);
        addW(L.run, wRun);
        addW(L.sprint, wSprint);
        A.setLoco(w, 0.2);
        if (L.walk === L.run) A.setLocoRate(L.walk, THREE.MathUtils.clamp(hv / L.walkSpeed, 0.6, 1.8));
        else {
          A.setLocoRate(L.walk, THREE.MathUtils.clamp(hv / L.walkSpeed, 0.6, 1.6));
          A.setLocoRate(L.run, THREE.MathUtils.clamp(hv / L.runSpeed, 0.7, 1.5));
        }
        if (L.sprint !== L.run) A.setLocoRate(L.sprint, THREE.MathUtils.clamp(hv / 11, 0.75, 1.4));
      }
    }
    // Lean into turns and acceleration (degrees of root roll/pitch).
    let dy = this.yaw - this.prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turnRate = dy / Math.max(dt, 1e-4);
    const accel = _v.copy(this.vel).sub(this.prevVel).divideScalar(Math.max(dt, 1e-4));
    const fwdAcc = accel.x * Math.sin(this.yaw) + accel.z * Math.cos(this.yaw);
    const flying = this.move === 'fly';
    const rollTarget = THREE.MathUtils.clamp(-turnRate * hv * (flying ? 1.6 : 0.55), flying ? -35 : -12, flying ? 35 : 12);
    if (!flying) this.flyPitchAdj = 0;
    const pitchTarget = THREE.MathUtils.clamp(fwdAcc * (flying ? 0.12 : 0.18), -8, 10) + this.flyPitchAdj;
    const k = 1 - Math.exp(-dt * 6);
    this.char.leanRoll += (rollTarget - this.char.leanRoll) * k;
    this.char.leanPitch += (pitchTarget - this.char.leanPitch) * k;
    this.prevYaw = this.yaw;
    this.prevVel.copy(this.vel);
  }

  /** Push the transform to the character and advance its animation/procedural layers. */
  protected syncCharacter(dt: number): void {
    const g = this.char.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.yaw, 0);
    const standing = this.move === 'ground' && !this.busy;
    this.char.update(dt, {
      groundAt: standing ? (x, z) => Math.max(this.world.groundAt(x, z, this.pos.y + 0.6), WATER_LEVEL - 0.02) : undefined,
      ik: standing ? 1 : 0,
      autoGround: standing && Math.hypot(this.vel.x, this.vel.z) < 1.2,
      velocity: this.vel,
      wind: _v.set(1.2, 0, 0.7),
    });
    this.world.bend({ x: this.pos.x, z: this.pos.z, radius: 1.1 * this.char.scale, strength: this.move === 'ground' ? 0.9 : 0.25 });
  }
}
