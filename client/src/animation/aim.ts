import * as THREE from 'three';
import { buildRig, BONES, BONE_INDEX, HERO_PROPORTIONS, type RigInstance } from '../character/Rig.ts';
import { semanticToQuat, bindValue, type Pose } from './Pose.ts';

/**
 * Authoring-time arm aiming. Torso twist, clavicle protraction and root rotation all rotate the arm's base frame,
 * so hand-tuned swing/lift values drift off target. `aimArm` runs forward kinematics for a pose on a reference rig
 * and solves the upper-arm swing/lift so the arm points exactly along a character-space direction.
 */

let rig: RigInstance | null = null;
const D2R = Math.PI / 180;

function refRig(): RigInstance {
  if (!rig) rig = buildRig(HERO_PROPORTIONS);
  return rig;
}

function applyPose(r: RigInstance, p: Pose): void {
  const q = new THREE.Quaternion();
  for (let i = 0; i < BONES.length; i++) {
    const b = BONES[i];
    const v = p.b[b] ?? bindValue(b);
    semanticToQuat(i, v[0], v[1], v[2], q);
    r.bones[i].quaternion.copy(r.restLocal[i]).multiply(q);
  }
  const root = p.root ?? {};
  r.root.rotation.set((root.rx ?? 0) * D2R, (root.ry ?? 0) * D2R, (root.rz ?? 0) * D2R, 'YXZ');
  r.root.updateMatrixWorld(true);
}

/** Return a copy of `p` with upperArm{side} swing/lift solved to point along `dir` (character space). */
export function aimArm(p: Pose, side: 'L' | 'R', dir: [number, number, number]): Pose {
  const r = refRig();
  applyPose(r, p);
  const ua = `upperArm${side}` as const;
  const bone = r.bones[BONE_INDEX[ua]];
  const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const frame = parentQ.multiply(r.restLocal[BONE_INDEX[ua]]);
  const d = new THREE.Vector3(...dir).normalize().applyQuaternion(frame.invert());
  const lift = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / D2R;
  const fwd = (side === 'L' ? Math.atan2(d.z, d.x) : Math.atan2(d.z, -d.x)) / D2R;
  const cur = p.b[ua] ?? bindValue(ua);
  return { b: { ...p.b, [ua]: [fwd, cur[1], lift] }, root: p.root };
}

/** Aim both arms (two-handed palms / beams). */
export function aimBoth(p: Pose, dir: [number, number, number], spread = 0.06): Pose {
  const l = aimArm(p, 'L', [dir[0] + spread, dir[1], dir[2]]);
  return aimArm(l, 'R', [dir[0] - spread, dir[1], dir[2]]);
}
