import type { FormDef } from '@ak/shared';

export interface PortraitLook {
  skin: string;
  eye: string;
  band: string;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

type Spike = [number, number, number, number, number, number];

/** Hair silhouettes per form style (spikes as [baseX0, baseY0, tipX, tipY, baseX1, baseY1] in a 100×100 head box). */
function spikes(style: number): Spike[] {
  switch (style) {
    case 1: // Golden Ascension: swept up and back.
      return [
        [18, 46, 4, 6, 34, 30],
        [28, 32, 22, -12, 46, 24],
        [40, 26, 46, -18, 58, 24],
        [54, 24, 72, -12, 70, 32],
        [66, 30, 94, 4, 80, 46],
        [76, 42, 104, 30, 82, 56],
        [14, 56, -2, 34, 24, 44],
      ];
    case 2: // Golden Storm: sharper, more numerous.
      return [
        [16, 48, -2, 4, 32, 32],
        [26, 34, 14, -16, 42, 26],
        [36, 28, 34, -24, 50, 24],
        [48, 24, 58, -24, 62, 26],
        [58, 26, 80, -16, 72, 32],
        [68, 32, 100, 0, 80, 46],
        [76, 44, 108, 26, 82, 58],
        [12, 58, -6, 32, 22, 46],
      ];
    case 3: // Golden Mane: a wall of long spikes falling past the shoulders.
      return [
        [20, 40, 6, 0, 38, 28],
        [34, 28, 40, -16, 56, 26],
        [54, 26, 74, -8, 74, 36],
        [72, 36, 104, 30, 86, 60],
        [80, 56, 112, 96, 84, 82],
        [14, 52, -10, 40, 22, 66],
        [16, 66, -12, 104, 26, 86],
        [80, 74, 104, 118, 74, 96],
      ];
    case 4: // Crimson: slim, swept to one side.
      return [
        [20, 42, 4, 12, 36, 30],
        [32, 30, 30, 2, 50, 26],
        [46, 26, 60, 0, 64, 28],
        [60, 28, 86, 14, 76, 40],
        [72, 38, 92, 40, 80, 54],
        [16, 52, 6, 44, 24, 48],
      ];
    case 5: // Silver: wild but softer.
      return [
        [16, 46, -4, 18, 32, 32],
        [28, 32, 18, -6, 46, 26],
        [42, 26, 50, -10, 60, 26],
        [56, 26, 80, 0, 74, 36],
        [68, 34, 98, 22, 82, 50],
        [12, 58, -4, 50, 22, 50],
      ];
    default: // Base: wild black spikes drooping out to the sides.
      return [
        [18, 44, -8, 30, 30, 32],
        [24, 34, 6, 4, 42, 26],
        [36, 26, 34, -6, 52, 24],
        [50, 24, 64, -4, 66, 28],
        [62, 28, 92, 6, 78, 38],
        [72, 38, 106, 34, 82, 52],
        [12, 56, -10, 60, 22, 48],
        [80, 52, 104, 66, 82, 62],
      ];
  }
}

/**
 * The HUD's agent portrait: a cel-style head drawn on a canvas — jaw, ear, sharp anime eyes, brows set by form,
 * headband, and the form's hair silhouette with highlight bands — over a slanted panel lit in the aura colour.
 * Redrawn whenever the form changes.
 */
export function drawPortrait(c: HTMLCanvasElement, look: PortraitLook, f: FormDef, baseHairColor: string): void {
  const S = c.width;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  // Panel.
  const g = ctx.createRadialGradient(S * 0.55, S * 0.45, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  g.addColorStop(0, f.tier > 0 ? f.auraCore : '#3a4256');
  g.addColorStop(0.45, f.tier > 0 ? f.auraColor : '#1e2433');
  g.addColorStop(1, '#0a0c12');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(S * 0.12, 0);
  ctx.lineTo(S, 0);
  ctx.lineTo(S * 0.88, S);
  ctx.lineTo(0, S);
  ctx.closePath();
  ctx.fill();
  ctx.clip();
  // Halftone dots.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < S; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < S; x += 6) ctx.fillRect(x, y, 1.6, 1.6);
  // Speed streaks behind the head.
  ctx.strokeStyle = f.tier > 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const x = (i / 9) * S + 6;
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.lineTo(x + S * 0.25, 0);
    ctx.stroke();
  }

  const k = S / 100;
  ctx.translate(S * 0.06, S * 0.14);
  ctx.scale(k * 0.88, k * 0.88);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = '#08070a';
  const hairColor = f.tier > 0 ? f.hairColor : baseHairColor;
  const hair = spikes(f.hairStyle);

  // Neck + shoulders.
  ctx.fillStyle = shade(look.skin, 0.82);
  ctx.beginPath();
  ctx.moveTo(38, 84);
  ctx.lineTo(36, 104);
  ctx.lineTo(64, 104);
  ctx.lineTo(62, 84);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Back hair mass (behind the face).
  ctx.fillStyle = shade(hairColor, 0.75);
  ctx.beginPath();
  ctx.ellipse(50, 42, 34, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  // Face: rounded cranium into a pointed anime jaw.
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.moveTo(24, 42);
  ctx.bezierCurveTo(24, 18, 76, 18, 76, 42);
  ctx.bezierCurveTo(77, 60, 70, 74, 52, 88);
  ctx.bezierCurveTo(30, 74, 23, 60, 24, 42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Cheek shadow (cel band).
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade(look.skin, 0.8);
  ctx.beginPath();
  ctx.moveTo(60, 20);
  ctx.bezierCurveTo(70, 40, 74, 62, 52, 90);
  ctx.lineTo(90, 90);
  ctx.lineTo(90, 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Ear.
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.ellipse(76, 52, 5, 8, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eyes: sharp, angled; brows lower and angrier in higher forms.
  const anger = Math.min(1, f.tier * 0.35);
  for (const s of [-1, 1]) {
    const cx = 50 + s * 12;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - 8, 52 - s * 0 + 1);
    ctx.quadraticCurveTo(cx, 46 + anger * 2, cx + 8, 50 + (s > 0 ? 3 : -1) * anger + 1);
    ctx.quadraticCurveTo(cx, 58, cx - 8, 52 + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = f.tier > 0 ? f.eyeColor : look.eye;
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.5, 52, 3.2, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.5, 52, 1.4, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(cx - 1.5, 49.5, 1.6, 1.6);
    // Upper lash line.
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - 9, 52);
    ctx.quadraticCurveTo(cx, 45 + anger * 2, cx + 9, 50 + anger * 2);
    ctx.stroke();
    // Brow.
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    const inner = cx - s * 8;
    const outer = cx + s * 9;
    ctx.moveTo(inner, 44 + anger * 3);
    ctx.lineTo(outer, 40 - anger * 1.5);
    ctx.stroke();
    ctx.lineWidth = 3.2;
  }
  // Nose + mouth.
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(50, 60);
  ctx.lineTo(48, 66);
  ctx.lineTo(51, 66.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(44, 74);
  ctx.quadraticCurveTo(50, 72 + anger * 2, 56, 74);
  ctx.stroke();
  ctx.lineWidth = 3.2;
  // Headband (base form only — it burns away in the transformed look).
  if (f.tier === 0) {
    ctx.fillStyle = look.band;
    ctx.beginPath();
    ctx.moveTo(24, 36);
    ctx.quadraticCurveTo(50, 28, 76, 36);
    ctx.lineTo(76, 42);
    ctx.quadraticCurveTo(50, 34, 24, 42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Front hair spikes with a highlight band.
  for (const sp of hair) {
    const [x0, y0, tx, ty, x1, y1] = sp;
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(tx, ty);
    ctx.lineTo(x1, y1);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 6, x0, y0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = f.tier > 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo((x0 * 2 + tx) / 3, (y0 * 2 + ty) / 3);
    ctx.lineTo((x0 + tx * 2) / 3 + 1, (y0 + ty * 2) / 3);
    ctx.lineTo((x1 * 2 + tx) / 3, (y1 * 2 + ty) / 3);
    ctx.closePath();
    ctx.fill();
  }
  // Bangs over the forehead.
  ctx.fillStyle = hairColor;
  ctx.beginPath();
  ctx.moveTo(26, 34);
  ctx.lineTo(34, 50);
  ctx.lineTo(40, 36);
  ctx.lineTo(48, 52);
  ctx.lineTo(54, 36);
  ctx.lineTo(62, 50);
  ctx.lineTo(68, 34);
  ctx.quadraticCurveTo(50, 22, 26, 34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Frame stroke.
  ctx.strokeStyle = '#07080b';
  ctx.lineWidth = Math.max(3, S * 0.035);
  ctx.beginPath();
  ctx.moveTo(S * 0.12, 0);
  ctx.lineTo(S, 0);
  ctx.lineTo(S * 0.88, S);
  ctx.lineTo(0, S);
  ctx.closePath();
  ctx.stroke();
}
