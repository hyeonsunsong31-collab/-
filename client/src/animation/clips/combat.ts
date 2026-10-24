import type { ClipDef } from '../Clip.ts';
import { P, STANCE, STAND, POWER_STANCE, GUARD_L, GUARD_R, STANCE_LEGS, hands, handShape, merge, mirror, offset, type B } from '../poses.ts';
import type { RootXf } from '../Pose.ts';
import { aimArm, aimBoth } from '../aim.ts';

/** Strike aim: straight ahead, a touch above shoulder height (chin/face of a same-height opponent). */
const AHEAD: [number, number, number] = [0, 0.06, 1];

/**
 * Melee clips (ZZZ-style snappy timing): short anticipation, a held contact frame, long cancelable recovery.
 * Windows: hit = active frames, combo = next input chains, cancel = dodge/specials may interrupt.
 */

const S = (b: B, root?: RootXf) => merge(STANCE, P(b, root));

/* ------------------------------------------------------------------ arm vocabulary */

/**
 * Straight punch that lands on the centerline ahead even when the torso is twisted: `twist` is the summed torso
 * twist (left +); the arm abducts outward by the matching amount so the fist travels straight to the target.
 */
const punch = (side: 'L' | 'R', twist = 0, fwd = 104): B => ({
  [`upperArm${side}`]: [fwd, 82, Math.max(-10, (side === 'R' ? twist : -twist) * 0.9 + 4)],
  [`foreArm${side}`]: [3, 0, 0],
  [`clavicle${side}`]: [24, 0, 4],
  ...handShape(side, 'fist', [0, 0, 0]),
});
const chamber = (side: 'L' | 'R'): B => ({
  [`upperArm${side}`]: [-34, 30, 14],
  [`foreArm${side}`]: [126, 10, 0],
  ...handShape(side, 'fist', [0, 0, 12]),
});
const palm = (side: 'L' | 'R', fwd = 100, twist = 0): B => ({
  [`upperArm${side}`]: [fwd, 86, Math.max(-10, (side === 'R' ? twist : -twist) * 0.9 + 6)],
  [`foreArm${side}`]: [4, 0, 0],
  [`clavicle${side}`]: [26, 0, 4],
  ...handShape(side, 'palm', [0, 0, -72]),
});
const LUNGE_LEGS: B = {
  thighL: [44, -4, 10],
  shinL: [46, 0, 0],
  footL: [18, 0, -4],
  thighR: [-24, 30, 13],
  shinR: [12, 0, 0],
  footR: [-6, 0, 6],
  toeR: [20, 0, 0],
};

/* ------------------------------------------------------------------ 5-hit light chain */

const L1_WIND = S({ hips: [6, -26, 0], chest: [8, -8, 0], ...offsetArm(GUARD_L, 'upperArmL', [-8, 0, 0]), foreArmL: [120, 18, 0] });
const L1_HIT = aimArm(S({ hips: [4, -24, 0], spine: [4, -4, 0], chest: [4, -10, 0], upperChest: [2, -4, 0], neck: [-2, 18, 0], head: [-6, 20, 0], ...punch('L', -42), clavicleL: [12, 0, 4], thighL: [36, 4, 9], shinL: [40, 0, 0] }, { z: 0.06, y: -0.08 }), 'L', AHEAD);
const light1: ClipDef = {
  name: 'light1',
  dur: 0.4,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.05, p: L1_WIND, e: 'inOut' },
    { t: 0.1, p: L1_HIT, e: 'snap', stop: true },
    { t: 0.18, p: offset(L1_HIT, { foreArmL: [6, 0, 0] }), stop: true },
    { t: 0.4, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.08, 0.14], combo: [0.11, 0.4], cancel: [0.12, 0.4] },
  move: [
    [0, 0],
    [0.12, 0.45],
    [0.4, 0.5],
  ],
  events: [{ t: 0.07, name: 'whoosh', data: { pitch: 1.3 } }],
};

const L2_WIND = S({ hips: [6, -28, 0], chest: [8, -12, 0], foreArmR: [134, 18, 0], clavicleR: [-4, 0, 2] });
const L2_HIT = aimArm(S({ hips: [4, 14, 0], spine: [4, 8, 0], chest: [4, 14, 0], upperChest: [2, 6, 0], neck: [-2, -20, 0], head: [-6, -20, 0], ...punch('R', 42), ...GUARD_L, upperArmL: [52, 50, 14], thighL: [38, -30, 9], shinL: [42, 0, 0], thighR: [-16, 6, 13], shinR: [14, 0, 0], footR: [-2, 0, 0], toeR: [30, 0, 0] }, { z: 0.08, y: -0.09 }), 'R', AHEAD);
const light2: ClipDef = {
  name: 'light2',
  dur: 0.42,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.06, p: L2_WIND, e: 'inOut' },
    { t: 0.12, p: L2_HIT, e: 'snap', stop: true },
    { t: 0.2, p: offset(L2_HIT, { foreArmR: [6, 0, 0] }), stop: true },
    { t: 0.42, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.1, 0.16], combo: [0.13, 0.42], cancel: [0.14, 0.42] },
  move: [
    [0, 0],
    [0.14, 0.55],
    [0.42, 0.6],
  ],
  events: [{ t: 0.09, name: 'whoosh', data: { pitch: 1.15 } }],
};

/** Spinning backfist: full 360° turn to the right, left backfist whipping out at 3/4 of the spin. */
const L3_COIL = S({ hips: [6, 20, 0], chest: [8, 18, 0], upperArmL: [40, 70, 8], foreArmL: [134, 0, 0], ...handShape('L', 'fist', [0, 0, 20]) }, { y: -0.1, ry: 15 });
const L3_TURN = S({ hips: [4, 0, 0], chest: [6, 10, 0], upperArmL: [30, 80, 14], foreArmL: [140, 0, 0], neck: [-6, -30, 0], head: [-8, -36, 0], thighL: [20, 30, 9], shinL: [24, 0, 0], thighR: [10, 20, 13], shinR: [30, 0, 0] }, { y: -0.08, ry: -150 });
const L3_HIT = S({ hips: [4, -10, 0], spine: [4, -10, 0], chest: [6, -24, 0], neck: [-6, 26, 0], head: [-8, 30, 0], upperArmL: [74, -40, 58], foreArmL: [6, 0, 0], clavicleL: [10, 0, 10], ...handShape('L', 'fist', [0, 0, -12]), upperArmR: [30, 40, 20], foreArmR: [110, 10, 0], thighL: [30, -4, 12], shinL: [34, 0, 0] }, { y: -0.08, ry: -320, z: 0.05 });
const light3: ClipDef = {
  name: 'light3',
  dur: 0.52,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.06, p: L3_COIL, e: 'inOut' },
    { t: 0.15, p: L3_TURN, e: 'in' },
    { t: 0.22, p: L3_HIT, e: 'outCubic', stop: true },
    { t: 0.3, p: offset(L3_HIT, {}, { ry: -6 }), stop: true },
    { t: 0.52, p: offset(STANCE, {}, { ry: -360 }), e: 'inOut' },
  ],
  win: { hit: [0.19, 0.26], combo: [0.23, 0.52], cancel: [0.25, 0.52] },
  move: [
    [0, 0],
    [0.22, 0.7],
    [0.52, 0.75],
  ],
  events: [{ t: 0.17, name: 'whoosh', data: { pitch: 0.9 } }],
};

/** Roundhouse kick with the right leg: chamber, pivot on the left foot, instep strike at hip height. */
const L4_CHAMBER = S({ hips: [2, 40, 0], spine: [0, 6, -8], chest: [-2, 8, -8], neck: [-4, -30, 6], head: [-6, -30, 6], thighR: [74, -16, 40], shinR: [124, 0, 0], footR: [-34, 0, 0], thighL: [8, 44, 8], shinL: [20, 0, 0], footL: [6, 0, 20], upperArmR: [-10, 20, 34], foreArmR: [60, 10, 0] }, { y: -0.03 });
const L4_HIT = S({ hips: [0, 72, 0], spine: [-2, 6, -14], chest: [-4, 6, -12], upperChest: [-2, 4, -4], neck: [-2, -46, 10], head: [-4, -40, 10], thighR: [8, -32, 86], shinR: [8, 0, 0], footR: [-38, 0, 0], toeR: [-14, 0, 0], thighL: [6, 62, 6], shinL: [14, 0, 0], footL: [6, 0, 24], upperArmR: [-24, 10, 44], foreArmR: [40, 10, 0], ...handShape('R', 'fist') }, { y: 0.0 });
const light4: ClipDef = {
  name: 'light4',
  dur: 0.58,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.12, p: L4_CHAMBER, e: 'inOut' },
    { t: 0.22, p: L4_HIT, e: 'snap', stop: true },
    { t: 0.3, p: offset(L4_HIT, { shinR: [10, 0, 0] }), stop: true },
    { t: 0.4, p: L4_CHAMBER, e: 'inOut' },
    { t: 0.58, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.19, 0.29], combo: [0.27, 0.58], cancel: [0.3, 0.58] },
  move: [
    [0, 0],
    [0.22, 0.5],
    [0.58, 0.55],
  ],
  events: [{ t: 0.16, name: 'whoosh', data: { pitch: 0.8 } }],
};

/** Finisher: deep step, both palms thrust forward — a point-blank ki burst that launches. */
const L5_DRAW = S({ hips: [8, 30, 0], spine: [6, 10, 0], chest: [6, 16, 0], upperArmR: [-30, 40, 30], foreArmR: [110, 0, 0], upperArmL: [36, 90, -6], foreArmL: [120, 0, 0], ...hands('claw', 'claw', [0, 0, -30], [0, 0, -30]), thighL: [36, -4, 10], shinL: [50, 0, 0], thighR: [-6, 30, 14], shinR: [36, 0, 0] }, { y: -0.12, ry: -10 });
const L5_HIT = aimBoth(S({ hips: [6, -4, 0], spine: [6, 0, 0], chest: [4, 0, 0], upperChest: [2, 0, 0], neck: [-8, 4, 0], head: [-6, 4, 0], ...palm('L', 104, -4), ...palm('R', 104, -4), upperArmL: [104, 86, -4], upperArmR: [104, 86, -4], ...LUNGE_LEGS }, { y: -0.16, z: 0.12 }), [0, -0.02, 1]);
const light5: ClipDef = {
  name: 'light5',
  dur: 0.78,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.12, p: L5_DRAW, e: 'inOut', stop: true },
    { t: 0.24, p: L5_HIT, e: 'snap', stop: true },
    { t: 0.46, p: offset(L5_HIT, { upperArmL: [-4, 0, 0], upperArmR: [-4, 0, 0], foreArmL: [10, 0, 0], foreArmR: [10, 0, 0] }), stop: true },
    { t: 0.78, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.22, 0.32], combo: [0.42, 0.78], cancel: [0.4, 0.78], hold: [0.24, 0.5] },
  move: [
    [0, 0],
    [0.12, -0.1],
    [0.26, 1.0],
    [0.78, 1.05],
  ],
  events: [
    { t: 0.08, name: 'kiGather', data: { hands: 'both' } },
    { t: 0.22, name: 'whoosh', data: { pitch: 0.7 } },
    { t: 0.24, name: 'palmBurst' },
  ],
};

/* ------------------------------------------------------------------ rush (hold on hit 5) */

const RUSH_L = aimArm(S({ hips: [6, -14, 0], spine: [6, -6, 0], chest: [6, -12, 0], neck: [-8, 16, 0], head: [-8, 16, 0], ...punch('L', -32, 108), ...chamber('R'), ...LUNGE_LEGS }, { y: -0.14, z: 0.08 }), 'L', [0.04, 0.0, 1]);
const RUSH_R = aimArm(S({ hips: [6, 12, 0], spine: [6, 6, 0], chest: [6, 12, 0], neck: [-8, -14, 0], head: [-8, -14, 0], ...punch('R', 30, 108), ...chamber('L'), ...LUNGE_LEGS }, { y: -0.14, z: 0.08 }), 'R', [-0.04, 0.04, 1]);
const rush: ClipDef = {
  name: 'rush',
  dur: 0.24,
  loop: true,
  keys: [
    { t: 0, p: RUSH_L, stop: true },
    { t: 0.06, p: RUSH_R, e: 'snap' },
    { t: 0.12, p: RUSH_R, stop: true },
    { t: 0.18, p: RUSH_L, e: 'snap' },
    { t: 0.24, p: RUSH_L, stop: true },
  ],
  events: [
    { t: 0.06, name: 'rushHit', data: { hand: 'R' } },
    { t: 0.18, name: 'rushHit', data: { hand: 'L' } },
  ],
};
const UPPER_CROUCH = S({ hips: [20, 16, 0], spine: [14, 10, 0], chest: [10, 8, 0], neck: [-18, -6, 0], head: [-14, -6, 0], upperArmR: [-20, 30, 20], foreArmR: [100, 0, 0], ...LUNGE_LEGS, shinL: [70, 0, 0], thighL: [56, -4, 10] }, { y: -0.26, z: 0.05 });
const UPPER_HIT = merge(STAND, P({ hips: [-4, 20, 0], spine: [-6, 10, 0], chest: [-8, 10, 0], neck: [-20, -8, 0], head: [-20, -8, 0], upperArmR: [154, 40, 12], foreArmR: [40, 0, 0], clavicleR: [10, 0, 20], ...handShape('R', 'fist', [0, 0, 6]), ...GUARD_L, thighL: [30, 0, 8], shinL: [20, 0, 0], footL: [-20, 0, 0], thighR: [-10, 20, 8], shinR: [6, 0, 0], footR: [-40, 0, 0], toeR: [30, 0, 0] }, { y: 0.06, z: 0.15 }));
const rush_end: ClipDef = {
  name: 'rush_end',
  dur: 0.62,
  keys: [
    { t: 0, p: RUSH_L },
    { t: 0.1, p: UPPER_CROUCH, e: 'inOut', stop: true },
    { t: 0.2, p: UPPER_HIT, e: 'snap', stop: true },
    { t: 0.36, p: offset(UPPER_HIT, {}, { y: 0.02 }), stop: true },
    { t: 0.62, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.17, 0.26], combo: [0.4, 0.62], cancel: [0.36, 0.62] },
  move: [
    [0, 0],
    [0.2, 0.6],
    [0.62, 0.65],
  ],
  events: [{ t: 0.16, name: 'whoosh', data: { pitch: 0.75 } }],
};

/* ------------------------------------------------------------------ air combo */

const AIR = merge(STAND, P({ hips: [6, -10, 0], spine: [6, -4, 0], chest: [6, -4, 0], neck: [-6, 8, 0], head: [-8, 8, 0], ...GUARD_L, ...GUARD_R, thighL: [50, -4, 8], shinL: [80, 0, 0], footL: [-20, 0, 0], thighR: [10, 20, 8], shinR: [40, 0, 0], footR: [-30, 0, 0] }));
const A1_HIT = aimArm(offset(merge(AIR, P({ ...punch('L', -30, 100), chest: [6, -16, 0] })), {}, { z: 0.05 }), 'L', AHEAD);
const air1: ClipDef = {
  name: 'air1',
  dur: 0.36,
  keys: [
    { t: 0, p: AIR },
    { t: 0.08, p: A1_HIT, e: 'snap', stop: true },
    { t: 0.16, p: A1_HIT, stop: true },
    { t: 0.36, p: AIR, e: 'inOut' },
  ],
  win: { hit: [0.06, 0.12], combo: [0.1, 0.36], cancel: [0.1, 0.36] },
  move: [
    [0, 0],
    [0.1, 0.35],
    [0.36, 0.4],
  ],
  events: [{ t: 0.05, name: 'whoosh', data: { pitch: 1.3 } }],
};
const A2_HIT = aimArm(merge(AIR, P({ ...punch('R', 24, 100), ...GUARD_L, chest: [6, 14, 0], hips: [6, 10, 0] }, { z: 0.06 })), 'R', AHEAD);
const air2: ClipDef = {
  name: 'air2',
  dur: 0.38,
  keys: [
    { t: 0, p: AIR },
    { t: 0.09, p: A2_HIT, e: 'snap', stop: true },
    { t: 0.17, p: A2_HIT, stop: true },
    { t: 0.38, p: AIR, e: 'inOut' },
  ],
  win: { hit: [0.07, 0.13], combo: [0.11, 0.38], cancel: [0.11, 0.38] },
  move: [
    [0, 0],
    [0.11, 0.35],
    [0.38, 0.4],
  ],
  events: [{ t: 0.06, name: 'whoosh', data: { pitch: 1.2 } }],
};
const A3_HIT = merge(AIR, P({ hips: [0, 50, 0], spine: [-4, 6, -10], chest: [-4, 6, -10], thighR: [10, -30, 84], shinR: [6, 0, 0], footR: [-40, 0, 0], thighL: [40, 30, 8], shinL: [90, 0, 0], neck: [-4, -36, 6], head: [-4, -30, 6] }, { ry: -20 }));
const air3: ClipDef = {
  name: 'air3',
  dur: 0.46,
  keys: [
    { t: 0, p: AIR },
    { t: 0.1, p: offset(AIR, {}, { ry: 40 }), e: 'in' },
    { t: 0.2, p: A3_HIT, e: 'snap', stop: true },
    { t: 0.28, p: A3_HIT, stop: true },
    { t: 0.46, p: AIR, e: 'inOut' },
  ],
  win: { hit: [0.17, 0.27], combo: [0.24, 0.46], cancel: [0.26, 0.46] },
  move: [
    [0, 0],
    [0.2, 0.4],
    [0.46, 0.45],
  ],
  events: [{ t: 0.15, name: 'whoosh', data: { pitch: 0.85 } }],
};
/** Double-axe-handle smash: fists clasped overhead, body arched, then hammered down (spike). */
const A4_UP = merge(STAND, P({ hips: [-10, 0, 0], spine: [-12, 0, 0], chest: [-12, 0, 0], neck: [-10, 0, 0], head: [-10, 0, 0], upperArmL: [168, -40, 12], upperArmR: [168, -40, 12], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0], ...hands('fist', 'fist', [0, 0, -20], [0, 0, -20]), thighL: [-10, 0, 6], thighR: [-16, 0, 6], shinL: [70, 0, 0], shinR: [80, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }, { rx: -14 }));
const A4_HIT = merge(STAND, P({ hips: [20, 0, 0], spine: [22, 0, 0], chest: [18, 0, 0], neck: [-24, 0, 0], head: [-14, 0, 0], upperArmL: [70, -30, 4], upperArmR: [70, -30, 4], foreArmL: [6, 0, 0], foreArmR: [6, 0, 0], clavicleL: [26, 0, 0], clavicleR: [26, 0, 0], ...hands('fist', 'fist', [0, 0, 20], [0, 0, 20]), thighL: [70, 0, 8], thighR: [64, 0, 8], shinL: [100, 0, 0], shinR: [96, 0, 0], footL: [-10, 0, 0], footR: [-10, 0, 0] }, { rx: 24, z: 0.1 }));
const air4: ClipDef = {
  name: 'air4',
  dur: 0.66,
  keys: [
    { t: 0, p: AIR },
    { t: 0.16, p: A4_UP, e: 'inOut', stop: true },
    { t: 0.26, p: A4_HIT, e: 'snap', stop: true },
    { t: 0.42, p: A4_HIT, stop: true },
    { t: 0.66, p: AIR, e: 'inOut' },
  ],
  win: { hit: [0.23, 0.32], cancel: [0.42, 0.66] },
  move: [
    [0, 0],
    [0.26, 0.5],
    [0.66, 0.5],
  ],
  events: [{ t: 0.22, name: 'whoosh', data: { pitch: 0.6 } }],
};

/* ------------------------------------------------------------------ dash attack / counters */

const KNEE = S({ hips: [6, 10, 0], spine: [12, 4, 0], chest: [10, 4, 0], neck: [-16, 0, 0], head: [-12, 0, 0], thighR: [104, -4, 10], shinR: [140, 0, 0], footR: [-30, 0, 0], thighL: [-14, 10, 8], shinL: [20, 0, 0], footL: [-36, 0, 0], toeL: [20, 0, 0], upperArmL: [70, 30, 20], upperArmR: [70, 30, 20], foreArmL: [80, 0, 0], foreArmR: [80, 0, 0], ...hands('claw', 'claw') }, { y: 0.12, z: 0.2 });
const dash_attack: ClipDef = {
  name: 'dash_attack',
  dur: 0.52,
  keys: [
    { t: 0, p: offset(STANCE, {}, { y: -0.06 }) },
    { t: 0.12, p: KNEE, e: 'snap', stop: true },
    { t: 0.24, p: KNEE, stop: true },
    { t: 0.52, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.09, 0.2], combo: [0.22, 0.52], cancel: [0.24, 0.52] },
  move: [
    [0, 0],
    [0.14, 2.2, 0, 0.25],
    [0.3, 2.5, 0, 0.1],
    [0.52, 2.6, 0, 0],
  ],
  events: [{ t: 0.08, name: 'whoosh', data: { pitch: 1.0 } }],
};
/** Vanish counter: reappear behind the target, driving a spinning back-elbow. */
const ELBOW_COIL = S({ hips: [6, 26, 0], chest: [8, 22, 0], upperArmR: [70, 80, 40], foreArmR: [150, 0, 0], ...handShape('R', 'fist', [0, 0, 20]) }, { y: -0.1, ry: 30 });
const ELBOW_HIT = S({ hips: [8, -30, 0], spine: [8, -10, 0], chest: [10, -24, 0], neck: [-8, 30, 0], head: [-10, 30, 0], upperArmR: [80, 80, 50], foreArmR: [150, 0, 0], clavicleR: [26, 0, 10], ...handShape('R', 'fist', [0, 0, 20]), ...LUNGE_LEGS }, { y: -0.14, z: 0.1 });
const dodge_counter: ClipDef = {
  name: 'dodge_counter',
  dur: 0.6,
  keys: [
    { t: 0, p: ELBOW_COIL },
    { t: 0.08, p: ELBOW_COIL, stop: true },
    { t: 0.16, p: ELBOW_HIT, e: 'snap', stop: true },
    { t: 0.32, p: ELBOW_HIT, stop: true },
    { t: 0.6, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.13, 0.22], combo: [0.3, 0.6], cancel: [0.28, 0.6], iframes: [0, 0.2] },
  move: [
    [0, 0],
    [0.16, 0.5],
    [0.6, 0.55],
  ],
  events: [
    { t: 0.0, name: 'vanish' },
    { t: 0.12, name: 'whoosh', data: { pitch: 0.9 } },
  ],
};
const parry: ClipDef = {
  name: 'parry',
  dur: 0.42,
  keys: [
    { t: 0, p: S({ upperArmL: [70, 60, 16], foreArmL: [120, 0, 0], upperArmR: [64, 70, 16], foreArmR: [126, 0, 0] }, { y: -0.1 }) },
    { t: 0.06, p: S({ hips: [6, -30, 0], chest: [6, -16, 0], upperArmL: [86, -10, 46], foreArmL: [40, 0, 0], ...handShape('L', 'blade', [0, 0, -10]), upperArmR: [30, 40, 20], foreArmR: [120, 0, 0] }, { y: -0.1 }), e: 'snap', stop: true },
    { t: 0.16, p: S({ hips: [6, -30, 0], chest: [6, -16, 0], upperArmL: [84, -10, 50], foreArmL: [44, 0, 0], ...handShape('L', 'blade', [0, 0, -10]) }, { y: -0.1 }), stop: true },
    { t: 0.42, p: STANCE, e: 'inOut' },
  ],
  win: { combo: [0.08, 0.42], cancel: [0.1, 0.42] },
  events: [{ t: 0.02, name: 'parryFlash' }],
};
const PARRY_PALM = aimArm(S({ hips: [6, 18, 0], spine: [6, 8, 0], chest: [6, 16, 0], neck: [-6, -20, 0], head: [-6, -20, 0], ...palm('R', 104, 42), ...GUARD_L, ...LUNGE_LEGS, thighL: [44, -30, 10] }, { y: -0.13, z: 0.1 }), 'R', [0, -0.05, 1]);
const parry_counter: ClipDef = {
  name: 'parry_counter',
  dur: 0.55,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.1, p: PARRY_PALM, e: 'snap', stop: true },
    { t: 0.24, p: PARRY_PALM, stop: true },
    { t: 0.55, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.08, 0.16], combo: [0.22, 0.55], cancel: [0.22, 0.55] },
  move: [
    [0, 0],
    [0.12, 0.7],
    [0.55, 0.75],
  ],
  events: [{ t: 0.08, name: 'palmBurst', data: { small: 1 } }],
};

/* ------------------------------------------------------------------ specials */

/** Rising dragon uppercut (Special, E): coil low, corkscrew up with the fist overhead. */
const DRAGON_RISE = merge(STAND, P({ hips: [-6, -20, 0], spine: [-8, -10, 0], chest: [-10, -10, 0], neck: [-26, 10, 0], head: [-24, 10, 0], upperArmR: [168, 20, 8], foreArmR: [8, 0, 0], clavicleR: [6, 0, 24], ...handShape('R', 'fist', [0, 0, 4]), upperArmL: [-20, 20, 30], foreArmL: [90, 0, 0], ...handShape('L', 'fist'), thighL: [86, 0, 8], shinL: [110, 0, 0], footL: [-30, 0, 0], thighR: [-6, 6, 4], shinR: [10, 0, 0], footR: [-50, 0, 0], toeR: [-10, 0, 0] }, { y: 0.1 }));
const special: ClipDef = {
  name: 'special',
  dur: 0.8,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.1, p: UPPER_CROUCH, e: 'inOut', stop: true },
    { t: 0.24, p: offset(DRAGON_RISE, {}, { ry: -120 }), e: 'outCubic' },
    { t: 0.42, p: offset(DRAGON_RISE, {}, { ry: -330 }), e: 'out', stop: true },
    { t: 0.58, p: offset(DRAGON_RISE, { upperArmR: [-20, 0, 0], foreArmR: [30, 0, 0] }, { ry: -360 }) },
    { t: 0.8, p: offset(STANCE, {}, { ry: -360 }), e: 'inOut' },
  ],
  win: { hit: [0.16, 0.42], cancel: [0.6, 0.8], armor: [0.1, 0.42] },
  move: [
    [0, 0],
    [0.1, 0, 0, 0],
    [0.3, 0.8, 0, 1.6],
    [0.48, 1.0, 0, 2.0],
    [0.8, 1.1, 0, 0],
  ],
  events: [
    { t: 0.12, name: 'dragonRise' },
    { t: 0.14, name: 'whoosh', data: { pitch: 0.7 } },
  ],
};

/** EX Special "Meteor Crash": vanish above the target, forward flip, axe kick that cratters the ground. */
const FLIP_TUCK = merge(STAND, P({ hips: [30, 0, 0], spine: [20, 0, 0], chest: [16, 0, 0], neck: [10, 0, 0], head: [10, 0, 0], upperArmL: [60, 40, 20], upperArmR: [60, 40, 20], foreArmL: [120, 0, 0], foreArmR: [120, 0, 0], ...hands('fist', 'fist'), thighL: [120, 0, 10], thighR: [120, 0, 10], shinL: [140, 0, 0], shinR: [140, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }));
const AXE_UP = merge(STAND, P({ hips: [-8, 0, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], neck: [-16, 0, 0], head: [-14, 0, 0], thighR: [162, -6, 8], shinR: [6, 0, 0], footR: [-30, 0, 0], thighL: [-14, 4, 6], shinL: [30, 0, 0], footL: [-40, 0, 0], upperArmL: [10, 10, 60], upperArmR: [10, 10, 60], foreArmL: [30, 0, 0], foreArmR: [30, 0, 0], ...hands('spread', 'spread') }));
const AXE_HIT = merge(STAND, P({ hips: [20, 0, 0], spine: [16, 0, 0], chest: [10, 0, 0], neck: [-24, 0, 0], head: [-18, 0, 0], thighR: [40, -6, 8], shinR: [4, 0, 0], footR: [-10, 0, 0], thighL: [-20, 10, 10], shinL: [70, 0, 0], footL: [-30, 0, 0], upperArmL: [-30, 10, 50], upperArmR: [-30, 10, 50], foreArmL: [30, 0, 0], foreArmR: [30, 0, 0], ...hands('fist', 'fist') }, { y: 0.0 }));
const METEOR_LAND = S({ hips: [24, 0, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-16, 0, 0], thighL: [80, -4, 16], shinL: [110, 0, 0], footL: [30, 0, -6], thighR: [30, 20, 18], shinR: [120, 0, 0], footR: [-20, 0, 0], toeR: [30, 0, 0], upperArmL: [30, 20, 50], upperArmR: [30, 20, 50], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0] }, { y: -0.42 });
const ex_special: ClipDef = {
  name: 'ex_special',
  dur: 1.25,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.08, p: offset(STANCE, {}, { y: -0.1 }), stop: true },
    { t: 0.14, p: FLIP_TUCK, e: 'out' },
    { t: 0.36, p: offset(FLIP_TUCK, {}, { rx: 300 }), e: 'inOut' },
    { t: 0.48, p: offset(AXE_UP, {}, { rx: 360 }), e: 'outCubic', stop: true },
    { t: 0.6, p: offset(AXE_HIT, {}, { rx: 360 }), e: 'inExpo', stop: true },
    { t: 0.68, p: offset(METEOR_LAND, {}, { rx: 360 }), e: 'outCubic', stop: true },
    { t: 0.9, p: offset(METEOR_LAND, { head: [-6, 0, 0] }, { rx: 360, y: 0.02 }), stop: true },
    { t: 1.25, p: offset(STANCE, {}, { rx: 360 }), e: 'inOut' },
  ],
  win: { hit: [0.55, 0.68], cancel: [0.9, 1.25], iframes: [0, 0.62] },
  events: [
    { t: 0.08, name: 'vanish', data: { above: 1 } },
    { t: 0.5, name: 'whoosh', data: { pitch: 0.5 } },
    { t: 0.62, name: 'meteorImpact' },
  ],
};

/** Hold E: fist cocked at the hip, body coiled — release = Dragon Fist. */
const HEAVY_COIL = S({ hips: [10, -40, 0], spine: [8, -16, 0], chest: [8, -18, 0], neck: [-8, 30, 0], head: [-10, 30, 0], upperArmR: [-40, 30, 22], foreArmR: [112, 10, 0], ...handShape('R', 'fist', [0, 0, 16]), upperArmL: [72, 50, 18], foreArmL: [96, 0, 0], ...handShape('L', 'open'), thighL: [36, -4, 14], shinL: [50, 0, 0], thighR: [-14, 34, 16], shinR: [34, 0, 0] }, { y: -0.15 });
const heavy_charge: ClipDef = {
  name: 'heavy_charge',
  dur: 0.6,
  loop: true,
  keys: [
    { t: 0, p: HEAVY_COIL },
    { t: 0.3, p: offset(HEAVY_COIL, { chest: [1, -1, 0], upperArmR: [-2, 0, 0] }, { y: -0.01 }) },
    { t: 0.6, p: HEAVY_COIL },
  ],
};
const DRAGON_FIST = aimArm(S({ hips: [8, 22, 0], spine: [6, 8, 0], chest: [6, 14, 0], upperChest: [4, 4, 0], neck: [-6, -22, 0], head: [-6, -22, 0], ...punch('R', 48, 110), clavicleR: [32, 0, 4], ...chamber('L'), ...LUNGE_LEGS, thighL: [50, -34, 12], shinL: [56, 0, 0] }, { y: -0.18, z: 0.15 }), 'R', [0, 0.02, 1]);
const heavy_release: ClipDef = {
  name: 'heavy_release',
  dur: 0.8,
  keys: [
    { t: 0, p: HEAVY_COIL },
    { t: 0.08, p: DRAGON_FIST, e: 'snap', stop: true },
    { t: 0.4, p: offset(DRAGON_FIST, { foreArmR: [4, 0, 0] }), stop: true },
    { t: 0.8, p: STANCE, e: 'inOut' },
  ],
  win: { hit: [0.06, 0.16], cancel: [0.42, 0.8], armor: [0, 0.12] },
  move: [
    [0, 0],
    [0.1, 1.6],
    [0.8, 1.7],
  ],
  events: [
    { t: 0.05, name: 'whoosh', data: { pitch: 0.5 } },
    { t: 0.08, name: 'dragonFist' },
  ],
};

/* ------------------------------------------------------------------ guard */

/** Crossed-forearm guard. */
const GUARD = S({ hips: [8, -10, 0], spine: [8, -2, 0], chest: [10, -2, 0], neck: [-6, 6, 0], head: [-14, 8, 0], upperArmL: [74, 66, 16], foreArmL: [122, 10, 0], upperArmR: [68, 72, 14], foreArmR: [128, 10, 0], ...hands('fist', 'fist', [0, 0, 18], [0, 0, 18]), thighL: [32, -4, 14], shinL: [44, 0, 0], thighR: [-6, 34, 18], shinR: [32, 0, 0] }, { y: -0.12 });
const guard: ClipDef = {
  name: 'guard',
  dur: 1.0,
  loop: true,
  keys: [
    { t: 0, p: GUARD },
    { t: 0.5, p: offset(GUARD, { chest: [1, 0, 0] }, { y: -0.008 }) },
    { t: 1.0, p: GUARD },
  ],
};
const guard_hit: ClipDef = {
  name: 'guard_hit',
  dur: 0.26,
  keys: [
    { t: 0, p: GUARD },
    { t: 0.05, p: offset(GUARD, { spine: [-8, 0, 0], chest: [-6, 0, 0], head: [-6, 0, 0], upperArmL: [-6, 0, 0], upperArmR: [-6, 0, 0] }, { y: -0.03, z: -0.05 }), e: 'snap', stop: true },
    { t: 0.26, p: GUARD, e: 'inOut' },
  ],
  move: [
    [0, 0],
    [0.08, -0.35],
    [0.26, -0.4],
  ],
};
const guard_break: ClipDef = {
  name: 'guard_break',
  dur: 0.8,
  keys: [
    { t: 0, p: GUARD },
    { t: 0.08, p: merge(STAND, P({ hips: [-10, 0, 0], spine: [-14, 0, 0], chest: [-12, 0, 0], neck: [-14, 0, 0], head: [-12, 0, 0], upperArmL: [30, -30, 70], upperArmR: [30, -30, 70], foreArmL: [20, 0, 0], foreArmR: [20, 0, 0], ...hands('spread', 'spread'), ...STANCE_LEGS }, { y: -0.05 })), e: 'snap', stop: true },
    { t: 0.45, p: merge(STAND, P({ hips: [6, 0, 0], spine: [8, 0, 0], upperArmL: [10, 10, 20], upperArmR: [10, 10, 20], foreArmL: [30, 0, 0], foreArmR: [30, 0, 0], ...STANCE_LEGS }, { y: -0.08 })), e: 'inOut' },
    { t: 0.8, p: STANCE, e: 'inOut' },
  ],
  move: [
    [0, 0],
    [0.15, -0.8],
    [0.8, -0.9],
  ],
};

export const COMBAT: ClipDef[] = [
  light1,
  light2,
  light3,
  light4,
  light5,
  rush,
  rush_end,
  air1,
  air2,
  air3,
  air4,
  dash_attack,
  dodge_counter,
  parry,
  parry_counter,
  special,
  ex_special,
  heavy_charge,
  heavy_release,
  guard,
  guard_hit,
  guard_break,
];

function offsetArm(b: B, key: keyof B, d: [number, number, number]): B {
  const v = b[key]!;
  return { ...b, [key]: [v[0] + d[0], v[1] + d[1], v[2] + d[2]] };
}

export { POWER_STANCE, mirror };
