import * as THREE from 'three';
import type { Renderer } from '../render/Renderer.ts';
import type { Clock } from '../core/Clock.ts';
import type { CombatEvent } from '../combat/CombatSystem.ts';
import type { Combatant } from '../combat/Combatant.ts';

interface Ripple {
  uv: THREE.Vector2;
  t: number;
  dur: number;
  strength: number;
  speed: number;
}

const _p = new THREE.Vector3();

/**
 * Screen-space combat presentation driven on real time (so it keeps animating through hitstop and slow-mo):
 * perfect-dodge greyscale with Sobel edges (drains in 0.1 s, returns in 0.3 s with a chromatic burst), anime impact
 * frames, radial zoom blur and CA kicks, shockwave ripples, heat haze over charging fighters, manga speed lines,
 * flashes, low-HP tint and hit vignettes.
 */
export class ScreenFx {
  private grey = 0;
  private wasSlow = false;
  private ca = 0;
  private radial = 0;
  private radialCenter = new THREE.Vector2(0.5, 0.5);
  private impactT = 0;
  private impactMode = 0;
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private vig = 0;
  private speed = 0;
  private speedTarget = 0;
  private ripples: Ripple[] = [];
  private heat = 0;
  private heatTarget = 0;
  private heatUv = new THREE.Vector2(0.5, 0.5);
  private heatRadius = 0.2;
  private tintAmt = 0;
  private tint = new THREE.Color(1, 1, 1);
  private t = 0;

  constructor(
    private renderer: Renderer,
    private camera: THREE.PerspectiveCamera,
    private clock: Clock,
  ) {}

  /** Project a world point to screen UV (0..1); returns false when behind the camera. */
  toUv(p: THREE.Vector3, out: THREE.Vector2): boolean {
    _p.copy(p).project(this.camera);
    out.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
    return _p.z < 1;
  }

  ripple(world: THREE.Vector3, strength = 1, dur = 0.7, speed = 1.4): void {
    const uv = new THREE.Vector2();
    if (!this.toUv(world, uv)) return;
    this.ripples.push({ uv, t: 0, dur, strength, speed });
    if (this.ripples.length > 4) this.ripples.shift();
  }

  /** Two-frame manga impact frame; things nearer than the strike point (+margin) become ink silhouettes. */
  impactFrame(mode = 0, at?: THREE.Vector3): void {
    this.impactT = 0.07;
    this.impactMode = mode;
    this.impactDepth = at ? this.camera.position.distanceTo(at) + 2.5 : 9;
    if (at) this.toUv(at, this.radialCenter);
  }

  private impactDepth = 9;
  /** Time-stop look while the chain-attack prompt is up. */
  private chainDim = 0;
  private chainCur = 0;

  kickRadial(world: THREE.Vector3 | null, amount: number): void {
    this.radial = Math.max(this.radial, amount);
    if (world) this.toUv(world, this.radialCenter);
    else this.radialCenter.set(0.5, 0.5);
  }

  kickCA(amount: number): void {
    this.ca = Math.max(this.ca, amount);
  }

  doFlash(amount: number, color: THREE.ColorRepresentation = '#ffffff'): void {
    this.flash = Math.max(this.flash, amount);
    this.flashColor.set(color);
  }

  /** React to combat events involving the player. */
  handle(e: CombatEvent, player: Combatant): void {
    switch (e.type) {
      case 'hit': {
        const mine = e.attacker === player || e.target === player;
        if (!mine) return;
        // Continuous beam ticks would strobe the screen; they only shake the camera.
        if (e.def.id.endsWith('_tick')) return;
        const tier = e.def.tier;
        if (e.target === player) {
          // Taking a hit: a red-edged vignette and a sharp aberration jolt; the big impact layer is reserved
          // for the player's own strikes so incoming chip damage never whites out the screen.
          this.vig = Math.max(this.vig, 0.4 + tier * 0.08);
          this.kickCA(0.35 + tier * 0.1);
          if (tier >= 4) this.kickRadial(e.point, 0.25);
          if (e.res.stunned) this.doFlash(0.18, '#ffe9a8');
          break;
        }
        if (tier >= 2) this.kickCA(0.18 * tier);
        if (tier >= 3) {
          this.kickRadial(e.point, 0.15 + tier * 0.1);
          this.ripple(e.point, 0.5 + tier * 0.15, 0.5);
        }
        if (tier >= 4 || (tier >= 3 && e.res.crit)) this.impactFrame(0, e.point);
        if (e.res.stunned) this.doFlash(0.18, '#ffe9a8');
        break;
      }
      case 'perfectDodge':
        if (e.who !== player) return;
        this.ripple(e.pos, 1.4, 0.9, 1.1);
        this.kickCA(1.2);
        this.doFlash(0.22, '#e8f2ff');
        break;
      case 'parry':
        if (e.who !== player && e.attacker !== player) return;
        this.doFlash(0.25, '#ffd76a');
        this.ripple(e.point, 1.1, 0.55);
        this.kickRadial(e.point, 0.45);
        this.impactFrame(0, e.point);
        break;
      case 'guardBreak':
        if (e.who === player) {
          this.vig = 0.7;
          this.kickCA(1.4);
        }
        break;
      case 'blast':
        if (e.def.tier >= 3) {
          this.ripple(e.pos, 1.3, 0.8, 1.2);
          this.kickRadial(e.pos, 0.5);
        }
        break;
      case 'crater':
        this.ripple(e.pos, 1, 0.7, 1.3);
        break;
      case 'anim':
        if (e.who !== player) return;
        if (e.name === 'transformBurst') {
          this.doFlash(0.95);
          this.impactFrame(0, player.chest(new THREE.Vector3()));
          this.ripple(player.chest(new THREE.Vector3()), 2, 1.2, 1.0);
          this.kickCA(2);
        } else if (e.name === 'ultimateFire' || e.name === 'beamFire') {
          this.doFlash(e.name === 'ultimateFire' ? 0.35 : 0.18, '#dff4ff');
          this.kickRadial(null, e.name === 'ultimateFire' ? 0.45 : 0.25);
        } else if (e.name === 'vanish') {
          this.kickCA(0.9);
        } else if (e.name === 'dash') {
          this.speed = Math.max(this.speed, 0.35);
        }
        break;
      case 'chain':
        if (e.phase === 'prompt') this.chainDim = 1;
        else {
          this.chainDim = 0;
          if (e.phase === 'start') {
            this.impactFrame(0, e.target.chest(new THREE.Vector3()));
            this.doFlash(0.4, '#ffe08a');
          }
        }
        break;
    }
  }

  /**
   * @param player for low-HP tint, speed lines and heat haze
   * @param boosting fast flight / sprint
   * @param charging 0..1 aura charge intensity of the player
   */
  update(realDt: number, player: Combatant | null, boosting: number, charging: number): void {
    this.t += realDt;
    const c = this.renderer.combat;
    const d = this.renderer.distort;
    // Perfect-dodge grey: drain fast, return slower with a chromatic burst.
    const slow = this.clock.slowmoAmount;
    const target = slow > 0 ? 1 : 0;
    const rate = target > this.grey ? 1 / 0.1 : 1 / 0.3;
    this.grey = target > this.grey ? Math.min(target, this.grey + realDt * rate) : Math.max(target, this.grey - realDt * rate);
    if (this.wasSlow && !this.clock.slowmoActive) this.kickCA(1.6);
    this.wasSlow = this.clock.slowmoActive;
    this.chainCur += (this.chainDim - this.chainCur) * (1 - Math.exp(-realDt * 14));
    c.u('uGrey').value = Math.max(this.grey, this.chainCur * 0.55);
    // Impact frames hold for a couple of frames.
    if (this.impactT > 0) {
      this.impactT -= realDt;
      c.u('uImpact').value = 1;
      c.u('uImpactMode').value = this.impactMode;
      c.u('uImpactDepth').value = this.impactDepth;
    } else c.u('uImpact').value = 0;
    // Kicks decay.
    this.radial *= Math.exp(-realDt * 7);
    this.ca *= Math.exp(-realDt * 6);
    this.flash *= Math.exp(-realDt * 9);
    this.vig *= Math.exp(-realDt * 3);
    c.u('uRadial').value = this.radial;
    (c.u('uRadialCenter').value as THREE.Vector2).copy(this.radialCenter);
    c.u('uCA').value = this.ca * 0.45 + this.grey * 0.2;
    c.u('uFlash').value = this.flash;
    (c.u('uFlashColor').value as THREE.Color).copy(this.flashColor);
    // Speed lines from boosting / dashing.
    this.speedTarget = boosting;
    this.speed += (this.speedTarget - this.speed) * (1 - Math.exp(-realDt * 6));
    c.u('uSpeed').value = this.speed;
    // Low HP: red pulse; heavy hits: vignette.
    let tintAmt = 0;
    if (player && player.alive) {
      const hpk = player.hp / player.maxHp;
      if (hpk < 0.3) {
        tintAmt = (0.3 - hpk) * 1.4 * (0.75 + 0.25 * Math.sin(this.t * 6));
        this.tint.set('#ff5a4a');
      }
    }
    this.tintAmt += (tintAmt - this.tintAmt) * (1 - Math.exp(-realDt * 4));
    c.u('uTintAmt').value = this.tintAmt;
    (c.u('uTint').value as THREE.Color).copy(this.tint);
    c.u('uVig').value = this.vig + this.grey * 0.35 + this.chainCur * 0.5;
    // Ripples.
    const arr = d.u('uRipples').value as THREE.Vector4[];
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += realDt;
      if (r.t > r.dur) this.ripples.splice(i, 1);
    }
    for (let i = 0; i < 4; i++) {
      const r = this.ripples[i];
      if (!r) {
        arr[i].set(0, 0, 0, 0);
        continue;
      }
      const k = r.t / r.dur;
      arr[i].set(r.uv.x, r.uv.y, k * r.speed * 0.6, r.strength * (1 - k) * (1 - k));
    }
    // Heat haze over the charging player.
    this.heatTarget = charging;
    this.heat += (this.heatTarget - this.heat) * (1 - Math.exp(-realDt * 3));
    if (player && this.heat > 0.01 && this.toUv(player.chest(_p.clone()), this.heatUv)) {
      const dist = this.camera.position.distanceTo(player.pos);
      this.heatRadius = THREE.MathUtils.clamp(2.6 / Math.max(1, dist), 0.08, 0.6);
    }
    (d.u('uHeat').value as THREE.Vector4).set(this.heatUv.x, this.heatUv.y, this.heatRadius, this.heat);
  }
}
