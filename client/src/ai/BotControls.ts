import * as THREE from 'three';
import { ActionState, type Action } from '../input/ActionState.ts';
import type { Hero, HeroControls } from '../gameplay/Hero.ts';

/** Hero controls written by an AI brain: timed button holds and world-space movement vectors. */
export class BotControls implements HeroControls {
  readonly buttons = new ActionState();
  readonly move = new THREE.Vector3();
  flyDir: THREE.Vector3 | null = null;
  vertical = 0;
  faceYaw: number | null = null;
  viewYaw: number | null = null;
  sprint = false;
  aim: THREE.Vector3 | null = null;
  private holds = new Map<Action, number>();
  brain: ((hero: Hero, ctl: BotControls, dt: number) => void) | null = null;

  /** Press `a` and keep it down for `hold` seconds (0 = a single-frame tap). */
  press(a: Action, hold = 0): void {
    if (this.buttons.held(a)) this.buttons.set(a, false);
    this.buttons.set(a, true);
    this.holds.set(a, hold);
  }

  release(a: Action): void {
    this.holds.delete(a);
    this.buttons.set(a, false);
  }

  holding(a: Action): boolean {
    return this.buttons.held(a);
  }

  refresh(hero: Hero, dt: number): void {
    this.buttons.endFrame();
    this.buttons.tick(dt);
    for (const [a, t] of this.holds) {
      const r = t - dt;
      if (r <= 0) {
        this.holds.delete(a);
        this.buttons.set(a, false);
      } else this.holds.set(a, r);
    }
    this.brain?.(hero, this, dt);
  }
}
