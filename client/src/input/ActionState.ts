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

interface ButtonState {
  down: boolean;
  pressed: boolean;
  released: boolean;
  t: number;
  lastPress: number;
  double: boolean;
}

/**
 * Button state machine shared by human input and bots: held/pressed/released edges, hold durations,
 * double-taps (Space -> flight, T -> revert) and a short action buffer.
 */
export class ActionState {
  private st = new Map<Action, ButtonState>();
  private buffer: { a: Action; t: number }[] = [];
  protected now = 0;
  enabled = true;
  private listeners: ((a: Action) => void)[] = [];

  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  private get(a: Action): ButtonState {
    let s = this.st.get(a);
    if (!s) {
      s = { down: false, pressed: false, released: false, t: 0, lastPress: -9, double: false };
      this.st.set(a, s);
    }
    return s;
  }

  /** Set an action's down state (keyboard, mouse, virtual touch buttons and bots all route here). */
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

  /** Press and release within the same frame (bots, taps). */
  tap(a: Action): void {
    this.set(a, true);
    this.get(a).down = false;
    this.get(a).released = true;
  }

  releaseAll(): void {
    for (const [a, s] of this.st) if (s.down) this.set(a, false);
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
    if (!this.enabled) return false;
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
    return this.enabled && this.buffer.some((b) => b.a === a && this.now - b.t <= maxAge);
  }

  clearBuffer(a?: Action): void {
    if (!a) this.buffer.length = 0;
    else this.buffer = this.buffer.filter((b) => b.a !== a);
  }

  /** Advance timers; call once per frame before gameplay reads the state. */
  tick(dt: number): void {
    this.now += dt;
    for (const s of this.st.values()) if (s.down) s.t += dt;
    if (this.buffer.length > 16) this.buffer.splice(0, this.buffer.length - 16);
  }

  /** Clear per-frame edges. */
  endFrame(): void {
    for (const s of this.st.values()) {
      s.pressed = false;
      s.released = false;
    }
  }

  get time(): number {
    return this.now;
  }
}
