import type { AudioEngine } from './AudioEngine.ts';

export type MusicMode = 'silent' | 'title' | 'explore' | 'combat' | 'arena';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** MIDI note sets. */
const N = { D2: 38, F2: 41, G2: 43, A2: 45, Bb1: 34, Bb2: 46, C2: 36, C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, Bb3: 58, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69 };

interface Chord {
  bass: number;
  tones: number[];
}

/* Exploration (D dorian, pastoral): i9 – VImaj7 – III – VII, two bars each. */
const EXPLORE: Chord[] = [
  { bass: N.D2, tones: [N.D3, N.F3, N.A3, N.C4, N.E4] },
  { bass: N.Bb1, tones: [N.Bb2, N.D3, N.F3, N.A3, N.C4] },
  { bass: N.F2, tones: [N.F3, N.A3, N.C4, N.E4, N.G4] },
  { bass: N.C2, tones: [N.C3, N.E3, N.G3, N.D4, N.E4] },
];
/* Combat (D minor, driving): i – VI – VII – i | i – VI – iv – V. */
const COMBAT: Chord[] = [
  { bass: N.D2, tones: [N.D3, N.F3, N.A3] },
  { bass: N.Bb1, tones: [N.Bb2, N.D3, N.F3] },
  { bass: N.C2, tones: [N.C3, N.E3, N.G3] },
  { bass: N.D2, tones: [N.D3, N.F3, N.A3] },
  { bass: N.D2, tones: [N.D3, N.F3, N.A3] },
  { bass: N.Bb1, tones: [N.Bb2, N.D3, N.F3] },
  { bass: N.G2 - 12, tones: [N.G3 - 12, N.Bb2, N.D3] },
  { bass: N.A2 - 12, tones: [N.A2, 49, N.E3] },
];
const PENTA = [62, 64, 65, 67, 69, 72, 74, 76, 77, 79];

interface Layer {
  gain: GainNode;
  target: number;
  /** Next step time (context seconds) and index. */
  next: number;
  step: number;
  bpm: number;
  /** Steps per bar. */
  spb: number;
}

/**
 * Generative score with three layers that crossfade by game state: an exploration piece (lute-like plucks, warm
 * pad, frame drum, occasional wooden-flute phrases), a driving combat piece (taiko patterns, bass ostinato,
 * staccato strings, brass stabs and a choir at high intensity) and an epic title theme (choir, low drone, taiko,
 * bells). Notes are scheduled ahead on the audio clock.
 */
export class Music {
  private layers: Record<'explore' | 'combat' | 'title', Layer> | null = null;
  private timer = 0;
  mode: MusicMode = 'silent';
  intensity = 0;
  private duck = 1;
  private phrase: { notes: { step: number; m: number; len: number }[] } | null = null;

  constructor(private a: AudioEngine) {
    a.onUnlock(() => this.init());
  }

  private init(): void {
    const a = this.a;
    const mk = (bpm: number, spb: number): Layer => ({ gain: a.gain(0, a.music), target: 0, next: a.now + 0.1, step: 0, bpm, spb });
    this.layers = { explore: mk(84, 8), combat: mk(150, 16), title: mk(66, 8) };
    // Glue reverb for the score.
    for (const l of Object.values(this.layers)) {
      const s = a.gain(0.35);
      l.gain.connect(s).connect(a.reverbIn);
    }
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.setMode(this.mode, true);
  }

  setMode(m: MusicMode, force = false): void {
    if (m === this.mode && !force) return;
    this.mode = m;
    const L = this.layers;
    if (!L) return;
    L.explore.target = m === 'explore' ? 1 : 0;
    L.combat.target = m === 'combat' || m === 'arena' ? 1 : 0;
    L.title.target = m === 'title' ? 1 : 0;
    const t = this.a.now;
    for (const l of Object.values(L)) {
      l.gain.gain.cancelScheduledValues(t);
      l.gain.gain.setTargetAtTime(l.target * this.duck, t, l.target > 0 ? 0.9 : 1.4);
      // A layer re-entering starts on a fresh bar.
      if (l.target > 0 && l.gain.gain.value < 0.02) {
        l.next = t + 0.08;
        l.step = 0;
      }
    }
  }

  /** Lower the score under menus (0..1). */
  setDuck(k: number): void {
    if (Math.abs(k - this.duck) < 0.01) return;
    this.duck = k;
    this.setMode(this.mode, true);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private schedule(): void {
    const L = this.layers;
    if (!L || !this.a.ready) return;
    const until = this.a.now + 0.22;
    for (const [name, l] of Object.entries(L) as [keyof typeof L, Layer][]) {
      const audible = l.target > 0 || l.gain.gain.value > 0.003;
      if (!audible) {
        l.next = Math.max(l.next, this.a.now);
        continue;
      }
      const dt = 60 / l.bpm / (l.spb / 4);
      while (l.next < until) {
        if (name === 'explore') this.exploreStep(l, l.step, l.next, dt);
        else if (name === 'combat') this.combatStep(l, l.step, l.next, dt);
        else this.titleStep(l, l.step, l.next, dt);
        l.next += dt;
        l.step++;
      }
    }
  }

  /* ---------------------------------------------------------------- exploration */

  private exploreStep(l: Layer, step: number, t: number, dt: number): void {
    const bar = Math.floor(step / l.spb);
    const s = step % l.spb;
    const chord = EXPLORE[Math.floor(bar / 2) % EXPLORE.length];
    const out = l.gain;
    // Pad on the chord change.
    if (s === 0 && bar % 2 === 0) this.pad(out, t, chord.tones.slice(0, 4), dt * l.spb * 2, 0.022);
    // Bass on beats 1 and 3.
    if (s === 0 || (s === 4 && Math.random() < 0.7)) this.bass(out, t, mtof(chord.bass), dt * 3.5, 0.32);
    // Arpeggio.
    const order = [0, 2, 1, 3, 2, 4, 3, 1];
    if (Math.random() > 0.12) {
      const m = chord.tones[order[s] % chord.tones.length] + (s === 7 && Math.random() < 0.4 ? 12 : 0);
      this.pluck(out, t + rnd(0, 0.012), mtof(m), 0.9, 0.16 * (s % 2 ? 0.75 : 1));
    }
    // Frame drum and shaker.
    if (s === 0) this.frameDrum(out, t, 0.28);
    if (s === 4) this.frameDrum(out, t, 0.14, true);
    if (s % 2 === 1) this.shaker(out, t, 0.04);
    // Wooden flute phrase every other 8-bar cycle.
    const cyc = Math.floor(bar / 8);
    if (step % (l.spb * 8) === 0) this.phrase = cyc % 2 === 1 ? this.makePhrase(l.spb * 8) : null;
    const ph = this.phrase;
    if (ph) {
      const local = step % (l.spb * 8);
      for (const n of ph.notes) if (n.step === local) this.flute(out, t, mtof(n.m), n.len * dt, 0.11);
    }
  }

  private makePhrase(steps: number): { notes: { step: number; m: number; len: number }[] } {
    const notes: { step: number; m: number; len: number }[] = [];
    let idx = 4 + Math.floor(Math.random() * 3);
    let s = 0;
    const rhythms = [
      [2, 2, 4],
      [3, 1, 4],
      [4, 2, 2],
      [1, 1, 2, 4],
      [6, 2],
    ];
    while (s < steps - 8) {
      for (const len of pick(rhythms)) {
        if (s >= steps - 4) break;
        if (Math.random() < 0.82) notes.push({ step: s, m: PENTA[idx], len: len * 0.95 });
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + pick([-2, -1, -1, 1, 1, 2, 0])));
        s += len;
      }
      s += pick([2, 4, 4, 8]);
    }
    return { notes };
  }

  /* ---------------------------------------------------------------- combat */

  private combatStep(l: Layer, step: number, t: number, dt: number): void {
    const bar = Math.floor(step / l.spb);
    const s = step % l.spb;
    const chord = COMBAT[bar % COMBAT.length];
    const k = Math.max(0.25, this.intensity);
    const out = l.gain;
    // Taiko pattern (with a fill on the last bar of 8).
    const fill = bar % 8 === 7;
    const kick = fill ? [0, 3, 6, 8, 10, 12, 13, 14, 15] : [0, 6, 8, 11];
    if (kick.includes(s)) this.taiko(out, t, s === 0 ? 0.85 : 0.55 + (fill ? 0.25 : 0), s === 0 ? 1 : 1.25);
    if (s === 4 || s === 12) this.frameDrum(out, t, 0.32, true);
    if (s % 2 === 0) this.shaker(out, t, 0.035 * k);
    // Bass ostinato in 8ths.
    if (s % 2 === 0) {
      const pat = [0, 0, 12, 0, 0, 7, 0, 12];
      this.bass(out, t, mtof(chord.bass + 12 + pat[(s / 2) % 8]), dt * 1.6, 0.26);
    }
    // Staccato strings in 16ths.
    if (k > 0.3) {
      const tone = chord.tones[[0, 1, 2, 1][s % 4]] + 12;
      this.strings(out, t, mtof(tone), dt * 0.9, 0.05 * k * (s % 4 === 0 ? 1.3 : 1));
    }
    // Brass stabs on bar starts.
    if (k > 0.55 && s === 0) this.brass(out, t, chord.tones.map(mtof), dt * (bar % 2 ? 3 : 6), 0.075 * k);
    if (k > 0.55 && fill && s === 14) this.brass(out, t, chord.tones.map((m) => mtof(m + 12)), dt * 2, 0.06);
    // Choir swell for the big fights.
    if (k > 0.8 && s === 0 && bar % 2 === 0) this.choir(out, t, chord.tones.map((m) => mtof(m + 12)), dt * l.spb * 2, 0.05);
  }

  /* ---------------------------------------------------------------- title */

  private titleStep(l: Layer, step: number, t: number, dt: number): void {
    const bar = Math.floor(step / l.spb);
    const s = step % l.spb;
    const chord = EXPLORE[Math.floor(bar / 2) % EXPLORE.length];
    const out = l.gain;
    if (s === 0 && bar % 2 === 0) {
      this.choir(out, t, chord.tones.slice(0, 4).map(mtof), dt * l.spb * 2.1, 0.05);
      this.pad(out, t, [chord.bass + 12, chord.bass + 19], dt * l.spb * 2, 0.03);
    }
    if (s === 0) this.taiko(out, t, 0.5 + (bar % 4 === 3 ? 0.3 : 0), 0.9);
    if (s === 6 && bar % 4 === 3) this.taiko(out, t, 0.45, 1.1);
    if (s === 0 && bar % 2 === 0) this.drone(out, t, mtof(chord.bass - 12), dt * l.spb * 2, 0.08);
    if ((s === 0 || s === 3 || s === 6) && Math.random() < 0.5) this.bell(out, t, mtof(pick(chord.tones) + 24), 0.04);
  }

  /* ---------------------------------------------------------------- instruments */

  private pluck(out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    const lp = a.filter('lowpass', 3600, 1.4, g);
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.exponentialRampToValueAtTime(520, t + 0.28);
    a.osc('triangle', f, t, dur, lp);
    const o2 = a.osc('sawtooth', f, t, dur, a.gain(0.35, lp));
    o2.detune.value = rnd(-6, 6);
    a.env(g.gain, t, 0.003, vel, dur);
  }

  private pad(out: AudioNode, t: number, notes: number[], dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    const lp = a.filter('lowpass', 1100, 0.7, g);
    for (const m of notes) {
      for (const d of [-7, 7]) {
        const o = a.osc('sawtooth', mtof(m), t, dur + 1.5, lp);
        o.detune.value = d;
      }
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.9);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
  }

  private bass(out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    const lp = a.filter('lowpass', 520, 2, g);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    a.osc('sawtooth', f, t, dur, lp);
    a.osc('sine', f / 2, t, dur, a.gain(0.6, g));
    a.env(g.gain, t, 0.005, vel, dur);
  }

  private flute(out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const a = this.a;
    const ctx = a.ctx!;
    const g = a.gain(0, out);
    const o = a.osc('sine', f, t, dur + 0.2, g);
    a.osc('triangle', f * 2, t, dur + 0.2, a.gain(0.12, g));
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = a.gain(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.4, dur * 0.6));
    vib.connect(vg).connect(o.frequency);
    vib.start(t);
    vib.stop(t + dur + 0.2);
    const br = a.gain(0.05, g);
    a.noise(a.white, t, dur + 0.2, a.filter('bandpass', f * 2, 3, br));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.06);
    g.gain.setValueAtTime(vel * 0.85, t + Math.max(0.07, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  }

  private taiko(out: AudioNode, t: number, vel: number, pitch: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    const o = a.osc('sine', 120 * pitch, t, 0.6, g);
    o.frequency.exponentialRampToValueAtTime(46 * pitch, t + 0.22);
    a.env(g.gain, t, 0.003, vel, 0.5);
    const n = a.gain(0, out);
    a.noise(a.white, t, 0.12, a.filter('lowpass', 700, 0.8, n));
    a.env(n.gain, t, 0.001, vel * 0.5, 0.08);
  }

  private frameDrum(out: AudioNode, t: number, vel: number, crack = false): void {
    const a = this.a;
    const n = a.gain(0, out);
    a.noise(a.white, t, 0.2, a.filter('bandpass', crack ? 1900 : 900, 0.9, n));
    a.env(n.gain, t, 0.001, vel, crack ? 0.12 : 0.18);
    const g = a.gain(0, out);
    a.osc('triangle', crack ? 230 : 140, t, 0.2, g);
    a.env(g.gain, t, 0.002, vel * 0.6, 0.12);
  }

  private shaker(out: AudioNode, t: number, vel: number): void {
    const a = this.a;
    const n = a.gain(0, out);
    a.noise(a.white, t, 0.06, a.filter('highpass', 6500, 0.7, n));
    a.env(n.gain, t, 0.004, vel, 0.04);
  }

  private strings(out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    const bp = a.filter('bandpass', 1300, 0.8, g);
    for (const d of [-8, 8]) {
      const o = a.osc('sawtooth', f, t, dur + 0.05, bp);
      o.detune.value = d;
    }
    a.env(g.gain, t, 0.006, vel, dur);
  }

  private brass(out: AudioNode, t: number, fs: number[], dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, a.shaper(2, out));
    const lp = a.filter('lowpass', 400, 1, g);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    for (const f of fs) for (const d of [-5, 5]) a.osc('sawtooth', f, t, dur, lp).detune.setValueAtTime(d, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.03);
    g.gain.setValueAtTime(vel * 0.8, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private choir(out: AudioNode, t: number, fs: number[], dur: number, vel: number): void {
    const a = this.a;
    const src = a.gain(1);
    for (const f of fs) for (const d of [-9, 0, 9]) a.osc('sawtooth', f, t, dur + 1.2, src).detune.setValueAtTime(d, t);
    const g = a.gain(0, out);
    for (const [fm, q, k] of [
      [700, 7, 1],
      [1150, 8, 0.6],
      [2700, 10, 0.25],
    ] as const) {
      const bp = a.filter('bandpass', fm, q);
      src.connect(bp);
      bp.connect(a.gain(k, g));
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.8);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.1);
  }

  private drone(out: AudioNode, t: number, f: number, dur: number, vel: number): void {
    const a = this.a;
    const g = a.gain(0, out);
    a.osc('sine', f, t, dur + 1, g);
    a.osc('triangle', f * 2, t, dur + 1, a.gain(0.25, g));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 1.2);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.9);
  }

  private bell(out: AudioNode, t: number, f: number, vel: number): void {
    const a = this.a;
    const ctx = a.ctx!;
    const g = a.gain(0, out);
    const car = a.osc('sine', f, t, 2.6, g);
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const mg = a.gain(f * 2);
    mg.gain.setValueAtTime(f * 2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.6);
    mod.connect(mg).connect(car.frequency);
    mod.start(t);
    mod.stop(t + 2.6);
    a.env(g.gain, t, 0.002, vel, 2.4);
  }
}
