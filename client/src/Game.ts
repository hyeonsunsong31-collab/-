import * as THREE from 'three';
import { Clock } from './core/Clock.ts';
import { Renderer } from './render/Renderer.ts';
import { Lighting } from './render/Lighting.ts';
import { SkySystem } from './render/SkySystem.ts';
import { QUALITY, type QualityLevel } from './render/Quality.ts';
import { World } from './world/World.ts';

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
  ready = false;
  private onFrame: ((g: Game) => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    readonly qualityLevel: QualityLevel,
  ) {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 12000);
    this.camera.position.set(0, 30, 60);
  }

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
    this.world.update(0, this.camera);
    await progress(0.9, 'Warming up shaders…');
    const t1 = performance.now();
    this.renderer.gl.compile(this.scene, this.camera);
    console.info(`[boot] shaders compiled in ${Math.round(performance.now() - t1)} ms`);
    this.ready = true;
    await progress(1, 'Ready');
  }

  addFrameHook(fn: (g: Game) => void): void {
    this.onFrame.push(fn);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  frame(): void {
    this.clock.tick();
    const dt = this.clock.realDt;
    for (const fn of this.onFrame) fn(this);
    this.camera.updateMatrixWorld();
    this.sky.update(this.clock.worldDt, this.camera);
    this.world.update(this.clock.worldDt, this.camera);
    this.lighting.update(dt);
    this.renderer.atmosphere.sync(this.camera, this.lighting.sunDir);
    this.renderer.combat.u('uT').value = this.clock.realTime;
    this.renderer.distort.u('uT').value = this.clock.realTime;
    this.renderer.render(dt);
    this.renderer.adapt(dt);
  }
}
