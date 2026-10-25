import * as THREE from 'three';
import type { Game } from '../Game.ts';
import { Character } from '../character/Character.ts';
import { clipLibrary } from '../animation/clips/index.ts';
import { animeShared } from '../character/AnimeMaterial.ts';
import * as Looks from '../character/Looks.ts';
import { FORMS } from '@ak/shared';

/**
 * Pose contact sheets: ?gallery=clipA,clipB&phases=6&view=side|front|3q|back&look=hero&form=0&expr=angry
 * Each row is a clip, each column a normalized phase. Used to review every motion for awkward poses.
 */
export function runGallery(game: Game, params: URLSearchParams): void {
  const lib = clipLibrary();
  const names = (params.get('gallery') || 'stance').split(',').filter((n) => lib.has(n));
  const phases = Math.max(1, Number(params.get('phases') || 1));
  const view = params.get('view') || '3q';
  const lookId = params.get('look') || 'hero';
  const looks: Record<string, Looks.Look> = {
    hero: Looks.HERO_LOOK,
    rival: Looks.RIVAL_LOOK,
    brigand: Looks.BRIGAND_LOOK,
    knight: Looks.KNIGHT_LOOK,
    imp: Looks.IMP_LOOK,
    golem: Looks.GOLEM_LOOK,
    warlock: Looks.WARLOCK_LOOK,
    herald: Looks.HERALD_LOOK,
  };
  const look = looks[lookId] ?? Looks.HERO_LOOK;
  const formTier = Number(params.get('form') || 0);
  const spacing = Number(params.get('spacing') || 1.6) * (look.proportions.height / 1.84);
  const rowSpacing = Number(params.get('rows') || 2.4) * (look.proportions.height / 1.84);
  const chars: { c: Character; clip: string; t: number }[] = [];
  const single = phases === 1;
  names.forEach((name, row) => {
    const clip = lib.get(name)!;
    for (let k = 0; k < phases; k++) {
      const c = new Character(look, game.lighting, lib);
      const at = params.get('at')?.split(',').map(Number);
      const t =
        phases === 1
          ? at && at[row] !== undefined
            ? at[row]
            : Number(params.get('t') || 0) * clip.dur
          : (k / (clip.loop ? phases : phases - 1)) * clip.dur;
      if (single) c.group.position.set((row - (names.length - 1) / 2) * spacing, 0, 0);
      else c.group.position.set((k - (phases - 1) / 2) * spacing, 0, -row * rowSpacing);
      if (formTier > 0) c.setForm(FORMS[formTier], look.hairStyle, true);
      const expr = params.get('expr');
      if (expr) c.setExpression(expr as never);
      game.scene.add(c.group);
      chars.push({ c, clip: name, t });
    }
  });
  // Camera framing.
  const width = Math.max((single ? names.length : phases) * spacing, 2.2);
  const depth = single ? 0 : names.length * rowSpacing;
  const h = look.proportions.height;
  const dist = Math.max(width * 1.05, depth * 0.9, h * 1.6) + 2;
  const target = new THREE.Vector3(0, h * 0.52, single ? 0 : -(names.length - 1) * rowSpacing * 0.5);
  const dir =
    view === 'side'
      ? new THREE.Vector3(1, 0.08, 0.0)
      : view === 'front'
        ? new THREE.Vector3(0, 0.08, 1)
        : view === 'back'
          ? new THREE.Vector3(0, 0.12, -1)
          : view === 'top'
            ? new THREE.Vector3(0, 1, 0.02)
            : new THREE.Vector3(0.6, 0.25, 1);
  dir.normalize();
  if (view === 'side' && !single) {
    // Side view of a row: look along +x at the whole grid laid out in z instead.
    chars.forEach((ch, i) => {
      const row = names.indexOf(ch.clip);
      const k = i % phases;
      ch.c.group.position.set(-row * rowSpacing, 0, (k - (phases - 1) / 2) * spacing);
      ch.c.group.rotation.y = 0;
    });
    target.set(-(names.length - 1) * rowSpacing * 0.5, h * 0.52, 0);
  }
  game.camera.fov = 28;
  game.camera.updateProjectionMatrix();
  // Fit the grid: horizontal extent vs horizontal FOV, vertical extent vs vertical FOV.
  const vfov = (game.camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * game.camera.aspect);
  const fitW = (width * 0.5 + 0.4) / Math.tan(hfov / 2);
  const fitH = (h * 0.62 + (single ? 0 : depth * 0.15)) / Math.tan(vfov / 2);
  const zoom = Number(params.get('zoom') || 1);
  game.camera.position.copy(target).addScaledVector(dir, Math.max(fitW, fitH) / zoom + (view === 'side' ? 0 : depth * 0.5));
  game.camera.lookAt(target);
  game.camera.updateProjectionMatrix();
  const freeze = params.has('freeze');
  const focus = params.get('focus');
  let focused = false;
  game.addFrameHook((g) => {
    const sv = animeShared.uSunView.value;
    sv.copy(g.lighting.sunDir).transformDirection(g.camera.matrixWorldInverse);
    for (const ch of chars) {
      if (!freeze) ch.c.animator.locoPhase = 0;
      ch.c.animator.evaluateClip(ch.clip, ch.t);
      ch.c.breathAmt = 0;
      ch.c.group.updateMatrixWorld(true);
      ch.c.update(0);
      ch.c.animator.evaluateClip(ch.clip, ch.t);
      const r = ch.c.animator.root;
      const s = ch.c.scale;
      ch.c.pivot.position.set(r[0] * s, ch.c.hipY + r[1] * s, r[2] * s);
      ch.c.pivot.rotation.set((r[3] * Math.PI) / 180, (r[4] * Math.PI) / 180, (r[5] * Math.PI) / 180, 'YXZ');
      ch.c.group.updateMatrixWorld(true);
    }
    if (focus && !focused && chars.length) {
      focused = true;
      const p = chars[0].c.boneWorld(focus as never);
      const span = Number(params.get('span') || 0.5);
      g.camera.fov = 30;
      g.camera.position.copy(p).addScaledVector(dir, span * 2.4);
      g.camera.lookAt(p);
      g.camera.updateProjectionMatrix();
    }
  });
  (window as unknown as { __gallery: unknown }).__gallery = { chars, names };
}
