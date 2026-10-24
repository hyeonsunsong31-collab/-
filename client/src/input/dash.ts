export type DashDir = 'f' | 'b' | 'l' | 'r';

/**
 * Spec: W+Q = forward, S+Q or Q alone = backward, A+Q = left, D+Q = right.
 * Forward wins over sideways; with both A and D held, neither applies. On analog input (mobile joystick)
 * the dominant axis decides; a centred stick dashes backward.
 */
export function dashDirection(keys: { w: boolean; a: boolean; s: boolean; d: boolean }): DashDir {
  if (keys.w && !keys.s) return 'f';
  if (keys.a && !keys.d) return 'l';
  if (keys.d && !keys.a) return 'r';
  return 'b';
}

export function dashDirectionAnalog(x: number, y: number, dead = 0.3): DashDir {
  if (Math.hypot(x, y) < dead) return 'b';
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 'f' : 'b';
  return x < 0 ? 'l' : 'r';
}

/**
 * Pick the dash clip for a world-space dash direction relative to the fighter's facing (yaw: forward = (sin, cos)).
 * The fighter keeps facing its target/camera, so the clip shows a forward lunge, side slide or back hop.
 * Returns the clip direction and the residual angle that aligns the clip's travel axis with the exact direction.
 */
export function dashClipFor(dirX: number, dirZ: number, yaw: number): { dir: DashDir; offset: number } {
  let rel = Math.atan2(dirX, dirZ) - yaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  let dir: DashDir;
  if (Math.abs(rel) <= Math.PI * 0.27) dir = 'f';
  else if (Math.abs(rel) >= Math.PI * 0.73) dir = 'b';
  else dir = rel > 0 ? 'l' : 'r';
  const axis = dir === 'f' ? 0 : dir === 'l' ? Math.PI / 2 : dir === 'b' ? Math.PI : -Math.PI / 2;
  let offset = rel - axis;
  offset = Math.atan2(Math.sin(offset), Math.cos(offset));
  return { dir, offset };
}
