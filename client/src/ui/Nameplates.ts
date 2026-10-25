import * as THREE from 'three';
import { formatPL } from '@ak/shared';
import type { Combatant } from '../combat/Combatant.ts';
import './styles/nameplates.css';

interface Plate {
  c: Combatant;
  el: HTMLDivElement;
  nm: HTMLElement;
  lv: HTMLElement;
  pl: HTMLElement;
  hp: HTMLElement;
  ghost: HTMLElement;
  daze: HTMLElement | null;
  shownPL: number;
  lastHp: number;
  state: string;
  /** Unscaled element height (px), measured once. */
  h: number;
  /** Smoothed upward offset that keeps overlapping plates apart. */
  lift: number;
}

interface Placed {
  p: Plate;
  sx: number;
  sy: number;
  k: number;
  dist: number;
  lift: number;
}

const _v = new THREE.Vector3();

/**
 * DOM nameplates projected above every fighter: level, name, a scouter-green power level that rolls toward its
 * live value (spiking on transformations), HP with a trailing damage ghost, Daze and a STUN tag, and the gold/red
 * telegraph glint when a foe winds up.
 */
export class Nameplates {
  private layer: HTMLDivElement;
  private plates = new Map<Combatant, Plate>();
  /** Player level, for colouring dangerous foes. */
  playerLevel = 1;

  constructor(parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.layer = document.createElement('div');
    this.layer.className = 'ak-np-layer';
    parent.appendChild(this.layer);
  }

  add(c: Combatant, ally = false): void {
    if (this.plates.has(c)) return;
    const el = document.createElement('div');
    el.className = `ak-np${ally ? ' ally' : ''}`;
    el.innerHTML = `<div class="flash"></div><div class="stun">STUN</div>
      <div class="ak-np-top"><span class="lv"></span><span class="nm"></span></div>
      <div class="ak-np-pl"><span class="t">PL</span><span class="v"></span></div>
      <div class="ak-np-bar"><i class="ghost"></i><i class="fill"></i></div>
      ${ally ? '' : '<div class="ak-np-bar ak-np-daze"><i class="fill"></i></div>'}`;
    this.layer.appendChild(el);
    const p: Plate = {
      c,
      el,
      nm: el.querySelector('.nm')!,
      lv: el.querySelector('.lv')!,
      pl: el.querySelector('.ak-np-pl .v')!,
      hp: el.querySelector('.ak-np-bar .fill')!,
      ghost: el.querySelector('.ak-np-bar .ghost')!,
      daze: ally ? null : el.querySelector('.ak-np-daze .fill'),
      shownPL: c.powerLevel,
      lastHp: c.hp,
      state: '',
      h: 0,
      lift: 0,
    };
    p.nm.textContent = c.name;
    this.plates.set(c, p);
  }

  remove(c: Combatant): void {
    const p = this.plates.get(c);
    if (!p) return;
    p.el.remove();
    this.plates.delete(c);
  }

  /** Telegraph glint over a foe about to strike. */
  telegraph(c: Combatant, color: 'gold' | 'red'): void {
    const p = this.plates.get(c);
    if (!p) return;
    p.el.style.setProperty('--fc', color === 'red' ? '#ff3b2a' : '#ffc21a');
    p.el.classList.remove('telegraph');
    void p.el.offsetWidth;
    p.el.classList.add('telegraph');
  }

  update(dt: number, camera: THREE.PerspectiveCamera, hideAll = false): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const shown: Placed[] = [];
    for (const p of this.plates.values()) {
      const c = p.c;
      const head = _v.copy(c.pos).setY(c.pos.y + c.height * 1.08 + 0.25);
      const dist = camera.position.distanceTo(head);
      head.project(camera);
      const visible = !hideAll && head.z < 1 && dist < 70 && (c.alive || c.sinceHit < 1.5) && Math.abs(head.x) < 1.2 && Math.abs(head.y) < 1.2;
      if (!visible) {
        if (p.el.style.display !== 'none') p.el.style.display = 'none';
        continue;
      }
      if (p.el.style.display === 'none') p.el.style.display = '';
      if (!p.h) p.h = p.el.offsetHeight || 46;
      shown.push({
        p,
        sx: (head.x * 0.5 + 0.5) * w,
        sy: (-head.y * 0.5 + 0.5) * h,
        k: THREE.MathUtils.clamp(9 / Math.max(4, dist), 0.55, 1.15),
        dist,
        lift: 0,
      });
    }
    // Declutter: the nearest plate keeps its spot, farther ones stack upward out of its way.
    shown.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < shown.length; i++) {
      const a = shown[i];
      const half = 64 * a.k;
      const ah = a.p.h * a.k + 2;
      for (let iter = 0; iter < 6; iter++) {
        const bottom = a.sy - 4 - a.lift;
        let moved = false;
        for (let j = 0; j < i; j++) {
          const b = shown[j];
          const bBottom = b.sy - 4 - b.lift;
          const bTop = bBottom - b.p.h * b.k;
          if (Math.abs(a.sx - b.sx) < half + 64 * b.k && bottom > bTop && bottom - ah < bBottom) {
            a.lift += bottom - bTop;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
    for (const e of shown) {
      const { p, sx, sy, k, dist } = e;
      const c = p.c;
      p.lift += (e.lift - p.lift) * (1 - Math.exp(-dt * 14));
      if (Math.abs(e.lift - p.lift) > 60) p.lift = e.lift;
      p.el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - 4 - p.lift - p.h).toFixed(1)}px) scale(${k.toFixed(3)})`;
      p.el.style.opacity = String(THREE.MathUtils.clamp((70 - dist) / 20, 0, 1));
      p.el.style.zIndex = String(1000 - Math.round(dist * 10));
      const lvText = `Lv ${c.level}`;
      if (p.lv.textContent !== lvText) p.lv.textContent = lvText;
      p.el.classList.toggle('danger', c.team === 'foe' && c.level >= this.playerLevel + 5);
      // Power level rolls toward the live value; big jumps spike.
      const target = c.powerLevel;
      if (target > p.shownPL * 1.5 && target - p.shownPL > 200) {
        p.el.classList.remove('spike');
        void p.el.offsetWidth;
        p.el.classList.add('spike');
      }
      p.shownPL += (target - p.shownPL) * (1 - Math.exp(-dt * 6));
      if (Math.abs(target - p.shownPL) < 1) p.shownPL = target;
      const plText = formatPL(Math.round(p.shownPL));
      if (p.pl.textContent !== plText) p.pl.textContent = plText;
      const hpk = Math.max(0, c.hp / c.maxHp);
      p.hp.style.transform = `scaleX(${hpk.toFixed(4)})`;
      if (Math.abs(c.hp - p.lastHp) > 0.5) {
        p.ghost.style.transform = `scaleX(${hpk.toFixed(4)})`;
        p.lastHp = c.hp;
      }
      if (p.daze) p.daze.style.transform = `scaleX(${(c.stunned ? c.stunTimer / 5 : c.daze / c.dazeMax).toFixed(4)})`;
      const st = c.stunned ? 'stunned' : '';
      if (st !== p.state) {
        p.el.classList.toggle('stunned', !!st);
        p.state = st;
      }
    }
  }
}
