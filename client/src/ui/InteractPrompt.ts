import * as THREE from 'three';
import './styles/interact.css';

const _v = new THREE.Vector3();

/** Floating "[F] Talk" prompt over an NPC (tap it on touch screens). */
export class InteractPrompt {
  private el: HTMLDivElement;
  private shown = false;
  private key = '';
  onPress: (() => void) | null = null;
  touch = false;

  constructor(parent: HTMLElement = document.getElementById('ui-root') ?? document.body) {
    this.el = document.createElement('div');
    this.el.className = 'ak-talk';
    this.el.innerHTML = '<span class="k"></span><span class="t"><b></b><small></small></span>';
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onPress?.();
    });
    parent.appendChild(this.el);
  }

  show(world: THREE.Vector3, camera: THREE.Camera, title: string, sub: string): void {
    const p = _v.copy(world).project(camera);
    if (p.z > 1) {
      this.hide();
      return;
    }
    const k = `${title}|${sub}|${this.touch}`;
    if (k !== this.key) {
      this.key = k;
      (this.el.querySelector('.k') as HTMLElement).textContent = this.touch ? 'TAP' : 'F';
      (this.el.querySelector('b') as HTMLElement).textContent = title;
      (this.el.querySelector('small') as HTMLElement).textContent = sub;
    }
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add('on');
    }
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('on');
  }
}
