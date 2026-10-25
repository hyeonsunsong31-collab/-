import * as THREE from 'three';
import { BUFFS, COMBAT, formatPL, nextForm, xpToNext, type FormDef, type Profile } from '@ak/shared';
import type { Hero } from '../gameplay/Hero.ts';
import type { Combatant } from '../combat/Combatant.ts';
import type { CombatEvent } from '../combat/CombatSystem.ts';
import { drawPortrait, type PortraitLook } from './Portrait.ts';
import './styles/hud.css';

const _v = new THREE.Vector3();

interface DmgNum {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  vx: number;
  vy: number;
  t: number;
  life: number;
  scale: number;
}

const RANKS: [number, string, string][] = [
  [120, 'SSS', '#ff3b8a'],
  [80, 'SS', '#ff5a3a'],
  [50, 'S', '#ffc21a'],
  [35, 'A', '#c6ff3c'],
  [20, 'B', '#3cf2ff'],
  [10, 'C', '#8fb4ff'],
  [0, 'D', '#9aa0ad'],
];

const KEY_HINTS: { id: string; key: string; label: string; icon: string }[] = [
  { id: 'light', key: 'LMB', label: 'ATTACK', icon: '<path d="M6 13h6l-2 7 8-11h-6l2-7z"/>' },
  { id: 'heavy', key: 'E', label: 'SPECIAL', icon: '<path d="M12 2c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3 0-3-1-5 0-7z"/>' },
  { id: 'ki', key: 'R', label: 'KI BLAST', icon: '<path d="M13 2 4 14h7l-2 8 9-12h-7z"/>' },
  { id: 'dodge', key: 'Q', label: 'DASH', icon: '<path d="M3 12h11M10 7l5 5-5 5M16 7l5 5-5 5"/>' },
  { id: 'block', key: 'RMB', label: 'GUARD', icon: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>' },
  { id: 'power', key: 'T', label: 'POWER UP', icon: '<path d="M12 2c3 5 7 7 7 13a7 7 0 0 1-14 0c0-6 4-8 7-13zm0 9c-1 2-3 3-3 5a3 3 0 0 0 6 0c0-2-2-3-3-5z"/>' },
];

/**
 * In-game HUD ("Ki-Punk"): agent portrait + level/name/form, segmented HP with damage ghost, Energy (EX marker),
 * Ki, scouter PL, XP sliver, the Surge (decibel) meter with MAXIMUM / TRANSFORM / ULTIMATE states, stacking buff
 * icons with timers, the target panel (HP, Daze, STUN), combo counter with rank, floating damage numbers, key hints
 * with live readiness, region-title banners and transformation title cards.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
  private portrait: HTMLCanvasElement;
  private portraitForm = -1;
  private ghost = 1;
  private ghostHold = 0;
  private lastHp = 1;
  private tGhost = 1;
  private tGhostHold = 0;
  private tLast = 1;
  private tWho: Combatant | null = null;
  private shownPL = 0;
  private combo = 0;
  private comboT = 0;
  private comboDmg = 0;
  private dmg: DmgNum[] = [];
  private dmgPool: HTMLDivElement[] = [];
  private buffEls = new Map<string, HTMLDivElement>();
  private regionTimer = 0;
  private formTimer = 0;
  private keys = new Map<string, HTMLElement>();
  /** Hide damage numbers (setting). */
  showDamage = true;
  touch = false;

  constructor(
    private look: PortraitLook,
    private baseHair: string,
    parent: HTMLElement = document.getElementById('ui-root') ?? document.body,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ak-hud';
    this.root.innerHTML = `
      <div class="ak-hud-me">
        <canvas class="portrait" width="160" height="160"></canvas>
        <div class="info">
          <div class="row1"><span class="lv">LV<b></b></span><span class="nm"></span><span class="form"></span></div>
          <div class="hp"><i class="ghost"></i><i class="fill"></i><i class="seg"></i><span class="num"></span></div>
          <div class="sub">
            <div class="en"><i class="fill"></i><i class="mark"></i><span>EX</span></div>
            <div class="ki"><i class="fill"></i><span>KI</span></div>
          </div>
          <div class="row2"><span class="pl"><small>PL</small><b></b></span><span class="xp"><i></i></span></div>
        </div>
      </div>
      <div class="ak-hud-surge">
        <div class="lbl"><span>SURGE</span><b class="state"></b></div>
        <div class="bar"><i class="fill"></i><i class="pip" style="left:33.33%"></i><i class="pip" style="left:66.66%"></i><i class="glare"></i></div>
      </div>
      <div class="ak-hud-buffs"></div>
      <div class="ak-hud-target">
        <div class="row"><span class="lv"></span><b class="nm"></b><span class="pl"></span></div>
        <div class="hp"><i class="ghost"></i><i class="fill"></i></div>
        <div class="daze"><i class="fill"></i><span>DAZE</span></div>
      </div>
      <div class="ak-hud-combo"><div class="n"><b></b><span>HITS</span></div><div class="rank"></div><div class="dmg"></div><i class="timer"><i></i></i></div>
      <div class="ak-hud-dmgnums"></div>
      <div class="ak-hud-keys">${KEY_HINTS.map(
        (k) => `<div class="k" data-id="${k.id}"><svg viewBox="0 0 24 24">${k.icon}</svg><kbd>${k.key}</kbd><span>${k.label}</span></div>`,
      ).join('')}<div class="k small" data-id="status"><kbd>C</kbd><span>STATUS</span></div><div class="k small" data-id="map"><kbd>M</kbd><span>MAP</span></div></div>
      <div class="ak-hud-region"><small></small><b></b><span></span></div>
      <div class="ak-hud-formcard"><small>TRANSFORMATION</small><b></b><span></span></div>`;
    parent.appendChild(this.root);
    this.portrait = this.q('.portrait');
    this.root.querySelectorAll<HTMLElement>('.ak-hud-keys .k').forEach((k) => this.keys.set(k.dataset.id!, k));
  }

  set visible(v: boolean) {
    this.root.classList.toggle('off', !v);
  }

  /** Hide gameplay chrome during cinematics but keep damage numbers. */
  set cinematic(v: boolean) {
    this.root.classList.toggle('cine', v);
  }

  /* ---------------------------------------------------------------- events */

  onCombat(e: CombatEvent, player: Combatant): void {
    switch (e.type) {
      case 'hit': {
        const mine = e.attacker === player;
        const onMe = e.target === player;
        if (mine && e.res.dmg > 0) {
          this.combo = this.comboT > 0 ? this.combo + 1 : 1;
          this.comboDmg = this.comboT > 0 ? this.comboDmg + e.res.dmg : e.res.dmg;
          this.comboT = 2.6;
          this.bumpCombo();
        }
        if (onMe && e.res.dmg > 0) this.comboT = Math.min(this.comboT, 0.35);
        if (!this.showDamage || (!mine && !onMe)) break;
        if (e.res.blocked) {
          this.number(e.point, onMe ? 'BLOCK' : `${Math.round(e.res.dmg)}`, onMe ? 'block' : 'blocked', 0.9);
          break;
        }
        const kind = onMe ? 'taken' : e.res.crit ? 'crit' : e.def.ki ? 'ki' : e.target.stunned ? 'stun' : 'norm';
        const tick = e.def.id.endsWith('_tick');
        const scale = tick ? 0.7 : 0.85 + Math.min(0.9, e.def.tier * 0.12) + (e.res.crit ? 0.25 : 0);
        this.number(e.point, Math.round(e.res.dmg).toLocaleString('en-US'), kind, scale);
        break;
      }
      case 'perfectDodge':
        if (e.who === player) this.number(player.chest(_v).setY(player.pos.y + 2.1), 'PERFECT', 'perfect', 1.15);
        break;
      case 'parry':
        if (e.who === player) this.number(e.point, 'PARRY!', 'parry', 1.25);
        break;
      case 'guardBreak':
        this.number(e.who.chest(_v), 'GUARD BREAK', 'gbreak', 1.1);
        break;
      case 'stun':
        if (e.who !== player) this.number(e.who.chest(_v).setY(e.who.pos.y + e.who.height + 0.4), 'STUNNED', 'stunned', 1.2);
        break;
    }
  }

  private bumpCombo(): void {
    const c = this.q<HTMLElement>('.ak-hud-combo');
    c.classList.add('on');
    (c.querySelector('.n b') as HTMLElement).textContent = String(this.combo);
    (c.querySelector('.dmg') as HTMLElement).textContent = Math.round(this.comboDmg).toLocaleString('en-US');
    const [, rank, col] = RANKS.find(([n]) => this.combo >= n)!;
    const r = c.querySelector('.rank') as HTMLElement;
    if (r.textContent !== rank) {
      r.textContent = rank;
      r.style.color = col;
      r.classList.remove('up');
      void r.offsetWidth;
      r.classList.add('up');
    }
    const n = c.querySelector('.n') as HTMLElement;
    n.classList.remove('pop');
    void n.offsetWidth;
    n.classList.add('pop');
  }

  private number(pos: THREE.Vector3, text: string, kind: string, scale: number): void {
    let el = this.dmgPool.pop();
    if (!el) {
      el = document.createElement('div');
      this.q('.ak-hud-dmgnums').appendChild(el);
    }
    el.className = `dn ${kind}`;
    el.textContent = text;
    el.style.display = '';
    if (this.dmg.length > 42) this.recycle(this.dmg.shift()!);
    this.dmg.push({
      el,
      pos: pos.clone(),
      vx: (Math.random() - 0.5) * 70,
      vy: -110 - Math.random() * 40,
      t: 0,
      life: kind === 'taken' ? 0.9 : 1.05,
      scale,
    });
  }

  private recycle(d: DmgNum): void {
    d.el.style.display = 'none';
    this.dmgPool.push(d.el);
  }

  /** Big region-title banner (village/camp names when entering). */
  region(name: string, sub: string, tag: string): void {
    const r = this.q<HTMLElement>('.ak-hud-region');
    (r.querySelector('small') as HTMLElement).textContent = tag;
    (r.querySelector('b') as HTMLElement).textContent = name;
    (r.querySelector('span') as HTMLElement).textContent = sub;
    r.classList.remove('on');
    void r.offsetWidth;
    r.classList.add('on');
    clearTimeout(this.regionTimer);
    this.regionTimer = window.setTimeout(() => r.classList.remove('on'), 4200);
  }

  /** Transformation title card. */
  formCard(f: FormDef): void {
    const c = this.q<HTMLElement>('.ak-hud-formcard');
    c.style.setProperty('--ac', f.auraColor);
    c.style.setProperty('--hc', f.hairColor);
    (c.querySelector('b') as HTMLElement).textContent = f.title;
    (c.querySelector('span') as HTMLElement).textContent = f.tier > 0 ? `POWER ×${f.plMult.toLocaleString('en-US')}` : 'POWER RELEASED';
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
    clearTimeout(this.formTimer);
    this.formTimer = window.setTimeout(() => c.classList.remove('on'), 3200);
  }

  /* ---------------------------------------------------------------- per frame */

  update(dt: number, p: Hero, prof: Profile, camera: THREE.PerspectiveCamera, opts: { showTarget: boolean }): void {
    // Portrait follows the form.
    if (this.portraitForm !== p.form.tier) {
      this.portraitForm = p.form.tier;
      drawPortrait(this.portrait, this.look, p.form, this.baseHair);
      this.root.style.setProperty('--form', p.form.tier > 0 ? p.form.auraColor : '#ffc21a');
    }
    const lv = this.q<HTMLElement>('.row1 .lv b');
    if (lv.textContent !== String(p.level)) lv.textContent = String(p.level);
    const nm = this.q<HTMLElement>('.row1 .nm');
    if (nm.textContent !== p.name) nm.textContent = p.name;
    const fm = this.q<HTMLElement>('.row1 .form');
    const ft = p.form.tier > 0 ? p.form.title : '';
    if (fm.textContent !== ft) fm.textContent = ft;
    // HP with a held-then-draining damage ghost.
    const hp = Math.max(0, p.hp / p.maxHp);
    if (hp < this.lastHp - 1e-4) this.ghostHold = 0.6;
    this.lastHp = hp;
    this.ghostHold -= dt;
    if (this.ghostHold <= 0) this.ghost = Math.max(hp, this.ghost - dt * 0.7);
    this.ghost = Math.max(this.ghost, hp);
    this.q<HTMLElement>('.ak-hud-me .hp .fill').style.transform = `scaleX(${hp.toFixed(4)})`;
    this.q<HTMLElement>('.ak-hud-me .hp .ghost').style.transform = `scaleX(${this.ghost.toFixed(4)})`;
    const hpn = `${Math.ceil(p.hp).toLocaleString('en-US')} / ${p.maxHp.toLocaleString('en-US')}`;
    const hpEl = this.q<HTMLElement>('.ak-hud-me .hp .num');
    if (hpEl.textContent !== hpn) hpEl.textContent = hpn;
    this.root.classList.toggle('lowhp', hp < 0.3 && p.alive);
    // Energy / Ki.
    const en = p.energy / COMBAT.energyMax;
    this.q<HTMLElement>('.en .fill').style.transform = `scaleX(${en.toFixed(4)})`;
    this.q<HTMLElement>('.en').classList.toggle('ready', p.energy >= COMBAT.exCost);
    this.q<HTMLElement>('.ki .fill').style.transform = `scaleX(${(p.ki / p.derived.maxKi).toFixed(4)})`;
    // PL rolls like a scouter.
    const pl = p.powerLevel;
    this.shownPL += (pl - this.shownPL) * (1 - Math.exp(-dt * 7));
    if (Math.abs(pl - this.shownPL) < 1) this.shownPL = pl;
    const plEl = this.q<HTMLElement>('.row2 .pl b');
    const plt = formatPL(this.shownPL);
    if (plEl.textContent !== plt) plEl.textContent = plt;
    this.q<HTMLElement>('.row2 .xp i').style.transform = `scaleX(${Math.min(1, prof.xp / xpToNext(prof.level)).toFixed(4)})`;
    // Surge.
    const sg = p.surge / COMBAT.surgeMax;
    this.q<HTMLElement>('.ak-hud-surge .fill').style.transform = `scaleX(${sg.toFixed(4)})`;
    const nf = nextForm(p.form.tier, p.level, p.surge);
    const canForm = !!nf && nf.tier <= p.maxTier;
    const state = p.surge >= COMBAT.surgeMax ? 'MAXIMUM' : canForm ? 'TRANSFORM READY' : p.surge >= COMBAT.ultimateCost ? 'ULTIMATE READY' : '';
    const sEl = this.q<HTMLElement>('.ak-hud-surge .state');
    if (sEl.textContent !== state) sEl.textContent = state;
    const surgeBox = this.q<HTMLElement>('.ak-hud-surge');
    surgeBox.classList.toggle('max', p.surge >= COMBAT.surgeMax);
    surgeBox.classList.toggle('ult', p.surge >= COMBAT.ultimateCost);
    surgeBox.classList.toggle('form', canForm);
    // Buffs.
    this.updateBuffs(p);
    // Target.
    this.updateTarget(dt, p, opts.showTarget);
    // Combo decay.
    if (this.comboT > 0) {
      this.comboT -= dt;
      this.q<HTMLElement>('.ak-hud-combo .timer i').style.transform = `scaleX(${Math.max(0, this.comboT / 2.6).toFixed(3)})`;
      if (this.comboT <= 0) {
        this.combo = 0;
        this.q<HTMLElement>('.ak-hud-combo').classList.remove('on');
      }
    }
    // Key hints readiness.
    this.keys.get('heavy')!.classList.toggle('ready', p.energy >= COMBAT.exCost);
    (this.keys.get('heavy')!.querySelector('span') as HTMLElement).textContent = p.energy >= COMBAT.exCost ? 'EX SPECIAL' : 'SPECIAL';
    this.keys.get('ki')!.classList.toggle('ready', p.surge >= COMBAT.ultimateCost);
    (this.keys.get('ki')!.querySelector('span') as HTMLElement).textContent = p.surge >= COMBAT.ultimateCost ? 'ULTIMATE (HOLD)' : 'KI BLAST';
    this.keys.get('power')!.classList.toggle('ready', canForm);
    (this.keys.get('power')!.querySelector('span') as HTMLElement).textContent = canForm ? 'TRANSFORM (HOLD)' : p.form.tier > 0 ? 'POWER · T×2 REVERT' : 'POWER UP';
    // Damage numbers.
    this.updateNumbers(dt, camera);
  }

  private updateBuffs(p: Hero): void {
    const box = this.q<HTMLElement>('.ak-hud-buffs');
    const seen = new Set<string>();
    for (const b of p.buffs.list) {
      const def = BUFFS[b.id];
      seen.add(b.id);
      let el = this.buffEls.get(b.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `bf ${def.kind}`;
        el.style.setProperty('--bc', def.color);
        el.title = `${def.name}: ${def.desc}`;
        el.innerHTML = `<i class="ring"></i><span class="g">${def.glyph}</span><b class="n"></b>`;
        box.appendChild(el);
        this.buffEls.set(b.id, el);
        el.classList.add('in');
      }
      const n = el.querySelector('.n') as HTMLElement;
      const st = b.stacks > 1 ? String(b.stacks) : '';
      if (n.textContent !== st) {
        n.textContent = st;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
      const frac = Number.isFinite(def.duration) ? Math.max(0, b.remaining / def.duration) : 1;
      (el.querySelector('.ring') as HTMLElement).style.setProperty('--p', `${(frac * 360).toFixed(1)}deg`);
    }
    for (const [id, el] of this.buffEls) {
      if (!seen.has(id)) {
        el.remove();
        this.buffEls.delete(id);
      }
    }
  }

  private updateTarget(dt: number, p: Hero, show: boolean): void {
    const box = this.q<HTMLElement>('.ak-hud-target');
    const t = p.target;
    const ok = show && !!t && (t.alive || t.sinceHit < 1.2) && t.pos.distanceTo(p.pos) < 40;
    box.classList.toggle('on', ok);
    if (!ok || !t) return;
    if (t !== this.tWho) {
      this.tWho = t;
      this.tGhost = this.tLast = t.hp / t.maxHp;
      (box.querySelector('.nm') as HTMLElement).textContent = t.name;
    }
    (box.querySelector('.lv') as HTMLElement).textContent = `LV ${t.level}`;
    (box.querySelector('.pl') as HTMLElement).textContent = `PL ${formatPL(t.powerLevel)}`;
    const hp = Math.max(0, t.hp / t.maxHp);
    if (hp < this.tLast - 1e-4) this.tGhostHold = 0.5;
    this.tLast = hp;
    this.tGhostHold -= dt;
    if (this.tGhostHold <= 0) this.tGhost = Math.max(hp, this.tGhost - dt * 0.8);
    this.tGhost = Math.max(this.tGhost, hp);
    (box.querySelector('.hp .fill') as HTMLElement).style.transform = `scaleX(${hp.toFixed(4)})`;
    (box.querySelector('.hp .ghost') as HTMLElement).style.transform = `scaleX(${this.tGhost.toFixed(4)})`;
    const dz = t.stunned ? t.stunTimer / COMBAT.stunDuration : t.daze / t.dazeMax;
    (box.querySelector('.daze .fill') as HTMLElement).style.transform = `scaleX(${dz.toFixed(4)})`;
    box.classList.toggle('stunned', t.stunned);
    (box.querySelector('.daze span') as HTMLElement).textContent = t.stunned ? `STUNNED ${t.stunTimer.toFixed(1)}s` : 'DAZE';
    box.classList.toggle('boss', t.level >= p.level + 5);
  }

  private updateNumbers(dt: number, camera: THREE.PerspectiveCamera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i];
      d.t += dt;
      if (d.t >= d.life) {
        this.recycle(d);
        this.dmg.splice(i, 1);
        continue;
      }
      const s = _v.copy(d.pos).project(camera);
      if (s.z > 1) {
        d.el.style.opacity = '0';
        continue;
      }
      // Pop in, float up and drift, then fade.
      const k = d.t / d.life;
      const pop = d.t < 0.08 ? 1.7 - (d.t / 0.08) * 0.7 : 1;
      const x = (s.x * 0.5 + 0.5) * w + d.vx * d.t;
      const y = (-s.y * 0.5 + 0.5) * h + d.vy * d.t + 90 * d.t * d.t;
      d.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(d.scale * pop).toFixed(3)})`;
      d.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
  }
}
