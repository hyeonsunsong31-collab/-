import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/**
 * Verlet spring chain for secondary motion (sash tails, long hair). Each bone is re-aimed at its simulated child
 * point after the animator has posed the skeleton, so cloth trails behind fast moves and settles naturally.
 */
export class SpringChain {
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private lens: number[] = [];
  private tipLocal: THREE.Vector3;
  private inited = false;

  constructor(
    private bones: THREE.Bone[],
    private stiffness = 0.18,
    private damping = 0.86,
    private gravity = 9.8,
    tipLength = 0.16,
  ) {
    for (let i = 0; i < bones.length - 1; i++) this.lens.push(bones[i + 1].position.length());
    this.tipLocal = new THREE.Vector3(0, tipLength, 0);
    this.lens.push(tipLength);
  }

  reset(): void {
    this.inited = false;
  }

  /** Animated (target) world position of joint i+1 (the child end of bone i). */
  private target(i: number, out: THREE.Vector3): THREE.Vector3 {
    if (i < this.bones.length - 1) return this.bones[i + 1].getWorldPosition(out);
    return out.copy(this.tipLocal).applyMatrix4(this.bones[i].matrixWorld);
  }

  update(dt: number, wind: THREE.Vector3, extraAccel?: THREE.Vector3): void {
    const n = this.bones.length;
    this.bones[0].parent?.updateMatrixWorld(true);
    this.bones[0].updateMatrixWorld(true);
    if (!this.inited) {
      for (let i = 0; i < n; i++) {
        const t = this.target(i, new THREE.Vector3());
        this.pts[i] = t.clone();
        this.prev[i] = t.clone();
      }
      this.inited = true;
    }
    const h = Math.min(dt, 1 / 30);
    if (h <= 0) return;
    for (let i = 0; i < n; i++) {
      // Re-evaluate the parent joint each step since we re-aim bones as we go.
      const root = this.bones[i].getWorldPosition(_v1);
      const p = this.pts[i];
      const vel = _v2.subVectors(p, this.prev[i]).multiplyScalar(this.damping);
      this.prev[i].copy(p);
      p.add(vel);
      p.y -= this.gravity * h * h;
      p.addScaledVector(wind, h * h);
      if (extraAccel) p.addScaledVector(extraAccel, h * h);
      // Pull toward the animated pose (keeps the chain's authored shape).
      const t = this.target(i, new THREE.Vector3());
      p.lerp(t, this.stiffness);
      // Length constraint from the parent joint.
      const d = _v2.subVectors(p, root);
      const len = d.length() || 1e-5;
      p.copy(root).addScaledVector(d, this.lens[i] / len);
      // Re-aim bone i so its +Y points at the simulated point.
      const bone = this.bones[i];
      const cur = this.target(i, new THREE.Vector3()).sub(root).normalize();
      const want = _v2.subVectors(p, root).normalize();
      _q1.setFromUnitVectors(cur, want);
      bone.getWorldQuaternion(_q2);
      _q2.premultiply(_q1);
      const parent = bone.parent!;
      parent.getWorldQuaternion(_q1).invert();
      bone.quaternion.copy(_q1.multiply(_q2));
      bone.updateMatrixWorld(true);
    }
  }
}

/**
 * Analytic two-bone IK (thigh → shin → ankle). Moves the ankle to `target` keeping the knee in its current
 * bend plane, so authored knee directions are preserved.
 */
export function solveTwoBone(a: THREE.Bone, b: THREE.Bone, c: THREE.Bone, target: THREE.Vector3, weight = 1): void {
  if (weight <= 0) return;
  const pa = a.getWorldPosition(new THREE.Vector3());
  const pb = b.getWorldPosition(new THREE.Vector3());
  const pc = c.getWorldPosition(new THREE.Vector3());
  const lab = pa.distanceTo(pb);
  const lcb = pb.distanceTo(pc);
  const t = pa.clone().lerp(target, 1).sub(pa);
  const lat = THREE.MathUtils.clamp(t.length(), 0.01, lab + lcb - 0.002);
  const ac = pc.clone().sub(pa).normalize();
  const ab = pb.clone().sub(pa).normalize();
  const ba = pa.clone().sub(pb).normalize();
  const bc = pc.clone().sub(pb).normalize();
  const at = t.clone().normalize();
  const clamp = (x: number) => THREE.MathUtils.clamp(x, -1, 1);
  const acab0 = Math.acos(clamp(ac.dot(ab)));
  const babc0 = Math.acos(clamp(ba.dot(bc)));
  const acat0 = Math.acos(clamp(ac.dot(at)));
  const acab1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const babc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  let axis0 = new THREE.Vector3().crossVectors(ac, ab);
  if (axis0.lengthSq() < 1e-8) axis0 = new THREE.Vector3(1, 0, 0);
  axis0.normalize();
  let axis1 = new THREE.Vector3().crossVectors(ac, at);
  if (axis1.lengthSq() < 1e-8) axis1 = axis0.clone();
  axis1.normalize();
  const r0 = new THREE.Quaternion().setFromAxisAngle(axis0, (acab1 - acab0) * weight);
  const r1 = new THREE.Quaternion().setFromAxisAngle(axis0, (babc1 - babc0) * weight);
  const r2 = new THREE.Quaternion().setFromAxisAngle(axis1, acat0 * weight);
  const applyWorld = (bone: THREE.Bone, r: THREE.Quaternion) => {
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    wq.premultiply(r);
    const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(pq.multiply(wq));
    bone.updateMatrixWorld(true);
  };
  applyWorld(a, r2.multiply(r0));
  applyWorld(b, r1);
  void _m;
}
