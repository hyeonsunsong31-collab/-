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
import { Hero } from './gameplay/Hero.ts';
import { CombatSystem } from './combat/CombatSystem.ts';
import { BotControls } from './ai/BotControls.ts';
import { RivalAI } from './ai/RivalAI.ts';
import { RIVAL_LOOK } from './character/Looks.ts';
import { ScreenFx } from './fx/ScreenFx.ts';
import { Vfx } from './fx/Vfx.ts';
import { ChainAttack } from './combat/ChainAttack.ts';
import type { CombatEvent } from './combat/CombatSystem.ts';
import type { CompiledClip } from './animation/Clip.ts';
import { Spawner } from './gameplay/Spawner.ts';
import { Nameplates } from './ui/Nameplates.ts';
import type { Combatant } from './combat/Combatant.ts';
import { CharacterScreen } from './ui/CharacterScreen.ts';
import { ProgressToasts } from './ui/ProgressToasts.ts';
import { portraitShot } from './camera/Shots.ts';
import type { SaveService } from './net/SaveService.ts';
import { STAT_KEYS, basePowerLevel, cloneStats, generateRival, type Difficulty, type Profile, type Stats } from '@ak/shared';

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
  combat!: CombatSystem;
  screenFx!: ScreenFx;
  vfx!: Vfx;
  chain!: ChainAttack;
  spawner!: Spawner;
  nameplates!: Nameplates;
  clips!: Map<string, CompiledClip>;
  status!: CharacterScreen;
  toasts!: ProgressToasts;
  /** A full-screen menu is open (world frozen, gameplay input captured). */
  menuOpen = false;
  /** Called when the player defeats a foe (progression hooks in here). */
  onKill: ((foe: Combatant) => void) | null = null;
  /** Non-player heroes (rival bots). */
  readonly bots: { hero: Hero; ai: RivalAI }[] = [];
  ready = false;
  /** When false the gameplay loop does not drive the camera (preview / photo modes). */
  playing = false;
  private onFrame: ((g: Game) => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    readonly qualityLevel: QualityLevel,
    readonly save: SaveService,
  ) {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 12000);
    this.camera.position.set(0, 30, 60);
    // A resize clears the drawing buffer; when the realtime loop is halted (tests) repaint the last frame.
    window.addEventListener('resize', () => {
      if (this.halted && this.ready) requestAnimationFrame(() => requestAnimationFrame(() => this.renderer.render(0)));
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
    this.combat = new CombatSystem(this.clock, this.world);
    this.clips = clipLibrary();
    const hero = new Character(HERO_LOOK, this.lighting, this.clips);
    const prof = this.save.profile;
    this.player = new Player(hero, this.world, cloneStats(prof.stats), prof.level, this.input, this.camRig);
    this.player.name = prof.name;
    this.combat.add(this.player);
    this.combat.player = this.player;
    this.screenFx = new ScreenFx(this.renderer, this.camera, this.clock);
    this.combat.on((e) => this.onCombatEvent(e));
    this.vfx = new Vfx(this.lighting, this.world, q.particleScale, this.player);
    this.vfx.connect(this.combat);
    this.vfx.track(this.player, true);
    this.scene.add(this.vfx.group);
    this.chain = new ChainAttack(this.clock, this.combat, this.camRig, this.input);
    this.nameplates = new Nameplates();
    this.nameplates.add(this.player, true);
    this.spawner = new Spawner(this.scene, this.lighting, this.world, this.combat, this.clips);
    this.spawner.onSpawn = (m) => {
      this.nameplates.add(m);
      m.onRune = (pos, t) => this.vfx.rune(pos, t);
    };
    this.spawner.onDespawn = (m) => {
      this.nameplates.remove(m);
      this.vfx.ghosts.forget(m.char);
    };
    this.toasts = new ProgressToasts();
    this.status = new CharacterScreen(this.save);
    this.status.onOpen = () => this.setMenu(true);
    this.status.onClose = () => this.setMenu(false);
    this.bindProgression();
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

  /** Camera + screen presentation for combat events. */
  private onCombatEvent(e: CombatEvent): void {
    const p = this.player;
    this.screenFx.handle(e, p);
    const cam = this.camRig;
    switch (e.type) {
      case 'hit':
        if (e.attacker === p || e.target === p) {
          const tick = e.def.id.endsWith('_tick');
          cam.shake(e.def.shake * (tick ? 0.35 : 1) * (e.target === p ? 1.2 : 1) * (e.res.crit ? 1.2 : 1));
          if (tick) break;
          if (e.def.tier >= 3 && e.attacker === p) cam.punch(-0.35);
          if (e.def.kind === 'knockdown' && e.attacker === p) cam.dutch(e.def.tier >= 4 ? 7 : 4);
        }
        break;
      case 'blast':
      case 'crater': {
        const d = (e.type === 'blast' ? e.pos : e.pos).distanceTo(p.pos);
        cam.shake(Math.max(0, 0.7 - d * 0.02));
        break;
      }
      case 'slam':
        if (e.pos.distanceTo(p.pos) < 25) cam.shake(0.25);
        break;
      case 'perfectDodge':
        if (e.who === p) cam.dutch(-5);
        break;
      case 'flash':
        this.nameplates.telegraph(e.who, e.color);
        break;
      case 'death':
        if (e.by === p && e.who !== p) this.onKill?.(e.who);
        break;
    }
  }

  /** Kills → XP (batched to the server), level-ups → stats, heal, fanfare; allocations → live stats. */
  private bindProgression(): void {
    this.onKill = (foe) => {
      // Rivals reward through the arena match flow, not per kill.
      if (foe instanceof Hero) return;
      this.save.reportKill(foe.level, basePowerLevel(foe.stats));
    };
    this.save.onChange((p) => this.syncPlayer(p));
    this.save.onProgress((e) => {
      if (e.kind === 'xp' && e.xp) this.toasts.xp(e.xp);
      if ((e.kind === 'level' || e.kind === 'match') && e.levels && e.levels > 0) {
        const to = e.profile.level;
        this.toasts.levelUp(to - e.levels, to, e.profile.unspent);
        this.vfx.levelUp(this.player);
        this.camRig.shake(0.2);
      }
    });
  }

  private syncPlayer(p: Profile): void {
    const pl = this.player;
    const leveled = p.level > pl.level;
    const changed = leveled || p.level !== pl.level || STAT_KEYS.some((k) => pl.stats[k] !== p.stats[k]);
    // A level-up fully restores the fighter; re-allocations keep the current HP fraction.
    if (changed) pl.setStats(p.level, cloneStats(p.stats), leveled);
    pl.name = p.name;
  }

  /** Whether a full-screen menu may open right now (not mid-cinematic, reeling or dead). */
  get canOpenMenu(): boolean {
    const p = this.player;
    return this.playing && !this.chain.active && !this.camRig.inCinematic && !this.clock.slowmoActive && p.alive && p.state === 'normal' && !p.busy && (p.move === 'ground' || p.flying);
  }

  /** Freeze the world (the fighter keeps breathing for the portrait camera) and hand input to the UI. */
  private setMenu(on: boolean): void {
    this.menuOpen = on;
    this.clock.freeze('menu', on);
    this.input.uiCapture = on;
    if (on) {
      this.input.releaseAll();
      this.input.clearBuffer();
      this.camRig.play(portraitShot(this.player));
    } else {
      this.camRig.releaseShot();
    }
    document.body.classList.toggle('ak-menu-open', on);
  }

  /** Spawn a rival bot (training dummy / sparring partner) in front of the player. */
  spawnRival(difficulty: Difficulty = 'normal', dist = 9, stats?: Stats, level?: number): Hero {
    const spec = generateRival(this.player.stats, this.player.level, difficulty, Math.floor(Math.random() * 1e9));
    const ctl = new BotControls();
    const ch = new Character(RIVAL_LOOK, this.lighting, this.clips);
    const p = this.player.pos.clone().addScaledVector(this.player.forward(), dist);
    const spot = this.findSpawn(p.x, p.z);
    const hero = new Hero(ch, this.world, spec.name, 'foe', level ?? spec.level, stats ?? spec.stats, ctl);
    hero.maxTier = spec.maxTier;
    hero.teleport(spot, this.player.yaw + Math.PI);
    const ai = new RivalAI(spec.skill, spec.style);
    ai.foe = this.player;
    ctl.brain = (h, c, dt) => ai.step(h, c, dt);
    this.scene.add(ch.group);
    this.combat.add(hero);
    this.vfx.track(hero);
    this.nameplates.add(hero);
    this.bots.push({ hero, ai });
    return hero;
  }

  /** Nearest walkable spot to (x, z) that is clear of colliders. */
  findSpawn(x: number, z: number): THREE.Vector3 {
    const out = { x: 0, z: 0 };
    for (let r = 0; r < 60; r += 1.5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        // Ground level only (never the top of a trunk or roof collider).
        const y = this.world.groundAt(px, pz, this.world.terrainHeight(px, pz) + 0.3);
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
      if (this.input.pressed('character') && !this.menuOpen && this.canOpenMenu) this.status.open();
      this.chain.update(dt, this.clock.playerDt);
      this.player.update(this.clock.playerDt);
      for (const b of this.bots) b.hero.update(this.clock.worldDt);
      this.spawner.update(this.clock.worldDt, this.player);
      this.combat.update(this.clock.worldDt, this.clock.playerDt);
      this.camRig.update(dt, this.input, this.player.camCtx);
      this.input.endFrame();
      const pl = this.player;
      const boosting = pl.flying && pl.vel.length() > pl.flySpeed * 1.4 ? 0.6 : pl.sprinting ? 0.22 : 0;
      const charging = pl.power === 'charging' ? 1 : pl.power === 'powerup' ? 0.55 : pl.actionName === 'beam_charge' || pl.actionName === 'heavy_charge' ? 0.4 : 0;
      this.screenFx.update(dt, pl, boosting, charging);
      this.vfx.update(this.clock.worldDt, dt, this.camera);
    }
    if (this.playing) {
      this.camera.updateMatrixWorld();
      this.nameplates.playerLevel = this.player.level;
      this.nameplates.update(dt, this.camera, this.chain.active || this.camRig.inCinematic);
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
