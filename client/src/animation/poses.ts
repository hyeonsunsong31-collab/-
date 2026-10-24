import type { BoneName } from '../character/Rig.ts';
import { type E3, type Pose, type RootXf, merge, mirror, offset } from './Pose.ts';

/**
 * Pose vocabulary shared by every clip. All angles are semantic degrees (see Pose.ts), measured with the gallery:
 *   center bones  [pitch fwd +, twist left +, bend right +]
 *   clavicle      [protract +, -, shrug +]
 *   upperArm      [swing fwd +, twist internal +, lift +]  (lift 0 = hanging, 90 = T)
 *   foreArm       [elbow flex +, twist, -]
 *   hand          [deviation, twist, flex palm-ward +]
 *   fingers       [spread, twist, curl +]
 *   thigh         [hip flex fwd +, toes-out +, abduct +]
 *   shin          [knee bend +]
 *   foot          [toe up +, roll, toe-out +]
 *   toe           [bend up +]
 *   root          x left+, y up, z fwd+ (m) · rx pitch fwd+, ry yaw left+, rz roll right+ (deg, about the hips)
 */

export type B = Partial<Record<BoneName, E3>>;

export const P = (b: B, root?: RootXf): Pose => ({ b, root });

export type HandKind = 'fist' | 'relaxed' | 'open' | 'palm' | 'claw' | 'blade' | 'grip' | 'spread';

/** Hand shapes for one side. */
export function handShape(side: 'L' | 'R', shape: HandKind, wrist: E3 = [0, 0, 0]): B {
  const s = side;
  const f = (c1: number, c2: number, spread = 0): [E3, E3] => [
    [spread, 0, c1],
    [0, 0, c2],
  ];
  let idx: [E3, E3];
  let mid: [E3, E3];
  let ring: [E3, E3];
  let th: [E3, E3];
  switch (shape) {
    case 'fist':
    case 'grip':
      idx = f(92, 105);
      mid = f(95, 108);
      ring = f(98, 110);
      // Thumb tucked across the front of index/middle fingers.
      th = [
        [-52, 0, -12],
        [0, 0, 28],
      ];
      break;
    case 'relaxed':
      idx = f(18, 22);
      mid = f(24, 26);
      ring = f(30, 32);
      th = [
        [-12, 0, 6],
        [0, 0, 12],
      ];
      break;
    case 'open':
      idx = f(4, 6, -6);
      mid = f(3, 4);
      ring = f(5, 6, 6);
      th = [
        [-6, 0, -4],
        [0, 0, 4],
      ];
      break;
    case 'spread':
      idx = f(6, 8, -14);
      mid = f(4, 6);
      ring = f(8, 10, 14);
      th = [
        [10, 0, -14],
        [0, 0, 2],
      ];
      break;
    case 'palm':
      idx = f(0, 2, -3);
      mid = f(0, 2);
      ring = f(2, 4, 3);
      th = [
        [-14, 0, -6],
        [0, 0, 6],
      ];
      break;
    case 'claw':
      idx = f(40, 60, -10);
      mid = f(42, 62);
      ring = f(45, 65, 10);
      th = [
        [-20, 0, 10],
        [0, 0, 35],
      ];
      break;
    case 'blade':
      idx = f(0, 0, -2);
      mid = f(0, 0);
      ring = f(0, 0, 2);
      th = [
        [-30, 0, 4],
        [0, 0, 20],
      ];
      break;
  }
  return {
    [`hand${s}`]: wrist,
    [`index1${s}`]: idx[0],
    [`index2${s}`]: idx[1],
    [`middle1${s}`]: mid[0],
    [`middle2${s}`]: mid[1],
    [`ring1${s}`]: ring[0],
    [`ring2${s}`]: ring[1],
    [`thumb1${s}`]: th[0],
    [`thumb2${s}`]: th[1],
  } as B;
}

export function hands(l: HandKind, r: HandKind, wl: E3 = [0, 0, 0], wr: E3 = [0, 0, 0]): B {
  return { ...handShape('L', l, wl), ...handShape('R', r, wr) };
}

const ZERO_CHAINS: B = {
  sashA1: [0, 0, 0],
  sashA2: [0, 0, 0],
  sashA3: [0, 0, 0],
  sashB1: [0, 0, 0],
  sashB2: [0, 0, 0],
  sashB3: [0, 0, 0],
  hairBack1: [0, 0, 0],
  hairBack2: [0, 0, 0],
};

/** Neutral upright relaxed body (arms hanging, legs straight). */
export const STAND: Pose = P(
  {
    hips: [0, 0, 0],
    spine: [2, 0, 0],
    chest: [0, 0, 0],
    upperChest: [-2, 0, 0],
    neck: [4, 0, 0],
    head: [-2, 0, 0],
    clavicleL: [0, 0, -4],
    clavicleR: [0, 0, -4],
    upperArmL: [4, 6, 9],
    upperArmR: [4, 6, 9],
    foreArmL: [14, 20, 0],
    foreArmR: [14, 20, 0],
    ...hands('relaxed', 'relaxed', [0, 0, 6], [0, 0, 6]),
    thighL: [1, 6, 4],
    thighR: [1, 6, 4],
    shinL: [3, 0, 0],
    shinR: [3, 0, 0],
    footL: [2, 0, 4],
    footR: [2, 0, 4],
    toeL: [0, 0, 0],
    toeR: [0, 0, 0],
    ...ZERO_CHAINS,
  },
  { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
);

/* ------------------------------------------------------------------ fighting stance pieces */

export const GUARD_L: B = { upperArmL: [62, 42, 16], foreArmL: [104, 18, 0], ...handShape('L', 'fist', [0, 0, 6]) };
export const GUARD_R: B = { upperArmR: [42, 52, 12], foreArmR: [128, 18, 0], ...handShape('R', 'fist', [0, 0, 10]) };

/** Legs for the orthodox stance (left foot forward, rear heel slightly raised). */
export const STANCE_LEGS: B = {
  thighL: [28, -4, 9],
  shinL: [36, 0, 0],
  footL: [12, 0, -4],
  toeL: [0, 0, 0],
  thighR: [-9, 34, 13],
  shinR: [22, 0, 0],
  footR: [6, 0, 6],
  toeR: [22, 0, 0],
};

/** Orthodox fighting stance: bladed torso, fists up at chin height, knees loaded. */
export const STANCE: Pose = merge(
  STAND,
  P(
    {
      hips: [4, -20, 0],
      spine: [4, -4, 0],
      chest: [4, -4, 0],
      upperChest: [2, -2, 0],
      neck: [-2, 12, 0],
      head: [-6, 14, 0],
      clavicleL: [10, 0, 4],
      clavicleR: [8, 0, 2],
      ...GUARD_L,
      ...GUARD_R,
      ...STANCE_LEGS,
    },
    { y: -0.07 },
  ),
);

/** Square, low "power" stance used for charging ki and transforming. */
export const POWER_STANCE: Pose = merge(
  STAND,
  P(
    {
      hips: [2, 0, 0],
      spine: [-6, 0, 0],
      chest: [-8, 0, 0],
      upperChest: [-6, 0, 0],
      neck: [-4, 0, 0],
      head: [-8, 0, 0],
      clavicleL: [-6, 0, 10],
      clavicleR: [-6, 0, 10],
      upperArmL: [8, 40, 34],
      upperArmR: [8, 40, 34],
      foreArmL: [96, 30, 0],
      foreArmR: [96, 30, 0],
      ...hands('fist', 'fist', [0, 0, 16], [0, 0, 16]),
      thighL: [24, 22, 26],
      thighR: [24, 22, 26],
      shinL: [46, 0, 0],
      shinR: [46, 0, 0],
      footL: [22, 0, -14],
      footR: [22, 0, -14],
    },
    { y: -0.13 },
  ),
);

/** Upright hover pose for flight idle. */
export const HOVER: Pose = merge(
  STAND,
  P(
    {
      hips: [-4, 0, 0],
      spine: [4, 0, 0],
      chest: [2, 0, 0],
      upperArmL: [8, 14, 20],
      upperArmR: [8, 14, 20],
      foreArmL: [30, 20, 0],
      foreArmR: [30, 20, 0],
      ...hands('relaxed', 'relaxed', [0, 0, 14], [0, 0, 14]),
      thighL: [14, 4, 5],
      thighR: [4, 6, 6],
      shinL: [34, 0, 0],
      shinR: [22, 0, 0],
      footL: [-38, 0, 2],
      footR: [-34, 0, 2],
      toeL: [-10, 0, 0],
      toeR: [-10, 0, 0],
    },
    { y: 0 },
  ),
);

export { merge, mirror, offset };
