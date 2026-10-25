import type { Input, Action } from '../input/Input.ts';
import './styles/touch.css';

interface Btn {
  id: string;
  action: Action;
  label: string;
  alt?: string;
  icon: string;
  /** Polar placement around the ATK button (deg, px) or absolute css. */
  angle?: number;
  r?: number;
  css?: Partial<Record<'left' | 'right' | 'top' | 'bottom', string>>;
  size: 'atk' | 'arc' | 'small';
  toggle?: boolean;
  tap?: boolean;
}

const ICON = {
  atk: '<path d="M7 14h5l-2 7 8-11h-5l2-7z"/>',
  heavy: '<path d="M12 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>',
  ki: '<path d="M13 2 4 14h7l-2 8 9-12h-7z"/>',
  dash: '<path d="M3 12h10M9 7l5 5-5 5M15 7l5 5-5 5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  guard: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>',
  jump: '<path d="M5 15l7-7 7 7M5 21l7-7 7 7" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M5 9l7 7 7-7M5 3l7 7 7-7" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  power: '<path d="M12 2c3 5 7 7 7 13a7 7 0 0 1-14 0c0-6 4-8 7-13zm0 9c-1 2-3 3-3 5a3 3 0 0 0 6 0c0-2-2-3-3-5z"/>',
  sprint: '<path d="M4 6l6 6-6 6M12 6l6 6-6 6" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  lock: '<circle cx="12" cy="12" r="6.5" fill="none" stroke-width="2.4"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke-width="2.4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16" stroke-width="2.6" stroke-linecap="round"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="none" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke-width="2.2"/>',
};

const BUTTONS: Btn[] = [
  { id: 'atk', action: 'light', label: 'ATK', icon: ICON.atk, size: 'atk' },
  { id: 'dash', action: 'dodge', label: 'DASH', icon: ICON.dash, angle: 95, r: 102, size: 'arc' },
  { id: 'ki', action: 'ki', label: 'KI', alt: 'ULT', icon: ICON.ki, angle: 126, r: 104, size: 'arc' },
  { id: 'heavy', action: 'heavy', label: 'SPECIAL', alt: 'EX', icon: ICON.heavy, angle: 157, r: 104, size: 'arc' },
  { id: 'guard', action: 'block', label: 'GUARD', icon: ICON.guard, angle: 188, r: 104, size: 'arc' },
  { id: 'jump', action: 'jump', label: 'JUMP', alt: 'RISE', icon: ICON.jump, angle: 218, r: 100, size: 'arc' },
  { id: 'power', action: 'transform', label: 'POWER', alt: 'FORM', icon: ICON.power, angle: 62, r: 108, size: 'arc' },
  { id: 'down', action: 'descend', label: 'DOWN', icon: ICON.down, css: { right: 'calc(268px + var(--ak-safe-r))', bottom: 'calc(26px + var(--ak-safe-b))' }, size: 'small' },
  { id: 'sprint', action: 'sprint', label: 'RUN', icon: ICON.sprint, css: { left: 'calc(22px + var(--ak-safe-l))', bottom: 'calc(178px + var(--ak-safe-b))' }, size: 'small', toggle: true },
  { id: 'lock', action: 'lock', label: 'TARGET', icon: ICON.lock, css: { left: 'calc(78px + var(--ak-safe-l))', bottom: 'calc(178px + var(--ak-safe-b))' }, size: 'small', tap: true },
  { id: 'menu', action: 'menu', label: 'MENU', icon: ICON.menu, css: { right: 'calc(150px + var(--ak-safe-r))', top: 'calc(18px + var(--ak-safe-t))' }, size: 'small', tap: true },
  { id: 'map', action: 'map', label: 'MAP', icon: ICON.map, css: { right: 'calc(150px + var(--ak-safe-r))', top: 'calc(74px + var(--ak-safe-t))' }, size: 'small', tap: true },
];

const ATK_RIGHT = 104;
const ATK_BOTTOM = 92;
const STICK_R = 58;

export interface TouchState {
  exReady: boolean;
  ultReady: boolean;
  formReady: boolean;
  flying: boolean;
  sprinting: boolean;
}

/**
 * Mobile controls: a dynamic joystick that spawns under the left thumb (movement and dash direction), camera drag on
 * the right side of the screen, a ZZZ-mobile button arc around a big ATK button (dash, ki, special/EX, guard, jump/fly,
 * power/transform) with readiness glows, plus run toggle, target cycle, menu and map. Haptic ticks on impacts.
 */
export class TouchControls {
  private root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private stickId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private camId = -1;
  private camLast = { x: 0, y: 0 };
  private btnEls = new Map<string, HTMLElement>();
  private enabled_ = false;
  /** Camera drag multiplier (settings). */
  sensitivity = 1;

  constructor(
    private input: Input,
    parent: HTMLElement = document.getElementById('ui-root') ?? document.body,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ak-touch';
    this.root.innerHTML = `
      <div class="zone-cam"></div>
      <div class="zone-move"><div class="ghost"><i></i></div></div>
      <div class="stick"><div class="knob"></div></div>`;
    parent.appendChild(this.root);
    this.stickBase = this.root.querySelector('.stick')!;
    this.stickKnob = this.root.querySelector('.knob')!;
    const zoneMove = this.root.querySelector('.zone-move') as HTMLElement;
    const zoneCam = this.root.querySelector('.zone-cam') as HTMLElement;
    zoneMove.addEventListener('pointerdown', (e) => this.stickDown(e));
    zoneCam.addEventListener('pointerdown', (e) => this.camDown(e));
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    for (const b of BUTTONS) this.makeButton(b);
  }

  private makeButton(b: Btn): void {
    const el = document.createElement('button');
    el.className = `tb ${b.size}`;
    el.dataset.id = b.id;
    el.innerHTML = `<svg viewBox="0 0 24 24">${b.icon}</svg><span>${b.label}</span>`;
    if (b.size === 'atk') {
      el.style.right = `calc(${ATK_RIGHT}px + var(--ak-safe-r))`;
      el.style.bottom = `calc(${ATK_BOTTOM}px + var(--ak-safe-b))`;
    } else if (b.angle !== undefined) {
      const a = (b.angle * Math.PI) / 180;
      const dx = Math.cos(a) * b.r!;
      const dy = Math.sin(a) * b.r!;
      el.style.right = `calc(${(ATK_RIGHT - dx).toFixed(1)}px + var(--ak-safe-r))`;
      el.style.bottom = `calc(${(ATK_BOTTOM + dy).toFixed(1)}px + var(--ak-safe-b))`;
    } else if (b.css) {
      for (const [k, v] of Object.entries(b.css)) el.style.setProperty(k, v!);
    }
    const press = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      if (b.toggle) {
        const on = !this.input.held(b.action);
        this.input.set(b.action, on);
        el.classList.toggle('on', on);
      } else if (b.tap) {
        this.input.tap(b.action);
      } else this.input.set(b.action, true);
      this.vibrate(8);
    };
    const release = (e: PointerEvent) => {
      el.classList.remove('down');
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!b.toggle && !b.tap) this.input.set(b.action, false);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.appendChild(el);
    this.btnEls.set(b.id, el);
  }

  get enabled(): boolean {
    return this.enabled_;
  }

  set enabled(v: boolean) {
    this.enabled_ = v;
    this.root.classList.toggle('on', v);
    this.input.touchMode = v;
    if (!v) this.resetStick();
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.resetStick();
      for (const [id, el] of this.btnEls) {
        el.classList.remove('down');
        const b = BUTTONS.find((x) => x.id === id)!;
        if (!b.toggle && !b.tap) this.input.set(b.action, false);
      }
    }
  }

  /* ---------------------------------------------------------------- joystick */

  private stickDown(e: PointerEvent): void {
    if (!this.enabled_ || this.stickId >= 0) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    const x = Math.max(STICK_R + 10, Math.min(window.innerWidth * 0.45, e.clientX));
    const y = Math.max(STICK_R + 10, Math.min(window.innerHeight - STICK_R - 10, e.clientY));
    this.stickOrigin = { x, y };
    this.stickBase.style.transform = `translate(${x}px, ${y}px)`;
    this.stickBase.classList.add('on');
    this.root.classList.add('sticking');
    this.applyStick(e.clientX, e.clientY);
  }

  private applyStick(px: number, py: number): void {
    let dx = px - this.stickOrigin.x;
    let dy = py - this.stickOrigin.y;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) {
      // Drag the base along when the thumb overshoots, so direction changes stay responsive.
      const over = l - STICK_R;
      this.stickOrigin.x += (dx / l) * over;
      this.stickOrigin.y += (dy / l) * over;
      this.stickBase.style.transform = `translate(${this.stickOrigin.x}px, ${this.stickOrigin.y}px)`;
      dx = (dx / l) * STICK_R;
      dy = (dy / l) * STICK_R;
    }
    this.stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const s = this.input.stick;
    const dead = 0.12;
    let x = dx / STICK_R;
    let y = -dy / STICK_R;
    const m = Math.hypot(x, y);
    if (m < dead) {
      x = 0;
      y = 0;
    } else {
      const k = (m - dead) / (1 - dead) / m;
      x *= k;
      y *= k;
    }
    s.x = x;
    s.y = y;
    s.active = true;
    this.stickBase.classList.toggle('full', m > 0.92);
  }

  private resetStick(): void {
    this.stickId = -1;
    const s = this.input.stick;
    s.x = 0;
    s.y = 0;
    s.active = false;
    this.stickBase.classList.remove('on', 'full');
    this.root.classList.remove('sticking');
    this.stickKnob.style.transform = '';
  }

  /* ---------------------------------------------------------------- camera */

  private camDown(e: PointerEvent): void {
    if (!this.enabled_ || this.camId >= 0) return;
    e.preventDefault();
    this.camId = e.pointerId;
    this.camLast = { x: e.clientX, y: e.clientY };
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      e.preventDefault();
      this.applyStick(e.clientX, e.clientY);
    } else if (e.pointerId === this.camId) {
      e.preventDefault();
      const k = 1.7 * this.sensitivity;
      this.input.cam.x += (e.clientX - this.camLast.x) * k;
      this.input.cam.y += (e.clientY - this.camLast.y) * k * (this.input.invertY ? -1 : 1);
      this.camLast = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) this.resetStick();
    if (e.pointerId === this.camId) this.camId = -1;
  }

  /* ---------------------------------------------------------------- state */

  update(st: TouchState): void {
    if (!this.enabled_) return;
    const set = (id: string, ready: boolean, alt: boolean) => {
      const el = this.btnEls.get(id)!;
      el.classList.toggle('ready', ready);
      const b = BUTTONS.find((x) => x.id === id)!;
      const label = alt && b.alt ? b.alt : b.label;
      const sp = el.querySelector('span') as HTMLElement;
      if (sp.textContent !== label) sp.textContent = label;
    };
    set('heavy', st.exReady, st.exReady);
    set('ki', st.ultReady, st.ultReady);
    set('power', st.formReady, st.formReady);
    set('jump', false, st.flying);
    this.btnEls.get('down')!.classList.toggle('gone', !st.flying);
    this.btnEls.get('sprint')!.classList.toggle('on', st.sprinting || this.input.held('sprint'));
  }

  vibrate(ms: number): void {
    if (!this.enabled_) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* not supported */
    }
  }
}
