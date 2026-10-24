import type { ClipDef } from '../Clip.ts';
import { P, STAND, STANCE, HOVER, GUARD_L, GUARD_R, hands, merge, mirror, offset, type B } from '../poses.ts';

const S = (b: B, root?: Parameters<typeof P>[1]) => merge(STANCE, P(b, root));
const U = (b: B, root?: Parameters<typeof P>[1]) => merge(STAND, P(b, root));

/* ------------------------------------------------------------------ idles */

const idle: ClipDef = {
  name: 'idle',
  dur: 2.0,
  loop: true,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.5, p: offset(STANCE, { chest: [2, 0, 0], upperArmL: [-3, 0, -2], upperArmR: [-3, 0, -2], head: [2, 0, 0], shinL: [4, 0, 0], shinR: [3, 0, 0], thighL: [2, 0, 0] }, { y: -0.018 }) },
    { t: 1.0, p: offset(STANCE, { hips: [0, -2, 0], chest: [0, 2, 0] }, { y: -0.004 }) },
    { t: 1.5, p: offset(STANCE, { chest: [2, -1, 0], upperArmL: [-2, 0, -1], upperArmR: [-4, 0, -2], shinL: [4, 0, 0], shinR: [4, 0, 0], thighL: [2, 0, 0] }, { y: -0.02 }) },
    { t: 2.0, p: STANCE },
  ],
};

/** Contrapposto rest: weight on the right leg, head looking around. */
const REST = U(
  {
    hips: [0, 4, 0],
    spine: [2, -2, -2],
    chest: [-2, 0, -2],
    neck: [4, 0, 2],
    upperArmL: [2, 10, 10],
    upperArmR: [6, 12, 12],
    foreArmL: [18, 25, 0],
    foreArmR: [24, 25, 0],
    thighL: [8, 14, 2],
    shinL: [16, 0, 0],
    footL: [-4, 0, 14],
    thighR: [-2, 4, 6],
    shinR: [2, 0, 0],
  },
  { x: -0.02, rz: 2.5 },
);
const idle_relaxed: ClipDef = {
  name: 'idle_relaxed',
  dur: 4.0,
  loop: true,
  keys: [
    { t: 0, p: REST },
    { t: 1.2, p: offset(REST, { head: [2, 18, 0], neck: [0, 8, 0], chest: [-1, 0, 0] }, { y: -0.006 }) },
    { t: 2.0, p: offset(REST, { head: [0, 10, 0] }) },
    { t: 3.0, p: offset(REST, { head: [-3, -16, 0], neck: [0, -6, 0], chest: [-1, 0, 0] }, { y: -0.006 }) },
    { t: 4.0, p: REST },
  ],
};

/* ------------------------------------------------------------------ walk (1.6 m/s) */

const WALK_CONTACT_L = U(
  {
    hips: [2, -5, 0],
    spine: [2, 2, 0],
    chest: [2, 5, 0],
    neck: [2, -2, 0],
    upperArmL: [-16, 10, 10],
    upperArmR: [20, 10, 10],
    foreArmL: [18, 20, 0],
    foreArmR: [28, 20, 0],
    thighL: [26, 2, 3],
    shinL: [4, 0, 0],
    footL: [14, 0, 3],
    thighR: [-16, 6, 3],
    shinR: [14, 0, 0],
    footR: [-14, 0, 3],
    toeR: [24, 0, 0],
  },
  { y: -0.025 },
);
const WALK_PASS_L = U(
  {
    hips: [2, 0, 0],
    spine: [2, 0, 0],
    upperArmL: [2, 10, 10],
    upperArmR: [4, 10, 10],
    foreArmL: [20, 20, 0],
    foreArmR: [22, 20, 0],
    thighL: [2, 2, 3],
    shinL: [6, 0, 0],
    footL: [2, 0, 3],
    thighR: [16, 6, 3],
    shinR: [48, 0, 0],
    footR: [6, 0, 3],
  },
  { y: 0.008, rz: -1.5 },
);
const walk: ClipDef = {
  name: 'walk',
  dur: 1.0,
  loop: true,
  speed: 1.6,
  keys: [
    { t: 0, p: WALK_CONTACT_L },
    { t: 0.25, p: WALK_PASS_L },
    { t: 0.5, p: mirror(WALK_CONTACT_L) },
    { t: 0.75, p: mirror(WALK_PASS_L) },
    { t: 1.0, p: WALK_CONTACT_L },
  ],
  events: [
    { t: 0.0, name: 'step', data: { foot: 'L' } },
    { t: 0.5, name: 'step', data: { foot: 'R' } },
  ],
};

/* ------------------------------------------------------------------ run (5.5 m/s) */

const RUN_ARMS = (fwdR: number, fwdL: number): B => ({
  upperArmR: [fwdR, 18, 14],
  upperArmL: [fwdL, 18, 14],
  foreArmR: [fwdR > 0 ? 95 : 70, 20, 0],
  foreArmL: [fwdL > 0 ? 95 : 70, 20, 0],
  ...hands('fist', 'fist', [0, 0, 10], [0, 0, 10]),
});
const RUN_TORSO = (tw: number): B => ({ hips: [6, -tw * 0.6, 0], spine: [6, tw * 0.3, 0], chest: [4, tw, 0], upperChest: [2, 0, 0], neck: [-6, -tw * 0.5, 0], head: [-6, -tw * 0.3, 0] });

const RUN_CONTACT_L = U({ ...RUN_TORSO(9), ...RUN_ARMS(48, -36), thighL: [38, 0, 3], shinL: [14, 0, 0], footL: [10, 0, 2], thighR: [-22, 6, 3], shinR: [72, 0, 0], footR: [-16, 0, 2], toeR: [10, 0, 0] }, { y: -0.035 });
const RUN_MID_L = U({ ...RUN_TORSO(3), ...RUN_ARMS(18, -8), thighL: [12, 0, 3], shinL: [40, 0, 0], footL: [12, 0, 2], thighR: [34, 6, 3], shinR: [108, 0, 0], footR: [0, 0, 2] }, { y: -0.075 });
const RUN_TOEOFF_L = U({ ...RUN_TORSO(-4), ...RUN_ARMS(-22, 30), thighL: [-26, 0, 3], shinL: [18, 0, 0], footL: [-30, 0, 2], toeL: [30, 0, 0], thighR: [54, 6, 3], shinR: [72, 0, 0], footR: [8, 0, 2] }, { y: -0.02 });
const RUN_FLIGHT_L = U({ ...RUN_TORSO(-8), ...RUN_ARMS(-34, 44), thighL: [-30, 0, 3], shinL: [62, 0, 0], footL: [-14, 0, 2], thighR: [46, 6, 3], shinR: [30, 0, 0], footR: [10, 0, 2] }, { y: 0.01 });

const run: ClipDef = {
  name: 'run',
  dur: 0.66,
  loop: true,
  speed: 5.5,
  keys: [
    { t: 0, p: RUN_CONTACT_L },
    { t: 0.08, p: RUN_MID_L },
    { t: 0.165, p: RUN_TOEOFF_L },
    { t: 0.25, p: RUN_FLIGHT_L },
    { t: 0.33, p: mirror(RUN_CONTACT_L) },
    { t: 0.41, p: mirror(RUN_MID_L) },
    { t: 0.495, p: mirror(RUN_TOEOFF_L) },
    { t: 0.58, p: mirror(RUN_FLIGHT_L) },
    { t: 0.66, p: RUN_CONTACT_L },
  ],
  events: [
    { t: 0.0, name: 'step', data: { foot: 'L' } },
    { t: 0.33, name: 'step', data: { foot: 'R' } },
  ],
};

/* ------------------------------------------------------------------ ninja sprint (11 m/s) */

/** Body pitched ~38° forward, head held level, both arms straight back, palms up. */
const SPRINT_UPPER: B = {
  hips: [6, 0, 0],
  spine: [6, 0, 0],
  chest: [4, 0, 0],
  upperChest: [0, 0, 0],
  neck: [-22, 0, 0],
  head: [-20, 0, 0],
  clavicleL: [-14, 0, 6],
  clavicleR: [-14, 0, 6],
  upperArmL: [-68, -12, 14],
  upperArmR: [-68, -12, 14],
  foreArmL: [7, -40, 0],
  foreArmR: [7, -40, 0],
  ...hands('blade', 'blade', [0, 0, -18], [0, 0, -18]),
};
const SPRINT_CONTACT_L = U({ ...SPRINT_UPPER, thighL: [62, 0, 3], shinL: [34, 0, 0], footL: [12, 0, 0], thighR: [-6, 4, 3], shinR: [70, 0, 0], footR: [-24, 0, 0], toeR: [16, 0, 0] }, { y: -0.12, rx: 28 });
const SPRINT_MID_L = U({ ...SPRINT_UPPER, upperArmL: [-70, -12, 16], upperArmR: [-66, -12, 12], thighL: [32, 0, 3], shinL: [52, 0, 0], footL: [6, 0, 0], thighR: [80, 4, 3], shinR: [128, 0, 0], footR: [-10, 0, 0] }, { y: -0.16, rx: 30 });
const SPRINT_PUSH_L = U({ ...SPRINT_UPPER, thighL: [-4, 0, 3], shinL: [22, 0, 0], footL: [-34, 0, 0], toeL: [34, 0, 0], thighR: [92, 4, 3], shinR: [100, 0, 0], footR: [0, 0, 0] }, { y: -0.1, rx: 29 });

const sprint: ClipDef = {
  name: 'sprint',
  dur: 0.42,
  loop: true,
  speed: 11,
  keys: [
    { t: 0, p: SPRINT_CONTACT_L },
    { t: 0.07, p: SPRINT_MID_L },
    { t: 0.14, p: SPRINT_PUSH_L },
    { t: 0.21, p: mirror(SPRINT_CONTACT_L) },
    { t: 0.28, p: mirror(SPRINT_MID_L) },
    { t: 0.35, p: mirror(SPRINT_PUSH_L) },
    { t: 0.42, p: SPRINT_CONTACT_L },
  ],
  events: [
    { t: 0.0, name: 'step', data: { foot: 'L', dust: 1 } },
    { t: 0.21, name: 'step', data: { foot: 'R', dust: 1 } },
  ],
};

/* ------------------------------------------------------------------ combat footwork */

const STRAFE_A = S({ thighL: [26, -4, 22], shinL: [34, 0, 0], footL: [10, 0, -10], thighR: [-8, 30, 4], shinR: [22, 0, 0] }, { y: -0.08, x: 0.04, rz: -3 });
const STRAFE_B = S({ thighL: [26, -4, 6], shinL: [38, 0, 0], thighR: [-8, 30, 22], shinR: [30, 0, 0], footR: [6, 0, -8] }, { y: -0.075, x: -0.03, rz: 2 });
const strafe_left: ClipDef = {
  name: 'strafe_left',
  dur: 0.6,
  loop: true,
  speed: 3.2,
  keys: [
    { t: 0, p: STRAFE_A },
    { t: 0.3, p: STRAFE_B },
    { t: 0.6, p: STRAFE_A },
  ],
};
const strafe_right: ClipDef = { ...strafe_left, name: 'strafe_right', keys: strafe_left.keys.map((k) => ({ ...k, p: mirror(k.p) })) };

const BACK_A = S({ thighL: [20, -4, 9], shinL: [30, 0, 0], footL: [-6, 0, 0], thighR: [-20, 30, 13], shinR: [30, 0, 0], footR: [-6, 0, 0], toeR: [24, 0, 0] }, { y: -0.08 });
const BACK_B = S({ thighL: [34, -4, 9], shinL: [24, 0, 0], footL: [16, 0, 0], thighR: [0, 30, 13], shinR: [40, 0, 0], footR: [10, 0, 0] }, { y: -0.065 });
const backpedal: ClipDef = {
  name: 'backpedal',
  dur: 0.7,
  loop: true,
  speed: 2.8,
  keys: [
    { t: 0, p: BACK_A },
    { t: 0.35, p: BACK_B },
    { t: 0.7, p: BACK_A },
  ],
};

const STEP_IN = S({ thighL: [40, -4, 9], shinL: [30, 0, 0], footL: [16, 0, -4] }, { y: -0.08 });
const advance: ClipDef = {
  name: 'advance',
  dur: 0.6,
  loop: true,
  speed: 3.0,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.3, p: STEP_IN },
    { t: 0.6, p: STANCE },
  ],
};

/* ------------------------------------------------------------------ ninja jump */

const JUMP_CROUCH = U(
  {
    hips: [18, 0, 0],
    spine: [12, 0, 0],
    chest: [6, 0, 0],
    neck: [-10, 0, 0],
    head: [-14, 0, 0],
    upperArmL: [-38, 6, 22],
    upperArmR: [-38, 6, 22],
    foreArmL: [24, 10, 0],
    foreArmR: [24, 10, 0],
    ...hands('relaxed', 'relaxed'),
    thighL: [62, 4, 8],
    thighR: [58, 4, 8],
    shinL: [96, 0, 0],
    shinR: [92, 0, 0],
    footL: [34, 0, 4],
    footR: [32, 0, 4],
  },
  { y: -0.27 },
);
/** One-leg ninja jump: loose T-pose arms, lead knee tucked high, trail leg long with pointed toe. */
const JUMP_NINJA = U(
  {
    hips: [-2, 4, 0],
    spine: [6, 0, 0],
    chest: [4, 0, 0],
    upperChest: [0, 0, 0],
    neck: [-4, 0, 0],
    head: [-6, 0, 0],
    clavicleL: [0, 0, 6],
    clavicleR: [0, 0, 6],
    upperArmL: [8, -4, 78],
    upperArmR: [8, -4, 80],
    foreArmL: [18, 10, 0],
    foreArmR: [16, 10, 0],
    ...hands('relaxed', 'relaxed', [0, 0, 26], [0, 0, 24]),
    thighL: [102, 2, 6],
    shinL: [124, 0, 0],
    footL: [-30, 0, 0],
    toeL: [-10, 0, 0],
    thighR: [-12, 4, 4],
    shinR: [14, 0, 0],
    footR: [-42, 0, 0],
    toeR: [-16, 0, 0],
  },
  { y: 0.04 },
);
const JUMP_LAUNCH = U(
  {
    hips: [-4, 0, 0],
    spine: [0, 0, 0],
    neck: [-6, 0, 0],
    head: [-8, 0, 0],
    upperArmL: [60, -4, 40],
    upperArmR: [60, -4, 40],
    foreArmL: [14, 10, 0],
    foreArmR: [14, 10, 0],
    ...hands('relaxed', 'relaxed', [0, 0, 10], [0, 0, 10]),
    thighL: [40, 2, 5],
    shinL: [40, 0, 0],
    footL: [-30, 0, 0],
    thighR: [-4, 4, 4],
    shinR: [4, 0, 0],
    footR: [-44, 0, 0],
    toeR: [-12, 0, 0],
  },
  { y: 0.02 },
);
const jump_start: ClipDef = {
  name: 'jump_start',
  dur: 0.12,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.1, p: JUMP_CROUCH, stop: true },
    { t: 0.12, p: JUMP_CROUCH },
  ],
};
const jump_rise: ClipDef = {
  name: 'jump_rise',
  dur: 0.42,
  keys: [
    { t: 0, p: JUMP_CROUCH, e: 'outCubic' },
    { t: 0.09, p: JUMP_LAUNCH, e: 'out' },
    { t: 0.26, p: JUMP_NINJA, stop: true },
    { t: 0.42, p: offset(JUMP_NINJA, { upperArmL: [0, 0, 4], upperArmR: [0, 0, 4], thighL: [4, 0, 0] }, { y: 0.01 }), stop: true },
  ],
  events: [{ t: 0.0, name: 'takeoff' }],
};
const FALL = offset(JUMP_NINJA, { thighL: [-36, 0, 0], shinL: [-46, 0, 0], footL: [6, 0, 0], thighR: [4, 0, 0], shinR: [14, 0, 0], upperArmL: [4, 0, 12], upperArmR: [4, 0, 12], foreArmL: [10, 0, 0], foreArmR: [10, 0, 0] });
const jump_fall: ClipDef = {
  name: 'jump_fall',
  dur: 0.9,
  loop: true,
  keys: [
    { t: 0, p: FALL },
    { t: 0.45, p: offset(FALL, { upperArmL: [0, 0, 5], upperArmR: [0, 0, 3], thighL: [3, 0, 0], shinL: [4, 0, 0] }, { y: 0.008 }) },
    { t: 0.9, p: FALL },
  ],
};
const LAND = S({ hips: [16, -12, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [-12, 6, 0], head: [-10, 8, 0], thighL: [62, -4, 12], shinL: [96, 0, 0], footL: [30, 0, -6], thighR: [44, 30, 16], shinR: [92, 0, 0], footR: [40, 0, 0], upperArmL: [30, 20, 38], upperArmR: [24, 26, 40], foreArmL: [50, 20, 0], foreArmR: [60, 20, 0] }, { y: -0.27 });
const land: ClipDef = {
  name: 'land',
  dur: 0.34,
  keys: [
    { t: 0, p: FALL },
    { t: 0.07, p: LAND, e: 'outCubic', stop: true },
    { t: 0.34, p: STANCE, e: 'inOut' },
  ],
  events: [{ t: 0.04, name: 'land' }],
  win: { cancel: [0.12, 0.34] },
};
/** Three-point superhero landing with the right fist on the ground. */
const LAND_HARD = U(
  {
    hips: [30, -10, 0],
    spine: [16, 0, 0],
    chest: [12, 0, 0],
    neck: [-20, 0, 0],
    head: [-22, 6, 0],
    upperArmR: [56, 30, 14],
    foreArmR: [12, 20, 0],
    upperArmL: [-30, 10, 52],
    foreArmL: [30, 10, 0],
    ...hands('spread', 'fist', [0, 0, -10], [0, 0, 20]),
    thighL: [96, -6, 18],
    shinL: [124, 0, 0],
    footL: [30, 0, -10],
    thighR: [22, 20, 18],
    shinR: [138, 0, 0],
    footR: [-30, 0, 0],
    toeR: [40, 0, 0],
  },
  { y: -0.5 },
);
const land_hard: ClipDef = {
  name: 'land_hard',
  dur: 0.95,
  keys: [
    { t: 0, p: FALL },
    { t: 0.08, p: LAND_HARD, e: 'outCubic', stop: true },
    { t: 0.45, p: offset(LAND_HARD, { head: [-4, 0, 0], chest: [-2, 0, 0] }, { y: 0.01 }), stop: true },
    { t: 0.95, p: STANCE, e: 'inOut' },
  ],
  events: [{ t: 0.05, name: 'land', data: { hard: 1 } }],
  win: { cancel: [0.5, 0.95] },
};

/* ------------------------------------------------------------------ flight */

const hover: ClipDef = {
  name: 'hover',
  dur: 2.0,
  loop: true,
  keys: [
    { t: 0, p: HOVER },
    { t: 0.5, p: offset(HOVER, { thighL: [-6, 0, 0], shinL: [-8, 0, 0], thighR: [6, 0, 0], shinR: [10, 0, 0], upperArmL: [0, 0, 3], upperArmR: [0, 0, 2] }, { y: 0.035 }) },
    { t: 1.0, p: offset(HOVER, { chest: [1, 0, 0] }, { y: 0.05 }) },
    { t: 1.5, p: offset(HOVER, { thighL: [6, 0, 0], shinL: [8, 0, 0], thighR: [-4, 0, 0], shinR: [-6, 0, 0], upperArmL: [0, 0, 2], upperArmR: [0, 0, 3] }, { y: 0.02 }) },
    { t: 2.0, p: HOVER },
  ],
};

/** Superman flight: lead fist forward, other arm along the body, legs together, one knee soft. */
const FLY = U(
  {
    hips: [-2, 0, 0],
    spine: [-4, 0, 0],
    chest: [-4, 0, 0],
    upperChest: [-4, 0, 0],
    neck: [-26, 0, 0],
    head: [-26, 0, 0],
    clavicleR: [10, 0, 8],
    clavicleL: [-4, 0, 0],
    upperArmR: [172, -4, 6],
    foreArmR: [6, -10, 0],
    upperArmL: [-14, 16, 10],
    foreArmL: [16, 30, 0],
    ...hands('relaxed', 'fist', [0, 0, 18], [0, 0, 4]),
    thighL: [2, 4, 2],
    thighR: [-2, 4, 1],
    shinL: [8, 0, 0],
    shinR: [26, 0, 0],
    footL: [-48, 0, 0],
    footR: [-44, 0, 0],
    toeL: [-14, 0, 0],
    toeR: [-14, 0, 0],
  },
  { rx: 76, y: 0 },
);
/** Slow groove: a travelling wave through hips → spine → chest and alternating soft knee flutter. */
const fly_fwd: ClipDef = {
  name: 'fly_fwd',
  dur: 1.8,
  loop: true,
  keys: [
    { t: 0, p: FLY },
    { t: 0.45, p: offset(FLY, { hips: [0, 2, 1.5], spine: [1, 0, -2], chest: [1, -1, -2], shinL: [8, 0, 0], shinR: [-8, 0, 0], thighL: [3, 0, 0], upperArmL: [3, 0, 2] }, { y: 0.02, rz: 2 }) },
    { t: 0.9, p: offset(FLY, { spine: [2, 0, 0], chest: [2, 0, 0], thighR: [2, 0, 0] }, { y: 0.03 }) },
    { t: 1.35, p: offset(FLY, { hips: [0, -2, -1.5], spine: [1, 0, 2], chest: [1, 1, 2], shinL: [-4, 0, 0], shinR: [6, 0, 0], upperArmL: [-2, 0, 1] }, { y: 0.015, rz: -2 }) },
    { t: 1.8, p: FLY },
  ],
};
const FLY_FAST = offset(FLY, { upperArmL: [-14, 0, -6], foreArmL: [-10, 0, 0], shinR: [-16, 0, 0], thighR: [2, 0, 0], neck: [-4, 0, 0], head: [-2, 0, 0], ...hands('blade', 'fist', [0, 0, -6], [0, 0, 4]) }, { rx: 8 });
const fly_fast: ClipDef = {
  name: 'fly_fast',
  dur: 0.9,
  loop: true,
  keys: [
    { t: 0, p: FLY_FAST },
    { t: 0.225, p: offset(FLY_FAST, { hips: [0, 1.5, 1], chest: [0, -1, -1.5], shinL: [4, 0, 0] }, { rz: 1.5 }) },
    { t: 0.45, p: offset(FLY_FAST, { chest: [1, 0, 0] }, { y: 0.01 }) },
    { t: 0.675, p: offset(FLY_FAST, { hips: [0, -1.5, -1], chest: [0, 1, 1.5], shinR: [4, 0, 0] }, { rz: -1.5 }) },
    { t: 0.9, p: FLY_FAST },
  ],
};
const FLY_UP = U(
  {
    hips: [-4, 0, 0],
    spine: [-4, 0, 0],
    chest: [-4, 0, 0],
    neck: [-14, 0, 0],
    head: [-18, 0, 0],
    clavicleR: [0, 0, 12],
    upperArmR: [176, -4, 4],
    foreArmR: [4, -10, 0],
    upperArmL: [-8, 14, 12],
    foreArmL: [20, 30, 0],
    ...hands('relaxed', 'fist', [0, 0, 16], [0, 0, 4]),
    thighL: [0, 4, 2],
    thighR: [-4, 4, 1],
    shinL: [6, 0, 0],
    shinR: [20, 0, 0],
    footL: [-50, 0, 0],
    footR: [-46, 0, 0],
  },
  { rx: -4 },
);
const fly_up: ClipDef = {
  name: 'fly_up',
  dur: 1.2,
  loop: true,
  keys: [
    { t: 0, p: FLY_UP },
    { t: 0.6, p: offset(FLY_UP, { shinR: [-8, 0, 0], shinL: [6, 0, 0], hips: [0, 2, 0] }) },
    { t: 1.2, p: FLY_UP },
  ],
};
const FLY_DOWN = U(
  {
    hips: [6, 0, 0],
    spine: [8, 0, 0],
    chest: [6, 0, 0],
    neck: [6, 0, 0],
    head: [10, 0, 0],
    upperArmL: [10, 0, 34],
    upperArmR: [10, 0, 34],
    foreArmL: [24, 20, 0],
    foreArmR: [24, 20, 0],
    ...hands('open', 'open', [0, 0, -14], [0, 0, -14]),
    thighL: [16, 4, 4],
    thighR: [8, 4, 4],
    shinL: [30, 0, 0],
    shinR: [18, 0, 0],
    footL: [-20, 0, 0],
    footR: [-18, 0, 0],
  },
  { rx: -6 },
);
const fly_down: ClipDef = {
  name: 'fly_down',
  dur: 1.2,
  loop: true,
  keys: [
    { t: 0, p: FLY_DOWN },
    { t: 0.6, p: offset(FLY_DOWN, { upperArmL: [0, 0, 4], upperArmR: [0, 0, 4] }, { y: 0.01 }) },
    { t: 1.2, p: FLY_DOWN },
  ],
};
const FLY_BACK = offset(HOVER, { hips: [-10, 0, 0], spine: [-6, 0, 0], neck: [10, 0, 0], head: [8, 0, 0], thighL: [24, 0, 0], thighR: [18, 0, 0], shinL: [10, 0, 0], upperArmL: [20, 0, 10], upperArmR: [20, 0, 10] }, { rx: -16 });
const fly_back: ClipDef = {
  name: 'fly_back',
  dur: 1.4,
  loop: true,
  keys: [
    { t: 0, p: FLY_BACK },
    { t: 0.7, p: offset(FLY_BACK, { thighL: [-6, 0, 0], thighR: [6, 0, 0] }, { y: 0.02 }) },
    { t: 1.4, p: FLY_BACK },
  ],
};
/** Lateral flight: torso banks into the turn, arms counterbalance. */
const FLY_SIDE_L = offset(HOVER, { spine: [0, 0, -6], chest: [0, 0, -6], neck: [0, 0, 8], upperArmR: [6, 0, 26], upperArmL: [-6, 0, 10], thighL: [6, 0, 10], thighR: [-2, 0, -2] }, { rz: -22, rx: 8 });
const fly_left: ClipDef = {
  name: 'fly_left',
  dur: 1.2,
  loop: true,
  keys: [
    { t: 0, p: FLY_SIDE_L },
    { t: 0.6, p: offset(FLY_SIDE_L, { shinL: [6, 0, 0] }, { y: 0.02 }) },
    { t: 1.2, p: FLY_SIDE_L },
  ],
};
const fly_right: ClipDef = { ...fly_left, name: 'fly_right', keys: fly_left.keys.map((k) => ({ ...k, p: mirror(k.p) })) };

/* ------------------------------------------------------------------ export */

export const LOCOMOTION: ClipDef[] = [
  idle,
  idle_relaxed,
  walk,
  run,
  sprint,
  strafe_left,
  strafe_right,
  backpedal,
  advance,
  jump_start,
  jump_rise,
  jump_fall,
  land,
  land_hard,
  hover,
  fly_fwd,
  fly_fast,
  fly_up,
  fly_down,
  fly_back,
  fly_left,
  fly_right,
];

export { GUARD_L, GUARD_R };
