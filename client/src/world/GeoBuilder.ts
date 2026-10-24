import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Box2Collider {
  kind: 'box';
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  y0: number;
  y1: number;
}

export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export type Collider = Box2Collider | CircleCollider;

/** World-space planar UVs so textures keep a consistent texel density on every part. */
export function planarUV(g: THREE.BufferGeometry, scale = 0.5): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/**
 * Accumulates transformed geometry per material key, then merges into one mesh per material.
 * Lets a whole village render in a handful of draw calls.
 */
export class GeoBuilder {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  readonly colliders: Collider[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get matrix(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  push(m: THREE.Matrix4): void {
    this.stack.push(this.matrix.clone().multiply(m));
  }

  pushTRS(x: number, y: number, z: number, yaw = 0, scale = 1): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(scale, scale, scale),
    );
    this.push(m);
  }

  pop(): void {
    this.stack.pop();
  }

  /** Add geometry (in current local space). UVs are generated in local space unless `keepUV`. */
  add(key: string, g: THREE.BufferGeometry, local?: THREE.Matrix4, uvScale = 0.5, keepUV = false): void {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (local) geo.applyMatrix4(local);
    if (!keepUV) planarUV(geo, uvScale);
    else if (!geo.getAttribute('uv')) planarUV(geo, uvScale);
    geo.applyMatrix4(this.matrix);
    // Normalize attribute sets so merges never fail.
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key)!.push(geo);
    geo = null as unknown as THREE.BufferGeometry;
  }

  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, uvScale = 0.5): void {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(key, g, m, uvScale);
  }

  cylinder(key: string, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 12, open = false, uvScale = 0.5): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    // Cylindrical UVs in meters.
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * circ * uvScale, (p.getY(i) + h / 2) * uvScale);
    const m = new THREE.Matrix4().makeTranslation(x, y, z);
    this.add(key, g, m, uvScale, true);
  }

  cone(key: string, r: number, h: number, x: number, y: number, z: number, seg = 12): void {
    const g = new THREE.ConeGeometry(r, h, seg, 1);
    const uv = g.getAttribute('uv');
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * r * 3, (p.getY(i) + h / 2) * 0.6);
    this.add(key, g, new THREE.Matrix4().makeTranslation(x, y, z), 0.5, true);
  }

  /** Triangular prism (gable end), apex up, extruded along z by depth. */
  gable(key: string, w: number, h: number, depth: number, x: number, y: number, z: number, ry = 0): void {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(key, g, m);
  }

  /** World-space OBB collider from local footprint. */
  colliderBox(x: number, z: number, hx: number, hz: number, y0: number, y1: number, yaw = 0): void {
    const v = new THREE.Vector3(x, 0, z).applyMatrix4(this.matrix);
    const e = new THREE.Euler().setFromRotationMatrix(this.matrix, 'YXZ');
    const sy = new THREE.Vector3().setFromMatrixScale(this.matrix).y;
    const baseY = new THREE.Vector3(0, 0, 0).applyMatrix4(this.matrix).y;
    this.colliders.push({ kind: 'box', x: v.x, z: v.z, hx: hx * sy, hz: hz * sy, yaw: e.y + yaw, y0: baseY + y0 * sy, y1: baseY + y1 * sy });
  }

  colliderCircle(x: number, z: number, r: number, y0: number, y1: number): void {
    const v = new THREE.Vector3(x, y0, z).applyMatrix4(this.matrix);
    const sy = new THREE.Vector3().setFromMatrixScale(this.matrix).y;
    this.colliders.push({ kind: 'circle', x: v.x, z: v.z, r: r * sy, y0: v.y, y1: v.y + (y1 - y0) * sy });
  }

  build(materials: Record<string, THREE.Material>, group: THREE.Group, shadows = true): void {
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat) throw new Error(`GeoBuilder: no material for ${key}`);
      // Split very large merges to keep frustum culling useful.
      const chunk = 400;
      for (let i = 0; i < list.length; i += chunk) {
        const merged = mergeGeometries(list.slice(i, i + chunk), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    for (const list of this.parts.values()) for (const g of list) g.dispose();
    this.parts.clear();
  }
}
