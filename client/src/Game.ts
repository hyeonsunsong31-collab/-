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
import { Arena } from './gameplay/Arena.ts';
import { Hud } from './ui/Hud.ts';
import { MapView, type MapMarker } from './ui/MapView.ts';
import { TouchControls } from './ui/TouchControls.ts';
import { TitleScreen, PauseMenu, SettingsPanel, ControlsPanel, DefeatScreen } from './ui/Screens.ts';
import type { Settings } from './core/Settings.ts';
import { isTouchDevice } from './render/Quality.ts';
import { titleShot } from './camera/Shots.ts';
import { POIS } from './world/layout.ts';
import { GameAudio } from './audio/GameAudio.ts';
import { COMBAT, nextForm } from '@ak/shared';
import { STAT_KEYS, basePowerLevel, cloneStats, generateRival, type BotSpec, type Difficulty, type Profile, type Stats } from '@ak/shared';

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
  arena!: Arena;
  hud!: Hud;
  map!: MapView;
  touch!: TouchControls;
  title!: TitleScreen;
  pause!: PauseMenu;
  settingsPanel!: SettingsPanel;
  controlsPanel!: ControlsPanel;
  defeat!: DefeatScreen;
  audio!: GameAudio;
  /** The title screen owns the camera and the fighter. */
  inTitle = false;
  private captures = new Set<string>();
  private regionId: string | null = null;
  private regionCheck = 0;
  private deadT = 0;
  /** A full-screen menu is open (world frozen, gameplay input captured). */
  menuOpen = false;
  /** Called when the player defeats a foe (progression hooks in here). */
  onKill: ((foe: Combatant) => void) | null = null;
  /** Non-player heroes (rival bots). */
  readonly bots: { hero: Hero; ai: RivalAI; ctl: BotControls }[] = [];
  ready = false;
  /** When false the gameplay loop does not drive the camera (preview / photo modes). */
  playing = false;
  private onFrame: ((g: Game) => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    readonly qualityLevel: QualityLevel,
    readonly save: SaveService,
    readonly settings: Settings,
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
    this.arena = new Arena(this);
    this.buildInterface();
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
    this.vfx.prewarm(this.player);
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

  /** HUD, maps, touch controls and the menu screens. */
  private buildInterface(): void {
    const ui = document.getElementById('ui-root') ?? document.body;
    this.hud = new Hud({ skin: HERO_LOOK.skin, eye: HERO_LOOK.eyeColor, band: HERO_LOOK.bands }, HERO_LOOK.hairColor, ui);
    this.map = new MapView(this.world, ui);
    this.map.setCamps(this.spawner.camps.map((c) => ({ id: c.id, name: c.name, x: c.x, z: c.z, level: c.level })));
    this.map.onClose = () => this.setUiCapture('map', false);
    this.map.onTravelArena = () => this.arena.openSelect();
    this.touch = new TouchControls(this.input, ui);
    this.title = new TitleScreen(ui);
    this.pause = new PauseMenu(ui);
    this.settingsPanel = new SettingsPanel(ui, this.settings, this.qualityLevel);
    this.controlsPanel = new ControlsPanel(ui);
    this.defeat = new DefeatScreen(ui);
    // Combat feedback: damage numbers, combo counter, haptics.
    this.combat.on((e) => {
      this.hud.onCombat(e, this.player);
      if (e.type === 'hit' && (e.attacker === this.player || e.target === this.player)) this.touch.vibrate(e.target === this.player ? 35 : e.def.tier >= 3 ? 18 : 8);
    });
    this.player.fxHooks.push((name) => {
      if (name === 'transformBurst') this.hud.formCard(this.player.form);
    });
    this.audio = new GameAudio(this);
    // Menus.
    this.pause.onResume = () => this.setPause(false);
    this.pause.onStatus = () => {
      this.setPause(false);
      this.status.open();
    };
    this.pause.onMap = () => {
      this.setPause(false);
      this.openMap();
    };
    this.pause.onSettings = () => this.settingsPanel.open();
    this.pause.onControls = () => this.controlsPanel.open();
    this.pause.onTitle = () => {
      void this.save.settle().finally(() => location.reload());
    };
    this.title.onSettings = () => this.settingsPanel.open();
    this.title.onControls = () => this.controlsPanel.open();
    this.title.onStart = () => this.leaveTitle();
    this.defeat.onRise = () => this.respawn();
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.pause.isOpen || this.settingsPanel.isOpen || this.controlsPanel.isOpen) return;
      e.preventDefault();
      this.setPause(false);
    });
    this.settings.onChange(() => this.applySettings());
    this.applySettings();
  }

  /** Push the player's preferences into the live systems. */
  applySettings(): void {
    const s = this.settings.data;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.touch.sensitivity = s.sensitivity;
    this.camRig.shakeScale = s.shake;
    this.hud.showDamage = s.damageNumbers;
    const touch = s.touch === 'on' || (s.touch === 'auto' && isTouchDevice());
    this.touch.enabled = touch;
    this.hud.root.classList.toggle('touch', touch);
    this.hud.touch = touch;
    this.status.touch = touch;
    this.toasts.touch = touch;
  }

  /** Esc / MENU: everything stops, including the fighter. */
  setPause(on: boolean): void {
    if (on === this.pause.isOpen) return;
    if (on) this.pause.open();
    else this.pause.close();
    this.clock.freeze('pause', on, true);
    this.setUiCapture('pause', on);
  }

  openMap(): void {
    if (this.map.isOpen) return;
    this.setUiCapture('map', true, true);
    this.map.open(this.player.pos.x, this.player.pos.z, this.player.yaw);
  }

  /** Title screen: the fighter charges their aura under a slow orbit while the menu waits. */
  enterTitle(): void {
    const p = this.player;
    this.inTitle = true;
    p.scripted = true;
    p.power = 'powerup';
    p.playAction('powerup', { fadeIn: 0.3, hold: true });
    p.char.setExpression('angry');
    this.camRig.play(titleShot(p));
    this.setUiCapture('title', true);
    this.title.show({ mode: this.save.mode, level: this.save.profile.level, name: this.save.profile.name });
  }

  private leaveTitle(): void {
    const p = this.player;
    this.inTitle = false;
    p.endChainState();
    p.stopAction(0.35);
    p.char.setExpression('neutral');
    p.scripted = false;
    this.camRig.yaw = p.yaw + Math.PI;
    this.camRig.pitch = -0.16;
    this.camRig.releaseShot();
    this.setUiCapture('title', false);
    this.regionId = null;
    this.regionCheck = 1.2;
  }

  /** Back on your feet in Ashford after a defeat in the field. */
  private respawn(): void {
    const p = this.player;
    this.setUiCapture('defeat', false);
    p.revive();
    p.resetForMatch();
    p.move = 'ground';
    const spot = this.findSpawn(6, 22);
    p.teleport(spot, Math.PI);
    p.invulnTimer = 3;
    this.camRig.stopShot();
    this.camRig.yaw = 0;
    this.camRig.pitch = -0.16;
    this.deadT = 0;
    this.regionId = null;
  }

  /** Minimap / HUD / region banners / defeat, once per frame. */
  private updateInterface(dt: number): void {
    const p = this.player;
    const anyMenu = this.menuOpen || this.map.isOpen || this.pause.isOpen || this.arena.ui.selecting || this.arena.ui.showingResult || this.defeat.isOpen;
    const showHud = !this.inTitle && !anyMenu;
    this.hud.visible = showHud;
    this.hud.cinematic = this.camRig.inCinematic || this.chain.active;
    this.hud.root.classList.toggle('arena', this.arena.busy);
    this.map.miniVisible = showHud && !this.arena.busy && !this.camRig.inCinematic;
    this.touch.visible = showHud && !this.camRig.inCinematic && !this.chain.active && this.arena.phase !== 'intro';
    if (showHud || this.camRig.inCinematic) {
      this.hud.update(dt, p, this.save.profile, this.camera, { showTarget: !this.arena.busy && !this.chain.active });
    }
    if (this.touch.enabled) {
      const nf = nextForm(p.form.tier, p.level, p.surge);
      this.touch.update({
        exReady: p.energy >= COMBAT.exCost,
        ultReady: p.surge >= COMBAT.ultimateCost,
        formReady: !!nf && nf.tier <= p.maxTier,
        flying: p.flying,
        sprinting: p.sprinting,
      });
    }
    if (showHud && !this.arena.busy) {
      const markers: MapMarker[] = [];
      for (const m of this.spawner.mobs) {
        if (!m.alive || m.pos.distanceTo(p.pos) > 160) continue;
        markers.push({ x: m.pos.x, z: m.pos.z, kind: m.target === p ? 'mobHot' : 'mob' });
      }
      for (const b of this.bots) if (b.hero.alive) markers.push({ x: b.hero.pos.x, z: b.hero.pos.z, kind: 'rival' });
      for (const h of this.arena.heralds) markers.push({ x: h.pos.x, z: h.pos.z, kind: 'herald' });
      this.map.updateMini(p.pos.x, p.pos.z, p.yaw, this.camRig.yaw, markers);
    }
    // Region title banners.
    this.regionCheck -= dt;
    if (this.regionCheck <= 0 && !this.inTitle) {
      this.regionCheck = 0.5;
      let best: (typeof POIS)[number] | null = null;
      let bestD = Infinity;
      for (const poi of POIS) {
        const r = poi.flat > 0 ? poi.flat * 0.9 + 12 : 150;
        const d = Math.hypot(p.pos.x - poi.x, p.pos.z - poi.z);
        if (d < r && d < bestD) {
          best = poi;
          bestD = d;
        }
      }
      const id = best?.id ?? null;
      if (id !== this.regionId) {
        this.regionId = id;
        if (best && !this.arena.busy) {
          const camp = this.spawner.camps.find((c) => c.id === best!.id);
          const tag = { village: 'VILLAGE', arena: 'TRAINING GROUNDS', castle: 'CASTLE', ruin: 'RUINS', lake: 'LAKE', forest: 'FOREST', meadow: 'MEADOWS', camp: 'ENEMY CAMP' }[best.kind];
          const sub = camp ? `RECOMMENDED LV ${camp.level[0]}–${camp.level[1]}` : best.kind === 'arena' ? 'RANKED SPARS · +5 LEVELS PER WIN' : '';
          this.hud.region(best.name.toUpperCase(), sub, tag);
        }
      }
    }
    // Defeat in the field.
    if (!p.alive && !this.arena.busy) {
      this.deadT += dt;
      if (this.deadT > 1.8 && !this.defeat.isOpen) {
        this.setUiCapture('defeat', true);
        this.defeat.show();
      }
    } else this.deadT = 0;
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
      // Arena rewards are presented by the result screen itself.
      if (e.kind === 'level' && e.levels && e.levels > 0) {
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
    return this.playing && !this.inTitle && !this.arena.busy && !this.chain.active && !this.camRig.inCinematic && !this.clock.slowmoActive && p.alive && p.state === 'normal' && (p.move === 'ground' || p.flying);
  }

  /** Freeze the world (the fighter keeps breathing for the portrait camera) and hand input to the UI. */
  private setMenu(on: boolean): void {
    this.menuOpen = on;
    this.setUiCapture('menu', on, true);
    if (on) this.camRig.play(portraitShot(this.player));
    else this.camRig.releaseShot();
    document.body.classList.toggle('ak-menu-open', on);
  }

  /**
   * A screen takes (or returns) keyboard/mouse input. Several can overlap; gameplay input resumes when none hold it.
   * `freezeWorld` also stops world time while it is held (the player can't defend while reading a menu).
   */
  setUiCapture(key: string, on: boolean, freezeWorld = false): void {
    if (on) this.captures.add(key);
    else this.captures.delete(key);
    this.input.uiCapture = this.captures.size > 0;
    if (on) {
      this.input.releaseAll();
      this.input.clearBuffer();
    }
    this.clock.freeze(`ui-${key}`, on && freezeWorld);
  }

  /** Spawn a rival bot (training dummy / sparring partner) in front of the player. */
  spawnRival(difficulty: Difficulty = 'normal', dist = 9, stats?: Stats, level?: number): Hero {
    const spec = generateRival(this.player.stats, this.player.level, difficulty, Math.floor(Math.random() * 1e9));
    if (stats) spec.stats = stats;
    if (level) spec.level = level;
    const p = this.player.pos.clone().addScaledVector(this.player.forward(), dist);
    return this.spawnRivalSpec(spec, this.findSpawn(p.x, p.z), this.player.yaw + Math.PI).hero;
  }

  /** Spawn a Rogue Ascendant from a stat block (arena tickets come from the server). */
  spawnRivalSpec(spec: BotSpec, pos: THREE.Vector3, yaw: number): { hero: Hero; ai: RivalAI; ctl: BotControls } {
    const ctl = new BotControls();
    const ch = new Character(RIVAL_LOOK, this.lighting, this.clips);
    const hero = new Hero(ch, this.world, spec.name, 'foe', spec.level, cloneStats(spec.stats), ctl);
    hero.maxTier = spec.maxTier;
    hero.teleport(pos, yaw);
    const ai = new RivalAI(spec.skill, spec.style);
    ai.foe = this.player;
    ctl.brain = (h, c, dt) => ai.step(h, c, dt);
    this.scene.add(ch.group);
    this.combat.add(hero);
    this.vfx.track(hero);
    this.nameplates.add(hero);
    this.bots.push({ hero, ai, ctl });
    return { hero, ai, ctl };
  }

  /** Remove a rival bot from the world. */
  despawnBot(hero: Hero): void {
    const i = this.bots.findIndex((b) => b.hero === hero);
    if (i < 0) return;
    this.bots.splice(i, 1);
    this.combat.remove(hero);
    this.vfx.untrack(hero);
    this.nameplates.remove(hero);
    if (this.player.target === hero) this.player.target = null;
    hero.char.dispose();
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
      if (this.input.pressed('map') && !this.menuOpen && this.canOpenMenu) this.openMap();
      if (this.input.pressed('menu') && !this.inTitle && !this.arena.ui.selecting && !this.arena.ui.showingResult && !this.defeat.isOpen) this.setPause(true);
      this.chain.update(dt, this.clock.playerDt);
      this.player.update(this.clock.playerDt);
      for (const b of this.bots) b.hero.update(this.clock.worldDt);
      this.spawner.update(this.clock.worldDt, this.player);
      this.arena.update(dt, this.clock.worldDt);
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
      const arenaMenu = this.arena.phase === 'select' || this.arena.phase === 'result' || this.arena.phase === 'loading';
      this.nameplates.update(dt, this.camera, this.inTitle || this.chain.active || this.camRig.inCinematic || arenaMenu || this.pause.isOpen || this.map.isOpen);
      this.updateInterface(dt);
      this.audio.update(dt);
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
