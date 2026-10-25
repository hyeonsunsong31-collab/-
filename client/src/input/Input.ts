import { dashDirection, dashDirectionAnalog, type DashDir } from './dash.ts';
import { ActionState, type Action } from './ActionState.ts';

export type { Action };

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

/**
 * Human input: keyboard + mouse on PC, virtual controls on touch (they call `set` and write `stick`).
 * Adds WASD/stick movement, camera deltas and Right Shift shift-lock on top of the shared button state.
 */
export class Input extends ActionState {
  private keys = new Set<string>();
  readonly move = { x: 0, y: 0 };
  readonly cam = { x: 0, y: 0 };
  /** Analog stick from touch (overrides keys when active). */
  readonly stick = { x: 0, y: 0, active: false };
  shiftLock = false;
  private dragging = false;
  sensitivity = 1;
  invertY = false;
  /** Set when the UI should get keyboard input (menus). */
  uiCapture = false;
  touchMode = false;

  constructor(private canvas: HTMLCanvasElement) {
    super();
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

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat || this.uiCapture) return;
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

  override releaseAll(): void {
    super.releaseAll();
    this.keys.clear();
    this.dragging = false;
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
    this.tick(dt);
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
  }

  /** Call at the end of the frame: clears edges and camera deltas. */
  override endFrame(): void {
    super.endFrame();
    this.cam.x = 0;
    this.cam.y = 0;
  }
}
