import * as THREE from 'three';

/**
 * Humanoid rig with anatomical bone frames:
 *   local +Y points along the bone toward its child,
 *   local +X is the main hinge axis (flexion: spine bends forward, arms/legs swing forward, elbows bend),
 *   local +Z is the abduction axis.
 * Poses are Euler offsets (degrees, order XZY) from the T-pose bind. Left/right mirror as (x, -y, -z).
 */

export const BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'clavicleL',
  'upperArmL',
  'foreArmL',
  'handL',
  'thumb1L',
  'thumb2L',
  'index1L',
  'index2L',
  'middle1L',
  'middle2L',
  'ring1L',
  'ring2L',
  'clavicleR',
  'upperArmR',
  'foreArmR',
  'handR',
  'thumb1R',
  'thumb2R',
  'index1R',
  'index2R',
  'middle1R',
  'middle2R',
  'ring1R',
  'ring2R',
  'thighL',
  'shinL',
  'footL',
  'toeL',
  'thighR',
  'shinR',
  'footR',
  'toeR',
  'sashA1',
  'sashA2',
  'sashA3',
  'sashB1',
  'sashB2',
  'sashB3',
  'hairBack1',
  'hairBack2',
] as const;

export type BoneName = (typeof BONES)[number];

export const BONE_INDEX: Record<BoneName, number> = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

export const PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  clavicleL: 'upperChest',
  upperArmL: 'clavicleL',
  foreArmL: 'upperArmL',
  handL: 'foreArmL',
  thumb1L: 'handL',
  thumb2L: 'thumb1L',
  index1L: 'handL',
  index2L: 'index1L',
  middle1L: 'handL',
  middle2L: 'middle1L',
  ring1L: 'handL',
  ring2L: 'ring1L',
  clavicleR: 'upperChest',
  upperArmR: 'clavicleR',
  foreArmR: 'upperArmR',
  handR: 'foreArmR',
  thumb1R: 'handR',
  thumb2R: 'thumb1R',
  index1R: 'handR',
  index2R: 'index1R',
  middle1R: 'handR',
  middle2R: 'middle1R',
  ring1R: 'handR',
  ring2R: 'ring1R',
  thighL: 'hips',
  shinL: 'thighL',
  footL: 'shinL',
  toeL: 'footL',
  thighR: 'hips',
  shinR: 'thighR',
  footR: 'shinR',
  toeR: 'footR',
  sashA1: 'hips',
  sashA2: 'sashA1',
  sashA3: 'sashA2',
  sashB1: 'hips',
  sashB2: 'sashB1',
  sashB3: 'sashB2',
  hairBack1: 'head',
  hairBack2: 'hairBack1',
};

/** Which bone each bone's +Y axis aims at (for building its rest frame). */
const AIM: Partial<Record<BoneName, BoneName>> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'upperChest',
  upperChest: 'neck',
  neck: 'head',
  clavicleL: 'upperArmL',
  upperArmL: 'foreArmL',
  foreArmL: 'handL',
  handL: 'middle1L',
  thumb1L: 'thumb2L',
  index1L: 'index2L',
  middle1L: 'middle2L',
  ring1L: 'ring2L',
  clavicleR: 'upperArmR',
  upperArmR: 'foreArmR',
  foreArmR: 'handR',
  handR: 'middle1R',
  thumb1R: 'thumb2R',
  index1R: 'index2R',
  middle1R: 'middle2R',
  ring1R: 'ring2R',
  thighL: 'shinL',
  shinL: 'footL',
  footL: 'toeL',
  thighR: 'shinR',
  shinR: 'footR',
  footR: 'toeR',
  sashA1: 'sashA2',
  sashA2: 'sashA3',
  sashB1: 'sashB2',
  sashB2: 'sashB3',
  hairBack1: 'hairBack2',
};

/** Body proportions (meters). Every archetype is a variation of these. */
export interface Proportions {
  height: number;
  /** Multipliers. */
  shoulder: number;
  armLen: number;
  legLen: number;
  torsoLen: number;
  hipWidth: number;
  /** Mass multipliers for mesh building. */
  muscle: number;
  girth: number;
  headScale: number;
  handScale: number;
}

export const HERO_PROPORTIONS: Proportions = {
  height: 1.84,
  shoulder: 1,
  armLen: 1,
  legLen: 1,
  torsoLen: 1,
  hipWidth: 1,
  muscle: 1,
  girth: 1,
  headScale: 1,
  handScale: 1,
};

/** Bind (T-pose) joint positions in character space (feet on y=0, facing +Z, character's left = +X). */
export function bindPositions(p: Proportions): Record<BoneName, THREE.Vector3> {
  const s = p.height / 1.84;
  const L = p.legLen;
  const T = p.torsoLen;
  const A = p.armLen;
  const sh = p.shoulder;
  const hw = p.hipWidth;
  const hipY = 0.99 * L;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x * s, y * s, z * s);
  const pos: Partial<Record<BoneName, THREE.Vector3>> = {};
  pos.hips = v(0, hipY, 0);
  pos.spine = v(0, hipY + 0.09 * T, -0.005);
  pos.chest = v(0, hipY + 0.24 * T, -0.01);
  pos.upperChest = v(0, hipY + 0.37 * T, -0.012);
  pos.neck = v(0, hipY + 0.53 * T, -0.02);
  pos.head = v(0, hipY + 0.62 * T, -0.005);
  const shY = hipY + 0.475 * T;
  for (const [side, sg] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    pos[`clavicle${side}`] = v(0.035 * sg, shY + 0.005, 0.025);
    const shoulderX = 0.205 * sh;
    pos[`upperArm${side}`] = v(shoulderX * sg, shY, -0.01);
    pos[`foreArm${side}`] = v((shoulderX + 0.3 * A) * sg, shY, -0.012);
    const hx = shoulderX + 0.57 * A;
    pos[`hand${side}`] = v(hx * sg, shY, -0.012);
    const hs = p.handScale;
    pos[`thumb1${side}`] = v((hx + 0.025 * hs) * sg, shY - 0.012, 0.03 * hs);
    pos[`thumb2${side}`] = v((hx + 0.06 * hs) * sg, shY - 0.018, 0.058 * hs);
    pos[`index1${side}`] = v((hx + 0.095 * hs) * sg, shY + 0.002, 0.024 * hs);
    pos[`index2${side}`] = v((hx + 0.14 * hs) * sg, shY + 0.002, 0.026 * hs);
    pos[`middle1${side}`] = v((hx + 0.1 * hs) * sg, shY + 0.003, 0.0);
    pos[`middle2${side}`] = v((hx + 0.15 * hs) * sg, shY + 0.003, 0.0);
    pos[`ring1${side}`] = v((hx + 0.093 * hs) * sg, shY + 0.001, -0.024 * hs);
    pos[`ring2${side}`] = v((hx + 0.138 * hs) * sg, shY + 0.001, -0.026 * hs);
    const lx = 0.1 * hw;
    pos[`thigh${side}`] = v(lx * sg, hipY - 0.03, 0.005);
    pos[`shin${side}`] = v(lx * sg * 0.98, hipY * 0.545, 0.012);
    pos[`foot${side}`] = v(lx * sg * 0.96, 0.088, -0.012);
    pos[`toe${side}`] = v(lx * sg * 0.98, 0.022, 0.138);
  }
  // Sash tails hang from the knot at the front-left of the waist.
  pos.sashA1 = v(0.15, hipY + 0.03 * T, 0.09);
  pos.sashA2 = v(0.17, hipY - 0.09, 0.1);
  pos.sashA3 = v(0.18, hipY - 0.2, 0.1);
  pos.sashB1 = v(0.12, hipY + 0.03 * T, 0.11);
  pos.sashB2 = v(0.13, hipY - 0.075, 0.12);
  pos.sashB3 = v(0.135, hipY - 0.17, 0.12);
  // Long-hair chain (used by the waist-length "Golden Mane" form).
  pos.hairBack1 = v(0, hipY + 0.78 * T, -0.11);
  pos.hairBack2 = v(0, hipY + 0.46 * T, -0.16);
  return pos as Record<BoneName, THREE.Vector3>;
}

/** Rest frame for a bone: Y toward aim target, Z toward a reference forward. */
function restFrame(name: BoneName, pos: Record<BoneName, THREE.Vector3>): THREE.Quaternion {
  const aim = AIM[name];
  let y: THREE.Vector3;
  if (aim) y = pos[aim].clone().sub(pos[name]).normalize();
  else if (name === 'head') y = new THREE.Vector3(0, 1, 0);
  else if (name.startsWith('toe')) y = new THREE.Vector3(0, 0, 1);
  else if (name.startsWith('sash')) y = new THREE.Vector3(0, -1, 0);
  else if (name === 'hairBack2') y = new THREE.Vector3(0, -1, -0.2).normalize();
  else {
    // Finger tips: continue the parent direction.
    const parent = PARENT[name]!;
    y = pos[name].clone().sub(pos[parent]).normalize();
  }
  let zRef = new THREE.Vector3(0, 0, 1);
  if (Math.abs(y.dot(zRef)) > 0.8) zRef = new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(y, zRef).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export interface RigInstance {
  root: THREE.Object3D;
  bones: THREE.Bone[];
  byName: Record<BoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  /** Rest local quaternions (bind). */
  restLocal: THREE.Quaternion[];
  restPos: THREE.Vector3[];
  /** Bind positions in character space. */
  bindWorld: Record<BoneName, THREE.Vector3>;
  bindRot: Record<BoneName, THREE.Quaternion>;
}

export function buildRig(p: Proportions): RigInstance {
  const pos = bindPositions(p);
  const worldRot = {} as Record<BoneName, THREE.Quaternion>;
  for (const b of BONES) worldRot[b] = restFrame(b, pos);
  const bones: THREE.Bone[] = [];
  const byName = {} as Record<BoneName, THREE.Bone>;
  const restLocal: THREE.Quaternion[] = [];
  const restPos: THREE.Vector3[] = [];
  for (const b of BONES) {
    const bone = new THREE.Bone();
    bone.name = b;
    const parent = PARENT[b];
    if (parent) {
      const pInv = worldRot[parent].clone().invert();
      bone.position.copy(pos[b].clone().sub(pos[parent]).applyQuaternion(pInv));
      bone.quaternion.copy(pInv.multiply(worldRot[b]));
      byName[parent].add(bone);
    } else {
      bone.position.copy(pos[b]);
      bone.quaternion.copy(worldRot[b]);
    }
    bones.push(bone);
    byName[b] = bone;
    restLocal.push(bone.quaternion.clone());
    restPos.push(bone.position.clone());
  }
  const root = new THREE.Object3D();
  root.add(byName.hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { root, bones, byName, skeleton, restLocal, restPos, bindWorld: pos, bindRot: worldRot };
}

export const MIRROR: Partial<Record<BoneName, BoneName>> = {};
for (const b of BONES) {
  if (b.endsWith('L')) MIRROR[b] = (b.slice(0, -1) + 'R') as BoneName;
  else if (b.endsWith('R')) MIRROR[b] = (b.slice(0, -1) + 'L') as BoneName;
}

export const FINGERS_L: BoneName[] = ['thumb1L', 'thumb2L', 'index1L', 'index2L', 'middle1L', 'middle2L', 'ring1L', 'ring2L'];
export const FINGERS_R: BoneName[] = ['thumb1R', 'thumb2R', 'index1R', 'index2R', 'middle1R', 'middle2R', 'ring1R', 'ring2R'];

export const UPPER_BODY = new Set<BoneName>([
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'clavicleL',
  'upperArmL',
  'foreArmL',
  'handL',
  ...FINGERS_L,
  'clavicleR',
  'upperArmR',
  'foreArmR',
  'handR',
  ...FINGERS_R,
]);
