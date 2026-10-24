import type { Collider } from './GeoBuilder.ts';

const CELL = 16;

/** Spatial hash of static colliders (buildings, props, trunks, rocks) for character collision. */
export class Colliders {
  private cells = new Map<number, Collider[]>();
  readonly all: Collider[] = [];

  add(c: Collider): void {
    this.all.push(c);
    const r = c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    for (let cx = Math.floor((c.x - r) / CELL); cx <= Math.floor((c.x + r) / CELL); cx++) {
      for (let cz = Math.floor((c.z - r) / CELL); cz <= Math.floor((c.z + r) / CELL); cz++) {
        const k = cx * 65536 + cz;
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
    }
  }

  remove(pred: (c: Collider) => boolean): void {
    for (const arr of this.cells.values()) {
      for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) arr.splice(i, 1);
    }
    for (let i = this.all.length - 1; i >= 0; i--) if (pred(this.all[i])) this.all.splice(i, 1);
  }

  near(x: number, z: number): Collider[] {
    return this.cells.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) ?? [];
  }

  /**
   * Push a vertical capsule (center x/z, radius, feet y, height) out of colliders.
   * Returns the corrected position via `out` and whether anything was hit.
   */
  resolve(x: number, z: number, radius: number, y: number, height: number, out: { x: number; z: number }): boolean {
    let px = x;
    let pz = z;
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const list = this.near(px, pz);
      for (const c of list) {
        if (y > c.y1 - 0.05 || y + height < c.y0) continue;
        if (c.kind === 'circle') {
          const dx = px - c.x;
          const dz = pz - c.z;
          const d = Math.hypot(dx, dz);
          const min = radius + c.r;
          if (d < min && d > 1e-5) {
            px = c.x + (dx / d) * min;
            pz = c.z + (dz / d) * min;
            hit = true;
          }
        } else {
          // OBB in xz: rotate into box space (matches Object3D yaw rotation).
          const cs = Math.cos(c.yaw);
          const sn = Math.sin(c.yaw);
          const dx = px - c.x;
          const dz = pz - c.z;
          const lx = dx * cs - dz * sn;
          const lz = dx * sn + dz * cs;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx));
          const qz = Math.max(-c.hz, Math.min(c.hz, lz));
          let ox = lx - qx;
          let oz = lz - qz;
          let d = Math.hypot(ox, oz);
          if (d < radius) {
            if (d < 1e-5) {
              // Inside: push out along the shallowest axis.
              const penX = c.hx - Math.abs(lx);
              const penZ = c.hz - Math.abs(lz);
              if (penX < penZ) {
                ox = Math.sign(lx) || 1;
                oz = 0;
                d = -penX;
              } else {
                ox = 0;
                oz = Math.sign(lz) || 1;
                d = -penZ;
              }
              const push = radius - d;
              const nlx = lx + ox * push;
              const nlz = lz + oz * push;
              px = c.x + nlx * cs + nlz * sn;
              pz = c.z - nlx * sn + nlz * cs;
            } else {
              const push = radius - d;
              const nlx = lx + (ox / d) * push;
              const nlz = lz + (oz / d) * push;
              px = c.x + nlx * cs + nlz * sn;
              pz = c.z - nlx * sn + nlz * cs;
            }
            hit = true;
          }
        }
      }
    }
    out.x = px;
    out.z = pz;
    return hit;
  }

  /** Highest collider top under (x,z) that is at or below `maxY` (for standing on roofs, walls, props). */
  topUnder(x: number, z: number, maxY: number): number {
    let best = -Infinity;
    for (const c of this.near(x, z)) {
      if (c.y1 > maxY) continue;
      if (c.kind === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) <= c.r) best = Math.max(best, c.y1);
      } else {
        const cs = Math.cos(c.yaw);
        const sn = Math.sin(c.yaw);
        const dx = x - c.x;
        const dz = z - c.z;
        const lx = dx * cs - dz * sn;
        const lz = dx * sn + dz * cs;
        if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) best = Math.max(best, c.y1);
      }
    }
    return best;
  }

  /** Ray-ish segment test against collider volumes (for camera collision). Returns t in [0,1] of first hit. */
  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    let tMin = 1;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      for (const c of this.near(x, z)) {
        if (y < c.y0 || y > c.y1) continue;
        let inside = false;
        if (c.kind === 'circle') inside = Math.hypot(x - c.x, z - c.z) < c.r;
        else {
          const cs = Math.cos(c.yaw);
          const sn = Math.sin(c.yaw);
          const dx = x - c.x;
          const dz = z - c.z;
          inside = Math.abs(dx * cs - dz * sn) < c.hx && Math.abs(dx * sn + dz * cs) < c.hz;
        }
        if (inside) return Math.min(tMin, (i - 1) / steps);
      }
    }
    return tMin;
  }
}
