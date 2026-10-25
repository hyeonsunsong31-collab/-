import * as THREE from 'three';

const _v = new THREE.Vector3();

export interface Voice {
  /** Connect sound sources here. */
  input: AudioNode;
  /** When the voice can be released (seconds, context time). */
  end: number;
}

/**
 * Web Audio backbone: master chain (bus gains → glue compressor → limiter), a generated stereo convolution reverb,
 * cached noise buffers, a slow-motion "underwater" filter on the effects bus, and positional voices (distance
 * attenuation, air absorption low-pass, equal-power panning relative to the camera) with a voice budget.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  ui!: GainNode;
  reverbIn!: GainNode;
  /** Post-limiter tap for level metering (tests, debug overlay). */
  analyser!: AnalyserNode;
  private slowFilter!: BiquadFilterNode;
  white!: AudioBuffer;
  brown!: AudioBuffer;
  pink!: AudioBuffer;
  private voices = 0;
  maxVoices = 56;
  readonly listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), fwd: new THREE.Vector3(0, 0, -1) };
  private vol = { master: 0.8, music: 0.55, sfx: 0.85 };
  private unlockListeners: (() => void)[] = [];

  /** Create / resume the context (must run inside a user gesture). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 3;
    glue.attack.value = 0.008;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(glue).connect(limiter).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    limiter.connect(this.analyser);
    this.slowFilter = ctx.createBiquadFilter();
    this.slowFilter.type = 'lowpass';
    this.slowFilter.frequency.value = 20000;
    this.slowFilter.Q.value = 0.8;
    this.slowFilter.connect(this.master);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.ui = ctx.createGain();
    this.sfx.connect(this.slowFilter);
    this.amb.connect(this.slowFilter);
    this.music.connect(this.master);
    this.ui.connect(this.master);
    // Reverb send.
    this.reverbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.6, 2.4);
    const rvOut = ctx.createGain();
    rvOut.gain.value = 0.55;
    this.reverbIn.connect(conv).connect(rvOut).connect(this.slowFilter);
    this.white = this.noiseBuffer('white');
    this.brown = this.noiseBuffer('brown');
    this.pink = this.noiseBuffer('pink');
    this.applyVolumes();
    for (const fn of this.unlockListeners) fn();
  }

  onUnlock(fn: () => void): void {
    if (this.ctx) fn();
    else this.unlockListeners.push(fn);
  }

  /** Peak and RMS of the most recent output window. */
  meter(): { peak: number; rms: number } {
    if (!this.analyser) return { peak: 0, rms: 0 };
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    let sum = 0;
    for (const v of buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / buf.length) };
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Perceptual (squared) volume curves.
    this.master.gain.setTargetAtTime(this.vol.master * this.vol.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * this.vol.music * 0.8, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx * this.vol.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.vol.sfx * this.vol.sfx * 0.7, t, 0.05);
    this.ui.gain.setTargetAtTime(this.vol.sfx * this.vol.sfx * 0.8, t, 0.05);
  }

  /** Muffle the world during slow motion (0..1). */
  slowmo(k: number): void {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(900 / 20000, Math.min(1, k));
    this.slowFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.04);
  }

  setListener(camera: THREE.Camera): void {
    camera.getWorldPosition(this.listener.pos);
    camera.getWorldDirection(this.listener.fwd);
    this.listener.right.crossVectors(this.listener.fwd, _v.set(0, 1, 0)).normalize();
  }

  /* ---------------------------------------------------------------- buffers */

  private noiseBuffer(kind: 'white' | 'brown' | 'pink'): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 2.5);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    }
    return b;
  }

  /** Stereo decaying-noise impulse response (early reflections + diffuse tail). */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.012 ? 0.2 : 1);
      }
      // A few discrete early reflections.
      for (let k = 0; k < 6; k++) {
        const at = Math.floor(ctx.sampleRate * (0.015 + Math.random() * 0.06));
        d[at] += (Math.random() > 0.5 ? 1 : -1) * 0.6;
      }
    }
    return b;
  }

  /* ---------------------------------------------------------------- voices */

  /**
   * A routed voice: positional when `pos` is given (distance roll-off, air absorption, panning), otherwise centred.
   * Returns null when over budget or out of earshot.
   */
  voice(
    dur: number,
    opts: { pos?: THREE.Vector3; gain?: number; reverb?: number; bus?: 'sfx' | 'ui' | 'amb'; range?: number; priority?: number } = {},
  ): Voice | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    if (this.voices >= this.maxVoices && (opts.priority ?? 0) < 1) return null;
    const t = ctx.currentTime;
    let gain = opts.gain ?? 1;
    let pan = 0;
    let cutoff = 20000;
    let rev = opts.reverb ?? 0.15;
    if (opts.pos) {
      const to = _v.subVectors(opts.pos, this.listener.pos);
      const d = to.length();
      const range = opts.range ?? 60;
      if (d > range * 2.2) return null;
      gain *= 1 / (1 + Math.max(0, d - 2) / (range * 0.18));
      if (d > 0.01) {
        to.multiplyScalar(1 / d);
        pan = THREE.MathUtils.clamp(to.dot(this.listener.right), -1, 1) * Math.min(1, d / 3) * 0.85;
      }
      cutoff = 20000 / (1 + d / 18);
      rev += Math.min(0.35, d / 140);
    }
    if (gain < 0.004) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(500, cutoff);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(lp).connect(p);
    p.connect(opts.bus === 'ui' ? this.ui : opts.bus === 'amb' ? this.amb : this.sfx);
    if (rev > 0) {
      const s = ctx.createGain();
      s.gain.value = rev;
      p.connect(s).connect(this.reverbIn);
      setTimeout(() => s.disconnect(), (dur + 3) * 1000);
    }
    this.voices++;
    const end = t + dur;
    setTimeout(
      () => {
        this.voices--;
        p.disconnect();
      },
      (dur + 0.3) * 1000,
    );
    return { input: g, end };
  }

  /* ---------------------------------------------------------------- building blocks */

  osc(type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(buf: AudioBuffer, t: number, dur: number, out: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(out);
    s.start(t, Math.random() * (buf.duration - 0.5));
    s.stop(t + dur + 0.05);
    return s;
  }

  filter(type: BiquadFilterType, freq: number, q = 1, out?: AudioNode): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (out) f.connect(out);
    return f;
  }

  gain(v: number, out?: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    if (out) g.connect(out);
    return g;
  }

  /** Attack / exponential decay envelope on a gain param. */
  env(p: AudioParam, t: number, attack: number, peak: number, decay: number): void {
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private curves = new Map<number, Float32Array<ArrayBuffer>>();

  /** Soft-clip waveshaper (drive 1..50). */
  shaper(drive: number, out?: AudioNode): WaveShaperNode {
    const ws = this.ctx!.createWaveShaper();
    let c = this.curves.get(drive);
    if (!c) {
      c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        c[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      this.curves.set(drive, c);
    }
    ws.curve = c;
    ws.oversample = '2x';
    if (out) ws.connect(out);
    return ws;
  }
}
