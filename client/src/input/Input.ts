import { dashDirection, dashDirectionAnalog, type DashDir } from './dash.ts';

export type Action =
  | 'light'
  | 'heavy'
  | 'ki'
  | 'dodge'
  | 'jump'
  | 'descend'
  | 'transform'
  | 'block'
  | 'sprint'
  | 'interact'
  | 'menu'
  | 'character'
  | 'map'
  | 'lock';

const KEYMAP: Record<string, Action> = {
  KeyE: 'heavy',
  KeyR: 'ki',
  KeyQ: 'dodge',
  Space: 'jump',
  ControlLeft: 'descend',
  KeyC: 'character',
  KeyT: 'transform',
  ShiftLeft: 'sprint',
  KeyF: 'interact',
  Escape: 'menu',
  KeyM: 'map',
  Tab: 'lock',
};

interface ActionState {
  down: boolean;
  pressed: boolean;
  released: boolean;
  t: number;
  lastPress: number;
  double: boolean;
}

/**
 * Unified input: keyboard + mouse on PC, virtual controls on touch. Exposes held/pressed/released edges,
 * hold durations, double-taps (Space → flight, T → revert), a 250 ms action buffer and camera deltas.
 */
export class Input {
  private st = new Map<Action, ActionState>();
  private keys = new Set<string>();
  readonly move = { x: 0, y: 0 };
  readonly cam = { x: 0, y: 0 };
  /** Analog stick from touch (overrides keys when active). */
  readonly stick = { x: 0, y: 0, active: false };
  shiftLock = false;
  private dragging = false;
  private buffer: { a: Action; t: number }[] = [];
  private now = 0;
  sensitivity = 1;
  invertY = false;
  enabled = true;
  /** Set when the UI should get keyboard input (menus). */
  uiCapture = false;
  touchMode = false;
  private listeners: ((a: Action) => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      canvas.focus();
      this.dragging = true;
      if (e.button === 0) this.set('light', true);
      if (e.button === 2) this.set('block', true);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.set('light', false);
      if (e.button === 2) this.set('block', false);
      if (e.buttons === 0) this.dragging = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (this.dragging || document.pointerLockElement === canvas) {
        this.cam.x += e.movementX * this.sensitivity;
        this.cam.y += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.shiftLock) this.shiftLock = false;
    });
  }

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (down && e.code === 'ShiftRight') this.toggleShiftLock();
    const a = KEYMAP[e.code];
    if (a) this.set(a, down);
  }

  toggleShiftLock(): void {
    this.shiftLock = !this.shiftLock;
    if (this.touchMode) return;
    if (this.shiftLock) this.canvas.requestPointerLock?.();
    else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private get(a: Action): ActionState {
    let s = this.st.get(a);
    if (!s) {
      s = { down: false, pressed: false, released: false, t: 0, lastPress: -9, double: false };
      this.st.set(a, s);
    }
    return s;
  }

  /** Set an action's down state (keyboard, mouse and virtual touch buttons all route here). */
  set(a: Action, down: boolean): void {
    const s = this.get(a);
    if (down && !s.down) {
      s.down = true;
      s.pressed = true;
      s.t = 0;
      s.double = this.now - s.lastPress < 0.3;
      s.lastPress = this.now;
      this.buffer.push({ a, t: this.now });
      for (const fn of this.listeners) fn(a);
    } else if (!down && s.down) {
      s.down = false;
      s.released = true;
    }
  }

  releaseAll(): void {
    for (const [a, s] of this.st) if (s.down) this.set(a, false);
    this.keys.clear();
    this.dragging = false;
  }

  held(a: Action): boolean {
    return this.enabled && this.get(a).down;
  }
  pressed(a: Action): boolean {
    return this.enabled && this.get(a).pressed;
  }
  released(a: Action): boolean {
    return this.enabled && this.get(a).released;
  }
  doubleTapped(a: Action): boolean {
    const s = this.get(a);
    return this.enabled && s.pressed && s.double;
  }
  holdTime(a: Action): number {
    const s = this.get(a);
    return s.down ? s.t : 0;
  }

  /** Consume a buffered press younger than `maxAge` seconds. */
  consume(a: Action, maxAge = 0.25): boolean {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const b = this.buffer[i];
      if (b.a === a && this.now - b.t <= maxAge) {
        this.buffer.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Peek without consuming. */
  buffered(a: Action, maxAge = 0.25): boolean {
    return this.buffer.some((b) => b.a === a && this.now - b.t <= maxAge);
  }

  clearBuffer(a?: Action): void {
    if (!a) this.buffer.length = 0;
    else this.buffer = this.buffer.filter((b) => b.a !== a);
  }

  dashDir(): DashDir {
    if (this.stick.active) return dashDirectionAnalog(this.stick.x, this.stick.y);
    const k = this.keys;
    return dashDirection({
      w: k.has('KeyW') || k.has('ArrowUp'),
      a: k.has('KeyA') || k.has('ArrowLeft'),
      s: k.has('KeyS') || k.has('ArrowDown'),
      d: k.has('KeyD') || k.has('ArrowRight'),
    });
  }

  /** Call once per frame before gameplay reads input. */
  update(dt: number): void {
    this.now += dt;
    if (this.stick.active) {
      this.move.x = this.stick.x;
      this.move.y = this.stick.y;
    } else {
      const k = this.keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      this.move.x = x / l;
      this.move.y = y / l;
    }
    for (const s of this.st.values()) if (s.down) s.t += dt;
    if (this.buffer.length > 16) this.buffer.splice(0, this.buffer.length - 16);
  }

  /** Call at the end of the frame: clears edges and camera deltas. */
  endFrame(): void {
    for (const s of this.st.values()) {
      s.pressed = false;
      s.released = false;
    }
    this.cam.x = 0;
    this.cam.y = 0;
  }

  get time(): number {
    return this.now;
  }
}
