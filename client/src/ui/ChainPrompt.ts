import './styles/chain.css';

export type ChainPick = 'rush' | 'meteor' | 'thunder';

const CARDS: { pick: ChainPick; key: string; touch: string; name: string; desc: string; color: string }[] = [
  { pick: 'rush', key: 'LMB', touch: 'ATK', name: 'RUSH BARRAGE', desc: 'A storm of blows, then the launcher', color: '#ffc21a' },
  { pick: 'meteor', key: 'E', touch: 'HEAVY', name: 'METEOR SMASH', desc: 'Vanish above and crater them', color: '#ff7a2a' },
  { pick: 'thunder', key: 'R', touch: 'KI', name: 'THUNDER BLAST', desc: 'Call lightning down on them', color: '#3cf2ff' },
];

/** The Chain Attack cut-in: banner, three finisher cards (click/tap or key) and a countdown bar. */
export class ChainPrompt {
  private el: HTMLDivElement;
  private bar: HTMLElement;
  private banner: HTMLElement;
  onPick: ((p: ChainPick) => void) | null = null;

  constructor(parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.el = document.createElement('div');
    this.el.className = 'ak-chain';
    this.el.innerHTML = `
      <div class="ak-chain-banner">CHAIN ATTACK<small></small></div>
      <div class="ak-chain-cards">${CARDS.map(
        (c) => `<div class="ak-chain-card" data-pick="${c.pick}" style="--c:${c.color}"><span class="k" data-k="${c.key}" data-t="${c.touch}">${c.key}</span><span class="n">${c.name}</span><span class="d">${c.desc}</span></div>`,
      ).join('')}</div>
      <div class="ak-chain-timer"><i></i></div>`;
    parent.appendChild(this.el);
    this.bar = this.el.querySelector('.ak-chain-timer i') as HTMLElement;
    this.banner = this.el.querySelector('.ak-chain-banner small') as HTMLElement;
    this.el.querySelectorAll<HTMLElement>('.ak-chain-card').forEach((card) => {
      card.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onPick?.(card.dataset.pick as ChainPick);
      });
    });
  }

  show(count: number, touch: boolean): void {
    this.banner.textContent = `${count} / 3`;
    this.el.querySelectorAll<HTMLElement>('.ak-chain-card .k').forEach((k) => (k.textContent = touch ? (k.dataset.t ?? '') : (k.dataset.k ?? '')));
    this.el.querySelectorAll('.ak-chain-card').forEach((c) => c.classList.remove('pick'));
    // Restart entry animations.
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    for (const a of this.el.querySelectorAll<HTMLElement>('.ak-chain-banner, .ak-chain-card')) {
      a.style.animation = 'none';
      void a.offsetWidth;
      a.style.animation = '';
    }
  }

  progress(k: number): void {
    this.bar.style.transform = `scaleX(${Math.max(0, k)})`;
  }

  highlight(p: ChainPick): void {
    this.el.querySelector(`.ak-chain-card[data-pick="${p}"]`)?.classList.add('pick');
  }

  hide(): void {
    this.el.classList.remove('on');
  }
}
