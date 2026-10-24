import * as THREE from 'three';
import { BONES, type BoneName, MIRROR } from '../character/Rig.ts';

/**
 * Poses are authored in per-side *semantic* degrees so a symmetric pose has identical numbers on L and R:
 *
 *  center (hips/spine/chest/upperChest/neck/head): [pitch fwd +, twist left +, side-bend right +]
 *  clavicle:  [protract +, -, shrug +]
 *  upperArm:  [fwd swing +, twist (thumb out) +, lift +]   lift 0 = hanging at side, 90 = T-pose, 180 = overhead
 *  foreArm:   [elbow flex +, twist +, -]
 *  hand:      [deviation +, twist +, palm-ward flex +]
 *  fingers:   [spread, twist, curl +]
 *  thigh:     [hip flex fwd +, toes-out twist +, abduct +]
 *  shin:      [knee bend +, -, -]
 *  foot:      [toe up +, roll, toe-out +]
 *  toe:       [bend up +, -, -]
 */
export type E3 = [number, number, number];

export interface RootXf {
  /** Meters, character space (x = character's left, y up, z forward). */
  x?: number;
  y?: number;
  z?: number;
  /** Degrees, whole-body rotation about the hips pivot (pitch fwd +, yaw left +, roll right +). */
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface Pose {
  b: Partial<Record<BoneName, E3>>;
  root?: RootXf;
}

type Kind = 'center' | 'clavicle' | 'upperArm' | 'foreArm' | 'hand' | 'finger' | 'thigh' | 'shin' | 'foot' | 'toe' | 'raw';

function kindOf(b: BoneName): Kind {
  if (b === 'hips' || b === 'spine' || b === 'chest' || b === 'upperChest' || b === 'neck' || b === 'head') return 'center';
  if (b.startsWith('clavicle')) return 'clavicle';
  if (b.startsWith('upperArm')) return 'upperArm';
  if (b.startsWith('foreArm')) return 'foreArm';
  if (b.startsWith('hand')) return 'hand';
  if (/^(thumb|index|middle|ring)/.test(b)) return 'finger';
  if (b.startsWith('thigh')) return 'thigh';
  if (b.startsWith('shin')) return 'shin';
  if (b.startsWith('foot')) return 'foot';
  if (b.startsWith('toe')) return 'toe';
  return 'raw';
}

const SIGNS: Record<Kind, E3> = {
  center: [1, 1, 1],
  clavicle: [1, 1, 1],
  upperArm: [1, 1, 1],
  foreArm: [1, 1, 1],
  hand: [1, 1, -1],
  finger: [1, 1, -1],
  thigh: [1, -1, 1],
  shin: [-1, 1, 1],
  foot: [1, -1, 1],
  toe: [1, 1, 1],
  raw: [1, 1, 1],
};

export const BONE_KIND: Kind[] = BONES.map(kindOf);
export const BONE_SIDE: number[] = BONES.map((b) => (b.endsWith('L') ? 1 : b.endsWith('R') ? -1 : 0));

const D2R = Math.PI / 180;
const _e = new THREE.Euler();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

/** Semantic degrees → local pose-delta quaternion for bone index `i` (relative to the T-pose bind). */
export function semanticToQuat(i: number, x: number, y: number, z: number, out: THREE.Quaternion): THREE.Quaternion {
  const kind = BONE_KIND[i];
  const side = BONE_SIDE[i];
  if (kind === 'upperArm') {
    // q = Ry(∓fwd) · Rz(±(lift-90)) · Ry(±twist)
    const s = side >= 0 ? 1 : -1;
    _qa.setFromAxisAngle(AX_Y, -s * x * D2R);
    _qb.setFromAxisAngle(AX_Z, s * (z - 90) * D2R);
    _qc.setFromAxisAngle(AX_Y, s * y * D2R);
    return out.copy(_qa).multiply(_qb).multiply(_qc);
  }
  const sg = SIGNS[kind];
  let rx = x * sg[0];
  let ry = y * sg[1];
  let rz = z * sg[2];
  if (side < 0) {
    ry = -ry;
    rz = -rz;
  }
  _e.set(rx * D2R, ry * D2R, rz * D2R, 'XZY');
  return out.setFromEuler(_e);
}

/** Bind (T-pose) expressed in semantic values: arms lifted to 90°, everything else 0. */
export function bindValue(b: BoneName): E3 {
  return kindOf(b) === 'upperArm' ? [0, 0, 90] : [0, 0, 0];
}

export function pose(b: Partial<Record<BoneName, E3>>, root?: RootXf): Pose {
  return { b, root };
}

/** Merge poses left→right; later bone entries replace earlier ones; roots are merged field-wise. */
export function merge(...ps: Pose[]): Pose {
  const out: Pose = { b: {}, root: {} };
  for (const p of ps) {
    Object.assign(out.b, p.b);
    if (p.root) Object.assign(out.root!, p.root);
  }
  return out;
}

/** Additively offset a pose (degrees summed per channel). */
export function offset(base: Pose, add: Partial<Record<BoneName, E3>>, rootAdd?: RootXf): Pose {
  const out: Pose = { b: { ...base.b }, root: { ...base.root } };
  for (const [k, v] of Object.entries(add) as [BoneName, E3][]) {
    const cur = out.b[k] ?? bindValue(k);
    out.b[k] = [cur[0] + v[0], cur[1] + v[1], cur[2] + v[2]];
  }
  if (rootAdd) {
    const r = out.root!;
    for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) if (rootAdd[key] !== undefined) r[key] = (r[key] ?? 0) + rootAdd[key]!;
  }
  return out;
}

/** Swap left/right and flip lateral components (twist / side-bend / yaw / roll / x offset). */
export function mirror(p: Pose): Pose {
  const out: Pose = { b: {}, root: p.root ? { ...p.root } : undefined };
  for (const [k, v] of Object.entries(p.b) as [BoneName, E3][]) {
    const m = MIRROR[k];
    if (m) out.b[m] = [v[0], v[1], v[2]];
    else out.b[k] = [v[0], -v[1], -v[2]];
  }
  if (out.root) {
    if (out.root.x !== undefined) out.root.x = -out.root.x;
    if (out.root.ry !== undefined) out.root.ry = -out.root.ry;
    if (out.root.rz !== undefined) out.root.rz = -out.root.rz;
  }
  return out;
}
