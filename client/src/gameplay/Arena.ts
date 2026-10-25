import * as THREE from 'three';
import { FORMS, basePowerLevel, maxUnlockedTier, type Difficulty } from '@ak/shared';
import type { Game } from '../Game.ts';
import type { Hero } from './Hero.ts';
import type { RivalAI } from '../ai/RivalAI.ts';
import type { BotControls } from '../ai/BotControls.ts';
import type { MatchTicket } from '../net/SaveService.ts';
import { Npc } from './Npc.ts';
import { HERALD_LOOK } from '../character/Looks.ts';
import { ArenaUI, type MatchStatsView } from '../ui/ArenaUI.ts';
import { InteractPrompt } from '../ui/InteractPrompt.ts';
import { finishShot, versusShot } from '../camera/Shots.ts';
import type { CombatEvent } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';

export type ArenaPhase = 'idle' | 'select' | 'loading' | 'intro' | 'fight' | 'finish' | 'result';

const ROUND_TIME = 180;
const INTRO = 4.6;
const START_GAP = 9;

const _v = new THREE.Vector3();

/**
 * The training-arena bot match: heralds (Ashford plaza and the colosseum gate) offer a ranked spar; the select
 * screen picks a difficulty; the server (or the offline fallback) issues a single-use match ticket with the rival's
 * stat block; fighters are placed on the stage for a VS intro and READY/FIGHT; the round is decided by K.O., ring-out
 * (touching the sand) or the clock; the finish plays in slow motion, then the result is reported (+5 levels on a
 * valid win) and the result screen offers rematch / change rival / leave.
 */
export class Arena {
  phase: ArenaPhase = 'idle';
  difficulty: Difficulty = 'normal';
  ticket: MatchTicket | null = null;
  rival: Hero | null = null;
  private ai: RivalAI | null = null;
  private ctl: BotControls | null = null;
  private t = 0;
  timeLeft = ROUND_TIME;
  private calls = 0;
  private stats: MatchStatsView = { time: 0, dealt: 0, taken: 0, maxCombo: 0, perfectDodges: 0, parries: 0, chains: 0 };
  private combo = 0;
  private comboT = 0;
  private finishInfo: { loser: Combatant; reason: 'ko' | 'ringout' | 'time' } | null = null;
  readonly ui: ArenaUI;
  readonly prompt: InteractPrompt;
  readonly heralds: Npc[] = [];
  /** Outcome of the last finished bout (for presentation). */
  lastOutcome: 'win' | 'loss' | null = null;
  private talkTo: Npc | null = null;

  constructor(private g: Game) {
    this.ui = new ArenaUI();
    this.prompt = new InteractPrompt();
    this.prompt.onPress = () => this.interact();
    this.ui.onStart = (d) => void this.begin(d);
    this.ui.onCancel = () => this.closeSelect();
    this.ui.onRematch = () => void this.begin(this.difficulty);
    this.ui.onChange = () => this.openSelect();
    this.ui.onLeave = () => this.leave();
    g.combat.on((e) => this.onCombat(e));
    this.placeHeralds();
  }

  /** In a match (or its menus): gameplay systems outside the arena stand down. */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  get fighting(): boolean {
    return this.phase === 'fight';
  }

  /* ---------------------------------------------------------------- stage geometry */

  /** Stage-local (x along the gate axis' side, z toward the gate) to world, standing on the stage top. */
  stagePoint(lx: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const A = this.g.world.settlements.arena;
    const c = Math.cos(A.yaw);
    const s = Math.sin(A.yaw);
    const x = A.x + lx * c + lz * s;
    const z = A.z - lx * s + lz * c;
    return out.set(x, this.g.world.groundAt(x, z, A.stageTop + 1), z);
  }

  /** How far outside the stage edge a point is (≤ 0 inside), in stage-local metres. */
  private outside(p: THREE.Vector3): number {
    const A = this.g.world.settlements.arena;
    const c = Math.cos(A.yaw);
    const s = Math.sin(A.yaw);
    const dx = p.x - A.x;
    const dz = p.z - A.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.max(Math.abs(lx), Math.abs(lz)) - (A.stageHalf + 0.6);
  }

  /** Ring-out: standing on the sand (or anything below the stage) outside the square. */
  private ringedOut(c: Combatant): boolean {
    const A = this.g.world.settlements.arena;
    return c.move === 'ground' && this.outside(c.pos) > 0 && c.pos.y < A.stageTop - 0.4;
  }

  /* ---------------------------------------------------------------- heralds */

  private placeHeralds(): void {
    const g = this.g;
    const A = g.world.settlements.arena;
    // At the colosseum gate, facing the road to Ashford.
    const outerR = 63;
    const gate = this.stagePoint(4.5, outerR + 7);
    gate.y = g.world.groundAt(gate.x, gate.z, g.world.terrainHeight(gate.x, gate.z) + 0.3);
    this.addHerald(gate, A.yaw, 'Gate Herald', 'Fight in the Training Grounds');
    // In Ashford's square, near where travellers arrive.
    const town = g.findSpawn(13, 17);
    const toSpawn = Math.atan2(6 - town.x, 22 - town.z);
    this.addHerald(town, toSpawn, 'Arena Herald', 'Travel to the Training Grounds');
  }

  private addHerald(pos: THREE.Vector3, yaw: number, name: string, role: string): void {
    const n = new Npc(HERALD_LOOK, this.g.lighting, this.g.clips, this.g.world, pos, yaw, name, role);
    this.g.scene.add(n.char.group);
    this.heralds.push(n);
  }

  /** Talk to the herald in range. */
  interact(): void {
    if (this.phase !== 'idle' || !this.talkTo || !this.g.canOpenMenu) return;
    this.openSelect();
  }

  /* ---------------------------------------------------------------- select */

  openSelect(): void {
    const g = this.g;
    const p = g.save.profile;
    if (this.phase === 'result') this.ui.hideResult();
    this.phase = 'select';
    this.prompt.hide();
    g.setUiCapture('arena', true, true);
    this.ui.touch = g.input.touchMode;
    this.ui.showSelect({
      playerPL: basePowerLevel(p.stats),
      level: p.level,
      maxTier: maxUnlockedTier(p.level),
      wins: p.wins,
      losses: p.losses,
      last: this.difficulty,
    });
  }

  private closeSelect(): void {
    this.ui.hideSelect();
    const inMatchArea = this.rival !== null;
    this.g.setUiCapture('arena', false);
    if (inMatchArea) {
      // Came from a result screen: back out of the arena entirely.
      this.leave();
      return;
    }
    this.phase = 'idle';
  }

  /* ---------------------------------------------------------------- match flow */

  async begin(d: Difficulty): Promise<void> {
    if (this.phase === 'loading' || this.phase === 'intro' || this.phase === 'fight') return;
    const g = this.g;
    this.difficulty = d;
    this.phase = 'loading';
    this.ui.hideSelect();
    this.ui.hideResult();
    this.ui.clearStamp();
    const [ticket] = await Promise.all([g.save.startMatch(d), this.ui.fadeOut()]);
    this.ticket = ticket;
    // ---- Set the stage.
    g.spawner.enabled = false;
    g.spawner.clear();
    g.chain.end();
    this.removeRival();
    for (const b of [...g.bots]) g.despawnBot(b.hero);
    const p = g.player;
    if (!p.alive) p.revive();
    p.setStats(g.save.profile.level, { ...g.save.profile.stats }, true);
    p.resetForMatch();
    p.revive();
    const a = this.stagePoint(0, -START_GAP / 2);
    const b = this.stagePoint(0, START_GAP / 2);
    const A = g.world.settlements.arena;
    p.move = 'ground';
    p.teleport(a, A.yaw);
    const spec = ticket.bot;
    const { hero, ai, ctl } = g.spawnRivalSpec(spec, b, A.yaw + Math.PI);
    hero.resetForMatch();
    hero.scripted = true;
    this.rival = hero;
    this.ai = ai;
    this.ctl = ctl;
    ctl.brain = null;
    ai.stage = { inside: (q) => -this.outside(q), center: this.stagePoint(0, 0) };
    p.scripted = true;
    p.target = hero;
    hero.target = p;
    // Camera: behind the player toward the rival, then the VS sweep.
    g.camRig.yaw = A.yaw + Math.PI;
    g.camRig.pitch = -0.16;
    g.camRig.play(versusShot(p, hero, INTRO));
    g.setUiCapture('arena', false);
    // ---- Reset the round.
    this.t = 0;
    this.calls = 0;
    this.timeLeft = ROUND_TIME;
    this.stats = { time: 0, dealt: 0, taken: 0, maxCombo: 0, perfectDodges: 0, parries: 0, chains: 0 };
    this.combo = 0;
    this.finishInfo = null;
    this.phase = 'intro';
    this.ui.fadeIn();
    this.ui.showVersus(
      { name: p.name, level: p.level, pl: p.powerLevel, sub: 'YOU' },
      { name: spec.name, level: spec.level, pl: hero.powerLevel, sub: `ROGUE ASCENDANT · ${spec.style.toUpperCase()}` },
    );
    this.ui.showHud({ name: p.name }, { name: spec.name });
  }

  private startFight(): void {
    const g = this.g;
    const r = this.rival!;
    g.player.scripted = false;
    r.scripted = false;
    const ai = this.ai!;
    this.ctl!.brain = (h, c, dt) => ai.step(h, c, dt);
    this.phase = 'fight';
    this.t = 0;
  }

  private finish(loser: Combatant, reason: 'ko' | 'ringout' | 'time'): void {
    const g = this.g;
    const p = g.player;
    const r = this.rival!;
    this.phase = 'finish';
    this.t = 0;
    this.finishInfo = { loser, reason };
    this.stats.time = ROUND_TIME - Math.max(0, this.timeLeft);
    g.chain.end();
    // Freeze the fight: both stop acting; the winner gets a beat, then poses.
    p.scripted = true;
    r.scripted = true;
    this.ctl!.brain = null;
    this.ctl!.buttons.releaseAll();
    p.endChainState();
    r.endChainState();
    g.clock.startSlowmo(1.5, 0.22, 0.22);
    const winner = loser === p ? r : p;
    g.camRig.play(finishShot(loser, winner, 2.9));
    const win = loser !== p;
    this.ui.stampText(reason === 'ko' ? 'K.O.' : reason === 'ringout' ? 'RING OUT' : 'TIME!', win ? '#ffc21a' : '#e3324d');
  }

  private async showResult(): Promise<void> {
    const g = this.g;
    const info = this.finishInfo!;
    const outcome = info.loser === this.rival ? 'win' : 'loss';
    this.lastOutcome = outcome;
    const before = { ...g.save.profile };
    const plFrom = basePowerLevel(before.stats);
    const levels = this.ticket ? await g.save.finishMatch(this.ticket, outcome) : 0;
    this.ticket = null;
    const after = g.save.profile;
    const unlocked = FORMS.filter((f) => f.unlockLevel > before.level && f.unlockLevel <= after.level).map((f) => f.title);
    // Points are unspent until allocated, so the PL climb previews an auto-balanced spend.
    const preview = { ...after.stats };
    let free = after.unspent - before.unspent;
    while (free-- > 0) {
      let lo = 'str' as keyof typeof preview;
      for (const k of Object.keys(preview) as (keyof typeof preview)[]) if (preview[k] < preview[lo]) lo = k;
      preview[lo]++;
    }
    this.phase = 'result';
    g.setUiCapture('arena', true);
    this.ui.touch = g.input.touchMode;
    this.ui.showResult({
      outcome,
      reason: info.reason,
      difficulty: this.difficulty,
      rival: this.rival?.name ?? 'Rival',
      stats: this.stats,
      levelsGained: levels,
      levelFrom: before.level,
      levelTo: after.level,
      plFrom,
      plTo: levels > 0 ? basePowerLevel(preview) : plFrom,
      uncounted: outcome === 'win' && levels === 0,
      unlockedForms: unlocked,
    });
  }

  /** Leave the arena: rival gone, fighter healed and walked out of the gate, the world wakes back up. */
  leave(): void {
    const g = this.g;
    this.ui.hideResult();
    this.ui.hideSelect();
    this.ui.hideHud();
    this.ui.hideVersus();
    this.ui.clearStamp();
    this.removeRival();
    const p = g.player;
    if (!p.alive) p.revive();
    p.revive();
    p.scripted = false;
    p.target = null;
    p.resetForMatch();
    const A = g.world.settlements.arena;
    const out = this.stagePoint(0, 63 + 11);
    out.y = g.world.groundAt(out.x, out.z, g.world.terrainHeight(out.x, out.z) + 0.3);
    void this.ui.fadeOut().then(() => {
      p.move = 'ground';
      p.teleport(out, A.yaw);
      g.camRig.stopShot();
      g.camRig.yaw = A.yaw + Math.PI;
      g.camRig.pitch = -0.18;
      g.spawner.enabled = true;
      this.ui.fadeIn();
    });
    g.setUiCapture('arena', false);
    this.phase = 'idle';
  }

  private removeRival(): void {
    if (!this.rival) return;
    this.g.despawnBot(this.rival);
    this.rival = null;
    this.ai = null;
    this.ctl = null;
  }

  /* ---------------------------------------------------------------- stats */

  private onCombat(e: CombatEvent): void {
    if (this.phase !== 'fight') return;
    const p = this.g.player;
    switch (e.type) {
      case 'hit':
        if (e.attacker === p && e.target === this.rival) {
          this.stats.dealt += e.res.dmg;
          if (e.res.dmg > 0) {
            this.combo = this.comboT > 0 ? this.combo + 1 : 1;
            this.comboT = 2.2;
            this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
          }
        } else if (e.target === p) {
          this.stats.taken += e.res.dmg;
          this.combo = 0;
        }
        break;
      case 'perfectDodge':
        if (e.who === p) this.stats.perfectDodges++;
        break;
      case 'parry':
        if (e.who === p) this.stats.parries++;
        break;
      case 'chain':
        if (e.phase === 'start' && e.attacker === p) this.stats.chains++;
        break;
    }
  }

  /* ---------------------------------------------------------------- per frame */

  update(realDt: number, worldDt: number): void {
    const g = this.g;
    const p = g.player;
    // Heralds and their prompt.
    let near: Npc | null = null;
    for (const h of this.heralds) {
      h.update(worldDt, p);
      if (this.phase === 'idle' && h.canTalk(p) && (!near || h.distanceTo(p) < near.distanceTo(p))) near = h;
    }
    this.talkTo = near;
    if (near && g.canOpenMenu && !g.menuOpen) {
      this.prompt.touch = g.input.touchMode;
      this.prompt.show(near.head(_v), g.camera, near.name.toUpperCase(), near.role);
      if (g.input.pressed('interact')) this.interact();
    } else this.prompt.hide();

    const r = this.rival;
    switch (this.phase) {
      case 'intro': {
        this.t += realDt;
        // Keep both squared up during the intro.
        if (r) {
          p.yaw = p.yawTo(r.pos);
          r.yaw = r.yawTo(p.pos);
        }
        if (this.calls === 0 && this.t > INTRO - 1.25) {
          this.calls = 1;
          this.ui.call('READY', 'ready');
        }
        if (this.calls === 1 && this.t > INTRO - 0.2) {
          this.calls = 2;
          this.ui.call('FIGHT!', 'fight');
          g.camRig.shake(0.25);
          this.startFight();
        }
        break;
      }
      case 'fight': {
        if (!r) break;
        this.t += worldDt;
        this.timeLeft -= worldDt;
        this.comboT -= worldDt;
        if (this.comboT <= 0) this.combo = 0;
        if (!p.alive) this.finish(p, 'ko');
        else if (!r.alive) this.finish(r, 'ko');
        else if (this.ringedOut(p)) this.finish(p, 'ringout');
        else if (this.ringedOut(r)) this.finish(r, 'ringout');
        else if (this.timeLeft <= 0) {
          const pk = p.hp / p.maxHp;
          const rk = r.hp / r.maxHp;
          this.finish(pk > rk ? r : p, 'time');
        }
        break;
      }
      case 'finish': {
        this.t += realDt;
        const info = this.finishInfo!;
        const winner = info.loser === p ? r : p;
        if (winner && this.t > 1.6 && this.t - realDt <= 1.6 && winner.alive && winner.move === 'ground') {
          winner.yaw = winner.yawTo(info.loser.pos);
          winner.playAction('victory', { fadeIn: 0.2, fadeOut: 0.4, hold: true });
        }
        if (this.t > 3.0 && this.t - realDt <= 3.0) void this.showResult();
        break;
      }
    }
    if (r && (this.phase === 'intro' || this.phase === 'fight' || this.phase === 'finish')) {
      const edge = this.phase === 'fight' && p.move === 'ground' ? THREE.MathUtils.clamp((this.outside(p.pos) + 2.2) / 2.2, 0, 1) : 0;
      this.ui.updateHud(
        realDt,
        { hp: p.hp / p.maxHp, form: p.form.tier > 0 ? p.form.title : 'BASE', pl: p.powerLevel },
        { hp: r.hp / r.maxHp, form: r.form.tier > 0 ? r.form.title : 'BASE', pl: r.powerLevel },
        this.timeLeft,
        edge,
      );
    } else if (this.phase === 'idle') this.ui.hideHud();
  }
}
