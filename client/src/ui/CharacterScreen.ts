import {
  FORMS,
  STAT_INFO,
  STAT_KEYS,
  balanceRatio,
  basePowerLevel,
  cloneStats,
  deriveStats,
  formatPL,
  maxUnlockedTier,
  xpToNext,
  type Profile,
  type StatKey,
  type Stats,
} from '@ak/shared';
import type { SaveService } from '../net/SaveService.ts';
import './styles/character.css';

type Tab = 'status' | 'forms' | 'ranking';

const ROMAN = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const STAT_COLOR: Record<StatKey, string> = {
  str: '#ff6a3d',
  ki: '#3cc8ff',
  vit: '#5dff7a',
  agi: '#c6ff3c',
  imp: '#ffc21a',
  foc: '#c98bff',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 104;
const CX = 140;
const CY = 136;

function axis(i: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / STAT_KEYS.length;
  return [Math.cos(a), Math.sin(a)];
}

function hexPath(k: number): string {
  return (
    STAT_KEYS.map((_, i) => {
      const [x, y] = axis(i);
      return `${i ? 'L' : 'M'}${(CX + x * R * k).toFixed(1)},${(CY + y * R * k).toFixed(1)}`;
    }).join('') + 'Z'
  );
}

function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * STATUS screen ("Ki-Punk" panel): identity + XP, a scouter power-level readout with a live preview of pending
 * points, the six-stat hexagon radar (current vs. preview, with the balance ratio that drives PL), hold-to-repeat
 * allocation with derived-stat deltas, auto-balance / reset / respec, the transformation ladder and the ranking.
 * While open the world is frozen and the camera frames the fighter on the right.
 */
export class CharacterScreen {
  private el: HTMLDivElement;
  private tab: Tab = 'status';
  private pending: Stats = { str: 0, ki: 0, vit: 0, agi: 0, imp: 0, foc: 0 };
  private sel = 0;
  private open_ = false;
  private shownPL = 0;
  private shownDelta = 0;
  private raf = 0;
  private repeat = 0;
  private respecArmed = 0;
  /** Animated radar polygon radii (current, preview) per axis. */
  private radarCur = new Float32Array(6);
  private radarPrev = new Float32Array(6);
  private q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  /** Touch layouts show bigger buttons and no key hints. */
  touch = false;

  constructor(
    private save: SaveService,
    parent: HTMLElement = document.getElementById('ui-root') ?? document.body,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ak-cs';
    this.el.innerHTML = this.template();
    parent.appendChild(this.el);
    this.buildRadar();
    this.bind();
    save.onChange(() => {
      if (this.open_) this.render();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /* ---------------------------------------------------------------- markup */

  private template(): string {
    const rows = STAT_KEYS.map(
      (k, i) => `
      <div class="ak-cs-row" data-k="${k}" data-i="${i}" style="--sc:${STAT_COLOR[k]};--d:${i * 40}ms">
        <span class="glyph">${STAT_INFO[k].short}</span>
        <span class="lbl">${STAT_INFO[k].label}</span>
        <span class="val"><b></b><em></em></span>
        <span class="btns">
          <button class="dec" data-k="${k}" aria-label="Remove a point from ${STAT_INFO[k].label}">−</button>
          <button class="inc" data-k="${k}" aria-label="Add a point to ${STAT_INFO[k].label}">+</button>
        </span>
        <i class="bar"><i class="now"></i><i class="add"></i></i>
      </div>`,
    ).join('');
    return `
      <div class="ak-cs-shade"></div>
      <div class="ak-cs-panel">
        <div class="ak-cs-head">
          <div class="ak-cs-title">STATUS<span>FIGHTER RECORD</span></div>
          <nav class="ak-cs-tabs">
            <button data-tab="status" class="on">STATUS</button>
            <button data-tab="forms">FORMS</button>
            <button data-tab="ranking">RANKING</button>
          </nav>
          <button class="ak-cs-close" aria-label="Close"><span>ESC</span>✕</button>
        </div>

        <section class="ak-cs-tab" data-tab="status">
          <div class="ak-cs-id">
            <div class="lv"><small>LV</small><b></b></div>
            <div class="who">
              <input class="name" maxlength="16" spellcheck="false" aria-label="Fighter name" />
              <span class="mode"></span>
              <div class="xp"><i></i><span></span></div>
              <div class="rec"></div>
            </div>
          </div>

          <div class="ak-cs-scouter">
            <span class="t">POWER LEVEL</span>
            <span class="v"></span>
            <span class="d"></span>
            <div class="bal"><span>BALANCE</span><i><i></i><i class="p"></i></i><b></b></div>
          </div>

          <div class="ak-cs-grid">
            <div class="ak-cs-radar"></div>
            <div class="ak-cs-rows">${rows}</div>
          </div>
          <div class="ak-cs-desc"></div>

          <div class="ak-cs-derived"></div>

          <div class="ak-cs-foot">
            <div class="pts"><b></b><span>STAT POINTS</span></div>
            <div class="acts">
              <button class="auto"><span class="full">AUTO-BALANCE</span><span class="short">AUTO</span></button>
              <button class="reset">CLEAR</button>
              <button class="respec">RESPEC</button>
              <button class="confirm">CONFIRM</button>
            </div>
          </div>
        </section>

        <section class="ak-cs-tab" data-tab="forms"><div class="ak-cs-forms"></div></section>
        <section class="ak-cs-tab" data-tab="ranking"><div class="ak-cs-rank"></div></section>
        <div class="ak-cs-hint"></div>
      </div>`;
  }

  private buildRadar(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 280 272');
    svg.classList.add('radar');
    const mk = (tag: string, attrs: Record<string, string>, parent: Element = svg) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      parent.appendChild(n);
      return n;
    };
    const defs = mk('defs', {});
    const grad = mk('radialGradient', { id: 'akRadarFill', cx: '50%', cy: '50%', r: '60%' }, defs);
    mk('stop', { offset: '0%', 'stop-color': '#fff3b0', 'stop-opacity': '0.65' }, grad);
    mk('stop', { offset: '100%', 'stop-color': '#ffc21a', 'stop-opacity': '0.28' }, grad);
    for (const k of [1, 0.75, 0.5, 0.25]) mk('path', { d: hexPath(k), class: k === 1 ? 'rim' : 'ring' });
    STAT_KEYS.forEach((key, i) => {
      const [x, y] = axis(i);
      mk('line', { x1: String(CX), y1: String(CY), x2: (CX + x * R).toFixed(1), y2: (CY + y * R).toFixed(1), class: 'spoke' });
      const tx = CX + x * (R + 20);
      const ty = CY + y * (R + 16);
      const g = mk('g', { class: 'axl', transform: `translate(${tx.toFixed(1)},${ty.toFixed(1)})` });
      (g as SVGGElement).style.setProperty('--sc', STAT_COLOR[key]);
      const t1 = mk('text', { class: 'k', 'text-anchor': 'middle', y: '-2' }, g);
      t1.textContent = STAT_INFO[key].short;
      const t2 = mk('text', { class: 'n', 'text-anchor': 'middle', y: '12', 'data-k': key }, g);
      t2.textContent = '';
    });
    mk('path', { class: 'prev', d: '' });
    mk('path', { class: 'cur', d: '' });
    STAT_KEYS.forEach((key) => mk('circle', { class: 'dot', r: '3.6', 'data-k': key }));
    this.q('.ak-cs-radar').appendChild(svg);
  }

  /* ---------------------------------------------------------------- events */

  private bind(): void {
    this.q('.ak-cs-close').addEventListener('click', () => this.close());
    this.q('.ak-cs-shade').addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLButtonElement>('.ak-cs-tabs button').forEach((b) =>
      b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab)),
    );
    // Hold-to-repeat +/- (accelerating).
    this.el.querySelectorAll<HTMLButtonElement>('.ak-cs-row button').forEach((b) => {
      const dir = b.classList.contains('inc') ? 1 : -1;
      const key = b.dataset.k as StatKey;
      const stop = () => {
        clearTimeout(this.repeat);
        this.repeat = 0;
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.sel = STAT_KEYS.indexOf(key);
        const step = e.shiftKey ? 5 : 1;
        this.bump(key, dir * step);
        let delay = 340;
        const again = () => {
          this.bump(key, dir * step);
          delay = Math.max(28, delay * 0.78);
          this.repeat = window.setTimeout(again, delay);
        };
        this.repeat = window.setTimeout(again, delay);
      });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('lostpointercapture', stop);
    });
    this.el.querySelectorAll<HTMLElement>('.ak-cs-row').forEach((row) => {
      row.addEventListener('pointerenter', () => {
        this.sel = Number(row.dataset.i);
        this.renderSel();
      });
    });
    this.q('.auto').addEventListener('click', () => this.autoBalance());
    this.q('.reset').addEventListener('click', () => {
      this.clearPending();
      this.render();
    });
    this.q('.confirm').addEventListener('click', () => this.confirm());
    this.q('.respec').addEventListener('click', () => this.respec());
    const name = this.q<HTMLInputElement>('.name');
    name.addEventListener('change', () => {
      this.save.rename(name.value);
      name.value = this.save.profile.name;
    });
    name.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (!this.open_) return;
    const k = e.code;
    if (k === 'Escape' || k === 'KeyC') {
      e.preventDefault();
      this.close();
      return;
    }
    if (k === 'Tab' || k === 'KeyQ' || k === 'KeyE') {
      e.preventDefault();
      const order: Tab[] = ['status', 'forms', 'ranking'];
      const d = k === 'KeyQ' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
      this.setTab(order[(order.indexOf(this.tab) + d + order.length) % order.length]);
      return;
    }
    if (this.tab !== 'status') return;
    const step = e.shiftKey ? 5 : 1;
    if (k === 'ArrowUp' || k === 'KeyW') this.sel = (this.sel + 5) % 6;
    else if (k === 'ArrowDown' || k === 'KeyS') this.sel = (this.sel + 1) % 6;
    else if (k === 'ArrowRight' || k === 'KeyD') this.bump(STAT_KEYS[this.sel], step);
    else if (k === 'ArrowLeft' || k === 'KeyA') this.bump(STAT_KEYS[this.sel], -step);
    else if (k === 'Enter' || k === 'Space') this.confirm();
    else if (k === 'KeyB') this.autoBalance();
    else if (/^Digit[1-6]$/.test(k)) this.sel = Number(k.slice(5)) - 1;
    else return;
    e.preventDefault();
    this.renderSel();
  }

  /* ---------------------------------------------------------------- state */

  private get pendingSum(): number {
    let s = 0;
    for (const k of STAT_KEYS) s += this.pending[k];
    return s;
  }

  private preview(): Stats {
    const s = cloneStats(this.save.profile.stats);
    for (const k of STAT_KEYS) s[k] += this.pending[k];
    return s;
  }

  private clearPending(): void {
    for (const k of STAT_KEYS) this.pending[k] = 0;
  }

  private bump(k: StatKey, d: number): void {
    const free = this.save.profile.unspent - this.pendingSum;
    const n = d > 0 ? Math.min(d, free) : Math.max(d, -this.pending[k]);
    if (n === 0) {
      this.nudge(d > 0 ? '.pts' : `.ak-cs-row[data-k="${k}"] .val`);
      return;
    }
    this.pending[k] += n;
    const row = this.q<HTMLElement>(`.ak-cs-row[data-k="${k}"]`);
    row.classList.remove('pop');
    void row.offsetWidth;
    row.classList.add('pop');
    this.render();
  }

  /** Spend the remaining points to raise the lowest stats first (the most PL per point). */
  private autoBalance(): void {
    let free = this.save.profile.unspent - this.pendingSum;
    if (free <= 0) {
      this.nudge('.pts');
      return;
    }
    const s = this.preview();
    while (free-- > 0) {
      let lo: StatKey = STAT_KEYS[0];
      for (const k of STAT_KEYS) if (s[k] < s[lo]) lo = k;
      s[lo]++;
      this.pending[lo]++;
    }
    this.render();
  }

  private confirm(): void {
    if (this.pendingSum <= 0) {
      this.nudge('.pts');
      return;
    }
    const delta: Partial<Record<StatKey, number>> = {};
    for (const k of STAT_KEYS) if (this.pending[k] > 0) delta[k] = this.pending[k];
    if (this.save.allocate(delta)) {
      this.clearPending();
      const sc = this.q<HTMLElement>('.ak-cs-scouter');
      sc.classList.remove('surge');
      void sc.offsetWidth;
      sc.classList.add('surge');
    }
    this.render();
  }

  private respec(): void {
    const b = this.q<HTMLButtonElement>('.respec');
    if (performance.now() - this.respecArmed > 2600) {
      this.respecArmed = performance.now();
      b.classList.add('armed');
      b.textContent = 'REFUND ALL?';
      window.setTimeout(() => {
        if (performance.now() - this.respecArmed >= 2500) {
          b.classList.remove('armed');
          b.textContent = 'RESPEC';
        }
      }, 2600);
      return;
    }
    this.respecArmed = 0;
    b.classList.remove('armed');
    b.textContent = 'RESPEC';
    this.clearPending();
    this.save.respec();
    this.render();
  }

  private nudge(sel: string): void {
    const n = this.el.querySelector(sel) as HTMLElement | null;
    if (!n) return;
    n.classList.remove('deny');
    void n.offsetWidth;
    n.classList.add('deny');
  }

  setTab(t: Tab): void {
    this.tab = t;
    this.el.querySelectorAll<HTMLElement>('.ak-cs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    this.el.querySelectorAll<HTMLElement>('.ak-cs-tab').forEach((s) => s.classList.toggle('on', s.dataset.tab === t));
    if (t === 'forms') this.renderForms();
    if (t === 'ranking') void this.renderRanking();
    this.renderHint();
  }

  open(tab: Tab = 'status'): void {
    if (this.open_) return;
    this.open_ = true;
    this.shownPL = basePowerLevel(this.save.profile.stats);
    this.shownDelta = 0;
    const cur = this.save.profile.stats;
    const scale = this.radarScale(cur);
    STAT_KEYS.forEach((k, i) => {
      this.radarCur[i] = 0;
      this.radarPrev[i] = cur[k] / scale;
    });
    this.el.classList.toggle('touch', this.touch);
    this.el.querySelectorAll<HTMLElement>('.ak-cs-tab').forEach((t) => (t.scrollTop = 0));
    this.el.classList.add('on');
    this.setTab(tab);
    this.render();
    this.onOpen?.();
    const loop = () => {
      this.animate();
      if (this.open_) this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    clearTimeout(this.repeat);
    this.el.classList.remove('on');
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.onClose?.();
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /* ---------------------------------------------------------------- rendering */

  private radarScale(s: Stats): number {
    let m = 0;
    for (const k of STAT_KEYS) m = Math.max(m, s[k]);
    return Math.max(20, m * 1.08);
  }

  private render(): void {
    const p = this.save.profile;
    const prev = this.preview();
    const free = p.unspent - this.pendingSum;
    const lvl = this.q<HTMLElement>('.ak-cs-id .lv b');
    if (lvl.textContent !== String(p.level)) lvl.textContent = String(p.level);
    const name = this.q<HTMLInputElement>('.name');
    if (document.activeElement !== name) name.value = p.name;
    const mode = this.q<HTMLElement>('.mode');
    mode.textContent = this.save.mode === 'online' ? '● ONLINE' : '○ OFFLINE SAVE';
    mode.classList.toggle('online', this.save.mode === 'online');
    const need = xpToNext(p.level);
    this.q<HTMLElement>('.xp i').style.transform = `scaleX(${Math.min(1, p.xp / need).toFixed(4)})`;
    this.q<HTMLElement>('.xp span').textContent = `${p.xp.toLocaleString('en-US')} / ${need.toLocaleString('en-US')} XP`;
    this.q<HTMLElement>('.rec').innerHTML =
      `<span>ARENA</span><b>${p.wins}</b>W <b>${p.losses}</b>L<span>BEST PL</span><b>${formatPL(p.bestPL)}</b>`;

    // Stat rows.
    const scale = this.radarScale(prev);
    for (const k of STAT_KEYS) {
      const row = this.q<HTMLElement>(`.ak-cs-row[data-k="${k}"]`);
      (row.querySelector('.val b') as HTMLElement).textContent = String(p.stats[k]);
      const add = this.pending[k];
      const em = row.querySelector('.val em') as HTMLElement;
      em.textContent = add > 0 ? `+${add}` : '';
      row.classList.toggle('added', add > 0);
      (row.querySelector('.bar .now') as HTMLElement).style.transform = `scaleX(${(p.stats[k] / scale).toFixed(4)})`;
      (row.querySelector('.bar .add') as HTMLElement).style.transform = `scaleX(${(prev[k] / scale).toFixed(4)})`;
      (row.querySelector('.inc') as HTMLButtonElement).disabled = free <= 0;
      (row.querySelector('.dec') as HTMLButtonElement).disabled = add <= 0;
      const label = this.el.querySelector(`.radar text.n[data-k="${k}"]`);
      if (label) label.textContent = add > 0 ? `${prev[k]}` : `${p.stats[k]}`;
    }
    const pts = this.q<HTMLElement>('.pts');
    this.q<HTMLElement>('.pts b').textContent = String(free);
    pts.classList.toggle('has', free > 0);
    const any = this.pendingSum > 0;
    this.q<HTMLButtonElement>('.confirm').disabled = !any;
    this.q<HTMLButtonElement>('.reset').disabled = !any;
    this.q<HTMLButtonElement>('.auto').disabled = free <= 0;
    this.el.classList.toggle('dirty', any);

    // Balance.
    const bNow = balanceRatio(p.stats);
    const bPrev = balanceRatio(prev);
    this.q<HTMLElement>('.bal i i:not(.p)').style.transform = `scaleX(${bNow.toFixed(4)})`;
    this.q<HTMLElement>('.bal i i.p').style.transform = `scaleX(${bPrev.toFixed(4)})`;
    const bal = this.q<HTMLElement>('.bal b');
    bal.textContent = any && Math.abs(bPrev - bNow) > 0.0005 ? `${pct(bNow, 1)} → ${pct(bPrev, 1)}` : pct(bNow, 1);
    bal.classList.toggle('up', any && bPrev > bNow + 0.0005);
    bal.classList.toggle('down', any && bPrev < bNow - 0.0005);

    this.renderDerived(p, prev);
    this.renderSel();
  }

  private renderDerived(p: Profile, prev: Stats): void {
    const a = deriveStats(p.stats, p.level);
    const b = deriveStats(prev, p.level);
    const rows: [string, number, number, (v: number) => string][] = [
      ['HP', a.maxHp, b.maxHp, (v) => Math.round(v).toLocaleString('en-US')],
      ['ATK', a.atk, b.atk, (v) => String(Math.round(v))],
      ['KI ATK', a.kiAtk, b.kiAtk, (v) => String(Math.round(v))],
      ['DEF', a.def, b.def, (v) => String(Math.round(v))],
      ['CRIT', a.critRate, b.critRate, (v) => pct(v, 1)],
      ['CRIT DMG', a.critDmg, b.critDmg, (v) => pct(v, 0)],
      ['SPEED', a.moveSpeed, b.moveSpeed, (v) => pct(v, 1)],
      ['DAZE', a.impact, b.impact, (v) => pct(v, 0)],
      ['KI POOL', a.maxKi, b.maxKi, (v) => String(Math.round(v))],
      ['ENERGY', a.energyRegen, b.energyRegen, (v) => pct(v, 0)],
    ];
    this.q<HTMLElement>('.ak-cs-derived').innerHTML = rows
      .map(([l, x, y, f]) => {
        const up = y > x + 1e-6;
        // Preview replaces the value in place (cyan, with the current value as a tooltip).
        return `<div class="${up ? 'up' : ''}" title="${up ? `${f(x)} → ${f(y)}` : f(x)}"><span>${l}</span><b>${up ? `${f(y)}<i>▲</i>` : f(x)}</b></div>`;
      })
      .join('');
  }

  private renderSel(): void {
    this.el.querySelectorAll<HTMLElement>('.ak-cs-row').forEach((r, i) => r.classList.toggle('sel', i === this.sel));
    const k = STAT_KEYS[this.sel];
    this.q<HTMLElement>('.ak-cs-desc').innerHTML = `<b style="color:${STAT_COLOR[k]}">${STAT_INFO[k].label.toUpperCase()}</b> ${STAT_INFO[k].desc}`;
  }

  private renderHint(): void {
    const h = this.q<HTMLElement>('.ak-cs-hint');
    if (this.touch) {
      h.textContent = '';
      return;
    }
    h.innerHTML =
      this.tab === 'status'
        ? '<kbd>W</kbd><kbd>S</kbd> select <kbd>A</kbd><kbd>D</kbd> spend <kbd>Shift</kbd> ×5 <kbd>B</kbd> auto-balance <kbd>Enter</kbd> confirm <kbd>Q</kbd><kbd>E</kbd> tabs <kbd>Esc</kbd> close'
        : '<kbd>Q</kbd><kbd>E</kbd> tabs <kbd>Esc</kbd> close';
  }

  private renderForms(): void {
    const p = this.save.profile;
    const unlocked = maxUnlockedTier(p.level);
    this.q<HTMLElement>('.ak-cs-forms').innerHTML = FORMS.map((f, i) => {
      const locked = f.tier > unlocked;
      const state = locked ? `UNLOCKS AT LV ${f.unlockLevel}` : f.tier === 0 ? 'ALWAYS' : `HOLD T · ${f.surgeCost.toLocaleString('en-US')} SURGE`;
      return `<div class="ak-cs-form${locked ? ' locked' : ''}" style="--hc:${f.hairColor};--ac:${f.auraColor};--d:${i * 50}ms">
        <div class="tier">${ROMAN[f.tier]}</div>
        <div class="sw"><i class="hair"></i><i class="aura"></i></div>
        <div class="info">
          <b>${f.title}</b>
          <span>${state}</span>
        </div>
        <div class="mods">
          <span><small>PL</small>×${f.plMult.toLocaleString('en-US')}</span>
          <span><small>ATK</small>×${f.atkMult.toFixed(2)}</span>
          <span><small>SPD</small>×${f.speedMult.toFixed(2)}</span>
          <span><small>DODGE</small>×${f.dodgeWindowMult.toFixed(2)}</span>
        </div>
        ${locked ? '<div class="lock">LOCKED</div>' : ''}
      </div>`;
    }).join('');
  }

  private async renderRanking(): Promise<void> {
    const box = this.q<HTMLElement>('.ak-cs-rank');
    box.innerHTML = '<div class="ak-cs-loading">SCANNING POWER LEVELS…</div>';
    const list = await this.save.leaderboard();
    if (this.tab !== 'ranking') return;
    const offline = this.save.mode !== 'online';
    box.innerHTML = `
      <div class="ak-cs-rank-head"><span>#</span><span>FIGHTER</span><span>LV</span><span>BEST PL</span><span>WINS</span></div>
      ${list
        .map(
          (e, i) => `<div class="ak-cs-rank-row${e.you ? ' you' : ''}${i < 3 ? ` top${i + 1}` : ''}" style="--d:${i * 30}ms">
            <span>${i + 1}</span><span>${e.name.replace(/[<>&]/g, '')}</span><span>${e.level}</span><span>${formatPL(e.bestPL)}</span><span>${e.wins}</span></div>`,
        )
        .join('')}
      ${offline ? '<div class="ak-cs-note">Offline save — run the game server to compete on the shared ranking.</div>' : ''}`;
  }

  /** Per-frame tweening: scouter PL roll, delta counter and radar morph. */
  private animate(): void {
    const p = this.save.profile;
    const prev = this.preview();
    const plNow = basePowerLevel(p.stats);
    const plPrev = basePowerLevel(prev);
    this.shownPL += (plNow - this.shownPL) * 0.16;
    if (Math.abs(plNow - this.shownPL) < 0.5) this.shownPL = plNow;
    const delta = plPrev - plNow;
    this.shownDelta += (delta - this.shownDelta) * 0.22;
    if (Math.abs(delta - this.shownDelta) < 0.5) this.shownDelta = delta;
    const v = this.q<HTMLElement>('.ak-cs-scouter .v');
    const txt = formatPL(this.shownPL);
    if (v.textContent !== txt) v.textContent = txt;
    const d = this.q<HTMLElement>('.ak-cs-scouter .d');
    const dt = this.shownDelta >= 1 ? `+${formatPL(this.shownDelta)}` : '';
    if (d.textContent !== dt) d.textContent = dt;

    // Radar morph.
    const scale = this.radarScale(prev);
    let curD = '';
    let prevD = '';
    STAT_KEYS.forEach((k, i) => {
      this.radarCur[i] += (p.stats[k] / scale - this.radarCur[i]) * 0.18;
      this.radarPrev[i] += (prev[k] / scale - this.radarPrev[i]) * 0.25;
      const [x, y] = axis(i);
      const c = this.radarCur[i] * R;
      const q = this.radarPrev[i] * R;
      curD += `${i ? 'L' : 'M'}${(CX + x * c).toFixed(1)},${(CY + y * c).toFixed(1)}`;
      prevD += `${i ? 'L' : 'M'}${(CX + x * q).toFixed(1)},${(CY + y * q).toFixed(1)}`;
      const dot = this.el.querySelector(`.radar circle[data-k="${k}"]`);
      dot?.setAttribute('cx', (CX + x * q).toFixed(1));
      dot?.setAttribute('cy', (CY + y * q).toFixed(1));
    });
    this.el.querySelector('.radar .cur')?.setAttribute('d', curD + 'Z');
    this.el.querySelector('.radar .prev')?.setAttribute('d', prevD + 'Z');
  }
}
