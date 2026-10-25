import { FORMS, type FormDef } from '@ak/shared';
import './styles/progress.css';

/**
 * Progression feedback: stacking "+XP" ticks beside the screen centre, the LEVEL UP fanfare (gold slab, light burst,
 * old → new level, +stat points hint) and a "NEW FORM UNLOCKED" card when a level crosses a transformation unlock.
 */
export class ProgressToasts {
  private root: HTMLDivElement;
  private xpBox: HTMLDivElement;
  private banner: HTMLDivElement;
  private formCard: HTMLDivElement;
  private lastXp: { el: HTMLElement; amount: number; t: number } | null = null;
  private bannerTimer = 0;
  private formTimer = 0;
  private queue: (() => void)[] = [];
  /** Touch layouts mention the menu button instead of the C key. */
  touch = false;

  constructor(parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.root = document.createElement('div');
    this.root.className = 'ak-prog';
    this.root.innerHTML = `
      <div class="ak-prog-xp"></div>
      <div class="ak-lvup">
        <div class="rays"></div>
        <div class="slab">
          <div class="t">LEVEL UP</div>
          <div class="lv"><span class="a"></span><i>▸</i><span class="b"></span></div>
          <div class="pts"></div>
        </div>
      </div>
      <div class="ak-formup">
        <small>NEW FORM UNLOCKED</small>
        <b></b>
        <span></span>
      </div>`;
    parent.appendChild(this.root);
    this.xpBox = this.root.querySelector('.ak-prog-xp')!;
    this.banner = this.root.querySelector('.ak-lvup')!;
    this.formCard = this.root.querySelector('.ak-formup')!;
  }

  /** "+N XP" tick; kills in quick succession merge into one growing number. */
  xp(amount: number): void {
    const now = performance.now();
    if (this.lastXp && now - this.lastXp.t < 900 && this.lastXp.el.isConnected) {
      this.lastXp.amount += amount;
      this.lastXp.t = now;
      const el = this.lastXp.el;
      el.querySelector('b')!.textContent = `+${this.lastXp.amount.toLocaleString('en-US')}`;
      // Restart the lifetime (without re-sliding in) and punch the number.
      el.classList.remove('bump', 'again');
      void el.offsetWidth;
      el.classList.add('bump', 'again');
      return;
    }
    const el = document.createElement('div');
    el.className = 'ak-xp';
    el.innerHTML = `<b>+${amount.toLocaleString('en-US')}</b><span>XP</span>`;
    this.xpBox.appendChild(el);
    this.lastXp = { el, amount, t: now };
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'ak-xp-life') el.remove();
    });
    while (this.xpBox.children.length > 4) this.xpBox.firstElementChild?.remove();
  }

  /**
   * Level-up fanfare. `from`/`to` are levels; `unspent` is the point total after the gain. Level-ups arriving while
   * the banner is still up extend it in place (LV 3 ▸ 6) instead of stacking banners.
   */
  levelUp(from: number, to: number, unspent: number): void {
    const cur = this.lv;
    if (cur && performance.now() - cur.shownAt < 2000) {
      this.queueForms(cur.to, to);
      cur.to = to;
      cur.unspent = unspent;
      this.fillBanner(cur);
      const b = this.banner.querySelector('.lv .b') as HTMLElement;
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
      return;
    }
    if (cur || this.banner.classList.contains('on')) {
      // On its way out: fold everything into one banner that follows.
      if (this.pendingLv) {
        this.queueForms(this.pendingLv.to, to);
        this.pendingLv.to = to;
        this.pendingLv.unspent = unspent;
        return;
      }
      this.pendingLv = { from, to, unspent, shownAt: 0 };
      this.queueForms(from, to);
      this.queue.unshift(() => {
        const p = this.pendingLv;
        this.pendingLv = null;
        if (p) this.showBanner(p);
      });
      return;
    }
    this.queueForms(from, to);
    this.showBanner({ from, to, unspent, shownAt: 0 });
  }

  private lv: { from: number; to: number; unspent: number; shownAt: number } | null = null;
  private pendingLv: { from: number; to: number; unspent: number; shownAt: number } | null = null;

  private queueForms(from: number, to: number): void {
    for (const f of FORMS) if (f.unlockLevel > from && f.unlockLevel <= to) this.queue.push(() => this.formUnlocked(f));
  }

  private fillBanner(st: { from: number; to: number; unspent: number }): void {
    const b = this.banner;
    (b.querySelector('.a') as HTMLElement).textContent = `LV ${st.from}`;
    (b.querySelector('.b') as HTMLElement).textContent = `LV ${st.to}`;
    const gained = st.to - st.from;
    (b.querySelector('.pts') as HTMLElement).innerHTML =
      `<b>+${gained * 5}</b> STAT POINTS${gained > 1 ? ` <em>×${gained} LEVELS</em>` : ''} · ${st.unspent} TO SPEND` +
      `<kbd>${this.touch ? 'MENU' : 'C'}</kbd>`;
  }

  private showBanner(st: { from: number; to: number; unspent: number; shownAt: number }): void {
    const b = this.banner;
    st.shownAt = performance.now();
    this.lv = st;
    this.fillBanner(st);
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      b.classList.remove('on');
      this.lv = null;
      this.next();
    }, 3000);
  }

  private next(): void {
    const fn = this.queue.shift();
    if (fn) window.setTimeout(fn, 250);
  }

  private formUnlocked(f: FormDef): void {
    const c = this.formCard;
    c.style.setProperty('--ac', f.auraColor);
    c.style.setProperty('--hc', f.hairColor);
    (c.querySelector('b') as HTMLElement).textContent = f.title;
    (c.querySelector('span') as HTMLElement).textContent = `Hold ${this.touch ? 'POWER' : 'T'} with ${f.surgeCost.toLocaleString('en-US')} Surge to transform · PL ×${f.plMult.toLocaleString('en-US')}`;
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
    clearTimeout(this.formTimer);
    this.formTimer = window.setTimeout(() => {
      c.classList.remove('on');
      this.next();
    }, 3600);
  }
}
