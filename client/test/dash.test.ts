import { describe, it, expect } from 'vitest';
import { dashDirection, dashDirectionAnalog, dashClipFor } from '../src/input/dash.ts';

const k = (s: string) => ({ w: s.includes('w'), a: s.includes('a'), s: s.includes('s'), d: s.includes('d') });

describe('dash direction (Q)', () => {
  it('matches the control spec', () => {
    expect(dashDirection(k('w'))).toBe('f');
    expect(dashDirection(k('s'))).toBe('b');
    expect(dashDirection(k(''))).toBe('b');
    expect(dashDirection(k('a'))).toBe('l');
    expect(dashDirection(k('d'))).toBe('r');
  });
  it('resolves combinations', () => {
    expect(dashDirection(k('wa'))).toBe('f');
    expect(dashDirection(k('sa'))).toBe('l');
    expect(dashDirection(k('ad'))).toBe('b');
    expect(dashDirection(k('ws'))).toBe('b');
  });
  it('analog joystick', () => {
    expect(dashDirectionAnalog(0, 0)).toBe('b');
    expect(dashDirectionAnalog(0, 0.9)).toBe('f');
    expect(dashDirectionAnalog(-0.9, 0.2)).toBe('l');
    expect(dashDirectionAnalog(0.9, -0.3)).toBe('r');
    expect(dashDirectionAnalog(0.1, -0.9)).toBe('b');
  });
});

describe('dash clip relative to facing', () => {
  it('keeps facing and picks lunge / slide / hop', () => {
    // Facing +Z (yaw 0); the fighter's left is +X.
    expect(dashClipFor(0, 1, 0).dir).toBe('f');
    expect(dashClipFor(1, 0, 0).dir).toBe('l');
    expect(dashClipFor(-1, 0, 0).dir).toBe('r');
    expect(dashClipFor(0, -1, 0).dir).toBe('b');
    // Facing -Z (yaw pi): world -Z is forward, world +X is the fighter's right.
    expect(dashClipFor(0, -1, Math.PI).dir).toBe('f');
    expect(dashClipFor(1, 0, Math.PI).dir).toBe('r');
  });
  it('returns the residual angle to the exact direction', () => {
    const d = Math.SQRT1_2;
    const r = dashClipFor(d * Math.sin(0.3), d * Math.cos(0.3), 0);
    expect(r.dir).toBe('f');
    expect(r.offset).toBeCloseTo(0.3, 5);
    const s = dashClipFor(Math.sin(Math.PI / 2 + 0.2), Math.cos(Math.PI / 2 + 0.2), 0);
    expect(s.dir).toBe('l');
    expect(s.offset).toBeCloseTo(0.2, 5);
  });
});
