import * as THREE from 'three';
import type { Stats } from '@ak/shared';
import { Hero, type HeroControls } from './Hero.ts';
import type { Character } from '../character/Character.ts';
import type { World } from '../world/World.ts';
import type { Input } from '../input/Input.ts';
import type { CameraRig, CamCtx } from '../camera/CameraRig.ts';
import { transformShot, ultimateShot } from '../camera/Shots.ts';

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Hero controls from keyboard/mouse/touch, made camera-relative through the camera rig. */
export class PlayerControls implements HeroControls {
  readonly move = new THREE.Vector3();
  private flyV = new THREE.Vector3();
  flyDir: THREE.Vector3 | null = null;
  vertical = 0;
  faceYaw: number | null = null;
  sprint = false;
  aim: THREE.Vector3 | null = new THREE.Vector3();
  /** Sprint toggle from the mobile control (keyboard uses hold-Left-Shift). */
  sprintToggle = false;

  constructor(
    readonly buttons: Input,
    private cam: CameraRig,
  ) {}

  refresh(hero: Hero): void {
    const inp = this.buttons;
    const f = this.cam.groundForward(_f);
    const r = _v.set(-f.z, 0, f.x);
    const mag = Math.min(1, Math.hypot(inp.move.x, inp.move.y));
    this.move.set(0, 0, 0).addScaledVector(f, inp.move.y).addScaledVector(r, inp.move.x);
    if (this.move.lengthSq() > 1e-6) this.move.normalize().multiplyScalar(mag);
    this.sprint = inp.held('sprint') || this.sprintToggle;
    this.vertical = (inp.held('jump') ? 1 : 0) - (inp.held('descend') ? 1 : 0);
    this.flyDir = null;
    if (hero.flying && mag > 0.1) {
      // W follows the camera pitch (biased so the default view flies level).
      const pitch = THREE.MathUtils.clamp((this.cam.pitch + 0.18) * 1.15, -1.25, 1.25);
      const cp = Math.cos(pitch);
      this.flyV.set(f.x * cp * inp.move.y + r.x * inp.move.x, Math.sin(pitch) * inp.move.y, f.z * cp * inp.move.y + r.z * inp.move.x);
      if (this.flyV.lengthSq() > 1e-6) this.flyV.normalize().multiplyScalar(mag);
      this.flyDir = this.flyV;
    }
    this.faceYaw = inp.shiftLock ? this.cam.forwardYaw : null;
    // Ki aim without a target: the point the camera centre looks at, 60 m out.
    const cp = Math.cos(this.cam.pitch);
    this.aim!.copy(this.cam.camera.position).add(_v.set(-Math.sin(this.cam.yaw) * cp, Math.sin(this.cam.pitch) + 0.08, -Math.cos(this.cam.yaw) * cp).multiplyScalar(60));
  }
}

/**
 * The player: a Hero driven by `PlayerControls`, feeding the camera (framing context, FOV kicks, shake on
 * landings and boosts, dodge zoom) and the head look-at that follows the camera's gaze when idle.
 */
export class Player extends Hero {
  readonly camCtx: CamCtx = {
    anchor: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    flying: false,
    sprinting: false,
    target: null,
    combat: false,
  };
  private sprintWas = false;
  private boostWas = false;
  private targetChest = new THREE.Vector3();

  constructor(
    char: Character,
    world: World,
    stats: Stats,
    level: number,
    readonly input: Input,
    readonly cam: CameraRig,
  ) {
    super(char, world, 'You', 'hero', level, stats, new PlayerControls(input, cam));
  }

  get pcontrols(): PlayerControls {
    return this.controls as PlayerControls;
  }

  protected override onFx(name: string, data?: Record<string, unknown>): void {
    const cam = this.cam;
    switch (name) {
      case 'dash':
        cam.kickFov(data?.rel === 'f' ? 6 : 3);
        break;
      case 'land':
        if (data?.hard) {
          cam.shake(Math.min(0.75, Number(data.impact ?? 30) / 45));
          cam.punch(0.6);
        } else if (Number(data?.impact ?? 0) > 8) cam.shake(0.08);
        break;
      case 'perfectDodge':
        cam.kickFov(-6);
        cam.punch(-0.8);
        break;
      case 'parry':
        cam.shake(0.3);
        cam.punch(-0.5);
        break;
      case 'transformCharge':
        cam.play(transformShot(this, 1.35));
        break;
      case 'transformBurst':
        cam.shake(0.9);
        cam.kickFov(12);
        cam.punch(2.2);
        break;
      case 'ultimate':
        cam.play(ultimateShot(this, this.target?.alive ? this.target : null));
        break;
      case 'exSpecial':
        cam.kickFov(4);
        break;
    }
  }

  /** Tab / TARGET: cycle through nearby foes, nearest first. */
  private cycleTarget(): void {
    const cs = this.combat;
    if (!cs) return;
    const list = cs
      .foesOf(this)
      .filter((f) => f.alive && f.pos.distanceTo(this.pos) < 32)
      .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
    if (!list.length) {
      this.target = null;
      return;
    }
    const i = this.target ? list.indexOf(this.target) : -1;
    this.target = list[(i + 1) % list.length];
    this.fx('targetLock', { who: this.target });
  }

  override update(dt: number): void {
    if (!this.scripted && this.input.pressed('lock')) this.cycleTarget();
    super.update(dt);
    const hv = Math.hypot(this.vel.x, this.vel.z);
    const sprintNow = this.sprinting;
    if (sprintNow && !this.sprintWas) {
      this.cam.kickFov(4);
      this.fx('sprint', { pos: this.pos.clone(), dir: this.forward() });
    }
    this.sprintWas = sprintNow;
    const boost = this.flying && this.vel.length() > this.flySpeed * 1.4;
    if (boost && !this.boostWas) {
      this.cam.kickFov(10);
      this.cam.shake(0.25);
      this.fx('boost', { pos: this.pos.clone(), dir: this.vel.clone().normalize() });
    }
    this.boostWas = boost;

    // Head follows the camera's gaze when idle and nothing else holds its attention.
    if (!this.target && !this.busy && hv < 3 && this.move === 'ground') {
      const f = this.cam.groundForward(_f);
      this.char.lookTarget = _v.copy(this.pos).addScaledVector(f, 12).setY(this.pos.y + 1.5 + Math.sin(this.cam.pitch) * 6);
    } else if (!this.target) this.char.lookTarget = null;

    const c = this.camCtx;
    c.anchor.copy(this.pos).setY(this.pos.y + (this.flying ? 1.15 : 1.45) * this.char.scale);
    c.velocity.copy(this.vel);
    c.flying = this.flying;
    c.sprinting = sprintNow;
    c.target = this.target?.alive && this.inCombat ? this.target.chest(this.targetChest) : null;
    c.combat = this.busy && !this.actionName.startsWith('dash_') && !this.actionName.startsWith('land');
  }
}
