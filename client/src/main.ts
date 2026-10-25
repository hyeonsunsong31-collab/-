import './ui/styles/base.css';
import { Game } from './Game.ts';
import { defaultQuality, type QualityLevel } from './render/Quality.ts';
import { SaveService } from './net/SaveService.ts';

const params = new URLSearchParams(location.search);

function bootProgress(frac: number, msg: string): Promise<void> {
  const fill = document.getElementById('boot-fill');
  const m = document.getElementById('boot-msg');
  if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
  if (m) m.textContent = msg;
  // Yield two frames so the bar actually paints between heavy synchronous steps.
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stored = (() => {
    try {
      return localStorage.getItem('ak.quality') as QualityLevel | null;
    } catch {
      return null;
    }
  })();
  const quality = (params.get('q') as QualityLevel | null) ?? stored ?? defaultQuality();
  const save = new SaveService();
  const game = new Game(canvas, quality, save);
  (window as unknown as { __game: Game }).__game = game;
  if (params.has('gallery')) {
    await game.bootLite();
    document.getElementById('boot')?.classList.add('done');
    const { runGallery } = await import('./dev/Gallery.ts');
    runGallery(game, params);
    game.start();
    return;
  }
  await bootProgress(0.02, 'Contacting the realm…');
  const mode = await save.init({ offline: params.has('offline') || params.has('gallery') });
  console.info(`[boot] save mode: ${mode} (Lv ${save.profile.level})`);
  await game.boot(bootProgress);
  document.getElementById('boot')?.classList.add('done');

  if (params.has('preview')) {
    // World preview camera: ?preview=x,y,z,yawDeg,pitchDeg
    const [x, y, z, yaw, pitch] = (params.get('preview') || '0,30,60,0,-10').split(',').map(Number);
    game.playing = false;
    game.camera.position.set(x, y, z);
    game.camera.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
  }
  game.start();
}

main().catch((e: unknown) => {
  console.error(e);
  const m = document.getElementById('boot-msg');
  if (m) m.textContent = `Error: ${(e as Error).message}`;
});
