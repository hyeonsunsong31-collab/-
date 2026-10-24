import * as THREE from 'three';

export type Expression = 'neutral' | 'focus' | 'angry' | 'shout' | 'pain' | 'ko' | 'smirk';

export interface FaceStyle {
  kind: 'human' | 'imp' | 'golem' | 'warlock';
  eyeColor: string;
  browColor: string;
  skin: string;
  scar?: boolean;
  stubble?: boolean;
}

export interface FaceState {
  expr: Expression;
  /** Transformed: glowing eyes, sharper iris. */
  powered: boolean;
  noBrows: boolean;
  eyeColor: string;
  browColor: string;
  blink: number;
}

/**
 * Draws a DB-style anime face onto a transparent canvas mapped to the front of the head.
 * Feature coordinates are in head-local meters (hero scale); the decal spans x ±0.082, y −0.12..0.065.
 */
export class FaceDrawer {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private key = '';

  constructor(
    private style: FaceStyle,
    private res = 512,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = res;
    this.canvas.height = res;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  private X(x: number): number {
    return (x / 0.082) * 0.5 * this.res + this.res / 2;
  }

  private Y(y: number): number {
    return (1 - (y + 0.12) / 0.185) * this.res;
  }

  private S(m: number): number {
    return (m / 0.164) * this.res;
  }

  draw(st: FaceState): void {
    const key = JSON.stringify(st) ;
    if (key === this.key) return;
    this.key = key;
    const c = this.ctx;
    c.clearRect(0, 0, this.res, this.res);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (this.style.kind === 'golem') this.golem(st);
    else if (this.style.kind === 'imp') this.imp(st);
    else this.human(st);
    this.texture.needsUpdate = true;
  }

  private human(st: FaceState): void {
    const c = this.ctx;
    const ink = '#120a08';
    const angry = st.expr === 'angry' || st.expr === 'shout' || st.expr === 'focus';
    const pain = st.expr === 'pain' || st.expr === 'ko';
    // Soft shading accents: cheekbone lines, nose shadow, chin.
    c.strokeStyle = 'rgba(120,60,40,0.35)';
    c.lineWidth = this.S(0.0018);
    for (const sd of [1, -1]) {
      c.beginPath();
      c.moveTo(this.X(sd * 0.048), this.Y(-0.028));
      c.quadraticCurveTo(this.X(sd * 0.044), this.Y(-0.042), this.X(sd * 0.036), this.Y(-0.05));
      c.stroke();
    }
    c.strokeStyle = 'rgba(90,40,30,0.55)';
    c.lineWidth = this.S(0.0022);
    c.beginPath();
    c.moveTo(this.X(0.004), this.Y(-0.012));
    c.lineTo(this.X(0.009), this.Y(-0.034));
    c.lineTo(this.X(0.003), this.Y(-0.038));
    c.stroke();
    // Eyes.
    for (const sd of [1, -1]) this.eye(sd, st, angry, pain);
    // Brows.
    if (!st.noBrows) {
      c.fillStyle = st.browColor;
      for (const sd of [1, -1]) {
        const inner = angry ? 0.0105 : pain ? 0.019 : 0.016;
        const innerY = angry ? 0.012 : pain ? 0.022 : 0.019;
        const outerY = angry ? 0.03 : pain ? 0.017 : 0.026;
        c.beginPath();
        c.moveTo(this.X(sd * inner), this.Y(innerY));
        c.lineTo(this.X(sd * 0.03), this.Y((innerY + outerY) / 2 + 0.006));
        c.lineTo(this.X(sd * 0.054), this.Y(outerY + 0.004));
        c.lineTo(this.X(sd * 0.05), this.Y(outerY - 0.003));
        c.lineTo(this.X(sd * 0.028), this.Y((innerY + outerY) / 2 - 0.002));
        c.lineTo(this.X(sd * (inner + 0.002)), this.Y(innerY - 0.006));
        c.closePath();
        c.fill();
      }
      if (angry) {
        // Furrow lines between the brows.
        c.strokeStyle = 'rgba(70,30,20,0.55)';
        c.lineWidth = this.S(0.0015);
        for (const sd of [1, -1]) {
          c.beginPath();
          c.moveTo(this.X(sd * 0.006), this.Y(0.014));
          c.lineTo(this.X(sd * 0.004), this.Y(0.026));
          c.stroke();
        }
      }
    } else {
      // Heavy brow-ridge shading (Golden Mane look).
      c.strokeStyle = 'rgba(80,40,20,0.6)';
      c.lineWidth = this.S(0.003);
      for (const sd of [1, -1]) {
        c.beginPath();
        c.moveTo(this.X(sd * 0.012), this.Y(0.014));
        c.quadraticCurveTo(this.X(sd * 0.03), this.Y(0.024), this.X(sd * 0.052), this.Y(0.02));
        c.stroke();
      }
    }
    // Mouth.
    c.strokeStyle = ink;
    c.fillStyle = '#4a0f12';
    c.lineWidth = this.S(0.0028);
    const my = -0.064;
    if (st.expr === 'shout') {
      c.beginPath();
      c.moveTo(this.X(-0.022), this.Y(my + 0.004));
      c.quadraticCurveTo(this.X(0), this.Y(my + 0.01), this.X(0.022), this.Y(my + 0.004));
      c.quadraticCurveTo(this.X(0.016), this.Y(my - 0.026), this.X(0), this.Y(my - 0.03));
      c.quadraticCurveTo(this.X(-0.016), this.Y(my - 0.026), this.X(-0.022), this.Y(my + 0.004));
      c.fill();
      c.stroke();
      c.fillStyle = '#f4efe6';
      c.fillRect(this.X(-0.017), this.Y(my + 0.006), this.S(0.034), this.S(0.005));
      c.fillStyle = '#b8323a';
      c.beginPath();
      c.ellipse(this.X(0), this.Y(my - 0.022), this.S(0.009), this.S(0.004), 0, 0, Math.PI * 2);
      c.fill();
    } else if (pain || st.expr === 'angry') {
      // Gritted teeth.
      c.fillStyle = '#f2ede4';
      const w = st.expr === 'angry' ? 0.03 : 0.034;
      c.beginPath();
      c.roundRect(this.X(-w / 2), this.Y(my + 0.004), this.S(w), this.S(0.009), this.S(0.002));
      c.fill();
      c.stroke();
      c.lineWidth = this.S(0.0012);
      c.beginPath();
      c.moveTo(this.X(-w / 2), this.Y(my - 0.0005));
      c.lineTo(this.X(w / 2), this.Y(my - 0.0005));
      for (let i = -2; i <= 2; i++) {
        c.moveTo(this.X(i * 0.006), this.Y(my + 0.004));
        c.lineTo(this.X(i * 0.006), this.Y(my - 0.005));
      }
      c.stroke();
    } else {
      // Confident smirk / neutral line.
      const smirk = st.expr === 'smirk' ? 0.004 : 0.0015;
      c.beginPath();
      c.moveTo(this.X(-0.017), this.Y(my - 0.001));
      c.quadraticCurveTo(this.X(0), this.Y(my - 0.003), this.X(0.018), this.Y(my + smirk));
      c.stroke();
      c.strokeStyle = 'rgba(90,40,30,0.4)';
      c.lineWidth = this.S(0.0016);
      c.beginPath();
      c.moveTo(this.X(-0.008), this.Y(my - 0.01));
      c.lineTo(this.X(0.008), this.Y(my - 0.01));
      c.stroke();
    }
    if (this.style.scar) {
      c.strokeStyle = 'rgba(150,50,50,0.85)';
      c.lineWidth = this.S(0.0022);
      c.beginPath();
      c.moveTo(this.X(-0.05), this.Y(0.03));
      c.lineTo(this.X(-0.018), this.Y(-0.028));
      c.stroke();
    }
    if (this.style.stubble) {
      c.fillStyle = 'rgba(40,25,15,0.35)';
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI;
        const r = 0.035 + Math.random() * 0.03;
        const x = Math.cos(a) * r * 0.9;
        const y = -0.06 - Math.sin(a) * r * 0.75;
        c.fillRect(this.X(x), this.Y(y), 2, 2);
      }
    }
    if (this.style.kind === 'warlock') {
      // Long beard.
      c.fillStyle = '#d8d2c6';
      c.beginPath();
      c.moveTo(this.X(-0.05), this.Y(-0.045));
      c.quadraticCurveTo(this.X(-0.04), this.Y(-0.12), this.X(0), this.Y(-0.125));
      c.quadraticCurveTo(this.X(0.04), this.Y(-0.12), this.X(0.05), this.Y(-0.045));
      c.quadraticCurveTo(this.X(0.02), this.Y(-0.072), this.X(0), this.Y(-0.07));
      c.quadraticCurveTo(this.X(-0.02), this.Y(-0.072), this.X(-0.05), this.Y(-0.045));
      c.fill();
    }
  }

  private eye(sd: number, st: FaceState, angry: boolean, pain: boolean): void {
    const c = this.ctx;
    const ink = '#120a08';
    const cx = sd * 0.032;
    const cy = -0.002;
    const inner = sd * 0.013;
    const outer = sd * 0.052;
    if (pain || st.blink > 0.85) {
      // Squeezed / closed: angular ">" shapes.
      c.strokeStyle = ink;
      c.lineWidth = this.S(0.0032);
      c.beginPath();
      if (pain) {
        c.moveTo(this.X(outer), this.Y(cy + 0.006));
        c.lineTo(this.X(inner + sd * 0.004), this.Y(cy));
        c.lineTo(this.X(outer), this.Y(cy - 0.006));
      } else {
        c.moveTo(this.X(inner), this.Y(cy));
        c.quadraticCurveTo(this.X(cx), this.Y(cy - 0.004), this.X(outer), this.Y(cy + 0.001));
      }
      c.stroke();
      return;
    }
    const topInner = angry ? cy + 0.003 : cy + 0.005;
    const topPeak = angry ? cy + 0.0105 : cy + 0.0125;
    const topOuter = cy + 0.005;
    const botY = cy - 0.0095;
    // Sclera.
    c.fillStyle = st.powered ? '#f4fbff' : '#fbf7f0';
    c.beginPath();
    c.moveTo(this.X(inner), this.Y(topInner));
    c.lineTo(this.X(cx - sd * 0.002), this.Y(topPeak));
    c.lineTo(this.X(outer), this.Y(topOuter));
    c.lineTo(this.X(outer - sd * 0.004), this.Y(botY + 0.002));
    c.lineTo(this.X(cx), this.Y(botY));
    c.lineTo(this.X(inner + sd * 0.002), this.Y(botY + 0.003));
    c.closePath();
    c.fill();
    c.save();
    c.clip();
    // Iris + pupil + highlight.
    const ir = st.powered ? 0.0072 : 0.008;
    const ix = cx - sd * 0.002;
    const iy = cy - 0.0015;
    const grd = c.createRadialGradient(this.X(ix), this.Y(iy), 0, this.X(ix), this.Y(iy), this.S(ir));
    const col = new THREE.Color(st.eyeColor);
    grd.addColorStop(0, `#${col.clone().multiplyScalar(st.powered ? 1.4 : 0.8).getHexString()}`);
    grd.addColorStop(0.75, `#${col.getHexString()}`);
    grd.addColorStop(1, '#0a0606');
    c.fillStyle = grd;
    c.beginPath();
    c.arc(this.X(ix), this.Y(iy), this.S(ir), 0, Math.PI * 2);
    c.fill();
    if (!(st.expr === 'shout' && st.powered)) {
      c.fillStyle = '#050303';
      c.beginPath();
      c.arc(this.X(ix), this.Y(iy), this.S(st.powered ? 0.0022 : 0.0034), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(this.X(ix + sd * 0.0025), this.Y(iy + 0.0028), this.S(0.0016), 0, Math.PI * 2);
    c.fill();
    c.restore();
    // Upper lid: thick, angular DB line with outer flick.
    c.strokeStyle = ink;
    c.lineWidth = this.S(0.0042);
    c.beginPath();
    c.moveTo(this.X(inner - sd * 0.001), this.Y(topInner - 0.001));
    c.lineTo(this.X(cx - sd * 0.002), this.Y(topPeak));
    c.lineTo(this.X(outer + sd * 0.004), this.Y(topOuter + 0.002));
    c.stroke();
    // Lower lid: thin.
    c.lineWidth = this.S(0.0016);
    c.beginPath();
    c.moveTo(this.X(outer - sd * 0.004), this.Y(botY + 0.002));
    c.lineTo(this.X(cx), this.Y(botY));
    c.lineTo(this.X(inner + sd * 0.004), this.Y(botY + 0.0025));
    c.stroke();
    if (st.powered) {
      // Glowing rim around the iris for transformed forms.
      c.strokeStyle = `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},0.5)`;
      c.lineWidth = this.S(0.0012);
      c.beginPath();
      c.arc(this.X(ix), this.Y(iy), this.S(ir + 0.0012), 0, Math.PI * 2);
      c.stroke();
    }
  }

  private imp(st: FaceState): void {
    const c = this.ctx;
    for (const sd of [1, -1]) {
      const g = c.createRadialGradient(this.X(sd * 0.03), this.Y(0), 0, this.X(sd * 0.03), this.Y(0), this.S(0.018));
      g.addColorStop(0, '#fff2a0');
      g.addColorStop(0.4, st.eyeColor);
      g.addColorStop(1, '#200000');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(this.X(sd * 0.03), this.Y(0), this.S(0.017), this.S(0.012), sd * -0.35, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#0a0000';
      c.beginPath();
      c.ellipse(this.X(sd * 0.03), this.Y(0), this.S(0.0025), this.S(0.009), 0, 0, Math.PI * 2);
      c.fill();
    }
    // Jagged grin with fangs.
    c.fillStyle = '#1a0606';
    c.beginPath();
    c.moveTo(this.X(-0.04), this.Y(-0.05));
    c.quadraticCurveTo(this.X(0), this.Y(st.expr === 'shout' ? -0.1 : -0.075), this.X(0.04), this.Y(-0.05));
    c.quadraticCurveTo(this.X(0), this.Y(-0.06), this.X(-0.04), this.Y(-0.05));
    c.fill();
    c.fillStyle = '#f0ead0';
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.011;
      c.beginPath();
      c.moveTo(this.X(x - 0.004), this.Y(-0.056));
      c.lineTo(this.X(x), this.Y(-0.066));
      c.lineTo(this.X(x + 0.004), this.Y(-0.056));
      c.fill();
    }
  }

  private golem(st: FaceState): void {
    const c = this.ctx;
    const glow = st.powered ? 1 : 0.85;
    for (const sd of [1, -1]) {
      const g = c.createLinearGradient(this.X(sd * 0.015), 0, this.X(sd * 0.05), 0);
      g.addColorStop(0, `rgba(255,190,80,${glow})`);
      g.addColorStop(1, `rgba(255,90,20,${glow})`);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(this.X(sd * 0.012), this.Y(0.004));
      c.lineTo(this.X(sd * 0.052), this.Y(0.012));
      c.lineTo(this.X(sd * 0.048), this.Y(-0.004));
      c.lineTo(this.X(sd * 0.014), this.Y(-0.006));
      c.closePath();
      c.fill();
    }
    c.strokeStyle = 'rgba(255,120,30,0.9)';
    c.lineWidth = this.S(0.003);
    c.beginPath();
    c.moveTo(this.X(-0.03), this.Y(-0.06));
    c.lineTo(this.X(-0.01), this.Y(-0.066));
    c.lineTo(this.X(0.008), this.Y(-0.058));
    c.lineTo(this.X(0.03), this.Y(-0.066));
    c.stroke();
  }
}
