import { DIFFICULTIES, FORMS, formatPL, type Difficulty } from '@ak/shared';
import './styles/arena.css';

const ORDER: Difficulty[] = ['easy', 'normal', 'hard', 'elite'];
const TIER_COLOR: Record<Difficulty, string> = { easy: '#5dff7a', normal: '#3cc8ff', hard: '#ffc21a', elite: '#ff3b3b' };
const SKILL_TEXT: Record<Difficulty, string> = {
  easy: 'Slow reads, rarely dodges. A warm-up.',
  normal: 'Fights back. Dodges and parries now and then.',
  hard: 'Punishes whiffs, reads wind-ups, flies and beams.',
  elite: 'Near-perfect defence. Transforms the moment it can.',
};

export interface FighterCard {
  name: string;
  level: number;
  pl: number;
  sub: string;
}

export interface MatchStatsView {
  time: number;
  dealt: number;
  taken: number;
  maxCombo: number;
  perfectDodges: number;
  parries: number;
  chains: number;
}

export interface ResultView {
  outcome: 'win' | 'loss';
  reason: 'ko' | 'ringout' | 'time';
  difficulty: Difficulty;
  rival: string;
  stats: MatchStatsView;
  levelsGained: number;
  levelFrom: number;
  levelTo: number;
  plFrom: number;
  plTo: number;
  /** A win that the server refused to count (e.g. finished implausibly fast). */
  uncounted: boolean;
  unlockedForms: string[];
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Every arena screen: difficulty select (four rival cards with predicted PL and AI temperament), the VS intro with
 * READY/FIGHT, the fighting-game HUD (mirrored HP bars with damage ghosts, forms, PL, round timer, edge warning),
 * the K.O./RING OUT/TIME stamp and the result screen with the +5 level reward climb.
 */
export class ArenaUI {
  private root: HTMLDivElement;
  private sel: HTMLDivElement;
  private vs: HTMLDivElement;
  private hud: HTMLDivElement;
  private stamp: HTMLDivElement;
  private res: HTMLDivElement;
  private fade: HTMLDivElement;
  private pick: Difficulty = 'normal';
  private ghostL = 1;
  private ghostR = 1;
  private lastL = 1;
  private lastR = 1;
  private ghostHoldL = 0;
  private ghostHoldR = 0;
  private resRaf = 0;
  touch = false;
  onStart: ((d: Difficulty) => void) | null = null;
  onCancel: (() => void) | null = null;
  onRematch: (() => void) | null = null;
  onChange: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor(parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ak-arena';
    this.root.innerHTML = `
      <div class="ak-ar-fade"></div>
      <div class="ak-ar-hud">
        <div class="side l"><div class="nm"><b></b><span class="form"></span><span class="pl"></span></div>
          <div class="bar"><i class="ghost"></i><i class="fill"></i><i class="tick"></i></div></div>
        <div class="clock"><span></span><small>ROUND</small></div>
        <div class="side r"><div class="nm"><b></b><span class="form"></span><span class="pl"></span></div>
          <div class="bar"><i class="ghost"></i><i class="fill"></i><i class="tick"></i></div></div>
        <div class="edge">EDGE</div>
      </div>
      <div class="ak-ar-stamp"><b></b></div>
      <div class="ak-ar-vs">
        <div class="slab l"><small></small><b></b><span></span></div>
        <div class="mid"><b>VS</b></div>
        <div class="slab r"><small></small><b></b><span></span></div>
      </div>
      <div class="ak-ar-call"></div>
      <div class="ak-ar-sel">
        <div class="panel">
          <div class="head"><div class="t">TRAINING GROUNDS<span>RANKED SPAR · ROGUE ASCENDANT</span></div><button class="x" aria-label="Close">✕</button></div>
          <p class="rules">Knock out the rival or force them off the stage. A win is worth <b>+5 LEVELS</b> (+25 stat points). Three minutes on the clock.</p>
          <div class="cards">${ORDER.map(
            (d, i) => `<button class="card" data-d="${d}" style="--tc:${TIER_COLOR[d]};--d:${i * 60}ms">
              <span class="num">${i + 1}</span>
              <span class="tier">${DIFFICULTIES[d].label.toUpperCase()}</span>
              <span class="ratio">PL ×${DIFFICULTIES[d].plRatio.toFixed(2)}</span>
              <span class="pl"><small>RIVAL PL ≈</small><b></b></span>
              <span class="skill"><small>AI SKILL</small><i><i style="transform:scaleX(${DIFFICULTIES[d].skill})"></i></i></span>
              <span class="txt">${SKILL_TEXT[d]}</span>
              <span class="form"></span>
            </button>`,
          ).join('')}</div>
          <div class="foot"><span class="rec"></span><span class="hint"></span><button class="go">FIGHT</button></div>
        </div>
      </div>
      <div class="ak-ar-res">
        <div class="panel">
          <div class="verdict"><b></b><span></span></div>
          <div class="body">
            <div class="stats"></div>
            <div class="reward">
              <small>REWARD</small>
              <div class="big"></div>
              <div class="lv"><span class="a"></span><i>▸</i><span class="b"></span></div>
              <div class="plr"><small>POWER LEVEL</small><b></b></div>
              <div class="note"></div>
            </div>
          </div>
          <div class="btns"><button class="rematch">REMATCH</button><button class="change">CHANGE RIVAL</button><button class="leave">LEAVE ARENA</button></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.sel = q('.ak-ar-sel');
    this.vs = q('.ak-ar-vs');
    this.hud = q('.ak-ar-hud');
    this.stamp = q('.ak-ar-stamp');
    this.res = q('.ak-ar-res');
    this.fade = q('.ak-ar-fade');
    this.sel.querySelectorAll<HTMLButtonElement>('.card').forEach((c) => {
      c.addEventListener('click', () => this.choose(c.dataset.d as Difficulty));
      c.addEventListener('dblclick', () => this.onStart?.(this.pick));
    });
    q('.ak-ar-sel .go').addEventListener('click', () => this.onStart?.(this.pick));
    q('.ak-ar-sel .x').addEventListener('click', () => this.onCancel?.());
    q('.ak-ar-res .rematch').addEventListener('click', () => this.onRematch?.());
    q('.ak-ar-res .change').addEventListener('click', () => this.onChange?.());
    q('.ak-ar-res .leave').addEventListener('click', () => this.onLeave?.());
    for (const el of [this.sel, this.res]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (this.sel.classList.contains('on')) {
      const i = ORDER.indexOf(this.pick);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.choose(ORDER[(i + 3) % 4]);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.choose(ORDER[(i + 1) % 4]);
      else if (/^Digit[1-4]$/.test(e.code)) this.choose(ORDER[Number(e.code.slice(5)) - 1]);
      else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF') this.onStart?.(this.pick);
      else if (e.code === 'Escape') this.onCancel?.();
      else return;
      e.preventDefault();
    } else if (this.res.classList.contains('show')) {
      if (e.code === 'Enter' || e.code === 'KeyR') this.onRematch?.();
      else if (e.code === 'KeyC') this.onChange?.();
      else if (e.code === 'Escape' || e.code === 'KeyL') this.onLeave?.();
      else return;
      e.preventDefault();
    }
  }

  get selecting(): boolean {
    return this.sel.classList.contains('on');
  }

  get showingResult(): boolean {
    return this.res.classList.contains('show');
  }

  /* ---------------------------------------------------------------- select */

  private choose(d: Difficulty): void {
    this.pick = d;
    this.sel.querySelectorAll<HTMLElement>('.card').forEach((c) => c.classList.toggle('on', c.dataset.d === d));
  }

  showSelect(opts: { playerPL: number; level: number; maxTier: number; wins: number; losses: number; last: Difficulty }): void {
    this.sel.classList.toggle('touch', this.touch);
    this.sel.querySelectorAll<HTMLElement>('.card').forEach((c) => {
      const d = c.dataset.d as Difficulty;
      const k = DIFFICULTIES[d];
      (c.querySelector('.pl b') as HTMLElement).textContent = formatPL(opts.playerPL * k.plRatio);
      const tier = Math.max(0, opts.maxTier + k.formOffset);
      (c.querySelector('.form') as HTMLElement).textContent = tier > 0 ? `Can transform: ${FORMS[tier].title}` : 'Base form only';
    });
    (this.sel.querySelector('.rec') as HTMLElement).innerHTML = `ARENA RECORD <b>${opts.wins}</b>W <b>${opts.losses}</b>L`;
    (this.sel.querySelector('.hint') as HTMLElement).innerHTML = this.touch
      ? ''
      : '<kbd>A</kbd><kbd>D</kbd> choose <kbd>Enter</kbd> fight <kbd>Esc</kbd> back';
    this.choose(opts.last);
    this.sel.classList.remove('on');
    void this.sel.offsetWidth;
    this.sel.classList.add('on');
  }

  hideSelect(): void {
    this.sel.classList.remove('on');
  }

  /* ---------------------------------------------------------------- fade */

  fadeOut(): Promise<void> {
    this.fade.classList.add('on');
    return new Promise((r) => setTimeout(r, 380));
  }

  fadeIn(): void {
    this.fade.classList.remove('on');
  }

  /* ---------------------------------------------------------------- versus intro */

  showVersus(a: FighterCard, b: FighterCard): void {
    const fill = (side: string, f: FighterCard) => {
      const s = this.vs.querySelector(`.slab.${side}`) as HTMLElement;
      (s.querySelector('small') as HTMLElement).textContent = `LV ${f.level} · ${f.sub}`;
      (s.querySelector('b') as HTMLElement).textContent = f.name;
      (s.querySelector('span') as HTMLElement).textContent = `PL ${formatPL(f.pl)}`;
    };
    fill('l', a);
    fill('r', b);
    this.callEl.textContent = '';
    this.callEl.className = 'ak-ar-call';
    this.vs.classList.remove('on', 'out');
    void this.vs.offsetWidth;
    this.vs.classList.add('on');
  }

  /** READY clears the VS cards off screen; FIGHT! slams in on its own. */
  call(text: string, kind: 'ready' | 'fight'): void {
    const c = this.callEl;
    c.textContent = text;
    c.className = `ak-ar-call ${kind}`;
    void c.offsetWidth;
    c.classList.add('go');
    if (kind === 'ready' && this.vs.classList.contains('on')) {
      this.vs.classList.add('out');
      setTimeout(() => this.vs.classList.remove('on', 'out'), 450);
    }
  }

  private get callEl(): HTMLElement {
    return this.root.querySelector('.ak-ar-call') as HTMLElement;
  }

  hideVersus(): void {
    this.vs.classList.remove('on', 'out');
  }

  /* ---------------------------------------------------------------- HUD */

  showHud(a: { name: string }, b: { name: string }): void {
    (this.hud.querySelector('.side.l .nm b') as HTMLElement).textContent = a.name;
    (this.hud.querySelector('.side.r .nm b') as HTMLElement).textContent = b.name;
    this.ghostL = this.ghostR = this.lastL = this.lastR = 1;
    this.hud.classList.add('on');
  }

  hideHud(): void {
    this.hud.classList.remove('on');
  }

  updateHud(
    dt: number,
    a: { hp: number; form: string; pl: number },
    b: { hp: number; form: string; pl: number },
    timeLeft: number,
    edge: number,
  ): void {
    const setSide = (side: 'l' | 'r', v: { hp: number; form: string; pl: number }) => {
      const s = this.hud.querySelector(`.side.${side}`) as HTMLElement;
      (s.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, v.hp).toFixed(4)})`;
      const f = s.querySelector('.form') as HTMLElement;
      if (f.textContent !== v.form) f.textContent = v.form;
      const pl = s.querySelector('.pl') as HTMLElement;
      const t = `PL ${formatPL(v.pl)}`;
      if (pl.textContent !== t) pl.textContent = t;
      s.classList.toggle('low', v.hp < 0.25);
    };
    setSide('l', a);
    setSide('r', b);
    // Damage ghosts hold for a beat, then drain.
    const ghost = (side: 'l' | 'r', hp: number) => {
      if (side === 'l') {
        if (hp < this.lastL - 1e-4) this.ghostHoldL = 0.55;
        this.lastL = hp;
        this.ghostHoldL -= dt;
        if (this.ghostHoldL <= 0) this.ghostL = Math.max(hp, this.ghostL - dt * 0.6);
        this.ghostL = Math.max(this.ghostL, hp);
        return this.ghostL;
      }
      if (hp < this.lastR - 1e-4) this.ghostHoldR = 0.55;
      this.lastR = hp;
      this.ghostHoldR -= dt;
      if (this.ghostHoldR <= 0) this.ghostR = Math.max(hp, this.ghostR - dt * 0.6);
      this.ghostR = Math.max(this.ghostR, hp);
      return this.ghostR;
    };
    (this.hud.querySelector('.side.l .ghost') as HTMLElement).style.transform = `scaleX(${ghost('l', a.hp).toFixed(4)})`;
    (this.hud.querySelector('.side.r .ghost') as HTMLElement).style.transform = `scaleX(${ghost('r', b.hp).toFixed(4)})`;
    const clock = this.hud.querySelector('.clock span') as HTMLElement;
    const ct = mmss(timeLeft);
    if (clock.textContent !== ct) clock.textContent = ct;
    this.hud.classList.toggle('hurry', timeLeft < 30);
    const e = this.hud.querySelector('.edge') as HTMLElement;
    e.classList.toggle('on', edge > 0);
    e.style.opacity = String(Math.min(1, edge));
  }

  /* ---------------------------------------------------------------- stamp */

  stampText(text: string, color: string): void {
    this.callEl.classList.remove('go');
    this.callEl.textContent = '';
    const s = this.stamp;
    (s.querySelector('b') as HTMLElement).textContent = text;
    s.style.setProperty('--sc', color);
    s.classList.remove('on');
    void s.offsetWidth;
    s.classList.add('on');
  }

  clearStamp(): void {
    this.stamp.classList.remove('on');
  }

  /* ---------------------------------------------------------------- result */

  showResult(v: ResultView): void {
    const r = this.res;
    const win = v.outcome === 'win';
    r.classList.toggle('win', win);
    r.classList.toggle('loss', !win);
    (r.querySelector('.verdict b') as HTMLElement).textContent = win ? 'VICTORY' : 'DEFEAT';
    const how = v.reason === 'ko' ? 'K.O.' : v.reason === 'ringout' ? 'RING OUT' : 'TIME';
    (r.querySelector('.verdict span') as HTMLElement).textContent = `${how} · VS ${v.rival.toUpperCase()} · ${DIFFICULTIES[v.difficulty].label.toUpperCase()}`;
    const st = v.stats;
    const rows: [string, string][] = [
      ['MATCH TIME', mmss(st.time)],
      ['DAMAGE DEALT', Math.round(st.dealt).toLocaleString('en-US')],
      ['DAMAGE TAKEN', Math.round(st.taken).toLocaleString('en-US')],
      ['BEST COMBO', `${st.maxCombo} HITS`],
      ['PERFECT DODGES', String(st.perfectDodges)],
      ['PERFECT PARRIES', String(st.parries)],
      ['CHAIN ATTACKS', String(st.chains)],
    ];
    (r.querySelector('.stats') as HTMLElement).innerHTML = rows
      .map(([k, val], i) => `<div style="--d:${300 + i * 70}ms"><span>${k}</span><b>${val}</b></div>`)
      .join('');
    const big = r.querySelector('.big') as HTMLElement;
    big.textContent = v.levelsGained > 0 ? `+${v.levelsGained} LEVELS` : win ? 'NOT COUNTED' : 'NO REWARD';
    big.classList.toggle('dim', v.levelsGained <= 0);
    const note = r.querySelector('.note') as HTMLElement;
    note.innerHTML = v.uncounted
      ? 'The judges ruled the bout too short to count.'
      : v.levelsGained > 0
        ? `+${v.levelsGained * 5} stat points to spend${v.unlockedForms.length ? `<br><em>NEW FORM: ${v.unlockedForms.map(esc).join(', ')}</em>` : ''}`
        : 'Train, spend your points and try again.';
    const lvA = r.querySelector('.lv .a') as HTMLElement;
    const lvB = r.querySelector('.lv .b') as HTMLElement;
    const plB = r.querySelector('.plr b') as HTMLElement;
    lvA.textContent = `LV ${v.levelFrom}`;
    lvB.textContent = `LV ${v.levelFrom}`;
    plB.textContent = formatPL(v.plFrom);
    r.classList.remove('show');
    void r.offsetWidth;
    r.classList.add('show');
    // Count the level and PL up after the panel lands.
    cancelAnimationFrame(this.resRaf);
    const t0 = performance.now() + 900;
    const dur = 1400;
    const step = () => {
      const k = Math.min(1, Math.max(0, (performance.now() - t0) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      lvB.textContent = `LV ${Math.round(v.levelFrom + (v.levelTo - v.levelFrom) * e)}`;
      plB.textContent = formatPL(v.plFrom + (v.plTo - v.plFrom) * e);
      if (k >= 1 && v.levelTo > v.levelFrom) lvB.classList.add('done');
      if (k < 1) this.resRaf = requestAnimationFrame(step);
    };
    lvB.classList.remove('done');
    this.resRaf = requestAnimationFrame(step);
  }

  hideResult(): void {
    cancelAnimationFrame(this.resRaf);
    this.res.classList.remove('show');
  }
}
