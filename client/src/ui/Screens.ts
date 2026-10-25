import type { Settings, SettingsData } from '../core/Settings.ts';
import './styles/screens.css';

const el = <T extends HTMLElement = HTMLDivElement>(html: string): T => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
};

/* ==================================================================== TITLE */

/**
 * Title screen over the live world: the hero charges an aura under a slow orbiting camera while the logo, menu
 * and "press any key" prompt animate in. START hands control to the player with the camera blending back.
 */
export class TitleScreen {
  readonly root: HTMLDivElement;
  onStart: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onControls: (() => void) | null = null;
  private armed = false;

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="ak-title">
        <div class="shade"></div>
        <div class="logo">
          <div class="l1">ASCENDANT<span>KI</span></div>
          <div class="tag">AN OPEN-WORLD KI ACTION RPG</div>
        </div>
        <nav class="menu">
          <button data-a="start"><b>START</b><small></small></button>
          <button data-a="settings"><b>SETTINGS</b></button>
          <button data-a="controls"><b>CONTROLS</b></button>
        </nav>
        <div class="press">PRESS ANY KEY</div>
        <div class="foot"><span class="save"></span><span>v1.0 · every mesh, motion, effect and sound generated in code</span></div>
      </div>`);
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('.menu button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'start') this.start();
        else if (a === 'settings') this.onSettings?.();
        else this.onControls?.();
      }),
    );
    const ignore = new Set(['Escape', 'Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
    window.addEventListener('keydown', (e) => {
      if (!this.armed || !this.root.classList.contains('on') || e.repeat) return;
      if (document.querySelector('.ak-panel.on')) return;
      if (ignore.has(e.code) || /^F\d+$/.test(e.code)) return;
      e.preventDefault();
      this.start();
    });
    // Tap / click anywhere outside the menu starts too.
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.menu')) return;
      this.start();
    });
  }

  show(save: { mode: string; level: number; name: string }): void {
    const startLabel = this.root.querySelector('[data-a="start"] small') as HTMLElement;
    startLabel.textContent = save.level > 1 ? `CONTINUE · ${save.name} · LV ${save.level}` : 'BEGIN YOUR JOURNEY';
    (this.root.querySelector('.save') as HTMLElement).textContent =
      save.mode === 'online' ? '● ONLINE — progress saved to the server' : '○ OFFLINE — progress saved on this device';
    this.root.classList.add('on');
    setTimeout(() => (this.armed = true), 900);
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  private start(): void {
    if (!this.armed) return;
    this.armed = false;
    this.root.classList.add('leaving');
    setTimeout(() => this.root.classList.remove('on', 'leaving'), 700);
    this.onStart?.();
  }
}

/* ==================================================================== PANELS */

/** Base for modal side panels (settings, controls). */
class Panel {
  readonly root: HTMLDivElement;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, title: string, sub: string, body: string) {
    this.root = el(`
      <div class="ak-panel">
        <div class="box">
          <div class="head"><b>${title}</b><span>${sub}</span><button class="x" aria-label="Close">✕</button></div>
          <div class="content">${body}</div>
        </div>
      </div>`);
    parent.appendChild(this.root);
    this.root.querySelector('.x')!.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('on') && e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    });
  }

  open(): void {
    this.root.classList.add('on');
  }

  close(): void {
    if (!this.root.classList.contains('on')) return;
    this.root.classList.remove('on');
    this.onClose?.();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }
}

export class SettingsPanel extends Panel {
  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private currentQuality: string,
  ) {
    super(
      parent,
      'SETTINGS',
      'GRAPHICS · CONTROLS · AUDIO',
      `
      <section><h4>GRAPHICS</h4>
        <div class="opt"><label>Quality</label><div class="seg" data-k="quality">
          <button data-v="auto">AUTO</button><button data-v="low">LOW</button><button data-v="medium">MEDIUM</button><button data-v="high">HIGH</button><button data-v="ultra">ULTRA</button>
        </div></div>
        <div class="opt note q-note">Quality changes apply after a reload. <button class="apply">RELOAD NOW</button></div>
        <div class="opt"><label>Camera shake</label><input type="range" min="0" max="1.5" step="0.05" data-k="shake"><output></output></div>
        <div class="opt"><label>Damage numbers</label><button class="tog" data-k="damageNumbers"></button></div>
      </section>
      <section><h4>CONTROLS</h4>
        <div class="opt"><label>Camera sensitivity</label><input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity"><output></output></div>
        <div class="opt"><label>Invert camera Y</label><button class="tog" data-k="invertY"></button></div>
        <div class="opt"><label>Touch controls</label><div class="seg" data-k="touch"><button data-v="auto">AUTO</button><button data-v="on">ON</button><button data-v="off">OFF</button></div></div>
      </section>
      <section><h4>AUDIO</h4>
        <div class="opt"><label>Master</label><input type="range" min="0" max="1" step="0.01" data-k="master"><output></output></div>
        <div class="opt"><label>Music</label><input type="range" min="0" max="1" step="0.01" data-k="music"><output></output></div>
        <div class="opt"><label>Effects</label><input type="range" min="0" max="1" step="0.01" data-k="sfx"><output></output></div>
      </section>`,
    );
    const r = this.root;
    r.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const k = seg.dataset.k as keyof SettingsData;
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          this.settings.set(k, b.dataset.v as never);
          this.refresh();
        }),
      );
    });
    r.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const k = inp.dataset.k as keyof SettingsData;
      inp.addEventListener('input', () => {
        this.settings.set(k, Number(inp.value) as never);
        this.refresh();
      });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
    });
    r.querySelectorAll<HTMLButtonElement>('.tog').forEach((b) => {
      const k = b.dataset.k as keyof SettingsData;
      b.addEventListener('click', () => {
        this.settings.set(k, !this.settings.data[k] as never);
        this.refresh();
      });
    });
    r.querySelector('.apply')!.addEventListener('click', () => location.reload());
  }

  override open(): void {
    this.refresh();
    super.open();
  }

  private refresh(): void {
    const d = this.settings.data;
    const r = this.root;
    r.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const v = String(d[seg.dataset.k as keyof SettingsData]);
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    });
    r.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      const v = d[inp.dataset.k as keyof SettingsData] as number;
      inp.value = String(v);
      const pct = inp.dataset.k === 'sensitivity' || inp.dataset.k === 'shake' ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}%`;
      (inp.nextElementSibling as HTMLElement).textContent = pct;
    });
    r.querySelectorAll<HTMLButtonElement>('.tog').forEach((b) => {
      const on = !!d[b.dataset.k as keyof SettingsData];
      b.classList.toggle('on', on);
      b.textContent = on ? 'ON' : 'OFF';
    });
    const want = d.quality;
    (r.querySelector('.q-note') as HTMLElement).classList.toggle('show', want !== 'auto' && want !== this.currentQuality);
  }
}

export class ControlsPanel extends Panel {
  constructor(parent: HTMLElement) {
    const row = (k: string, v: string) => `<div class="kr"><span class="keys">${k
      .split(' ')
      .map((x) => (x === '+' || x === '/' || x === '×2' ? `<i>${x}</i>` : `<kbd>${x}</kbd>`))
      .join('')}</span><span>${v}</span></div>`;
    super(
      parent,
      'CONTROLS',
      'KEYBOARD & MOUSE · TOUCH',
      `
      <section><h4>MOVEMENT</h4>
        ${row('W A S D', 'Move')}${row('Shift', 'Ninja sprint')}${row('Space', 'Jump (one-leg ninja jump)')}${row('Space ×2', 'Take flight / land')}
        ${row('Space / Ctrl', 'Ascend / descend while flying')}${row('Q', 'Dash — with W/A/S/D for direction (Q alone dashes back)')}
        ${row('Mouse', 'Drag to turn the camera')}${row('RShift', 'Shift-lock camera')}${row('Tab', 'Cycle target')}
      </section>
      <section><h4>COMBAT</h4>
        ${row('LMB', 'Light combo · hold on the 5th hit for a rush')}${row('E', 'Special · EX Special with 60 Energy · hold for Dragon Fist')}
        ${row('RMB', 'Guard · perfect parry on a gold flash')}${row('R', 'Ki blast · hold for a beam · hold at 2000 Surge for the Ultimate')}
        ${row('T', 'Hold to power up and transform · T×2 to revert')}${row('Q', 'Perfect dodge just before a hit → slow-mo, then LMB to counter')}
        ${row('LMB / E / R', 'Pick a Chain Attack finisher on a stunned foe')}
      </section>
      <section><h4>MENUS</h4>
        ${row('C', 'Status — spend stat points')}${row('M', 'World map')}${row('F', 'Talk')}${row('Esc', 'Pause')}
      </section>
      <section><h4>TOUCH</h4>
        <p>Left thumb anywhere on the left side: movement stick (also aims dashes). Drag on the right side to turn the camera.
        Buttons around ATK: DASH, KI, SPECIAL, GUARD, JUMP (tap twice to fly) and POWER. RUN toggles sprint, TARGET cycles foes.</p>
      </section>`,
    );
  }
}

/* ==================================================================== PAUSE */

export class PauseMenu {
  readonly root: HTMLDivElement;
  onResume: (() => void) | null = null;
  onStatus: (() => void) | null = null;
  onMap: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onControls: (() => void) | null = null;
  onTitle: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="ak-pause">
        <div class="side">
          <div class="t">PAUSED</div>
          <nav>
            <button data-a="resume">RESUME</button>
            <button data-a="status">STATUS</button>
            <button data-a="map">WORLD MAP</button>
            <button data-a="settings">SETTINGS</button>
            <button data-a="controls">CONTROLS</button>
            <button data-a="title" class="dim">RETURN TO TITLE</button>
          </nav>
          <div class="tip"></div>
        </div>
      </div>`);
    parent.appendChild(this.root);
    const act: Record<string, () => void> = {
      resume: () => this.onResume?.(),
      status: () => this.onStatus?.(),
      map: () => this.onMap?.(),
      settings: () => this.onSettings?.(),
      controls: () => this.onControls?.(),
      title: () => this.onTitle?.(),
    };
    this.root.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => b.addEventListener('click', () => act[b.dataset.a!]()));
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private static TIPS = [
    'Dodge (Q) a split second before a hit lands to trigger a Perfect Dodge — then strike back with LMB.',
    'Gold flashes can be parried with a timed guard (RMB). Red flashes can only be dodged.',
    'Fill a foe’s Daze gauge to stun them, then land a heavy hit to start a Chain Attack.',
    'Balanced stats raise your Power Level more than piling everything into one.',
    'Every arena win is worth five levels. Talk to a herald to enter the Training Grounds.',
    'Hold T at 1,000+ Surge to transform once you reach the unlock level.',
  ];

  open(): void {
    (this.root.querySelector('.tip') as HTMLElement).textContent = PauseMenu.TIPS[Math.floor(Math.random() * PauseMenu.TIPS.length)];
    this.root.classList.add('on');
  }

  close(): void {
    this.root.classList.remove('on');
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }
}

/* ==================================================================== DEFEAT */

export class DefeatScreen {
  readonly root: HTMLDivElement;
  onRise: (() => void) | null = null;
  private timer = 0;
  private left = 0;

  constructor(parent: HTMLElement) {
    this.root = el(`
      <div class="ak-defeat">
        <b>DEFEATED</b>
        <span>Your ki fades… but a warrior always rises again.</span>
        <button>RISE AGAIN AT ASHFORD <i></i></button>
      </div>`);
    parent.appendChild(this.root);
    this.root.querySelector('button')!.addEventListener('click', () => this.rise());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('on') && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF')) this.rise();
    });
  }

  show(): void {
    this.root.classList.add('on');
    this.left = 8;
    const tick = () => {
      (this.root.querySelector('button i') as HTMLElement).textContent = `${this.left}`;
      if (this.left-- <= 0) this.rise();
      else this.timer = window.setTimeout(tick, 1000);
    };
    tick();
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }

  private rise(): void {
    if (!this.isOpen) return;
    clearTimeout(this.timer);
    this.root.classList.remove('on');
    this.onRise?.();
  }
}
