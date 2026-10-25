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
