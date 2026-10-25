import type * as THREE from 'three';
import type { AudioEngine } from './AudioEngine.ts';

type P = THREE.Vector3 | undefined;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Procedural sound recipes — every effect in the game is synthesised here from oscillators, noise, filters and
 * waveshapers (no samples): punches and kicks, whooshes, electric ki bolts and impacts, explosions, beams, aura
 * roar, battle screams, clangs, footsteps by surface, telegraph chimes, UI and fanfares.
 */
export class Sfx {
  constructor(private a: AudioEngine) {}

  private get ctx(): AudioContext | null {
    return this.a.ready ? this.a.ctx : null;
  }

  /* ---------------------------------------------------------------- impacts */

  /** Fist / kick impact. `power` 0..1+, `heavy` adds sub and crack. */
  punch(pos: P, power = 0.5, heavy = false): void {
    const a = this.a;
    const v = a.voice(0.6, { pos, gain: 0.55 + power * 0.5, reverb: 0.12 + power * 0.15, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const sat = a.shaper(3 + power * 6, v.input);
    // Body thump: fast pitch drop.
    const thump = a.gain(0, sat);
    const o = a.osc('sine', 170 + power * 40, t, 0.3, thump);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    a.env(thump.gain, t, 0.002, 0.9, 0.16 + power * 0.08);
    // Skin slap / click.
    const click = a.gain(0, v.input);
    a.noise(a.white, t, 0.06, a.filter('bandpass', rnd(1800, 2600), 1.2, click));
    a.env(click.gain, t, 0.001, 0.55 + power * 0.25, 0.035);
    // Air pop (mid noise body).
    const body = a.gain(0, sat);
    a.noise(a.pink, t, 0.2, a.filter('lowpass', 900 + power * 900, 0.8, body));
    a.env(body.gain, t, 0.002, 0.6 * (0.5 + power), 0.09 + power * 0.06);
    if (heavy || power > 0.75) {
      const sub = a.gain(0, v.input);
      const s = a.osc('sine', 72, t, 0.6, sub);
      s.frequency.exponentialRampToValueAtTime(34, t + 0.45);
      a.env(sub.gain, t, 0.004, 0.9, 0.42);
      const crack = a.gain(0, v.input);
      a.noise(a.white, t, 0.12, a.filter('highpass', 3200, 0.7, crack));
      a.env(crack.gain, t, 0.001, 0.5, 0.07);
    }
  }

  /** Blade / axe / claw impact: a cut with a metallic edge. */
  slash(pos: P, power = 0.5, metal = true): void {
    const a = this.a;
    const v = a.voice(0.7, { pos, gain: 0.55 + power * 0.35, reverb: 0.18, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const cut = a.gain(0, v.input);
    const bp = a.filter('bandpass', 2400, 2.5, cut);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    a.noise(a.white, t, 0.25, bp);
    a.env(cut.gain, t, 0.002, 0.8, 0.16);
    if (metal) {
      for (const f of [1840, 2930, 4410]) {
        const g = a.gain(0, v.input);
        a.osc('sine', f * rnd(0.97, 1.03), t, 0.5, g);
        a.env(g.gain, t, 0.001, 0.07, 0.35);
      }
    }
    this.punch(pos, power * 0.6, false);
  }

  /** Swing whoosh: band-passed noise sweep. `pitch` shifts the band; `len` stretches it. */
  whoosh(pos: P, pitch = 1, len = 0.22, gain = 0.45): void {
    const a = this.a;
    const v = a.voice(len + 0.2, { pos, gain, reverb: 0.06, range: 30 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    const bp = a.filter('bandpass', 500 * pitch, 1.6, g);
    bp.frequency.exponentialRampToValueAtTime(2600 * pitch, t + len * 0.55);
    bp.frequency.exponentialRampToValueAtTime(700 * pitch, t + len);
    a.noise(a.white, t, len + 0.05, bp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + len * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  }

  /** Guarded hit: dull thud + light clang. */
  block(pos: P, power = 0.5): void {
    const a = this.a;
    const v = a.voice(0.6, { pos, gain: 0.6, reverb: 0.2, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const th = a.gain(0, v.input);
    const o = a.osc('triangle', 110, t, 0.3, th);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    a.env(th.gain, t, 0.002, 0.8, 0.14);
    for (const f of [620, 1430]) {
      const g = a.gain(0, v.input);
      a.osc('square', f, t, 0.3, a.filter('lowpass', 2400, 1, g));
      a.env(g.gain, t, 0.001, 0.06 * (0.5 + power), 0.18);
    }
  }

  /** Perfect parry: bright inharmonic clang, spark crackle, rising shimmer. */
  parry(pos: P): void {
    const a = this.a;
    const v = a.voice(1.6, { pos, gain: 0.85, reverb: 0.45, priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    for (const [f, k] of [
      [523, 0.24],
      [1311, 0.16],
      [2093, 0.12],
      [2795, 0.08],
      [3951, 0.05],
    ] as const) {
      const g = a.gain(0, v.input);
      a.osc('sine', f, t, 1.4, g);
      a.env(g.gain, t, 0.001, k, 1.2);
    }
    const sp = a.gain(0, v.input);
    a.noise(a.white, t, 0.3, a.filter('highpass', 5000, 0.8, sp));
    a.env(sp.gain, t, 0.001, 0.5, 0.2);
    this.punch(pos, 0.6);
  }

  guardBreak(pos: P): void {
    const a = this.a;
    const v = a.voice(1.0, { pos, gain: 0.8, reverb: 0.3, priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, a.shaper(8, v.input));
    a.noise(a.white, t, 0.5, a.filter('bandpass', 1400, 0.7, g));
    a.env(g.gain, t, 0.001, 0.8, 0.4);
    for (const f of [300, 470, 790]) {
      const o = a.gain(0, v.input);
      const os = a.osc('sawtooth', f, t, 0.6, a.filter('lowpass', 1800, 1, o));
      os.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.5);
      a.env(o.gain, t, 0.002, 0.08, 0.5);
    }
  }

  /* ---------------------------------------------------------------- ki */

  /** Electric ki bolt launch: FM zap, crackle bursts, thump. */
  kiFire(pos: P, size = 1): void {
    const a = this.a;
    const v = a.voice(0.9, { pos, gain: 0.55 + size * 0.15, reverb: 0.2, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const out = a.gain(0, v.input);
    const car = a.osc('sawtooth', 980, t, 0.5, a.filter('bandpass', 1700, 0.8, out));
    car.frequency.exponentialRampToValueAtTime(260, t + 0.32);
    const mod = a.ctx!.createOscillator();
    mod.frequency.value = 2700;
    const mg = a.gain(1400);
    mod.connect(mg).connect(car.frequency);
    mg.gain.exponentialRampToValueAtTime(30, t + 0.3);
    mod.start(t);
    mod.stop(t + 0.5);
    a.env(out.gain, t, 0.004, 0.45, 0.34);
    this.crackle(v.input, t, 0.35, 0.6);
    const th = a.gain(0, v.input);
    const o = a.osc('sine', 140, t, 0.3, th);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    a.env(th.gain, t, 0.003, 0.6, 0.2);
  }

  /** Random-gated high noise bursts (electric arcing). */
  private crackle(out: AudioNode, t: number, dur: number, level: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    a.noise(a.white, t, dur, a.filter('highpass', 3500, 0.6, g));
    let tt = t;
    g.gain.setValueAtTime(0, t);
    while (tt < t + dur) {
      const on = rnd(0.004, 0.018);
      g.gain.setValueAtTime(level * rnd(0.3, 1) * (1 - (tt - t) / dur), tt);
      g.gain.setValueAtTime(0, tt + on);
      tt += on + rnd(0.005, 0.03);
    }
  }

  /** Lightning crack (aura arcs, thunder strikes): `big` adds a rolling thunder tail. */
  lightning(pos: P, big = false): void {
    const a = this.a;
    const v = a.voice(big ? 3 : 0.6, { pos, gain: big ? 0.9 : 0.35, reverb: big ? 0.5 : 0.15, range: big ? 220 : 40 });
    if (!v || !this.ctx) return;
    const t = a.now;
    this.crackle(v.input, t, big ? 0.45 : 0.18, big ? 1 : 0.7);
    const zap = a.gain(0, v.input);
    const o = a.osc('square', big ? 1600 : 2400, t, 0.2, a.filter('bandpass', 3000, 2, zap));
    o.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    a.env(zap.gain, t, 0.001, 0.25, 0.14);
    if (big) {
      const rumble = a.gain(0, v.input);
      a.noise(a.brown, t + 0.05, 2.6, a.filter('lowpass', 260, 0.7, rumble));
      rumble.gain.setValueAtTime(0.0001, t);
      rumble.gain.exponentialRampToValueAtTime(1.6, t + 0.15);
      rumble.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    }
  }

  /** Explosion / ki impact / crater: noise sweep, sub boom, debris crackle. */
  explosion(pos: P, size = 1, electric = false): void {
    const a = this.a;
    const dur = 0.8 + size * 0.9;
    const v = a.voice(dur + 0.3, { pos, gain: 0.6 + Math.min(0.6, size * 0.3), reverb: 0.35 + size * 0.1, range: 80 + size * 60, priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const sat = a.shaper(4, v.input);
    const n = a.gain(0, sat);
    const lp = a.filter('lowpass', 5000, 0.7, n);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    a.noise(a.white, t, dur, lp);
    n.gain.setValueAtTime(0.0001, t);
    n.gain.exponentialRampToValueAtTime(1, t + 0.01);
    n.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const sub = a.gain(0, v.input);
    const s = a.osc('sine', 85, t, dur, sub);
    s.frequency.exponentialRampToValueAtTime(28, t + dur * 0.8);
    a.env(sub.gain, t, 0.005, 1.1, dur * 0.8);
    const deb = a.gain(0, v.input);
    a.noise(a.pink, t + 0.08, dur, a.filter('bandpass', 1200, 0.6, deb));
    deb.gain.setValueAtTime(0.0001, t);
    deb.gain.exponentialRampToValueAtTime(0.25, t + 0.12);
    deb.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (electric) this.crackle(v.input, t, 0.4 + size * 0.2, 0.7);
  }

  /** Continuous beam / Ultimate: returns a stopper. */
  beam(pos: P, ultimate: boolean): { set: (p: THREE.Vector3) => void; stop: () => void } | null {
    const a = this.a;
    const ctx = this.ctx;
    if (!ctx) return null;
    const dur = 30;
    const v = a.voice(dur, { pos, gain: ultimate ? 0.95 : 0.7, reverb: 0.35, range: 120, priority: 2 });
    if (!v) return null;
    const t = a.now;
    const out = a.gain(0, a.shaper(3, v.input));
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1, t + 0.15);
    const nodes: AudioScheduledSourceNode[] = [];
    const base = ultimate ? 70 : 110;
    for (const d of [-9, 0, 7, 12.05]) {
      const o = a.osc('sawtooth', base * Math.pow(2, d / 12), t, dur, a.filter('lowpass', ultimate ? 1500 : 2200, 1.2, a.gain(0.18, out)));
      nodes.push(o);
    }
    // Roaring hiss with a slow sweep.
    const hiss = a.gain(0.5, out);
    const bp = a.filter('bandpass', 1400, 0.9, hiss);
    nodes.push(a.noise(a.white, t, dur, bp));
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const lg = a.gain(500);
    lfo.connect(lg).connect(bp.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
    nodes.push(lfo);
    // Electric shimmer.
    const sh = a.gain(0.12, out);
    nodes.push(a.osc('square', ultimate ? 1320 : 1760, t, dur, a.filter('bandpass', 3000, 6, sh)));
    let stopped = false;
    return {
      set: () => {},
      stop: () => {
        if (stopped) return;
        stopped = true;
        const n = a.now;
        out.gain.cancelScheduledValues(n);
        out.gain.setValueAtTime(out.gain.value, n);
        out.gain.exponentialRampToValueAtTime(0.0001, n + 0.35);
        for (const s of nodes) s.stop(n + 0.4);
      },
    };
  }

  /* ---------------------------------------------------------------- body & movement */

  footstep(pos: P, surface: 'grass' | 'stone' | 'dirt' | 'water', run: number): void {
    const a = this.a;
    const v = a.voice(0.3, { pos, gain: 0.12 + run * 0.12, reverb: 0.03, range: 25 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    if (surface === 'water') {
      a.noise(a.white, t, 0.22, a.filter('bandpass', rnd(700, 1100), 1.4, g));
      a.env(g.gain, t, 0.01, 0.9, 0.18);
      return;
    }
    const f = surface === 'stone' ? rnd(1800, 2600) : surface === 'dirt' ? rnd(900, 1300) : rnd(2600, 4200);
    a.noise(a.white, t, 0.1, a.filter(surface === 'grass' ? 'highpass' : 'bandpass', f, 0.9, g));
    a.env(g.gain, t, 0.004, surface === 'grass' ? 0.4 : 0.7, surface === 'stone' ? 0.05 : 0.08);
    const th = a.gain(0, v.input);
    const o = a.osc('sine', surface === 'stone' ? 140 : 95, t, 0.1, th);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.06);
    a.env(th.gain, t, 0.002, 0.5, 0.06);
  }

  land(pos: P, hard: boolean): void {
    const a = this.a;
    const v = a.voice(0.8, { pos, gain: hard ? 0.9 : 0.4, reverb: 0.15, range: 40 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const th = a.gain(0, v.input);
    const o = a.osc('sine', hard ? 110 : 150, t, 0.4, th);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    a.env(th.gain, t, 0.003, 0.9, hard ? 0.35 : 0.15);
    const d = a.gain(0, v.input);
    a.noise(a.pink, t, 0.5, a.filter('lowpass', hard ? 1600 : 1100, 0.7, d));
    a.env(d.gain, t, 0.004, hard ? 0.8 : 0.35, hard ? 0.4 : 0.15);
  }

  dash(pos: P): void {
    this.whoosh(pos, 1.3, 0.2, 0.5);
    const a = this.a;
    const v = a.voice(0.3, { pos, gain: 0.25, reverb: 0.05 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    const o = a.osc('sine', 2200, t, 0.2, g);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    a.env(g.gain, t, 0.002, 0.3, 0.16);
  }

  /** Flight take-off / sonic boom on boost. */
  takeoff(pos: P, boom: boolean): void {
    const a = this.a;
    this.whoosh(pos, 0.7, 0.55, 0.55);
    if (!boom) return;
    const v = a.voice(1.4, { pos, gain: 0.85, reverb: 0.3, range: 120, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, a.shaper(5, v.input));
    a.noise(a.brown, t, 1.2, a.filter('lowpass', 420, 0.8, g));
    a.env(g.gain, t, 0.004, 2.2, 1.0);
    const c = a.gain(0, v.input);
    a.noise(a.white, t, 0.1, a.filter('highpass', 2500, 0.7, c));
    a.env(c.gain, t, 0.001, 0.5, 0.06);
  }

  vanish(pos: P): void {
    const a = this.a;
    const v = a.voice(0.4, { pos, gain: 0.45, reverb: 0.2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    const bp = a.filter('bandpass', 3000, 3, g);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    a.noise(a.white, t, 0.18, bp);
    a.env(g.gain, t, 0.001, 1, 0.12);
  }

  /* ---------------------------------------------------------------- power */

  /** Battle roar: formant-filtered saw with vibrato and grit; `len` seconds, `pitch` voice height. */
  roar(pos: P, len = 1.4, pitch = 1): void {
    const a = this.a;
    const ctx = this.ctx;
    if (!ctx) return;
    const v = a.voice(len + 0.6, { pos, gain: 0.7, reverb: 0.4, range: 90, priority: 2 });
    if (!v) return;
    const t = a.now;
    const src = a.gain(1);
    const f0 = 120 * pitch;
    for (const det of [0, 0.6, -0.4]) {
      const o = a.osc('sawtooth', f0 * Math.pow(2, det / 12), t, len + 0.3, src);
      o.frequency.setValueAtTime(f0 * 0.85, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + len * 0.55);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t + len);
      const vib = ctx.createOscillator();
      vib.frequency.value = 6.5;
      const vg = a.gain(f0 * 0.05);
      vib.connect(vg).connect(o.frequency);
      vib.start(t);
      vib.stop(t + len + 0.3);
    }
    // "AAAH" formants.
    const mix = a.gain(0, a.shaper(6, v.input));
    for (const [f, q, k] of [
      [760, 8, 1],
      [1180, 9, 0.7],
      [2600, 12, 0.35],
    ] as const) {
      const bp = a.filter('bandpass', f * (0.95 + pitch * 0.05), q);
      src.connect(bp);
      bp.connect(a.gain(k, mix));
    }
    mix.gain.setValueAtTime(0.0001, t);
    mix.gain.exponentialRampToValueAtTime(1.3, t + 0.12);
    mix.gain.setValueAtTime(1.3, t + len - 0.25);
    mix.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.25);
    // Breath / rasp.
    const br = a.gain(0, v.input);
    a.noise(a.pink, t, len + 0.3, a.filter('bandpass', 1500, 0.8, br));
    br.gain.setValueAtTime(0.0001, t);
    br.gain.exponentialRampToValueAtTime(0.35, t + 0.15);
    br.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.25);
  }

  /** Transformation release: explosion + bright shimmering chord. */
  transformBurst(pos: P, tier: number): void {
    this.explosion(pos, 2.2, tier >= 2);
    const a = this.a;
    const v = a.voice(3.2, { pos, gain: 0.55, reverb: 0.6, range: 200, priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const root = 220 * Math.pow(2, Math.min(tier, 6) / 12);
    for (const r of [1, 1.26, 1.5, 2, 2.52, 3]) {
      const g = a.gain(0, v.input);
      const o = a.osc('triangle', root * r, t + 0.05, 3, g);
      o.detune.value = rnd(-8, 8);
      a.env(g.gain, t + 0.05, 0.03, 0.09, 2.8);
    }
    if (tier >= 2) this.lightning(pos, true);
  }

  /* ---------------------------------------------------------------- cues */

  /** Enemy wind-up telegraph: gold = bright two-note chime, red = low warning sting. */
  telegraph(pos: P, red: boolean): void {
    const a = this.a;
    const v = a.voice(0.8, { pos, gain: red ? 1.1 : 0.9, reverb: 0.3, range: 60, priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    if (red) {
      for (const f of [196, 207.6]) {
        const g = a.gain(0, a.filter('lowpass', 1800, 1, v.input));
        a.osc('sawtooth', f, t, 0.5, g);
        a.env(g.gain, t, 0.005, 0.22, 0.45);
      }
      this.crackle(v.input, t, 0.15, 0.25);
    } else {
      [1568, 2349].forEach((f, i) => {
        const g = a.gain(0, v.input);
        a.osc('sine', f, t + i * 0.06, 0.5, g);
        a.env(g.gain, t + i * 0.06, 0.002, 0.22, 0.4);
      });
    }
  }

  /** Perfect dodge: reverse whoosh into a glassy "shing". */
  perfectDodge(): void {
    const a = this.a;
    const v = a.voice(1.8, { gain: 1.15, reverb: 0.6, bus: 'ui', priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    const bp = a.filter('bandpass', 400, 2, g);
    bp.frequency.exponentialRampToValueAtTime(5000, t + 0.18);
    a.noise(a.white, t, 0.2, bp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.17);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    for (const f of [2637, 3951, 5274]) {
      const s = a.gain(0, v.input);
      a.osc('sine', f, t + 0.15, 1.5, s);
      a.env(s.gain, t + 0.15, 0.003, 0.12, 1.3);
    }
  }

  stun(pos: P): void {
    const a = this.a;
    const v = a.voice(1.2, { pos, gain: 0.6, reverb: 0.35, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    [880, 1109, 1319, 1760].forEach((f, i) => {
      const g = a.gain(0, v.input);
      a.osc('triangle', f, t + i * 0.05, 0.6, g);
      a.env(g.gain, t + i * 0.05, 0.003, 0.14, 0.5);
    });
  }

  /** Chain-attack cut-in stinger: snare crack + brass stab. */
  stinger(): void {
    const a = this.a;
    const v = a.voice(1.4, { gain: 0.8, reverb: 0.4, bus: 'ui', priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const sn = a.gain(0, v.input);
    a.noise(a.white, t, 0.3, a.filter('highpass', 1200, 0.7, sn));
    a.env(sn.gain, t, 0.001, 0.8, 0.22);
    for (const f of [146.8, 220, 293.7, 349.2]) {
      const g = a.gain(0, a.shaper(2, v.input));
      const lp = a.filter('lowpass', 400, 1, g);
      lp.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.8);
      a.osc('sawtooth', f, t, 1, lp);
      a.env(g.gain, t, 0.01, 0.1, 0.9);
    }
  }

  /* ---------------------------------------------------------------- UI */

  ui(kind: 'hover' | 'select' | 'back' | 'open' | 'deny' | 'xp' | 'point'): void {
    const a = this.a;
    const v = a.voice(0.5, { gain: 0.5, reverb: 0.08, bus: 'ui', range: 1, priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const note = (f: number, at: number, len: number, k = 0.2, type: OscillatorType = 'triangle') => {
      const g = a.gain(0, v.input);
      a.osc(type, f, t + at, len, g);
      a.env(g.gain, t + at, 0.003, k, len);
    };
    switch (kind) {
      case 'hover':
        note(1320, 0, 0.05, 0.08, 'sine');
        break;
      case 'select':
        note(880, 0, 0.12);
        note(1320, 0.05, 0.18);
        break;
      case 'back':
        note(990, 0, 0.1);
        note(660, 0.05, 0.14);
        break;
      case 'open':
        this.whoosh(undefined, 1.6, 0.16, 0.25);
        break;
      case 'deny':
        note(220, 0, 0.12, 0.25, 'square');
        note(196, 0.07, 0.14, 0.2, 'square');
        break;
      case 'xp':
        note(1760, 0, 0.08, 0.1, 'sine');
        note(2349, 0.04, 0.12, 0.08, 'sine');
        break;
      case 'point':
        note(1046, 0, 0.08, 0.15);
        break;
    }
  }

  /** Short brass-and-bell fanfare (level up, victory). */
  fanfare(kind: 'level' | 'victory' | 'defeat'): void {
    const a = this.a;
    const v = a.voice(3.5, { gain: 0.7, reverb: 0.5, bus: 'ui', priority: 2 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const brass = (f: number, at: number, len: number, k: number) => {
      const g = a.gain(0, a.shaper(2, v.input));
      const lp = a.filter('lowpass', 500, 1, g);
      lp.frequency.setValueAtTime(500, t + at);
      lp.frequency.exponentialRampToValueAtTime(3000, t + at + 0.08);
      lp.frequency.exponentialRampToValueAtTime(1100, t + at + len);
      for (const d of [-6, 6]) {
        const o = a.osc('sawtooth', f, t + at, len, lp);
        o.detune.value = d;
      }
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.linearRampToValueAtTime(k, t + at + 0.04);
      g.gain.setValueAtTime(k, t + at + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
    };
    const bell = (f: number, at: number) => {
      const g = a.gain(0, v.input);
      a.osc('sine', f, t + at, 1.6, g);
      a.env(g.gain, t + at, 0.002, 0.12, 1.4);
    };
    if (kind === 'level') {
      [392, 523.3, 659.3].forEach((f, i) => brass(f, i * 0.09, 0.22, 0.12));
      brass(784, 0.27, 1.1, 0.14);
      brass(523.3, 0.27, 1.1, 0.08);
      [1568, 2093, 2637, 3136].forEach((f, i) => bell(f, 0.3 + i * 0.07));
    } else if (kind === 'victory') {
      [293.7, 293.7, 293.7, 392, 349.2, 440].forEach((f, i) => brass(f, [0, 0.12, 0.24, 0.36, 0.72, 0.9][i], i === 5 ? 1.4 : 0.14, 0.13));
      [587.3, 740, 880].forEach((f) => brass(f, 0.9, 1.4, 0.06));
      [1760, 2349, 2960].forEach((f, i) => bell(f, 0.95 + i * 0.08));
    } else {
      [220, 207.6, 196, 174.6].forEach((f, i) => brass(f, i * 0.32, 0.5, 0.1));
      const low = a.gain(0, v.input);
      a.osc('sine', 55, t, 2.5, low);
      a.env(low.gain, t, 0.3, 0.5, 2);
    }
  }

  /** Crowd roar swell (arena). */
  crowd(intensity = 1): void {
    const a = this.a;
    const v = a.voice(3, { gain: 0.4 * intensity, reverb: 0.5, bus: 'amb', priority: 1 });
    if (!v || !this.ctx) return;
    const t = a.now;
    const g = a.gain(0, v.input);
    for (const f of [520, 900, 1400]) a.noise(a.pink, t, 2.8, a.filter('bandpass', f, 1.2, g));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  }
}
