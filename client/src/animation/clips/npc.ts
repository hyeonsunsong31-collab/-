import type { ClipDef } from '../Clip.ts';
import { P, STAND, hands, merge, offset, type B } from '../poses.ts';
import type { RootXf } from '../Pose.ts';

const U = (b: B, root?: RootXf) => merge(STAND, P(b, root));

/* ================================================================== ARENA HERALD */

/**
 * Formal rest: chest up, shoulders drawn back, hands clasped behind the lower back (shoulders extended and turned
 * in so the forearms cross behind the body), weight settled on the left leg.
 */
const HERALD_REST = U(
  {
    hips: [0, -3, 0],
    spine: [-2, 0, 1],
    chest: [-4, 0, 1],
    upperChest: [-3, 0, 0],
    neck: [8, 0, -1],
    head: [-2, 0, 0],
    clavicleL: [-8, 0, -2],
    clavicleR: [-8, 0, -2],
    upperArmL: [-32, 78, 12],
    upperArmR: [-32, 78, 12],
    foreArmL: [84, 0, 0],
    foreArmR: [84, 0, 0],
    ...hands('relaxed', 'relaxed', [0, 0, 8], [0, 0, 8]),
    thighL: [0, -4, 3],
    shinL: [2, 0, 0],
    footL: [0, 0, -2],
    thighR: [6, 10, 6],
    shinR: [12, 0, 0],
    footR: [-4, 0, 10],
  },
  { x: 0.015, rz: -1.5 },
);

const herald_idle: ClipDef = {
  name: 'herald_idle',
  dur: 5.2,
  loop: true,
  keys: [
    { t: 0, p: HERALD_REST },
    // Look over the square, breathe in.
    { t: 1.4, p: offset(HERALD_REST, { neck: [0, 10, 0], head: [2, 16, 0], chest: [-1.5, 2, 0] }, { y: 0.004 }), e: 'inOut' },
    { t: 2.4, p: offset(HERALD_REST, { neck: [0, 6, 0], head: [0, 8, 0] }), e: 'inOut' },
    // Shift weight and glance the other way.
    { t: 3.7, p: offset(HERALD_REST, { hips: [0, 2, 0], neck: [0, -9, 0], head: [-2, -14, 0], chest: [-1, -2, 0], thighR: [-2, 0, 0], shinR: [-3, 0, 0] }, { x: 0.005, rz: -0.6, y: -0.004 }), e: 'inOut' },
    { t: 5.2, p: HERALD_REST, e: 'inOut' },
  ],
};

/** Courtly bow with the right hand sweeping to the chest — plays when the player walks up. */
const BOW = U(
  {
    hips: [10, 0, 0],
    spine: [10, 0, 0],
    chest: [8, 0, 0],
    upperChest: [4, 0, 0],
    neck: [8, 0, 0],
    head: [4, 0, 0],
    clavicleL: [-8, 0, -2],
    upperArmL: [-32, 78, 12],
    foreArmL: [84, 0, 0],
    upperArmR: [34, 64, 22],
    foreArmR: [104, 0, 0],
    ...hands('relaxed', 'open', [0, 0, 8], [0, 0, -6]),
    thighL: [10, -4, 3],
    shinL: [8, 0, 0],
    thighR: [-8, 6, 6],
    shinR: [18, 0, 0],
    footR: [8, 0, 6],
  },
  { y: -0.02, z: -0.03 },
);

const herald_greet: ClipDef = {
  name: 'herald_greet',
  dur: 2.1,
  keys: [
    { t: 0, p: HERALD_REST },
    { t: 0.45, p: offset(BOW, { hips: [-8, 0, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [-6, 0, 0] }, { y: 0.02 }), e: 'outCubic' },
    { t: 0.95, p: BOW, e: 'inOut', stop: true },
    { t: 1.35, p: offset(BOW, { hips: [-2, 0, 0], spine: [-2, 0, 0] }), e: 'inOut' },
    { t: 2.1, p: HERALD_REST, e: 'inOut' },
  ],
  win: { cancel: [1.5, 2.1] },
};

export const NPC: ClipDef[] = [herald_idle, herald_greet];
