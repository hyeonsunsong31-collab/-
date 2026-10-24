/**
 * Layered game time. Real time drives UI and camera; world and player time can be slowed independently
 * (perfect-dodge slow motion) or frozen (hitstop, chain-attack freeze).
 */
export class Clock {
  realDt = 0;
  worldDt = 0;
  playerDt = 0;
  realTime = 0;
  worldTime = 0;
  private last = performance.now();
  private hitstop = 0;
  private slowmo = 0;
  private slowmoDur = 0;
  private slowWorld = 1;
  private slowPlayer = 1;
  private freezes = new Set<string>();
  /** Debug/test override (e.g. pause world for screenshots). */
  timeScale = 1;

  tick(): void {
    const now = performance.now();
    this.realDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)) * this.timeScale;
    this.last = now;
    this.advance(this.realDt);
  }

  /** Advance with an explicit dt (used by deterministic tests). */
  advance(dt: number): void {
    this.realDt = dt;
    this.realTime += dt;
    let w = 1;
    let p = 1;
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      // Ease in fast, ease out over the last 30%.
      const t = 1 - Math.max(0, this.slowmo) / this.slowmoDur;
      const k = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      w = 1 + (this.slowWorld - 1) * k;
      p = 1 + (this.slowPlayer - 1) * k;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      w = 0;
      p = 0;
    }
    if (this.freezes.size > 0) {
      w = 0;
    }
    this.worldDt = dt * w;
    this.playerDt = dt * p;
    this.worldTime += this.worldDt;
  }

  addHitstop(sec: number): void {
    this.hitstop = Math.max(this.hitstop, sec);
  }

  startSlowmo(duration: number, world: number, player: number): void {
    this.slowmo = duration;
    this.slowmoDur = duration;
    this.slowWorld = world;
    this.slowPlayer = player;
  }

  get slowmoActive(): boolean {
    return this.slowmo > 0;
  }

  /** 0..1 how deep into slow motion we are (for screen effects). */
  get slowmoAmount(): number {
    if (this.slowmo <= 0) return 0;
    const t = 1 - this.slowmo / this.slowmoDur;
    return t < 0.08 ? t / 0.08 : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  }

  freeze(key: string, on: boolean): void {
    if (on) this.freezes.add(key);
    else this.freezes.delete(key);
  }

  get frozen(): boolean {
    return this.freezes.size > 0;
  }
}
