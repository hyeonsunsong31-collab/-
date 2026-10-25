import type { ClipDef } from '../Clip.ts';
import { P, STAND, STANCE_LEGS, hands, handShape, merge, offset, type B } from '../poses.ts';
import type { Pose, RootXf } from '../Pose.ts';
import { aimArm, aimBlade } from '../aim.ts';

/**
 * Mob movesets. Weapons ride the hand's +Z axis, so every armed key aims the arm (aimArm) and then the blade
 * (aimBlade) in character space — blades read correctly through torso twists and lunges.
 */

const U = (b: B, root?: RootXf) => merge(STAND, P(b, root));
type V3 = [number, number, number];
/** Aim arm then blade. */
const wield = (p: Pose, side: 'L' | 'R', arm: V3 | null, blade: V3): Pose => aimBlade(arm ? aimArm(p, side, arm) : p, side, blade);
const both = (p: Pose, armR: V3, armL: V3, blade: V3): Pose => aimBlade(aimBlade(aimArm(aimArm(p, 'R', armR), 'L', armL), 'R', blade), 'L', blade);
const ARM_RE = /^(clavicle|upperArm|foreArm|hand|thumb|index|middle|ring)\d?(L|R)$/;
/** Only one side's arm and finger bones of a pose (for overlays and arm inserts). */
const arm = (p: Pose, side: 'L' | 'R'): B => {
  const out: B = {};
  for (const [k, v] of Object.entries(p.b)) {
    const m = ARM_RE.exec(k);
    if (m && m[2] === side) out[k as keyof B] = v;
  }
  return out;
};

/* ================================================================== BRIGAND (one-handed axe) */

const BRIG_LEGS: B = { thighL: [30, -6, 11], shinL: [40, 0, 0], footL: [10, 0, -4], thighR: [-10, 30, 14], shinR: [26, 0, 0], footR: [6, 0, 6], toeR: [18, 0, 0] };
const BRIG_READY = wield(
  U({ hips: [8, -16, 0], spine: [6, -4, 0], chest: [6, -6, 0], upperChest: [2, 0, 0], neck: [-6, 12, 0], head: [-8, 12, 0], clavicleR: [6, 0, 4], upperArmR: [24, 20, 22], foreArmR: [70, 0, 0], ...handShape('R', 'grip'), upperArmL: [44, 30, 24], foreArmL: [70, 10, 0], ...handShape('L', 'open', [0, 0, 10]), ...BRIG_LEGS }, { y: -0.09 }),
  'R',
  null,
  [-0.25, 0.75, 0.6],
);
const brig_idle: ClipDef = {
  name: 'brig_idle',
  dur: 1.8,
  loop: true,
  keys: [
    { t: 0, p: BRIG_READY },
    { t: 0.9, p: offset(BRIG_READY, { chest: [-2, 0, 0], upperArmR: [2, 0, 0], head: [2, 0, 0] }, { y: -0.012 }) },
    { t: 1.8, p: BRIG_READY },
  ],
};
/** Upper-body overlay holding the axe low and ready while walking/running. */
const brig_hold: ClipDef = {
  name: 'brig_hold',
  dur: 1,
  loop: true,
  keys: [{ t: 0, p: P(arm(wield(U({ upperArmR: [16, 20, 14], foreArmR: [62, 0, 0], ...handShape('R', 'grip') }), 'R', null, [-0.15, 0.55, 0.8]), 'R')) }],
};
const BRIG_WIND = wield(
  U({ hips: [4, 26, 0], spine: [-2, 10, 0], chest: [-4, 22, 0], upperChest: [-2, 8, 0], neck: [-4, -24, 0], head: [-6, -26, 0], clavicleR: [-6, 0, 16], upperArmR: [-30, 40, 128], foreArmR: [96, 0, 0], ...handShape('R', 'grip'), upperArmL: [60, 20, 30], foreArmL: [50, 10, 0], ...handShape('L', 'open'), thighL: [20, -10, 10], shinL: [24, 0, 0], thighR: [-6, 34, 14], shinR: [34, 0, 0], footR: [10, 0, 6] }, { y: -0.1, ry: 8 }),
  'R',
  null,
  [-0.75, 0.55, -0.35],
);
const BRIG_HIT = wield(
  U({ hips: [12, -30, 0], spine: [8, -10, 0], chest: [10, -26, 0], upperChest: [4, -8, 0], neck: [-10, 30, 0], head: [-10, 32, 0], clavicleR: [22, 0, 4], foreArmR: [8, 0, 0], ...handShape('R', 'grip'), upperArmL: [20, 10, 40], foreArmL: [40, 0, 0], ...handShape('L', 'spread'), thighL: [54, -10, 12], shinL: [62, 0, 0], footL: [22, 0, -6], thighR: [-24, 30, 14], shinR: [16, 0, 0], footR: [-6, 0, 8], toeR: [30, 0, 0] }, { y: -0.2, z: 0.12, ry: -6 }),
  'R',
  [0.42, 0.1, 0.9],
  [0.64, -0.05, 0.76],
);
const BRIG_FOLLOW = wield(
  merge(BRIG_HIT, P({ chest: [12, -34, 0], hips: [12, -36, 0], foreArmR: [20, 0, 0] }, { y: -0.2, z: 0.14, ry: -10 })),
  'R',
  [0.85, -0.45, 0.25],
  [0.8, -0.55, -0.1],
);
const brig_slash: ClipDef = {
  name: 'brig_slash',
  dur: 0.95,
  keys: [
    { t: 0, p: BRIG_READY },
    { t: 0.32, p: BRIG_WIND, e: 'inExpo', stop: true },
    { t: 0.44, p: BRIG_HIT, e: 'outCubic' },
    { t: 0.55, p: BRIG_FOLLOW, stop: true },
    { t: 0.95, p: BRIG_READY, e: 'inOut' },
  ],
  win: { hit: [0.4, 0.5], combo: [0.55, 0.8], cancel: [0.7, 0.95] },
  move: [
    [0, 0],
    [0.3, 0.05],
    [0.46, 0.85],
    [0.95, 0.95],
  ],
  events: [{ t: 0.36, name: 'whoosh', data: { pitch: 0.85 } }],
};
const BRIG_BACK = wield(
  U({ hips: [8, 30, 0], spine: [6, 10, 0], chest: [6, 30, 0], upperChest: [2, 8, 0], neck: [-8, -32, 0], head: [-8, -32, 0], clavicleR: [10, 0, 10], foreArmR: [6, 0, 0], ...handShape('R', 'grip'), upperArmL: [36, 40, 18], foreArmL: [104, 20, 0], ...handShape('L', 'fist'), ...BRIG_LEGS, thighL: [44, -10, 12], shinL: [52, 0, 0] }, { y: -0.16, z: 0.1, ry: 10 }),
  'R',
  [-0.75, 0.05, 0.66],
  [-0.85, 0.1, 0.5],
);
const BRIG_BACK_F = wield(merge(BRIG_BACK, P({ chest: [6, 40, 0], hips: [8, 38, 0] }, { y: -0.16, z: 0.1, ry: 14 })), 'R', [-0.95, 0.0, 0.1], [-0.7, 0.2, -0.65]);
const brig_backhand: ClipDef = {
  name: 'brig_backhand',
  dur: 0.7,
  keys: [
    { t: 0, p: BRIG_FOLLOW },
    { t: 0.08, p: offset(BRIG_FOLLOW, { chest: [0, -6, 0] }), stop: true },
    { t: 0.2, p: BRIG_BACK, e: 'outCubic' },
    { t: 0.3, p: BRIG_BACK_F, stop: true },
    { t: 0.7, p: BRIG_READY, e: 'inOut' },
  ],
  win: { hit: [0.15, 0.24], cancel: [0.45, 0.7] },
  move: [
    [0, 0],
    [0.2, 0.5],
    [0.7, 0.55],
  ],
  events: [{ t: 0.12, name: 'whoosh', data: { pitch: 0.95 } }],
};
const BRIG_RAISE = both(
  U({ hips: [-2, 0, 0], spine: [-5, 0, 0], chest: [-6, 0, 0], upperChest: [-4, 0, 0], neck: [6, 0, 0], head: [4, 0, 0], clavicleL: [-4, 0, 18], clavicleR: [-4, 0, 18], foreArmR: [60, 0, 0], foreArmL: [64, 0, 0], ...hands('grip', 'grip'), thighL: [20, -6, 10], shinL: [24, 0, 0], thighR: [-8, 20, 12], shinR: [20, 0, 0], footR: [-4, 0, 6], toeR: [20, 0, 0] }, { y: -0.04, rx: -4 }),
  [-0.05, 0.92, -0.35],
  [0.05, 0.92, -0.35],
  [0, -0.35, -1],
);
const BRIG_CHOP = both(
  U({ hips: [28, 0, 0], spine: [22, 0, 0], chest: [16, 0, 0], upperChest: [6, 0, 0], neck: [-26, 0, 0], head: [-20, 0, 0], clavicleL: [20, 0, 0], clavicleR: [20, 0, 0], foreArmR: [10, 0, 0], foreArmL: [12, 0, 0], ...hands('grip', 'grip'), thighL: [80, -6, 14], shinL: [96, 0, 0], footL: [28, 0, -6], thighR: [-20, 24, 16], shinR: [44, 0, 0], footR: [-14, 0, 6], toeR: [40, 0, 0] }, { y: -0.42, z: 0.22 }),
  [-0.04, -0.55, 0.84],
  [0.04, -0.55, 0.84],
  [0, -0.85, 0.5],
);
const brig_overhead: ClipDef = {
  name: 'brig_overhead',
  dur: 1.55,
  keys: [
    { t: 0, p: BRIG_READY },
    { t: 0.55, p: BRIG_RAISE, e: 'inOut', stop: true },
    { t: 0.62, p: offset(BRIG_RAISE, { chest: [-3, 0, 0], upperChest: [-2, 0, 0] }, { y: 0.02, rx: -3 }), e: 'inExpo' },
    { t: 0.74, p: BRIG_CHOP, e: 'outCubic', stop: true },
    { t: 1.1, p: offset(BRIG_CHOP, { head: [6, 0, 0] }, { y: -0.4 }), stop: true },
    { t: 1.55, p: BRIG_READY, e: 'inOut' },
  ],
  win: { hit: [0.69, 0.78], cancel: [1.25, 1.55] },
  move: [
    [0, 0],
    [0.6, -0.1],
    [0.74, 1.2],
    [1.55, 1.3],
  ],
  events: [
    { t: 0.66, name: 'whoosh', data: { pitch: 0.6 } },
    { t: 0.74, name: 'groundImpact', data: { r: 1.6 } },
  ],
};
const KICK_CH = U({ hips: [-6, -6, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [6, 0, 0], ...arm(wield(U({ upperArmR: [20, 20, 30], foreArmR: [70, 0, 0], ...handShape('R', 'grip') }), 'R', null, [-0.2, 0.8, 0.4]), 'R'), upperArmL: [30, 20, 34], foreArmL: [60, 0, 0], thighR: [96, 0, 8], shinR: [118, 0, 0], footR: [10, 0, 0], thighL: [4, 10, 8], shinL: [14, 0, 0] }, { y: -0.02 });
const KICK_HIT = merge(KICK_CH, P({ hips: [-14, -6, 0], spine: [-12, 0, 0], thighR: [92, 0, 8], shinR: [6, 0, 0], footR: [24, 0, 0], thighL: [-2, 10, 8], shinL: [10, 0, 0], footL: [-4, 0, 0] }, { y: 0.0, z: 0.1, rx: -10 }));
const brig_kick: ClipDef = {
  name: 'brig_kick',
  dur: 0.62,
  keys: [
    { t: 0, p: BRIG_READY },
    { t: 0.14, p: KICK_CH, e: 'inOut' },
    { t: 0.24, p: KICK_HIT, e: 'outCubic', stop: true },
    { t: 0.36, p: KICK_CH, e: 'inOut' },
    { t: 0.62, p: BRIG_READY, e: 'inOut' },
  ],
  win: { hit: [0.2, 0.3], cancel: [0.4, 0.62] },
  move: [
    [0, 0],
    [0.24, 0.35],
    [0.62, 0.4],
  ],
};

/* ================================================================== KNIGHT (sword + shield) */

const KN_LEGS: B = { thighL: [26, -6, 10], shinL: [34, 0, 0], footL: [10, 0, -4], thighR: [-10, 32, 14], shinR: [24, 0, 0], footR: [6, 0, 6], toeR: [20, 0, 0] };
const SHIELD_UP: B = { clavicleL: [14, 0, 4], upperArmL: [74, 56, 18], foreArmL: [96, 30, 0], ...handShape('L', 'fist', [0, 0, 6]) };
const KN_READY = wield(
  U({ hips: [6, -18, 0], spine: [4, -4, 0], chest: [4, -6, 0], upperChest: [2, -2, 0], neck: [-4, 14, 0], head: [-6, 14, 0], ...SHIELD_UP, clavicleR: [4, 0, 4], upperArmR: [18, 10, 24], foreArmR: [86, 0, 0], ...handShape('R', 'grip'), ...KN_LEGS }, { y: -0.08 }),
  'R',
  null,
  [0.05, 0.62, 0.78],
);
const knight_idle: ClipDef = {
  name: 'knight_idle',
  dur: 2.2,
  loop: true,
  keys: [
    { t: 0, p: KN_READY },
    { t: 1.1, p: offset(KN_READY, { chest: [-1.5, 0, 0], upperArmR: [2, 0, 0] }, { y: -0.01 }) },
    { t: 2.2, p: KN_READY },
  ],
};
const knight_hold: ClipDef = {
  name: 'knight_hold',
  dur: 1,
  loop: true,
  keys: [{ t: 0, p: P({ ...arm(wield(U({ upperArmR: [14, 14, 16], foreArmR: [70, 0, 0], ...handShape('R', 'grip') }), 'R', null, [0.05, 0.5, 0.86]), 'R'), ...SHIELD_UP, upperArmL: [56, 50, 18] }) }],
};
const KN_WIND = wield(
  U({ hips: [4, 30, 0], spine: [2, 10, 0], chest: [0, 26, 0], upperChest: [0, 8, 0], neck: [-6, -30, 0], head: [-6, -30, 0], ...SHIELD_UP, upperArmL: [60, 50, 24], clavicleR: [-10, 0, 6], foreArmR: [40, 0, 0], ...handShape('R', 'grip'), thighL: [16, -10, 10], shinL: [20, 0, 0], thighR: [-6, 34, 14], shinR: [34, 0, 0] }, { y: -0.1, ry: 10 }),
  'R',
  [-0.85, 0.15, -0.5],
  [-0.75, 0.25, -0.6],
);
const KN_CUT = wield(
  U({ hips: [10, -32, 0], spine: [6, -10, 0], chest: [8, -26, 0], upperChest: [4, -8, 0], neck: [-8, 32, 0], head: [-8, 32, 0], ...SHIELD_UP, upperArmL: [40, 40, 40], foreArmL: [80, 30, 0], clavicleR: [22, 0, 4], foreArmR: [6, 0, 0], ...handShape('R', 'grip'), thighL: [48, -10, 12], shinL: [56, 0, 0], footL: [18, 0, -6], thighR: [-22, 30, 14], shinR: [18, 0, 0], footR: [-6, 0, 8], toeR: [30, 0, 0] }, { y: -0.18, z: 0.12, ry: -6 }),
  'R',
  [0.55, 0.05, 0.84],
  [0.75, 0.0, 0.66],
);
const KN_CUT_F = wield(merge(KN_CUT, P({ hips: [10, -38, 0], chest: [8, -34, 0] }, { y: -0.18, z: 0.14, ry: -10 })), 'R', [0.9, -0.15, 0.3], [0.85, -0.2, -0.45]);
const knight_slash: ClipDef = {
  name: 'knight_slash',
  dur: 0.9,
  keys: [
    { t: 0, p: KN_READY },
    { t: 0.3, p: KN_WIND, e: 'inExpo', stop: true },
    { t: 0.42, p: KN_CUT, e: 'outCubic' },
    { t: 0.52, p: KN_CUT_F, stop: true },
    { t: 0.9, p: KN_READY, e: 'inOut' },
  ],
  win: { hit: [0.38, 0.48], combo: [0.52, 0.78], cancel: [0.7, 0.9] },
  move: [
    [0, 0],
    [0.3, 0.05],
    [0.44, 0.8],
    [0.9, 0.9],
  ],
  events: [{ t: 0.34, name: 'whoosh', data: { pitch: 1.0 } }],
};
const KN_RISE = wield(
  U({ hips: [0, 24, 0], spine: [-6, 8, 0], chest: [-8, 24, 0], upperChest: [-4, 8, 0], neck: [-14, -28, 0], head: [-14, -28, 0], ...SHIELD_UP, clavicleR: [14, 0, 18], foreArmR: [10, 0, 0], ...handShape('R', 'grip'), ...KN_LEGS, thighL: [36, -10, 12], shinL: [40, 0, 0] }, { y: -0.08, z: 0.08, ry: 8 }),
  'R',
  [-0.45, 0.75, 0.48],
  [-0.4, 0.85, 0.32],
);
const knight_rising: ClipDef = {
  name: 'knight_rising',
  dur: 0.7,
  keys: [
    { t: 0, p: KN_CUT_F },
    { t: 0.1, p: offset(KN_CUT_F, { chest: [6, -4, 0] }, { y: -0.04 }), stop: true },
    { t: 0.22, p: KN_RISE, e: 'outCubic' },
    { t: 0.32, p: offset(KN_RISE, { chest: [-4, 6, 0] }, { y: 0.02 }), stop: true },
    { t: 0.7, p: KN_READY, e: 'inOut' },
  ],
  win: { hit: [0.16, 0.26], cancel: [0.45, 0.7] },
  move: [
    [0, 0],
    [0.22, 0.45],
    [0.7, 0.5],
  ],
  events: [{ t: 0.14, name: 'whoosh', data: { pitch: 1.1 } }],
};
const KN_DRAW = wield(
  U({ hips: [6, -30, 0], spine: [6, -8, 0], chest: [6, -14, 0], neck: [-8, 22, 0], head: [-8, 22, 0], ...SHIELD_UP, upperArmL: [80, 60, 22], clavicleR: [-14, 0, 2], upperArmR: [-46, 30, 26], foreArmR: [110, 0, 0], ...handShape('R', 'grip'), thighL: [36, -6, 12], shinL: [56, 0, 0], thighR: [-10, 34, 14], shinR: [44, 0, 0], footR: [10, 0, 6] }, { y: -0.22 }),
  'R',
  null,
  [0.05, 0.05, 1],
);
const KN_THRUST = wield(
  U({ hips: [14, -12, 0], spine: [10, -4, 0], chest: [10, -8, 0], upperChest: [4, 0, 0], neck: [-16, 10, 0], head: [-14, 10, 0], ...SHIELD_UP, upperArmL: [40, 30, 40], foreArmL: [70, 20, 0], clavicleR: [30, 0, 2], foreArmR: [4, 0, 0], ...handShape('R', 'grip'), thighL: [70, -8, 12], shinL: [84, 0, 0], footL: [26, 0, -6], thighR: [-34, 30, 14], shinR: [10, 0, 0], footR: [-14, 0, 8], toeR: [40, 0, 0] }, { y: -0.34, z: 0.2 }),
  'R',
  [0.05, -0.02, 1],
  [0.02, -0.02, 1],
);
const knight_thrust: ClipDef = {
  name: 'knight_thrust',
  dur: 1.15,
  keys: [
    { t: 0, p: KN_READY },
    { t: 0.45, p: KN_DRAW, e: 'inOut', stop: true },
    { t: 0.56, p: KN_THRUST, e: 'outExpo', stop: true },
    { t: 0.8, p: offset(KN_THRUST, { head: [4, 0, 0] }), stop: true },
    { t: 1.15, p: KN_READY, e: 'inOut' },
  ],
  win: { hit: [0.52, 0.64], cancel: [0.9, 1.15] },
  move: [
    [0, 0],
    [0.45, -0.15],
    [0.58, 1.9],
    [1.15, 2.0],
  ],
  events: [{ t: 0.5, name: 'whoosh', data: { pitch: 1.2 } }],
};
const KN_BASH = U({ hips: [10, 20, 0], spine: [8, 10, 0], chest: [8, 16, 0], neck: [-10, -14, 0], head: [-10, -14, 0], clavicleL: [30, 0, 2], upperArmL: [84, 70, 10], foreArmL: [30, 30, 0], ...handShape('L', 'fist'), ...arm(wield(U({ upperArmR: [-10, 20, 30], foreArmR: [90, 0, 0], ...handShape('R', 'grip') }), 'R', null, [-0.2, 0.7, -0.4]), 'R'), thighL: [56, -10, 12], shinL: [64, 0, 0], footL: [20, 0, -6], thighR: [-26, 30, 14], shinR: [14, 0, 0], toeR: [30, 0, 0] }, { y: -0.22, z: 0.15 });
const knight_bash: ClipDef = {
  name: 'knight_bash',
  dur: 0.72,
  keys: [
    { t: 0, p: KN_READY },
    { t: 0.2, p: offset(KN_READY, { chest: [0, -12, 0], hips: [0, -10, 0] }, { y: -0.12 }), e: 'inOut', stop: true },
    { t: 0.3, p: KN_BASH, e: 'outCubic', stop: true },
    { t: 0.72, p: KN_READY, e: 'inOut' },
  ],
  win: { hit: [0.26, 0.34], cancel: [0.5, 0.72] },
  move: [
    [0, 0],
    [0.2, -0.05],
    [0.32, 1.1],
    [0.72, 1.15],
  ],
};
const KN_BLOCK = wield(
  U({ hips: [10, -10, 0], spine: [10, -4, 0], chest: [10, -4, 0], neck: [-12, 6, 0], head: [-14, 6, 0], clavicleL: [20, 0, 10], upperArmL: [84, 66, 22], foreArmL: [104, 30, 0], ...handShape('L', 'fist'), upperArmR: [10, 10, 20], foreArmR: [80, 0, 0], ...handShape('R', 'grip'), ...KN_LEGS, shinL: [48, 0, 0], shinR: [40, 0, 0] }, { y: -0.16 }),
  'R',
  null,
  [0.1, 0.4, 0.9],
);
const knight_block: ClipDef = {
  name: 'knight_block',
  dur: 1,
  loop: true,
  keys: [
    { t: 0, p: KN_BLOCK },
    { t: 0.5, p: offset(KN_BLOCK, { chest: [1, 0, 0] }, { y: -0.006 }) },
    { t: 1, p: KN_BLOCK },
  ],
};

/* ================================================================== MANDRAKE IMP (claws, leaps, self-destruct) */

const IMP_READY = U({ hips: [24, 0, 0], spine: [16, 0, 0], chest: [14, 0, 0], upperChest: [8, 0, 0], neck: [-26, 0, 0], head: [-18, 0, 0], clavicleL: [16, 0, 0], clavicleR: [16, 0, 0], upperArmL: [44, 10, 26], upperArmR: [44, 10, 26], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0], ...hands('claw', 'claw', [0, 0, -20], [0, 0, -20]), thighL: [54, -6, 18], thighR: [54, -6, 18], shinL: [80, 0, 0], shinR: [80, 0, 0], footL: [26, 0, -8], footR: [26, 0, -8] }, { y: -0.12 });
const imp_idle: ClipDef = {
  name: 'imp_idle',
  dur: 0.8,
  loop: true,
  keys: [
    { t: 0, p: IMP_READY },
    { t: 0.2, p: offset(IMP_READY, { head: [6, 8, 6], upperArmL: [6, 0, 4], upperArmR: [-4, 0, 2] }, { y: 0.03 }) },
    { t: 0.4, p: offset(IMP_READY, { head: [0, -6, -4] }, { y: -0.01 }) },
    { t: 0.6, p: offset(IMP_READY, { head: [6, -8, -6], upperArmR: [6, 0, 4], upperArmL: [-4, 0, 2] }, { y: 0.03 }) },
    { t: 0.8, p: IMP_READY },
  ],
};
const IMP_SW_L = aimArm(merge(IMP_READY, P({ hips: [24, -26, 0], chest: [14, -22, 0], neck: [-26, 20, 0], clavicleL: [30, 0, 4], foreArmL: [10, 0, 0], ...handShape('L', 'claw', [0, 0, -30]) }, { y: -0.12, z: 0.12 })), 'L', [-0.45, -0.1, 0.9]);
const IMP_SW_R = aimArm(merge(IMP_READY, P({ hips: [24, 26, 0], chest: [14, 22, 0], neck: [-26, -20, 0], clavicleR: [30, 0, 4], foreArmR: [10, 0, 0], ...handShape('R', 'claw', [0, 0, -30]) }, { y: -0.12, z: 0.2 })), 'R', [0.45, -0.1, 0.9]);
const imp_claw: ClipDef = {
  name: 'imp_claw',
  dur: 0.72,
  keys: [
    { t: 0, p: IMP_READY },
    { t: 0.1, p: offset(IMP_READY, { chest: [0, 20, 0], upperArmL: [-20, 0, 30] }, { y: -0.04 }), e: 'inOut' },
    { t: 0.18, p: IMP_SW_L, e: 'outCubic', stop: true },
    { t: 0.28, p: offset(IMP_SW_L, { chest: [0, -16, 0], upperArmR: [-20, 0, 30] }) },
    { t: 0.36, p: IMP_SW_R, e: 'outCubic', stop: true },
    { t: 0.72, p: IMP_READY, e: 'inOut' },
  ],
  win: { hit: [0.15, 0.22], cancel: [0.5, 0.72] },
  move: [
    [0, 0],
    [0.18, 0.4],
    [0.36, 0.7],
    [0.72, 0.75],
  ],
  events: [{ t: 0.35, name: 'clawHit' }],
};
const IMP_CROUCH = offset(IMP_READY, { thighL: [26, 0, 0], thighR: [26, 0, 0], shinL: [30, 0, 0], shinR: [30, 0, 0], upperArmL: [-30, 0, -10], upperArmR: [-30, 0, -10] }, { y: -0.12 });
const IMP_POUNCE = U({ hips: [-4, 0, 0], spine: [-6, 0, 0], chest: [-6, 0, 0], neck: [-24, 0, 0], head: [-16, 0, 0], upperArmL: [150, 0, 30], upperArmR: [150, 0, 30], foreArmL: [20, 0, 0], foreArmR: [20, 0, 0], ...hands('claw', 'claw', [0, 0, -40], [0, 0, -40]), thighL: [40, 0, 10], thighR: [20, 0, 10], shinL: [90, 0, 0], shinR: [70, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }, { rx: 40 });
const IMP_STRIKE = U({ hips: [30, 0, 0], spine: [20, 0, 0], chest: [16, 0, 0], neck: [-30, 0, 0], head: [-20, 0, 0], upperArmL: [100, 0, 24], upperArmR: [100, 0, 24], foreArmL: [10, 0, 0], foreArmR: [10, 0, 0], ...hands('claw', 'claw', [0, 0, -50], [0, 0, -50]), thighL: [90, 0, 14], thighR: [70, 0, 14], shinL: [110, 0, 0], shinR: [100, 0, 0], footL: [10, 0, 0], footR: [10, 0, 0] }, { rx: 30, y: -0.2 });
const imp_leap: ClipDef = {
  name: 'imp_leap',
  dur: 1.1,
  keys: [
    { t: 0, p: IMP_READY },
    { t: 0.28, p: IMP_CROUCH, e: 'inOut', stop: true },
    { t: 0.4, p: IMP_POUNCE, e: 'outCubic' },
    { t: 0.6, p: IMP_STRIKE, e: 'in' },
    { t: 0.7, p: offset(IMP_STRIKE, {}, { rx: -10, y: -0.1 }), stop: true },
    { t: 1.1, p: IMP_READY, e: 'inOut' },
  ],
  win: { hit: [0.55, 0.72], cancel: [0.85, 1.1] },
  move: [
    [0, 0, 0, 0],
    [0.28, 0, 0, 0],
    [0.45, 1.8, 0, 1.4],
    [0.6, 3.8, 0, 0.8],
    [0.7, 4.4, 0, 0],
    [1.1, 4.5, 0, 0],
  ],
  events: [
    { t: 0.3, name: 'whoosh', data: { pitch: 1.4 } },
    { t: 0.7, name: 'land' },
  ],
};
const IMP_SWELL = U({ hips: [-10, 0, 0], spine: [-16, 0, 0], chest: [-18, 0, 0], upperChest: [-10, 0, 0], neck: [-20, 0, 0], head: [-24, 0, 0], upperArmL: [10, -20, 70], upperArmR: [10, -20, 70], foreArmL: [30, 0, 0], foreArmR: [30, 0, 0], ...hands('spread', 'spread'), thighL: [24, 20, 24], thighR: [24, 20, 24], shinL: [44, 0, 0], shinR: [44, 0, 0] }, { y: -0.08 });
const imp_bomb: ClipDef = {
  name: 'imp_bomb',
  dur: 1.5,
  keys: [
    { t: 0, p: IMP_READY },
    { t: 0.3, p: IMP_SWELL, e: 'inOut' },
    { t: 0.9, p: offset(IMP_SWELL, { chest: [-6, 0, 0], head: [-8, 0, 0] }, { y: 0.02 }) },
    { t: 1.4, p: offset(IMP_SWELL, { chest: [-10, 0, 0], head: [-12, 0, 0], upperArmL: [0, 0, 14], upperArmR: [0, 0, 14] }, { y: 0.05 }), e: 'inOut' },
    { t: 1.5, p: offset(IMP_SWELL, { chest: [-10, 0, 0] }, { y: 0.05 }) },
  ],
  win: { armor: [0.2, 1.5] },
  events: [
    { t: 0.1, name: 'bombStart' },
    { t: 1.45, name: 'bombBlast' },
  ],
};

/* ================================================================== STONE GOLEM (huge, slow, red slams) */

const GOLEM_READY = U({ hips: [8, 0, 0], spine: [10, 0, 0], chest: [10, 0, 0], upperChest: [6, 0, 0], neck: [-14, 0, 0], head: [-10, 0, 0], clavicleL: [10, 0, 6], clavicleR: [10, 0, 6], upperArmL: [24, 24, 26], upperArmR: [24, 24, 26], foreArmL: [40, 20, 0], foreArmR: [40, 20, 0], ...hands('fist', 'fist'), thighL: [20, 10, 16], thighR: [20, 10, 16], shinL: [30, 0, 0], shinR: [30, 0, 0], footL: [10, 0, -6], footR: [10, 0, -6] }, { y: -0.08 });
const golem_idle: ClipDef = {
  name: 'golem_idle',
  dur: 3,
  loop: true,
  keys: [
    { t: 0, p: GOLEM_READY },
    { t: 1.5, p: offset(GOLEM_READY, { chest: [-3, 0, 0], upperArmL: [0, 0, 3], upperArmR: [0, 0, 3], head: [3, 4, 0] }, { y: 0.015 }) },
    { t: 3, p: GOLEM_READY },
  ],
};
const GOLEM_STEP_L = merge(GOLEM_READY, P({ hips: [8, 8, 4], spine: [10, -4, -4], chest: [10, -4, -4], thighL: [44, 6, 14], shinL: [40, 0, 0], footL: [6, 0, -4], thighR: [-12, 10, 16], shinR: [18, 0, 0], footR: [-6, 0, -6], upperArmL: [8, 24, 26], upperArmR: [40, 24, 26] }, { y: -0.03, rz: 4 }));
const GOLEM_STEP_R = merge(GOLEM_READY, P({ hips: [8, -8, -4], spine: [10, 4, 4], chest: [10, 4, 4], thighR: [44, 6, 14], shinR: [40, 0, 0], footR: [6, 0, -4], thighL: [-12, 10, 16], shinL: [18, 0, 0], footL: [-6, 0, -6], upperArmR: [8, 24, 26], upperArmL: [40, 24, 26] }, { y: -0.03, rz: -4 }));
const golem_walk: ClipDef = {
  name: 'golem_walk',
  dur: 1.6,
  loop: true,
  speed: 2.2,
  keys: [
    { t: 0, p: GOLEM_STEP_L },
    { t: 0.4, p: offset(GOLEM_READY, {}, { y: 0.03 }) },
    { t: 0.8, p: GOLEM_STEP_R },
    { t: 1.2, p: offset(GOLEM_READY, {}, { y: 0.03 }) },
    { t: 1.6, p: GOLEM_STEP_L },
  ],
  events: [
    { t: 0.0, name: 'step', data: { foot: 'L', heavy: 1 } },
    { t: 0.8, name: 'step', data: { foot: 'R', heavy: 1 } },
  ],
};
const GOLEM_RAISE = U({ hips: [-6, 0, 0], spine: [-14, 0, 0], chest: [-16, 0, 0], upperChest: [-10, 0, 0], neck: [-6, 0, 0], head: [-12, 0, 0], clavicleL: [-10, 0, 24], clavicleR: [-10, 0, 24], upperArmL: [-10, -20, 168], upperArmR: [-10, -20, 168], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0], ...hands('fist', 'fist'), thighL: [16, 10, 18], thighR: [16, 10, 18], shinL: [20, 0, 0], shinR: [20, 0, 0] }, { y: 0.02, rx: -10 });
const GOLEM_SLAM = U({ hips: [36, 0, 0], spine: [26, 0, 0], chest: [20, 0, 0], upperChest: [8, 0, 0], neck: [-30, 0, 0], head: [-22, 0, 0], clavicleL: [26, 0, 0], clavicleR: [26, 0, 0], upperArmL: [100, -10, 10], upperArmR: [100, -10, 10], foreArmL: [6, 0, 0], foreArmR: [6, 0, 0], ...hands('fist', 'fist'), thighL: [70, 10, 18], thighR: [70, 10, 18], shinL: [90, 0, 0], shinR: [90, 0, 0], footL: [26, 0, -6], footR: [26, 0, -6] }, { y: -0.32, z: 0.15 });
const golem_slam: ClipDef = {
  name: 'golem_slam',
  dur: 2.0,
  keys: [
    { t: 0, p: GOLEM_READY },
    { t: 0.8, p: GOLEM_RAISE, e: 'inOut', stop: true },
    { t: 0.9, p: offset(GOLEM_RAISE, { chest: [-4, 0, 0] }, { rx: -14 }), e: 'inExpo' },
    { t: 1.02, p: GOLEM_SLAM, e: 'outCubic', stop: true },
    { t: 1.5, p: offset(GOLEM_SLAM, { head: [8, 0, 0] }, { y: -0.3 }), stop: true },
    { t: 2.0, p: GOLEM_READY, e: 'inOut' },
  ],
  win: { hit: [0.98, 1.08], armor: [0, 1.6], cancel: [1.7, 2.0] },
  move: [
    [0, 0],
    [1.02, 0.6],
    [2.0, 0.65],
  ],
  events: [
    { t: 0.94, name: 'whoosh', data: { pitch: 0.4 } },
    { t: 1.02, name: 'quake', data: { r: 6.5, at: 2.4 } },
  ],
};
const GOLEM_SW_WIND = aimArm(merge(GOLEM_READY, P({ hips: [6, 34, 0], spine: [4, 12, 0], chest: [4, 30, 0], neck: [-12, -30, 0], head: [-10, -30, 0], clavicleR: [-10, 0, 10], foreArmR: [20, 0, 0], thighL: [14, 10, 16], thighR: [26, 30, 18], shinR: [40, 0, 0] }, { y: -0.08, ry: 10 })), 'R', [-0.9, 0.15, -0.3]);
const GOLEM_SW_HIT = aimArm(merge(GOLEM_READY, P({ hips: [12, -36, 0], spine: [8, -12, 0], chest: [10, -30, 0], neck: [-16, 30, 0], head: [-14, 30, 0], clavicleR: [20, 0, 6], foreArmR: [10, 0, 0], thighL: [40, -10, 18], shinL: [50, 0, 0], thighR: [-6, 30, 18], shinR: [20, 0, 0] }, { y: -0.14, z: 0.1, ry: -10 })), 'R', [0.85, -0.05, 0.5]);
const golem_swipe: ClipDef = {
  name: 'golem_swipe',
  dur: 1.45,
  keys: [
    { t: 0, p: GOLEM_READY },
    { t: 0.55, p: GOLEM_SW_WIND, e: 'inOut', stop: true },
    { t: 0.72, p: GOLEM_SW_HIT, e: 'outCubic' },
    { t: 0.85, p: aimArm(offset(GOLEM_SW_HIT, { chest: [0, -10, 0], hips: [0, -6, 0] }), 'R', [0.9, -0.1, -0.3]), stop: true },
    { t: 1.45, p: GOLEM_READY, e: 'inOut' },
  ],
  win: { hit: [0.64, 0.8], armor: [0, 1.0], cancel: [1.15, 1.45] },
  move: [
    [0, 0],
    [0.72, 0.6],
    [1.45, 0.65],
  ],
  events: [{ t: 0.6, name: 'whoosh', data: { pitch: 0.45 } }],
};
const GOLEM_LIFT = merge(GOLEM_READY, P({ hips: [-2, 0, -6], spine: [-6, 0, -6], chest: [-6, 0, -4], thighR: [96, 10, 14], shinR: [96, 0, 0], footR: [10, 0, 0], thighL: [6, 10, 18], shinL: [14, 0, 0], upperArmL: [30, 24, 46], upperArmR: [30, 24, 46] }, { y: 0.04, rz: -6 }));
const GOLEM_STOMP = merge(GOLEM_READY, P({ hips: [20, 0, 4], spine: [16, 0, 0], chest: [14, 0, 0], neck: [-24, 0, 0], thighR: [30, 10, 16], shinR: [40, 0, 0], footR: [10, 0, -6], thighL: [30, 10, 18], shinL: [50, 0, 0], upperArmL: [40, 24, 40], upperArmR: [40, 24, 40] }, { y: -0.18, rz: 4 }));
const golem_stomp: ClipDef = {
  name: 'golem_stomp',
  dur: 1.6,
  keys: [
    { t: 0, p: GOLEM_READY },
    { t: 0.62, p: GOLEM_LIFT, e: 'inOut', stop: true },
    { t: 0.76, p: GOLEM_STOMP, e: 'inExpo', stop: true },
    { t: 1.2, p: offset(GOLEM_STOMP, {}, { y: -0.17 }), stop: true },
    { t: 1.6, p: GOLEM_READY, e: 'inOut' },
  ],
  win: { armor: [0, 1.2], cancel: [1.3, 1.6] },
  events: [{ t: 0.76, name: 'quake', data: { r: 8.5, at: 0 } }],
};

/* ================================================================== WARLOCK TEMPLAR (staff caster) */

const WL_READY = wield(
  U({ hips: [2, -10, 0], spine: [2, 0, 0], chest: [2, -4, 0], neck: [-2, 8, 0], head: [-4, 8, 0], upperArmR: [16, 30, 20], foreArmR: [60, 0, 0], ...handShape('R', 'grip'), upperArmL: [40, 40, 24], foreArmL: [80, 30, 0], ...handShape('L', 'open', [0, 0, -20]), ...STANCE_LEGS, thighL: [16, -4, 8], shinL: [20, 0, 0], thighR: [-6, 24, 10], shinR: [14, 0, 0] }, { y: -0.04 }),
  'R',
  null,
  [-0.12, 0.98, 0.15],
);
const warlock_idle: ClipDef = {
  name: 'warlock_idle',
  dur: 2.6,
  loop: true,
  keys: [
    { t: 0, p: WL_READY },
    { t: 1.3, p: offset(WL_READY, { chest: [-2, 2, 0], upperArmL: [4, 0, 4], head: [2, -4, 0] }, { y: 0.01 }) },
    { t: 2.6, p: WL_READY },
  ],
};
const warlock_hold: ClipDef = {
  name: 'warlock_hold',
  dur: 1,
  loop: true,
  keys: [{ t: 0, p: P(arm(wield(U({ upperArmR: [14, 30, 16], foreArmR: [56, 0, 0], ...handShape('R', 'grip') }), 'R', null, [-0.1, 0.96, 0.25]), 'R')) }],
};
const WL_DRAW = merge(WL_READY, P({ hips: [2, 20, 0], chest: [0, 24, 0], neck: [-4, -20, 0], head: [-6, -20, 0], upperArmL: [-10, 30, 30], foreArmL: [110, 20, 0], ...handShape('L', 'claw', [0, 0, -30]) }, { y: -0.08 }));
const WL_PUSH = aimArm(merge(WL_READY, P({ hips: [6, -20, 0], spine: [6, -4, 0], chest: [6, -18, 0], neck: [-8, 20, 0], head: [-8, 20, 0], clavicleL: [24, 0, 4], foreArmL: [6, 0, 0], ...handShape('L', 'palm', [0, 0, -70]), thighL: [36, -6, 10], shinL: [40, 0, 0] }, { y: -0.12, z: 0.06 })), 'L', [0, 0.05, 1]);
const warlock_cast: ClipDef = {
  name: 'warlock_cast',
  dur: 0.9,
  keys: [
    { t: 0, p: WL_READY },
    { t: 0.3, p: WL_DRAW, e: 'inOut', stop: true },
    { t: 0.4, p: WL_PUSH, e: 'outCubic', stop: true },
    { t: 0.9, p: WL_READY, e: 'inOut' },
  ],
  win: { cancel: [0.6, 0.9] },
  events: [
    { t: 0.1, name: 'castGather' },
    { t: 0.4, name: 'castOrb' },
  ],
};
const WL_RAISE = wield(
  U({ hips: [-2, 0, 0], spine: [-8, 0, 0], chest: [-10, 0, 0], neck: [-10, 0, 0], head: [-14, 0, 0], clavicleR: [-4, 0, 22], foreArmR: [10, 0, 0], ...handShape('R', 'grip'), upperArmL: [10, 20, 60], foreArmL: [40, 0, 0], ...handShape('L', 'spread'), thighL: [10, 10, 12], thighR: [10, 10, 12], shinL: [14, 0, 0], shinR: [14, 0, 0] }, { y: -0.02 }),
  'R',
  [-0.1, 0.98, 0.1],
  [0, 1, 0.05],
);
const WL_PLANT = wield(
  U({ hips: [14, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [-14, 0, 0], head: [-10, 0, 0], clavicleR: [14, 0, 4], foreArmR: [20, 0, 0], ...handShape('R', 'grip'), upperArmL: [20, 20, 50], foreArmL: [40, 0, 0], ...handShape('L', 'spread'), thighL: [40, 10, 16], thighR: [40, 10, 16], shinL: [60, 0, 0], shinR: [60, 0, 0], footL: [16, 0, -6], footR: [16, 0, -6] }, { y: -0.24 }),
  'R',
  [-0.15, -0.2, 0.96],
  [0, -1, 0.15],
);
const warlock_nova: ClipDef = {
  name: 'warlock_nova',
  dur: 1.4,
  keys: [
    { t: 0, p: WL_READY },
    { t: 0.5, p: WL_RAISE, e: 'inOut', stop: true },
    { t: 0.66, p: WL_PLANT, e: 'inExpo', stop: true },
    { t: 1.05, p: offset(WL_PLANT, {}, { y: -0.01 }), stop: true },
    { t: 1.4, p: WL_READY, e: 'inOut' },
  ],
  win: { cancel: [1.1, 1.4] },
  events: [
    { t: 0.08, name: 'runeMark', data: { delay: 1.05 } },
    { t: 0.66, name: 'staffPlant' },
  ],
};
const warlock_blink: ClipDef = {
  name: 'warlock_blink',
  dur: 0.5,
  keys: [
    { t: 0, p: WL_READY },
    { t: 0.12, p: offset(WL_READY, { chest: [-8, 0, 0], head: [-6, 0, 0] }, { y: -0.08 }), stop: true },
    { t: 0.5, p: WL_READY, e: 'inOut' },
  ],
  events: [{ t: 0.14, name: 'blink' }],
};

export const MOBS: ClipDef[] = [
  brig_idle,
  brig_hold,
  brig_slash,
  brig_backhand,
  brig_overhead,
  brig_kick,
  knight_idle,
  knight_hold,
  knight_slash,
  knight_rising,
  knight_thrust,
  knight_bash,
  knight_block,
  imp_idle,
  imp_claw,
  imp_leap,
  imp_bomb,
  golem_idle,
  golem_walk,
  golem_slam,
  golem_swipe,
  golem_stomp,
  warlock_idle,
  warlock_hold,
  warlock_cast,
  warlock_nova,
  warlock_blink,
];
