import * as THREE from 'three';
import { Clock } from './core/Clock.ts';
import { Renderer } from './render/Renderer.ts';
import { Lighting } from './render/Lighting.ts';
import { SkySystem } from './render/SkySystem.ts';
import { QUALITY, type QualityLevel } from './render/Quality.ts';
import { World } from './world/World.ts';
import { Input } from './input/Input.ts';
import { CameraRig } from './camera/CameraRig.ts';
import { Character } from './character/Character.ts';
import { HERO_LOOK } from './character/Looks.ts';
import { animeShared } from './character/AnimeMaterial.ts';
import { clipLibrary } from './animation/clips/index.ts';
import { Player } from './gameplay/Player.ts';

export type BootProgress = (frac: number, msg: string) => Promise<void>;

/** Top-level game object: owns the loop and every subsystem. */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly clock = new Clock();
  renderer!: Renderer;
  lighting!: Lighting;
  sky!: SkySystem;
  world!: World;
  input!: Input;
  camRig!: CameraRig;
  player!: Player;
  ready = false;
  /** When false the gameplay loop does not drive the camera (preview / photo modes). */
  playing = false;
  private onFrame: ((g: Game) => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    readonly qualityLevel: QualityLevel,
  ) {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 12000);
    this.camera.position.set(0, 30, 60);
    // A resize clears the drawing buffer; when the realtime loop is halted (tests) repaint the last frame.
    window.addEventListener('resize', () => {
      if (this.halted && this.ready) requestAnimationFrame(() => this.renderer.render(0));
    });
  }

  /** Minimal scene (sky + sun + flat ground) for the pose gallery and tests. */
  async bootLite(): Promise<void> {
    const q = QUALITY[this.qualityLevel];
    this.lighting = new Lighting(this.scene, this.camera, q);
    const sun = SkySystem.createSun(this.lighting.sunDir);
    this.renderer = new Renderer(this.canvas, this.scene, this.camera, q, sun);
    this.sky = new SkySystem(this.scene, this.renderer.gl, this.lighting.sunDir, sun);
    this.scene.environment = this.sky.envMap;
    this.scene.environmentIntensity = 1.0;
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
      this.lighting.register(new THREE.MeshStandardMaterial({ color: '#4f7a2a', roughness: 0.95 }), undefined, 'gallery-ground'),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.lite = true;
    this.ready = true;
  }

  lite = false;
  /** Tests stop the realtime loop and drive frames through simulate(). */
  halted = false;

  async boot(progress: BootProgress): Promise<void> {
    const q = QUALITY[this.qualityLevel];
    await progress(0.05, 'Igniting the sun…');
    this.lighting = new Lighting(this.scene, this.camera, q);
    const sun = SkySystem.createSun(this.lighting.sunDir);
    this.renderer = new Renderer(this.canvas, this.scene, this.camera, q, sun);
    this.sky = new SkySystem(this.scene, this.renderer.gl, this.lighting.sunDir, sun);
    this.scene.environment = this.sky.envMap;
    this.scene.environmentIntensity = 1.0;
    await progress(0.15, 'Raising mountains and carving rivers…');
    const t0 = performance.now();
    this.world = new World(1337, this.lighting, q, this.renderer.gl, this.sky.envMap);
    console.info(`[boot] world generated in ${Math.round(performance.now() - t0)} ms`);
    await progress(0.75, 'Growing forests…');
    this.scene.add(this.world.group);
    await progress(0.82, 'Awakening the fighter…');
    this.input = new Input(this.canvas);
    this.camRig = new CameraRig(this.camera, this.world);
    const hero = new Character(HERO_LOOK, this.lighting, clipLibrary());
    this.player = new Player(hero, this.world, this.input, this.camRig);
    this.scene.add(hero.group);
    const spawn = this.findSpawn(6, 22);
    this.player.teleport(spawn, Math.PI);
    this.camRig.yaw = 0;
    this.playing = true;
    this.player.update(0.016);
    this.camRig.update(0.016, this.input, this.player.camCtx);
    this.world.update(0, this.camera);
    await progress(0.9, 'Warming up shaders…');
    const t1 = performance.now();
    this.renderer.gl.compile(this.scene, this.camera);
    console.info(`[boot] shaders compiled in ${Math.round(performance.now() - t1)} ms`);
    this.ready = true;
    await progress(1, 'Ready');
  }

  /** Nearest walkable spot to (x, z) that is clear of colliders. */
  findSpawn(x: number, z: number): THREE.Vector3 {
    const out = { x: 0, z: 0 };
    for (let r = 0; r < 60; r += 1.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const y = this.world.groundAt(px, pz, 1e4);
        if (!this.world.colliders.resolve(px, pz, 0.6, y, 1.8, out) && !this.world.isWater(px, pz)) return new THREE.Vector3(px, y, pz);
        if (r === 0) break;
      }
    }
    return new THREE.Vector3(x, this.world.groundAt(x, z), z);
  }

  addFrameHook(fn: (g: Game) => void): void {
    this.onFrame.push(fn);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.halted) this.frame();
    };
    requestAnimationFrame(loop);
  }

  frame(): void {
    this.clock.tick();
    this.step();
    this.renderer.render(this.clock.realDt);
    this.renderer.adapt(this.clock.realDt);
  }

  /** Advance every system by the clock's current deltas (no rendering). */
  private step(): void {
    const dt = this.clock.realDt;
    if (this.playing) {
      this.input.update(dt);
      this.player.update(this.clock.playerDt);
      this.camRig.update(dt, this.input, this.player.camCtx);
      this.input.endFrame();
    }
    for (const fn of this.onFrame) fn(this);
    this.camera.updateMatrixWorld();
    animeShared.uSunView.value.copy(this.lighting.sunDir).transformDirection(this.camera.matrixWorldInverse);
    animeShared.uTime.value = this.clock.realTime;
    this.sky.update(this.clock.worldDt, this.camera);
    if (!this.lite) this.world.update(this.clock.worldDt, this.camera);
    this.lighting.update(dt);
    this.renderer.atmosphere.sync(this.camera, this.lighting.sunDir);
    this.renderer.combat.u('uT').value = this.clock.realTime;
    this.renderer.distort.u('uT').value = this.clock.realTime;
  }

  /** Deterministic fixed-step simulation for tests: runs `frames` steps of `dt` then renders once. */
  simulate(frames: number, dt = 1 / 60, render = true): void {
    this.halted = true;
    for (let i = 0; i < frames; i++) {
      this.clock.advance(dt);
      this.step();
    }
    if (render) this.renderer.render(dt);
  }
}
