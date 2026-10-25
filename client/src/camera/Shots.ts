import * as THREE from 'three';
import type { CinematicShot } from './CameraRig.ts';
import type { Combatant } from '../combat/Combatant.ts';

const _v = new THREE.Vector3();
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = THREE.MathUtils.lerp;

/** Point at angle `ang` (relative to the fighter's facing), distance `d` and height `h` around a fighter. */
function orbit(c: Combatant, ang: number, d: number, h: number, out: THREE.Vector3): THREE.Vector3 {
  const a = c.yaw + ang;
  return out.set(c.pos.x + Math.sin(a) * d, c.pos.y + h * c.char.scale, c.pos.z + Math.cos(a) * d);
}

/** Transformation: low hero angle circling the screaming fighter, then a snap pull-back on the burst. */
export function transformShot(hero: Combatant, chargeDur: number): CinematicShot {
  const total = chargeDur + 1.3;
  return {
    dur: total,
    blendIn: 0.35,
    blendOut: 0.5,
    frame(u, out) {
      const t = u * total;
      const head = hero.char.boneWorld('head', _v).clone();
      if (t < chargeDur) {
        const k = smooth(t / chargeDur);
        orbit(hero, 0.5 + k * 0.9, lerp(3.6, 2.6, k), lerp(0.35, 0.6, k), out.pos);
        out.look.copy(head).setY(head.y - 0.15);
        out.fov = lerp(48, 40, k);
        out.roll = lerp(0, -6, k);
      } else {
        const k = smooth(Math.min(1, (t - chargeDur) / 0.6));
        orbit(hero, 1.4 + k * 0.25, lerp(2.6, 7.5, k), lerp(0.6, 1.5, k), out.pos);
        out.look.copy(hero.pos).setY(hero.pos.y + 1.2 * hero.char.scale);
        out.fov = lerp(40, 68, k);
        out.roll = lerp(-6, 2, k);
      }
    },
  };
}

/** Ultimate: close on the charge, then a wide tracking side view of the beam crossing to the target. */
export function ultimateShot(hero: Combatant, target: Combatant | null): CinematicShot {
  return {
    dur: 3.2,
    blendIn: 0.3,
    blendOut: 0.5,
    frame(u, out) {
      const t = u * 3.2;
      const chest = hero.chest(new THREE.Vector3());
      if (t < 1.6) {
        const k = smooth(t / 1.6);
        orbit(hero, 2.4 - k * 0.6, lerp(2.4, 3.4, k), lerp(0.9, 1.2, k), out.pos);
        out.look.copy(chest);
        out.fov = lerp(42, 50, k);
        out.roll = 4 * k;
      } else {
        const k = smooth(Math.min(1, (t - 1.6) / 1.4));
        const tp = target ? target.chest(new THREE.Vector3()) : hero.chest(new THREE.Vector3()).addScaledVector(hero.forward(), 25);
        const mid = chest.clone().lerp(tp, 0.35 + k * 0.25);
        const span = chest.distanceTo(tp);
        const side = new THREE.Vector3().subVectors(tp, chest).setY(0).normalize();
        side.set(-side.z, 0, side.x);
        out.pos.copy(mid).addScaledVector(side, Math.max(9, span * 0.8)).setY(mid.y + 2.5 + k * 2);
        out.look.copy(mid);
        out.fov = lerp(60, 66, k);
        out.roll = lerp(4, -3, k);
      }
    },
  };
}

/**
 * Status-screen portrait: a slow drifting three-quarter front view with the fighter framed on the right third of the
 * screen (the menu panel owns the left). Runs until stopped.
 */
export function portraitShot(hero: Combatant, side: 1 | -1 = 1): CinematicShot {
  const right = new THREE.Vector3();
  const shot: CinematicShot = {
    dur: 3600,
    blendIn: 0.55,
    blendOut: 0.45,
    frame(u, out) {
      // `dur` shrinks when the shot is released, so derive time from the live value.
      const t = u * shot.dur;
      const chest = hero.chest(new THREE.Vector3());
      const s = hero.char.scale;
      orbit(hero, side * (0.42 + Math.sin(t * 0.21) * 0.1), 3.3 * s, 1.05 + Math.sin(t * 0.13) * 0.06, out.pos);
      right.subVectors(chest, out.pos).setY(0).normalize();
      right.set(-right.z, 0, right.x);
      // Shift the aim left of the fighter so they sit on the right of the frame.
      out.look.copy(chest).addScaledVector(right, -0.95 * side * s).setY(chest.y - 0.05 * s);
      out.fov = 40;
      out.roll = side * 1.5;
    },
  };
  return shot;
}

/**
 * Title screen: a slow, low orbit around the fighter charging their aura, framed on the right so the logo and menu
 * own the left. Breathes in and out of a closer framing. Runs until released.
 */
export function titleShot(hero: Combatant): CinematicShot {
  const right = new THREE.Vector3();
  const shot: CinematicShot = {
    dur: 3600,
    blendIn: 0.05,
    blendOut: 1.4,
    frame(u, out) {
      const t = u * shot.dur;
      const s = hero.char.scale;
      const chest = hero.chest(new THREE.Vector3());
      const breathe = 0.5 + 0.5 * Math.sin(t * 0.16);
      orbit(hero, 0.55 + t * 0.045, lerp(5.6, 4.4, breathe) * s, lerp(0.35, 0.65, breathe), out.pos);
      right.subVectors(chest, out.pos).setY(0).normalize();
      right.set(-right.z, 0, right.x);
      out.look.copy(chest).addScaledVector(right, -1.35 * s).setY(chest.y + 0.35 * s);
      out.fov = lerp(44, 38, breathe);
      out.roll = 2.5 * Math.sin(t * 0.11);
    },
  };
  return shot;
}

/**
 * Arena intro: open tight and low on the rival, sweep out to a wide profile of both fighters squaring off, then
 * settle behind the player's shoulder so the hand-off to the follow camera is seamless.
 */
export function versusShot(player: Combatant, rival: Combatant, dur: number): CinematicShot {
  return {
    dur,
    blendIn: 0.05,
    blendOut: 0.7,
    frame(u, out) {
      const a = player.chest(new THREE.Vector3());
      const b = rival.chest(new THREE.Vector3());
      const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const mid = a.clone().lerp(b, 0.5);
      if (u < 0.32) {
        // Low hero angle on the rival, slow push-in.
        const k = smooth(u / 0.32);
        out.pos.copy(b).addScaledVector(dir, -lerp(3.4, 2.7, k)).addScaledVector(side, 1.2).setY(b.y - 0.55);
        out.look.copy(b).setY(b.y + 0.25);
        out.fov = lerp(44, 38, k);
        out.roll = lerp(-4, -2, k);
      } else if (u < 0.72) {
        // Wide tracking profile of both.
        const k = smooth((u - 0.32) / 0.4);
        const span = a.distanceTo(b);
        out.pos.copy(mid).addScaledVector(side, lerp(span * 0.55, span * 0.85, k)).addScaledVector(dir, lerp(3, -2, k)).setY(mid.y + lerp(0.2, 1.4, k));
        out.look.copy(mid).addScaledVector(dir, lerp(2, 0, k));
        out.fov = lerp(52, 58, k);
        out.roll = lerp(3, 0, k);
      } else {
        // Over the player's shoulder toward the rival.
        const k = smooth((u - 0.72) / 0.28);
        out.pos.copy(a).addScaledVector(dir, -lerp(3.2, 4.6, k)).addScaledVector(side, lerp(-1.6, -0.6, k)).setY(a.y + lerp(0.5, 1.0, k));
        out.look.copy(b).lerp(a, lerp(0.25, 0.4, k));
        out.fov = lerp(50, 62, k);
        out.roll = 0;
      }
    },
  };
}

/** Match finish: slow low orbit around the fallen (or ringed-out) fighter with the winner in the background. */
export function finishShot(loser: Combatant, winner: Combatant, dur: number): CinematicShot {
  return {
    dur,
    blendIn: 0.25,
    blendOut: 0.5,
    frame(u, out) {
      const k = smooth(u);
      const l = loser.chest(new THREE.Vector3());
      const w = winner.chest(new THREE.Vector3());
      const away = new THREE.Vector3().subVectors(l, w).setY(0);
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      away.normalize();
      const side = new THREE.Vector3(-away.z, 0, away.x);
      const a = lerp(-0.7, 0.5, k);
      out.pos.copy(l).addScaledVector(away, Math.cos(a) * 4.2).addScaledVector(side, Math.sin(a) * 4.2).setY(l.y + lerp(0.4, 1.3, k));
      out.look.copy(l).lerp(w, 0.3);
      out.fov = lerp(46, 54, k);
      out.roll = lerp(5, -2, k);
    },
  };
}

/** Chain attack finisher: dynamic angle sweeping around attacker and target. */
export function chainShot(att: Combatant, target: Combatant, dur: number, style: 'rush' | 'meteor' | 'thunder'): CinematicShot {
  return {
    dur,
    blendIn: 0.15,
    blendOut: 0.35,
    frame(u, out) {
      const k = smooth(u);
      const a = att.chest(new THREE.Vector3());
      const b = target.chest(new THREE.Vector3());
      const mid = a.clone().lerp(b, 0.5);
      const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (style === 'rush') {
        const ang = lerp(-0.9, 0.9, k);
        const off = side.clone().multiplyScalar(Math.cos(ang) * 4.2).addScaledVector(dir, Math.sin(ang) * 4.2);
        out.pos.copy(mid).add(off).setY(mid.y + 0.6);
        out.look.copy(mid);
        out.fov = 46;
        out.roll = lerp(-6, 6, k);
      } else if (style === 'meteor') {
        out.pos.copy(b).addScaledVector(side, 7).addScaledVector(dir, -2).setY(b.y + lerp(1, 4, k));
        out.look.copy(b).setY(b.y + lerp(4, 0.5, k));
        out.fov = lerp(55, 62, k);
        out.roll = 3;
      } else {
        out.pos.copy(b).addScaledVector(side, 9).setY(b.y + lerp(2, 6, k));
        out.look.copy(b).setY(b.y + 3);
        out.fov = 64;
        out.roll = lerp(0, -5, k);
      }
    },
  };
}
