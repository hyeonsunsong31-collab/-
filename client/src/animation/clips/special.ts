import type { ClipDef } from '../Clip.ts';
import { P, STAND, STANCE, POWER_STANCE, GUARD_L, GUARD_R, STANCE_LEGS, hands, handShape, merge, mirror, offset, type B } from '../poses.ts';
import type { RootXf } from '../Pose.ts';
import { aimArm, aimBoth } from '../aim.ts';

const S = (b: B, root?: RootXf) => merge(STANCE, P(b, root));
const U = (b: B, root?: RootXf) => merge(STAND, P(b, root));

/* ------------------------------------------------------------------ dodges (Q) */

/** Forward dash: low streamlined lunge with arms swept back (afterimages + zip lines in gameplay). */
const DASH_F = U({ hips: [14, 0, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [-24, 0, 0], head: [-18, 0, 0], upperArmL: [-50, -10, 22], upperArmR: [-50, -10, 22], foreArmL: [20, 0, 0], foreArmR: [20, 0, 0], ...hands('blade', 'blade', [0, 0, -12], [0, 0, -12]), thighL: [52, -4, 8], shinL: [70, 0, 0], footL: [20, 0, 0], thighR: [-34, 10, 8], shinR: [30, 0, 0], footR: [-30, 0, 0], toeR: [30, 0, 0] }, { y: -0.18, rx: 14 });
const dash_f: ClipDef = {
  name: 'dash_f',
  dur: 0.34,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.05, p: DASH_F, e: 'outCubic' },
    { t: 0.2, p: offset(DASH_F, {}, { y: 0.02 }), stop: true },
    { t: 0.34, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 0.18], cancel: [0.16, 0.34], combo: [0.1, 0.34] },
  move: [
    [0, 0],
    [0.04, 0.6],
    [0.2, 4.6],
    [0.34, 5.0],
  ],
  events: [{ t: 0.0, name: 'dash', data: { dir: 'f' } }],
};
/** Back-hop slide, guard kept up. */
const DASH_B = S({ hips: [-6, -10, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [6, 6, 0], head: [4, 8, 0], thighL: [50, -4, 10], shinL: [16, 0, 0], footL: [20, 0, 0], thighR: [-6, 30, 14], shinR: [50, 0, 0], footR: [10, 0, 0] }, { y: -0.14, rx: -8 });
const dash_b: ClipDef = {
  name: 'dash_b',
  dur: 0.34,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.05, p: DASH_B, e: 'outCubic' },
    { t: 0.2, p: offset(DASH_B, {}, { y: 0.02 }), stop: true },
    { t: 0.34, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 0.18], cancel: [0.16, 0.34], combo: [0.1, 0.34] },
  move: [
    [0, 0],
    [0.04, -0.5],
    [0.2, -4.0],
    [0.34, -4.3],
  ],
  events: [{ t: 0.0, name: 'dash', data: { dir: 'b' } }],
};
/** Side slide to the left: torso banks into the slide, trailing leg extended. */
const DASH_L = S({ hips: [8, -6, 0], spine: [6, 0, -10], chest: [4, 0, -8], neck: [-6, 8, 10], head: [-8, 10, 8], thighL: [30, -10, 30], shinL: [56, 0, 0], footL: [10, 0, -10], thighR: [-4, 30, 4], shinR: [14, 0, 0], footR: [-14, 0, 20], toeR: [20, 0, 0] }, { y: -0.16, rz: -14, x: 0.04 });
const dash_l: ClipDef = {
  name: 'dash_l',
  dur: 0.34,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.05, p: DASH_L, e: 'outCubic' },
    { t: 0.2, p: offset(DASH_L, {}, { y: 0.02 }), stop: true },
    { t: 0.34, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 0.18], cancel: [0.16, 0.34], combo: [0.1, 0.34] },
  move: [
    [0, 0, 0],
    [0.04, 0, 0.5],
    [0.2, 0, 4.0],
    [0.34, 0, 4.3],
  ],
  events: [{ t: 0.0, name: 'dash', data: { dir: 'l' } }],
};
const dash_r: ClipDef = {
  ...dash_l,
  name: 'dash_r',
  keys: dash_l.keys.map((k) => ({ ...k, p: mirror(k.p) })),
  move: dash_l.move!.map(([t, z, x]) => [t, z, -(x ?? 0)]),
  events: [{ t: 0.0, name: 'dash', data: { dir: 'r' } }],
};

/* ------------------------------------------------------------------ ki */

const kiPalm = (side: 'L' | 'R', twist = 0): B => ({
  [`upperArm${side}`]: [102, 86, Math.max(-10, (side === 'R' ? twist : -twist) * 0.9 + 4)],
  [`foreArm${side}`]: [4, 0, 0],
  [`clavicle${side}`]: [26, 0, 4],
  ...handShape(side, 'palm', [0, 0, -74]),
});
const BOLT_L = aimArm(S({ hips: [4, -24, 0], spine: [4, -4, 0], chest: [4, -10, 0], neck: [-4, 20, 0], head: [-6, 20, 0], ...kiPalm('L', -38), ...GUARD_R, thighL: [30, 4, 9] }, { y: -0.09 }), 'L', [0, 0.04, 1]);
const ki_bolt_l: ClipDef = {
  name: 'ki_bolt_l',
  dur: 0.32,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.07, p: BOLT_L, e: 'snap', stop: true },
    { t: 0.12, p: offset(BOLT_L, { foreArmL: [22, 0, 0], upperArmL: [-6, 0, 0] }, { z: -0.03 }), e: 'out' },
    { t: 0.32, p: STANCE, e: 'inOut' },
  ],
  win: { cancel: [0.12, 0.32], combo: [0.1, 0.32] },
  events: [{ t: 0.07, name: 'kiBolt', data: { hand: 'L' } }],
};
const BOLT_R = aimArm(S({ hips: [4, 14, 0], spine: [4, 8, 0], chest: [4, 14, 0], neck: [-4, -18, 0], head: [-6, -18, 0], ...kiPalm('R', 36), ...GUARD_L, thighL: [30, -26, 9] }, { y: -0.09 }), 'R', [0, 0.04, 1]);
const ki_bolt_r: ClipDef = {
  name: 'ki_bolt_r',
  dur: 0.32,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.07, p: BOLT_R, e: 'snap', stop: true },
    { t: 0.12, p: offset(BOLT_R, { foreArmR: [22, 0, 0], upperArmR: [-6, 0, 0] }, { z: -0.03 }), e: 'out' },
    { t: 0.32, p: STANCE, e: 'inOut' },
  ],
  win: { cancel: [0.12, 0.32], combo: [0.1, 0.32] },
  events: [{ t: 0.07, name: 'kiBolt', data: { hand: 'R' } }],
};
/** Air variants keep the legs tucked. */
const AIR_LEGS: B = { thighL: [50, -4, 8], shinL: [80, 0, 0], footL: [-20, 0, 0], thighR: [10, 20, 8], shinR: [40, 0, 0], footR: [-30, 0, 0] };
const ki_bolt_air_l: ClipDef = { ...ki_bolt_l, name: 'ki_bolt_air_l', keys: ki_bolt_l.keys.map((k) => ({ ...k, p: merge(k.p, P(AIR_LEGS, { y: 0 })) })) };
const ki_bolt_air_r: ClipDef = { ...ki_bolt_r, name: 'ki_bolt_air_r', keys: ki_bolt_r.keys.map((k) => ({ ...k, p: merge(k.p, P(AIR_LEGS, { y: 0 })) })) };

/** Beam charge: cupped hands drawn to the right hip, body coiled, knees deep. */
const BEAM_CHARGE = U({ hips: [10, 40, 0], spine: [6, 14, 0], chest: [4, 16, 0], upperChest: [0, 6, 0], neck: [-8, -36, 0], head: [-10, -34, 0], clavicleR: [-8, 0, 6], clavicleL: [18, 0, 0], upperArmR: [-26, 50, 22], foreArmR: [104, 0, 0], upperArmL: [42, 96, -8], foreArmL: [116, 0, 0], ...hands('claw', 'claw', [0, 0, -34], [0, 0, -40]), thighL: [40, -10, 20], shinL: [60, 0, 0], footL: [20, 0, -10], thighR: [6, 40, 22], shinR: [56, 0, 0], footR: [22, 0, 4] }, { y: -0.17 });
const beam_charge: ClipDef = {
  name: 'beam_charge',
  dur: 0.8,
  loop: true,
  keys: [
    { t: 0, p: BEAM_CHARGE },
    { t: 0.4, p: offset(BEAM_CHARGE, { chest: [1, 1, 0], upperArmR: [-2, 0, 0] }, { y: -0.01 }) },
    { t: 0.8, p: BEAM_CHARGE },
  ],
  events: [{ t: 0.0, name: 'chargeTick' }],
};
/** Beam fire: both palms thrust forward heel-to-heel, front knee braced. */
const BEAM_FIRE = aimBoth(U({ hips: [10, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], upperChest: [4, 0, 0], neck: [-14, 0, 0], head: [-12, 0, 0], ...kiPalm('L'), ...kiPalm('R'), upperArmL: [104, 80, -2], upperArmR: [104, 80, -2], thighL: [50, -6, 14], shinL: [58, 0, 0], footL: [18, 0, -4], thighR: [-26, 32, 16], shinR: [12, 0, 0], footR: [-6, 0, 8], toeR: [24, 0, 0] }, { y: -0.17, z: 0.05 }), [0, -0.02, 1], 0.07);
const beam_fire: ClipDef = {
  name: 'beam_fire',
  dur: 0.5,
  loop: true,
  keys: [
    { t: 0, p: BEAM_FIRE },
    { t: 0.25, p: offset(BEAM_FIRE, { upperArmL: [-1.5, 0, 0], upperArmR: [-1.5, 0, 0], chest: [-1, 0, 0] }, { z: -0.012 }) },
    { t: 0.5, p: BEAM_FIRE },
  ],
};
const beam_end: ClipDef = {
  name: 'beam_end',
  dur: 0.45,
  keys: [
    { t: 0, p: BEAM_FIRE },
    { t: 0.45, p: STANCE, e: 'inOut' },
  ],
  win: { cancel: [0.15, 0.45] },
};
/** Ultimate: a long cinematic charge into a full-power beam. */
const ULT_CHARGE = offset(BEAM_CHARGE, { spine: [-10, 0, 0], chest: [-12, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0] }, { y: -0.05 });
const ultimate: ClipDef = {
  name: 'ultimate',
  dur: 3.2,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.35, p: ULT_CHARGE, e: 'inOut' },
    { t: 1.5, p: offset(ULT_CHARGE, { chest: [-3, 0, 0], head: [-4, 0, 0] }, { y: -0.02 }), stop: true },
    { t: 1.65, p: BEAM_FIRE, e: 'snap', stop: true },
    { t: 2.75, p: offset(BEAM_FIRE, { chest: [-2, 0, 0] }, { z: -0.05 }), stop: true },
    { t: 3.2, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 3.0] },
  events: [
    { t: 0.0, name: 'ultCharge' },
    { t: 1.65, name: 'ultFire' },
    { t: 2.75, name: 'ultEnd' },
  ],
};

/* ------------------------------------------------------------------ power up & transformation */

const powerup: ClipDef = {
  name: 'powerup',
  dur: 1.2,
  loop: true,
  keys: [
    { t: 0, p: POWER_STANCE },
    { t: 0.6, p: offset(POWER_STANCE, { chest: [-2, 0, 0], upperArmL: [0, 0, 2], upperArmR: [0, 0, 2] }, { y: -0.01 }) },
    { t: 1.2, p: POWER_STANCE },
  ],
};
/** The scream: back arched, head thrown back, fists clenched, elbows flared. */
const TF_CHARGE = offset(POWER_STANCE, { spine: [-10, 0, 0], chest: [-12, 0, 0], upperChest: [-8, 0, 0], neck: [-20, 0, 0], head: [-18, 0, 0], upperArmL: [-6, 8, 10], upperArmR: [-6, 8, 10], foreArmL: [10, 0, 0], foreArmR: [10, 0, 0], clavicleL: [0, 0, 6], clavicleR: [0, 0, 6] }, { y: -0.03 });
const transform_charge: ClipDef = {
  name: 'transform_charge',
  dur: 0.9,
  loop: true,
  keys: [
    { t: 0, p: TF_CHARGE },
    { t: 0.45, p: offset(TF_CHARGE, { chest: [-2, 0, 0], neck: [-3, 0, 0] }, { y: -0.012 }) },
    { t: 0.9, p: TF_CHARGE },
  ],
};
/** Explosive release: arms flung down and out, chest thrust forward, then settle into the new stance. */
const TF_BURST = U({ hips: [0, 0, 0], spine: [-14, 0, 0], chest: [-16, 0, 0], upperChest: [-8, 0, 0], neck: [-18, 0, 0], head: [-16, 0, 0], clavicleL: [-10, 0, 12], clavicleR: [-10, 0, 12], upperArmL: [-24, -30, 52], upperArmR: [-24, -30, 52], foreArmL: [16, 0, 0], foreArmR: [16, 0, 0], ...hands('spread', 'spread', [0, 0, -30], [0, 0, -30]), thighL: [16, 22, 28], thighR: [16, 22, 28], shinL: [28, 0, 0], shinR: [28, 0, 0], footL: [14, 0, -14], footR: [14, 0, -14] }, { y: -0.08 });
const transform_burst: ClipDef = {
  name: 'transform_burst',
  dur: 1.25,
  keys: [
    { t: 0, p: TF_CHARGE },
    { t: 0.08, p: TF_BURST, e: 'snap', stop: true },
    { t: 0.55, p: offset(TF_BURST, { head: [6, 0, 0], neck: [4, 0, 0] }, { y: 0.01 }), stop: true },
    { t: 0.85, p: offset(POWER_STANCE, { spine: [4, 0, 0], head: [6, 0, 0] }), e: 'inOut' },
    { t: 1.25, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 0.6], cancel: [0.9, 1.25] },
  events: [{ t: 0.08, name: 'burst' }],
};

/* ------------------------------------------------------------------ reactions */

const HIT_F = S({ hips: [-6, 6, 0], spine: [-12, 6, 0], chest: [-10, 8, 0], neck: [-20, -10, 6], head: [-22, -14, 8], upperArmL: [40, 40, 30], upperArmR: [30, 50, 34], foreArmL: [70, 0, 0], foreArmR: [80, 0, 0], ...hands('spread', 'spread') }, { y: -0.08, z: -0.05 });
const hit_f: ClipDef = {
  name: 'hit_f',
  dur: 0.4,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.04, p: HIT_F, e: 'snap', stop: true },
    { t: 0.4, p: STANCE, e: 'inOut' },
  ],
  move: [
    [0, 0],
    [0.12, -0.45],
    [0.4, -0.5],
  ],
};
const hit_f2: ClipDef = { ...hit_f, name: 'hit_f2', keys: hit_f.keys.map((k) => ({ ...k, p: mirror(k.p) })) };
const HIT_B = S({ hips: [12, 0, 0], spine: [16, 0, 0], chest: [12, 0, 0], neck: [10, 0, 0], head: [8, 0, 0], upperArmL: [20, 10, 40], upperArmR: [20, 10, 40], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0] }, { y: -0.1, z: 0.05 });
const hit_b: ClipDef = {
  name: 'hit_b',
  dur: 0.4,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.04, p: HIT_B, e: 'snap', stop: true },
    { t: 0.4, p: STANCE, e: 'inOut' },
  ],
  move: [
    [0, 0],
    [0.12, 0.4],
    [0.4, 0.45],
  ],
};
/** Heavy stagger: knocked back two steps, arms flailing. */
const STAG1 = U({ hips: [-16, 0, 0], spine: [-14, 0, 0], chest: [-12, 0, 0], neck: [-16, 0, 0], head: [-14, 0, 0], upperArmL: [50, -20, 60], upperArmR: [40, -20, 70], foreArmL: [30, 0, 0], foreArmR: [40, 0, 0], ...hands('spread', 'spread'), thighL: [30, 0, 8], shinL: [10, 0, 0], footL: [20, 0, 0], thighR: [-14, 10, 10], shinR: [30, 0, 0] }, { y: -0.04, rx: -6 });
const STAG2 = U({ hips: [4, 0, 0], spine: [6, 0, 0], neck: [6, 0, 0], head: [4, 0, 0], upperArmL: [20, 10, 30], upperArmR: [20, 10, 30], foreArmL: [40, 0, 0], foreArmR: [40, 0, 0], thighL: [6, 0, 8], shinL: [40, 0, 0], thighR: [-30, 10, 10], shinR: [20, 0, 0], footR: [-10, 0, 0] }, { y: -0.12 });
const hit_heavy: ClipDef = {
  name: 'hit_heavy',
  dur: 0.75,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.05, p: STAG1, e: 'snap', stop: true },
    { t: 0.32, p: STAG2, e: 'inOut' },
    { t: 0.75, p: STANCE, e: 'inOut' },
  ],
  move: [
    [0, 0],
    [0.2, -1.2],
    [0.45, -1.6],
    [0.75, -1.65],
  ],
};
/** Launched: arched back, limbs trailing — trajectory comes from physics. */
const LAUNCH = U({ hips: [-20, 0, 0], spine: [-16, 0, 0], chest: [-12, 0, 0], neck: [-24, 0, 0], head: [-14, 0, 0], upperArmL: [60, -20, 70], upperArmR: [70, -20, 60], foreArmL: [30, 0, 0], foreArmR: [40, 0, 0], ...hands('spread', 'spread'), thighL: [30, 0, 10], shinL: [50, 0, 0], thighR: [10, 0, 12], shinR: [70, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }, { rx: -20 });
const launch: ClipDef = {
  name: 'launch',
  dur: 0.8,
  loop: true,
  keys: [
    { t: 0, p: LAUNCH },
    { t: 0.4, p: offset(LAUNCH, { upperArmL: [6, 0, 6], thighL: [6, 0, 0], shinR: [-8, 0, 0] }, { rx: -10 }) },
    { t: 0.8, p: LAUNCH },
  ],
};
const DOWN = U({ hips: [0, 0, 0], spine: [-4, 0, 0], neck: [10, 0, 0], head: [10, 20, 0], upperArmL: [80, 0, 70], upperArmR: [100, 0, 60], foreArmL: [30, 0, 0], foreArmR: [20, 0, 0], ...hands('relaxed', 'relaxed'), thighL: [10, 20, 14], shinL: [30, 0, 0], thighR: [4, 20, 8], shinR: [6, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }, { rx: -90, y: -0.84 });
const knockdown: ClipDef = {
  name: 'knockdown',
  dur: 0.6,
  keys: [
    { t: 0, p: LAUNCH },
    { t: 0.22, p: offset(DOWN, { neck: [-20, 0, 0] }, { y: 0.04 }), e: 'in', stop: true },
    { t: 0.32, p: offset(DOWN, {}, { y: -0.01 }), e: 'outCubic' },
    { t: 0.6, p: DOWN, e: 'inOut' },
  ],
  events: [{ t: 0.22, name: 'bodyfall' }],
};
const down: ClipDef = { name: 'down', dur: 2, loop: true, keys: [{ t: 0, p: DOWN }, { t: 1, p: offset(DOWN, { chest: [-2, 0, 0] }) }, { t: 2, p: DOWN }] };
/** Kip-up: legs swing over, then spring to the feet. */
const KIP1 = U({ hips: [40, 0, 0], spine: [20, 0, 0], neck: [30, 0, 0], head: [10, 0, 0], upperArmL: [150, 20, 20], upperArmR: [150, 20, 20], foreArmL: [140, 0, 0], foreArmR: [140, 0, 0], ...hands('open', 'open', [0, 0, -60], [0, 0, -60]), thighL: [130, 0, 8], thighR: [130, 0, 8], shinL: [60, 0, 0], shinR: [60, 0, 0] }, { rx: -120, y: -0.7 });
const KIP2 = U({ hips: [-20, 0, 0], spine: [-24, 0, 0], neck: [-10, 0, 0], upperArmL: [40, 20, 30], upperArmR: [40, 20, 30], foreArmL: [30, 0, 0], foreArmR: [30, 0, 0], thighL: [80, 0, 10], thighR: [80, 0, 10], shinL: [120, 0, 0], shinR: [120, 0, 0], footL: [20, 0, 0], footR: [20, 0, 0] }, { rx: -20, y: -0.42 });
const getup: ClipDef = {
  name: 'getup',
  dur: 0.85,
  keys: [
    { t: 0, p: DOWN },
    { t: 0.22, p: KIP1, e: 'inOut' },
    { t: 0.42, p: KIP2, e: 'outCubic' },
    { t: 0.6, p: offset(STANCE, { thighL: [20, 0, 0], shinL: [30, 0, 0], thighR: [20, 0, 0], shinR: [30, 0, 0] }, { y: -0.15 }), e: 'inOut' },
    { t: 0.85, p: STANCE, e: 'inOut' },
  ],
  win: { iframes: [0, 0.7], cancel: [0.6, 0.85] },
};
/** Stunned (dazed): loose wobble, head lolling. */
const STUN = U({ hips: [6, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [16, 0, 0], head: [14, 0, 0], upperArmL: [6, 10, 16], upperArmR: [6, 10, 16], foreArmL: [20, 0, 0], foreArmR: [20, 0, 0], ...hands('relaxed', 'relaxed'), thighL: [14, 10, 10], thighR: [10, 10, 10], shinL: [30, 0, 0], shinR: [24, 0, 0] }, { y: -0.06 });
const stun: ClipDef = {
  name: 'stun',
  dur: 1.6,
  loop: true,
  keys: [
    { t: 0, p: offset(STUN, { spine: [0, 0, 6], head: [0, 10, 10] }, { rz: 4 }) },
    { t: 0.4, p: offset(STUN, { spine: [4, 0, 0], head: [6, 0, 0] }, { rx: 3, y: -0.02 }) },
    { t: 0.8, p: offset(STUN, { spine: [0, 0, -6], head: [0, -10, -10] }, { rz: -4 }) },
    { t: 1.2, p: offset(STUN, { spine: [-2, 0, 0], head: [-4, 0, 0] }, { rx: -2 }) },
    { t: 1.6, p: offset(STUN, { spine: [0, 0, 6], head: [0, 10, 10] }, { rz: 4 }) },
  ],
};
const death: ClipDef = {
  name: 'death',
  dur: 1.3,
  keys: [
    { t: 0, p: HIT_F },
    { t: 0.35, p: U({ hips: [10, 0, 0], spine: [20, 0, 0], neck: [20, 0, 0], head: [10, 0, 0], upperArmL: [10, 0, 14], upperArmR: [10, 0, 14], foreArmL: [20, 0, 0], foreArmR: [20, 0, 0], thighL: [0, 0, 10], thighR: [0, 0, 10], shinL: [130, 0, 0], shinR: [130, 0, 0], footL: [-40, 0, 0], footR: [-40, 0, 0] }, { y: -0.48 }), e: 'inOut' },
    { t: 0.8, p: U({ spine: [6, 0, 0], neck: [-10, 30, 0], head: [-10, 40, 0], upperArmL: [100, 0, 50], upperArmR: [80, 0, 40], foreArmL: [30, 0, 0], foreArmR: [40, 0, 0], thighL: [6, 0, 10], thighR: [10, 0, 8], shinL: [20, 0, 0], shinR: [10, 0, 0], footL: [-40, 0, 0], footR: [-40, 0, 0] }, { rx: 88, y: -0.82 }), e: 'in', stop: true },
    { t: 1.3, p: U({ spine: [6, 0, 0], neck: [-10, 30, 0], head: [-10, 40, 0], upperArmL: [100, 0, 50], upperArmR: [80, 0, 40], foreArmL: [30, 0, 0], foreArmR: [40, 0, 0], thighL: [6, 0, 10], thighR: [10, 0, 8], shinL: [20, 0, 0], shinR: [10, 0, 0], footL: [-40, 0, 0], footR: [-40, 0, 0] }, { rx: 90, y: -0.84 }) },
  ],
  events: [{ t: 0.8, name: 'bodyfall' }],
};
/** Victory: fist pump, then arms crossed with a confident stance. */
const CROSSED = U({ hips: [0, 6, 0], spine: [-2, 0, 0], chest: [-4, 0, 0], neck: [-2, -8, 0], head: [-6, -10, 4], upperArmL: [40, 76, -14], upperArmR: [44, 78, -12], foreArmL: [122, 30, 0], foreArmR: [118, 30, 0], ...hands('fist', 'fist', [0, 0, 10], [0, 0, 10]), thighL: [2, 20, 12], thighR: [2, 20, 12], shinL: [2, 0, 0], shinR: [2, 0, 0], footL: [0, 0, 6], footR: [0, 0, 6] });
const victory: ClipDef = {
  name: 'victory',
  dur: 2.4,
  keys: [
    { t: 0, p: STANCE },
    { t: 0.2, p: U({ ...GUARD_L, upperArmR: [150, 20, 40], foreArmR: [60, 0, 0], ...handShape('R', 'fist'), neck: [-14, 0, 0], head: [-10, 0, 0], ...STANCE_LEGS }, { y: -0.05 }), e: 'outBack', stop: true },
    { t: 0.8, p: U({ ...GUARD_L, upperArmR: [160, 20, 40], foreArmR: [50, 0, 0], ...handShape('R', 'fist'), neck: [-16, 0, 0], head: [-12, 0, 0], ...STANCE_LEGS }, { y: -0.04 }), stop: true },
    { t: 1.3, p: CROSSED, e: 'inOut' },
    { t: 2.4, p: offset(CROSSED, { chest: [1, 0, 0] }) },
  ],
  events: [{ t: 0.2, name: 'victory' }],
};

export const SPECIAL: ClipDef[] = [
  dash_f,
  dash_b,
  dash_l,
  dash_r,
  ki_bolt_l,
  ki_bolt_r,
  ki_bolt_air_l,
  ki_bolt_air_r,
  beam_charge,
  beam_fire,
  beam_end,
  ultimate,
  powerup,
  transform_charge,
  transform_burst,
  hit_f,
  hit_f2,
  hit_b,
  hit_heavy,
  launch,
  knockdown,
  down,
  getup,
  stun,
  death,
  victory,
];
export { GUARD_R };
