import * as THREE from 'three';
import { Fighter, type MoveIntent } from './Fighter.ts';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import type { Input } from '../input/Input.ts';
import type { CameraRig, CamCtx } from '../camera/CameraRig.ts';
import { dashClipFor, type DashDir } from '../input/dash.ts';

export type PlayerFx =
  | { kind: 'step'; pos: THREE.Vector3; foot: 'L' | 'R'; dust: number; water: boolean }
  | { kind: 'land'; pos: THREE.Vector3; hard: boolean; water: boolean }
  | { kind: 'jump'; pos: THREE.Vector3; water: boolean }
  | { kind: 'dash'; pos: THREE.Vector3; dir: THREE.Vector3; air: boolean }
  | { kind: 'flight'; pos: THREE.Vector3; on: boolean }
  | { kind: 'boost'; pos: THREE.Vector3; dir: THREE.Vector3 }
  | { kind: 'sprint'; pos: THREE.Vector3; dir: THREE.Vector3 };

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * The player's controller: camera-relative movement, sprint, ninja jump with apex hang, Space×2 flight with boost,
 * Q directional dashes (ground / air / flight) with i-frames and dash→sprint flow, shift-lock strafing, landings.
 */
export class Player extends Fighter {
  private intent: MoveIntent = { dir: new THREE.Vector3(), sprint: false, vertical: 0, flyDir: null, faceYaw: null };
  private flyDirV = new THREE.Vector3();
  private jumpPrep = -1;
  private flyAfterJump = false;
  private jumping = false;
  private dashSprint = false;
  private dashChain = 0;
  private dashRest = 0;
  private dashCooldown = 0;
  private dashWorld = new THREE.Vector3();
  private dashRel: DashDir = 'f';
  private airDashUsed = false;
  private landCancelAt = -1;
  private boostWas = false;
  private sprintWas = false;
  /** Combat target / lock-on (set by combat systems). */
  target: THREE.Vector3 | null = null;
  readonly camCtx: CamCtx = {
    anchor: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    flying: false,
    sprinting: false,
    target: null,
    combat: false,
  };
  private fxListeners: ((e: PlayerFx) => void)[] = [];
  /** Sprint toggle from the mobile control (keyboard uses hold-Left-Shift). */
  sprintToggle = false;

  constructor(
    char: Character,
    world: World,
    private input: Input,
    private cam: CameraRig,
  ) {
    super(char, world);
    char.animator.onEvent((clip, name, data) => this.onAnimEvent(clip, name, data));
    char.animator.setLoco({ idle: 1 }, 0);
  }

  onFx(fn: (e: PlayerFx) => void): void {
    this.fxListeners.push(fn);
  }

  private fx(e: PlayerFx): void {
    for (const fn of this.fxListeners) fn(e);
  }

  get invulnerable(): boolean {
    return this.actionWindow('iframes');
  }

  get flying(): boolean {
    return this.move === 'fly';
  }

  get sprinting(): boolean {
    return this.move === 'ground' && Math.hypot(this.vel.x, this.vel.z) > this.runSpeed * 1.25;
  }

  private onWater(): boolean {
    return this.world.isWater(this.pos.x, this.pos.z) && this.pos.y < 0.3;
  }

  private onAnimEvent(_clip: string, name: string, data?: Record<string, unknown>): void {
    if (name === 'step' && this.move === 'ground') {
      const foot = (data?.foot as 'L' | 'R') ?? 'L';
      this.fx({ kind: 'step', pos: this.char.footWorld(foot, new THREE.Vector3()), foot, dust: Number(data?.dust ?? 0), water: this.onWater() });
    }
  }

  /* ------------------------------------------------------------------ intent */

  private buildIntent(): MoveIntent {
    const inp = this.input;
    const it = this.intent;
    const f = this.cam.groundForward(_f);
    const r = _r.set(-f.z, 0, f.x);
    it.dir.set(0, 0, 0).addScaledVector(f, inp.move.y).addScaledVector(r, inp.move.x);
    const mag = Math.min(1, Math.hypot(inp.move.x, inp.move.y));
    if (it.dir.lengthSq() > 1e-6) it.dir.normalize().multiplyScalar(mag);
    const moving = mag > 0.1;
    if (!moving) this.dashSprint = false;
    it.sprint = moving && (inp.held('sprint') || this.sprintToggle || this.dashSprint);
    it.vertical = 0;
    it.flyDir = null;
    if (this.move === 'fly') {
      if (inp.held('jump')) it.vertical += 1;
      if (inp.held('descend')) it.vertical -= 1;
      if (moving) {
        // W follows the camera pitch (biased so the default view flies level).
        const pitch = THREE.MathUtils.clamp((this.cam.pitch + 0.18) * 1.15, -1.25, 1.25);
        const cp = Math.cos(pitch);
        const fwd3 = _v.set(f.x * cp, Math.sin(pitch), f.z * cp);
        this.flyDirV.set(0, 0, 0).addScaledVector(fwd3, inp.move.y).addScaledVector(r, inp.move.x);
        if (this.flyDirV.lengthSq() > 1e-6) this.flyDirV.normalize().multiplyScalar(mag);
        it.flyDir = this.flyDirV;
      }
    }
    it.faceYaw = inp.shiftLock ? this.cam.forwardYaw : null;
    return it;
  }

  /* ------------------------------------------------------------------ actions */

  private canAct(): boolean {
    if (!this.busy) return true;
    return this.actionWindow('cancel');
  }

  private tryDash(): boolean {
    if (this.dashCooldown > 0) return false;
    if (this.busy && !this.actionWindow('cancel')) return false;
    if (this.move === 'air' && this.airDashUsed) return false;
    const inp = this.input;
    const it = this.intent;
    // World direction: stick/WASD direction relative to the camera; Q alone = backstep from the current facing.
    const mag = it.dir.length();
    if (mag > 0.2) this.dashWorld.copy(it.dir).normalize();
    else this.dashWorld.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const qd = inp.dashDir();
    // Clip from the direction relative to where the fighter faces (keeps facing: side-steps around targets).
    const pick = dashClipFor(this.dashWorld.x, this.dashWorld.z, this.yaw);
    const dir: DashDir = mag <= 0.2 ? qd : pick.dir;
    this.dashRel = dir;
    const air = this.move !== 'ground';
    this.stopCosmetic(0.05);
    this.playAction(`dash_${dir}`, { fadeIn: 0.04, fadeOut: 0.16, mask: air ? 'upper' : 'full' });
    // Align the clip's travel axis with the exact requested direction.
    this.motionYawOffset = mag > 0.2 ? pick.offset : 0;
    this.motionScale = this.move === 'fly' ? 2.2 : air ? 1.3 : 1;
    if (air) {
      this.vel.y = 0;
      this.floatTimer = 0.3;
      if (this.move === 'air') this.airDashUsed = true;
    }
    this.dashChain++;
    this.dashRest = 0;
    if (this.dashChain >= 3) {
      this.dashCooldown = 0.5;
      this.dashChain = 0;
    }
    this.jumpPrep = -1;
    this.fx({ kind: 'dash', pos: this.pos.clone(), dir: this.dashWorld.clone(), air });
    this.cam.kickFov(dir === 'f' ? 6 : 3);
    return true;
  }

  private onDashEnd(): void {
    const moving = this.intent.dir.lengthSq() > 0.04;
    if (this.move === 'fly') {
      this.vel.copy(this.dashWorld).multiplyScalar(this.flySpeed * (moving ? 1.2 : 0.5));
      return;
    }
    if (moving) {
      // ZZZ flow: a dash with the stick held rolls straight into a sprint.
      this.dashSprint = this.dashRel === 'f' || this.dashRel === 'l' || this.dashRel === 'r';
      const spd = this.dashSprint ? this.sprintSpeed * 0.9 : this.runSpeed * 0.7;
      this.vel.x = this.dashWorld.x * spd;
      this.vel.z = this.dashWorld.z * spd;
    } else {
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
  }

  private startJump(): void {
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > this.runSpeed * 1.1) {
      // Sprinting: no crouch, launch straight away to keep the momentum.
      this.launch();
      return;
    }
    this.jumpPrep = 0.075;
    this.playCosmetic('jump_start', { fadeIn: 0.03, speed: 1.4, hold: true });
  }

  private launch(): void {
    this.jumpPrep = -1;
    this.jump();
    this.jumping = true;
    this.airDashUsed = false;
    this.playCosmetic('jump_rise', { fadeIn: 0.04, hold: true, start: 0.02 });
    this.fx({ kind: 'jump', pos: this.pos.clone(), water: this.onWater() });
    if (this.flyAfterJump) {
      this.flyAfterJump = false;
      this.enterFlight();
    }
  }

  private enterFlight(): void {
    this.startFlight();
    this.jumping = false;
    this.gravityScale = 1;
    this.stopCosmetic(0.25);
    this.vel.y = Math.max(this.vel.y, 5);
    this.fx({ kind: 'flight', pos: this.pos.clone(), on: true });
  }

  private exitFlight(): void {
    this.stopFlight();
    this.airCarry = Math.hypot(this.vel.x, this.vel.z);
    this.airDashUsed = false;
    this.fx({ kind: 'flight', pos: this.pos.clone(), on: false });
  }

  protected override onLand(impact: number): void {
    this.jumping = false;
    this.gravityScale = 1;
    this.airDashUsed = false;
    const water = this.onWater();
    if (impact > 21) {
      this.playAction('land_hard', { fadeIn: 0.03, fadeOut: 0.25 });
      this.vel.x *= 0.1;
      this.vel.z *= 0.1;
      this.cam.shake(Math.min(0.75, impact / 45));
      this.cam.punch(0.6);
      this.fx({ kind: 'land', pos: this.pos.clone(), hard: true, water });
    } else {
      const moving = this.intent.dir.lengthSq() > 0.04;
      this.playCosmetic('land', { fadeIn: 0.03, fadeOut: moving ? 0.14 : 0.2, speed: moving ? 1.6 : 1 });
      this.landCancelAt = moving ? 0.1 : -1;
      if (impact > 8) this.cam.shake(0.08);
      this.fx({ kind: 'land', pos: this.pos.clone(), hard: false, water });
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    const inp = this.input;
    const it = this.buildIntent();
    const moving = it.dir.lengthSq() > 0.01;
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (!this.busy) {
      this.dashRest += dt;
      if (this.dashRest > 0.6) this.dashChain = 0;
    }

    // Finished locking action → clear and hand over to locomotion.
    if (this.action && this.action.ended) {
      const wasDash = this.actionName.startsWith('dash_');
      this.stopAction(this.move === 'fly' ? 0.2 : 0.14);
      if (wasDash) this.onDashEnd();
    }
    // Cancel windows: moving out of landings and dash recoveries.
    if (this.busy && this.actionWindow('cancel') && moving && !this.actionName.startsWith('dash_')) this.stopAction(0.18);
    if (this.cosmetic && this.landCancelAt >= 0 && this.cosmetic.time >= this.landCancelAt) {
      this.stopCosmetic(0.14);
      this.landCancelAt = -1;
    }

    // Dash (Q).
    if (inp.buffered('dodge', 0.2) && this.tryDash()) inp.consume('dodge', 0.2);

    // Jump / flight (Space, Space×2).
    if (inp.pressed('jump')) {
      if (this.move === 'ground') {
        if (this.jumpPrep >= 0) {
          if (inp.doubleTapped('jump')) this.flyAfterJump = true;
        } else if (this.canAct()) {
          if (this.busy) this.stopAction(0.08);
          this.startJump();
        }
      } else if (inp.doubleTapped('jump')) {
        if (this.move === 'fly') this.exitFlight();
        else this.enterFlight();
      }
    }
    if (this.jumpPrep >= 0) {
      this.jumpPrep -= dt;
      if (this.jumpPrep < 0) this.launch();
    }
    // Short hop when Space is released early.
    if (this.move === 'air' && this.jumping && inp.released('jump') && this.vel.y > 5) this.vel.y *= 0.6;
    // Ninja apex hang: gravity eases off around the top of the jump.
    if (this.move === 'air' && this.jumping) {
      const vy = this.vel.y;
      this.gravityScale = vy < 2.3 && vy > -1.4 ? 0.5 : 1;
      if (this.cosmetic && this.cosmetic.clip.name === 'jump_rise' && vy < -2) this.stopCosmetic(0.35);
    } else this.gravityScale = 1;

    // Touch down from flight when descending onto the ground.
    if (this.move === 'fly') {
      const g = Math.max(this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5), -0.02);
      if (this.pos.y - g < 0.45 && (it.vertical < 0 || this.vel.y < -6)) {
        const impact = Math.max(-this.vel.y, Math.hypot(this.vel.x, this.vel.z) * 0.5);
        this.move = 'ground';
        this.grounded = true;
        this.pos.y = g;
        this.vel.y = 0;
        this.fx({ kind: 'flight', pos: this.pos.clone(), on: false });
        this.onLand(impact);
      }
    }

    // Facing.
    if (!this.busy || this.actionName.startsWith('dash_')) {
      if (it.faceYaw !== null) this.turnToward(it.faceYaw, 20, dt);
      else if (this.target && !this.flying && !it.sprint) {
        if (moving) this.turnToward(Math.atan2(it.dir.x, it.dir.z), 12, dt);
      } else if (this.move === 'fly') {
        const hv = Math.hypot(this.vel.x, this.vel.z);
        const want = it.flyDir && Math.hypot(it.flyDir.x, it.flyDir.z) > 0.15 ? Math.atan2(it.flyDir.x, it.flyDir.z) : hv > 2 ? Math.atan2(this.vel.x, this.vel.z) : null;
        // Backpedal / strafe in the air without spinning around.
        if (want !== null && inp.move.y >= -0.2) this.turnToward(want, 5.5, dt);
        else if (inp.move.y < -0.2) this.turnToward(this.cam.forwardYaw, 5.5, dt);
      } else if (moving && !this.busy) {
        const rate = this.move === 'air' ? 7 : it.sprint ? 8 : 13;
        this.turnToward(Math.atan2(it.dir.x, it.dir.z), rate, dt);
      }
    }

    this.integrate(dt, this.jumpPrep >= 0 ? null : it);
    this.driveLocomotion(dt, it, !!this.target);

    // Speed effects.
    const hv = Math.hypot(this.vel.x, this.vel.z);
    const sprintNow = this.sprinting;
    if (sprintNow && !this.sprintWas) {
      this.cam.kickFov(4);
      this.fx({ kind: 'sprint', pos: this.pos.clone(), dir: this.forward() });
    }
    this.sprintWas = sprintNow;
    const boost = this.flying && this.vel.length() > this.flySpeed * 1.4;
    if (boost && !this.boostWas) {
      this.cam.kickFov(10);
      this.cam.shake(0.25);
      this.fx({ kind: 'boost', pos: this.pos.clone(), dir: this.vel.clone().normalize() });
    }
    this.boostWas = boost;

    // Head follows the camera's gaze when idle/walking (or the target).
    if (this.target) this.char.lookTarget = this.target;
    else if (!this.busy && hv < 3 && this.move === 'ground') {
      const f = this.cam.groundForward(_d);
      this.char.lookTarget = _v.copy(this.pos).addScaledVector(f, 12).setY(this.pos.y + 1.5 + Math.sin(this.cam.pitch) * 6);
    } else this.char.lookTarget = null;

    this.syncCharacter(dt);

    // Camera context.
    const c = this.camCtx;
    c.anchor.copy(this.pos).setY(this.pos.y + (this.flying ? 1.15 : 1.45) * this.char.scale);
    c.velocity.copy(this.vel);
    c.flying = this.flying;
    c.sprinting = sprintNow;
    c.target = this.target;
    c.combat = this.busy && !this.actionName.startsWith('dash_') && !this.actionName.startsWith('land');
  }
}
