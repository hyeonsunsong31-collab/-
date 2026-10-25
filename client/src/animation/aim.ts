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

/**
 * Point a held weapon. Weapons lie along the hand bone's local +Z (thumb side of the grip). Given the pose's
 * shoulder/elbow, search forearm twist and wrist deviation/flex (within comfortable ranges) for the blade to point
 * along `dir` (character space). Returns the pose with foreArm twist and hand set.
 */
export function aimBlade(p: Pose, side: 'L' | 'R', dir: [number, number, number]): Pose {
  const r = refRig();
  applyPose(r, p);
  const uaName = `upperArm${side}` as const;
  const fa = `foreArm${side}` as const;
  const hd = `hand${side}` as const;
  const ua = r.bones[BONE_INDEX[uaName]];
  const parentQ = ua.parent!.getWorldQuaternion(new THREE.Quaternion());
  const uaRest = r.restLocal[BONE_INDEX[uaName]];
  const faRest = r.restLocal[BONE_INDEX[fa]];
  const hdRest = r.restLocal[BONE_INDEX[hd]];
  const uaCur = p.b[uaName] ?? bindValue(uaName);
  const faCur = p.b[fa] ?? bindValue(fa);
  const hdCur = p.b[hd] ?? bindValue(hd);
  const want = new THREE.Vector3(...dir).normalize();
  const q0 = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3();
  // Twisting the upper arm about its own axis keeps the elbow where it is but rolls the forearm plane;
  // combined with forearm pronation and the wrist it can point the blade almost anywhere naturally.
  const score = (ut: number, tw: number, dev: number, flex: number): number => {
    semanticToQuat(BONE_INDEX[uaName], uaCur[0], ut, uaCur[2], q0);
    semanticToQuat(BONE_INDEX[fa], faCur[0], tw, faCur[2], qa);
    semanticToQuat(BONE_INDEX[hd], dev, hdCur[1], flex, qb);
    q.copy(parentQ).multiply(uaRest).multiply(q0).multiply(faRest).multiply(qa).multiply(hdRest).multiply(qb);
    z.set(0, 0, 1).applyQuaternion(q);
    return z.dot(want) - (Math.abs(dev) / 40) * 0.02 - (Math.abs(flex) / 80) * 0.02 - (Math.abs(tw - faCur[1]) / 90) * 0.01 - (Math.abs(ut - uaCur[1]) / 90) * 0.012;
  };
  let best = { ut: uaCur[1], tw: faCur[1], dev: 0, flex: 0, s: -Infinity };
  for (let ut = uaCur[1] - 60; ut <= uaCur[1] + 60; ut += 15)
    for (let tw = -90; tw <= 90; tw += 15)
      for (let dev = -40; dev <= 40; dev += 8)
        for (let flex = -80; flex <= 80; flex += 10) {
          const sc = score(ut, tw, dev, flex);
          if (sc > best.s) best = { ut, tw, dev, flex, s: sc };
        }
  for (let it = 0; it < 3; it++) {
    const step = [4, 2, 1][it];
    const b0 = { ...best };
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++)
          for (let d = -1; d <= 1; d++) {
            const ut = b0.ut + a * step * 2;
            const tw = THREE.MathUtils.clamp(b0.tw + b * step * 2, -95, 95);
            const dev = THREE.MathUtils.clamp(b0.dev + c * step, -42, 42);
            const flex = THREE.MathUtils.clamp(b0.flex + d * step, -82, 82);
            const sc = score(ut, tw, dev, flex);
            if (sc > best.s) best = { ut, tw, dev, flex, s: sc };
          }
  }
  return {
    b: { ...p.b, [uaName]: [uaCur[0], best.ut, uaCur[2]], [fa]: [faCur[0], best.tw, faCur[2]], [hd]: [best.dev, hdCur[1], best.flex] },
    root: p.root,
  };
}
