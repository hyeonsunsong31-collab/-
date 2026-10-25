import * as THREE from 'three';
import { buildRig, type RigInstance, type BoneName, BONE_INDEX } from './Rig.ts';
import { BodyBuilder } from './BodyBuilder.ts';
import { animeMaterial, outlineMaterial, type AnimeMaterial } from './AnimeMaterial.ts';
import { FaceDrawer, type Expression, type FaceState } from './Face.ts';
import { buildHair } from './Hair.ts';
import { SpringChain, solveTwoBone } from './Secondary.ts';
import type { Look } from './Looks.ts';
import * as Arm from './Armory.ts';
import { Animator } from '../animation/Animator.ts';
import type { CompiledClip } from '../animation/Clip.ts';
import type { Lighting } from '../render/Lighting.ts';
import type { FormDef } from '@ak/shared';

export interface CharacterUpdateCtx {
  /** Terrain/ground height query for foot IK. */
  groundAt?: (x: number, z: number) => number;
  /** 0..1 how much foot IK to apply (only when standing on the ground). */
  ik?: number;
  /** Ambient wind (world). */
  wind?: THREE.Vector3;
  /** Character world velocity (drives cloth drag). */
  velocity?: THREE.Vector3;
}

const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

interface HairSet {
  mesh: THREE.SkinnedMesh;
  outline: THREE.SkinnedMesh;
  mat: AnimeMaterial;
}

/**
 * A fully procedural anime fighter: rig + skinned body + outline + face decal + per-form hair + rigid gear,
 * driven by the layered Animator plus procedural layers (breathing, look-at, lean, tremble), spring cloth and foot IK.
 */
export class Character {
  readonly group = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly rig: RigInstance;
  readonly animator: Animator;
  readonly body: THREE.SkinnedMesh;
  readonly outline: THREE.SkinnedMesh;
  readonly faceMesh: THREE.SkinnedMesh;
  readonly bodyMat: AnimeMaterial;
  readonly faceMat: AnimeMaterial;
  readonly face: FaceDrawer;
  readonly faceState: FaceState;
  readonly scale: number;
  readonly hipY: number;
  readonly look: Look;
  private builder: BodyBuilder;
  private hairSets = new Map<string, HairSet>();
  private hair: HairSet | null = null;
  private hairOld: HairSet | null = null;
  private hairBlend = 1;
  private springs: SpringChain[] = [];
  private gearMats: AnimeMaterial[] = [];
  readonly orb: THREE.Object3D | null = null;
  private headCenter = new THREE.Vector3();
  private blinkTimer = 2;
  private time = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lighting: Lighting;
  private outlineMat: THREE.MeshBasicMaterial;

  /** Procedural controls (set by gameplay each frame). */
  lookTarget: THREE.Vector3 | null = null;
  leanPitch = 0;
  leanRoll = 0;
  tremble = 0;
  breathAmt = 1;
  glow = 0;
  glowColor = new THREE.Color('#ffcf2e');
  hitFlash = 0;
  /** Extra hair glow multiplier per form. */
  hairGlow = 0;

  constructor(look: Look, lighting: Lighting, clips: Map<string, CompiledClip>) {
    this.look = look;
    this.lighting = lighting;
    this.rig = buildRig(look.proportions);
    this.scale = look.proportions.height / 1.84;
    this.hipY = this.rig.bindWorld.hips.y;
    this.builder = new BodyBuilder(this.rig, look);
    const b = this.builder;
    const faceGeo = this.buildOutfit(b);
    const built = b.build();
    this.bodyMat = animeMaterial(lighting, { vertexColors: true, key: 'body' });
    if (look.outfit === 'golem') {
      this.bodyMat.userData.anime.uShadeTint.value.set('#5a4a6a');
      this.bodyMat.userData.anime.uRimStrength.value = 0.35;
    }
    this.body = new THREE.SkinnedMesh(built.geometry, this.bodyMat);
    this.outlineMat = outlineMaterial(0.0062 * this.scale);
    this.outline = new THREE.SkinnedMesh(built.geometry, this.outlineMat);
    // Face decal.
    this.face = new FaceDrawer(
      {
        kind: look.outfit === 'golem' ? 'golem' : look.outfit === 'imp' ? 'imp' : look.outfit === 'robe' ? 'warlock' : 'human',
        eyeColor: look.eyeColor,
        browColor: look.browColor,
        skin: look.skin,
        scar: look.scar,
        stubble: look.outfit === 'brigand',
      },
      look.faceRes,
    );
    this.faceState = { expr: 'neutral', powered: false, noBrows: false, eyeColor: look.eyeColor, browColor: look.browColor, blink: 0 };
    this.face.draw(this.faceState);
    b.skin(faceGeo, ['head']);
    this.faceMat = animeMaterial(lighting, { map: this.face.texture, transparent: true, key: 'face' });
    this.faceMat.alphaTest = 0.04;
    this.faceMat.depthWrite = false;
    this.faceMat.polygonOffset = true;
    this.faceMat.polygonOffsetFactor = -2;
    this.faceMat.userData.anime.uRimStrength.value = 0;
    this.faceMesh = new THREE.SkinnedMesh(faceGeo, this.faceMat);
    this.faceMesh.renderOrder = 2;

    for (const m of [this.body, this.outline, this.faceMesh]) {
      m.bind(this.rig.skeleton, new THREE.Matrix4());
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.body.castShadow = true;
    this.body.receiveShadow = true;

    const hb = this.rig.bindWorld.head;
    const hs = this.scale * look.proportions.headScale;
    this.headCenter.set(hb.x, hb.y + 0.105 * hs, hb.z + 0.012 * hs);
    if (look.hairStyle >= 0) this.setHair(look.hairStyle, look.hairColor, 0, true);

    // Hierarchy: group (feet, yaw) → pivot (hips; whole-body root rotation) → rig root (offset down by hip height).
    this.group.add(this.pivot);
    this.pivot.position.set(0, this.hipY, 0);
    this.rig.root.position.set(0, -this.hipY, 0);
    this.pivot.add(this.rig.root);

    this.animator = new Animator(this.rig, clips);
    const by = this.rig.byName;
    if (look.outfit === 'gi' || look.outfit === 'brigand') {
      this.springs.push(new SpringChain([by.sashA1, by.sashA2, by.sashA3], 0.12, 0.9, 6, 0.15 * this.scale));
      this.springs.push(new SpringChain([by.sashB1, by.sashB2, by.sashB3], 0.12, 0.9, 6, 0.13 * this.scale));
    }
    this.springs.push(new SpringChain([by.hairBack1, by.hairBack2], 0.2, 0.88, 4, 0.2 * this.scale));
    this.buildGear();
    this.group.updateMatrixWorld(true);
  }

  /** Assemble body parts for the look's outfit; returns the face decal geometry. */
  private buildOutfit(b: BodyBuilder): THREE.BufferGeometry {
    const L = this.look;
    b.torso();
    b.neck();
    const sleeve = L.sleeveless ? null : L.outfit === 'robe' ? L.top : L.outfit === 'knight' ? L.pants : L.top;
    b.arm(1, sleeve);
    b.arm(-1, sleeve);
    const claws = L.outfit === 'imp' || L.outfit === 'golem';
    b.hand(1, L.skin, claws);
    b.hand(-1, L.skin, claws);
    const face = b.head(1, L.outfit === 'imp');
    switch (L.outfit) {
      case 'gi':
        b.giTop();
        b.sash();
        b.pants();
        b.boots();
        b.wristbands();
        break;
      case 'brigand':
        b.vest(L.top, L.trim);
        b.sash(L.sash);
        b.pants();
        b.boots();
        b.wristbands();
        break;
      case 'knight':
        b.giTop(L.pants, L.trim);
        b.pants();
        b.boots(L.boots, L.wrap);
        break;
      case 'imp':
        b.pants(L.pants, true);
        b.boots(L.skin, L.skin);
        break;
      case 'golem':
        b.pants(L.pants, true);
        b.boots(L.skin, L.trim);
        break;
      case 'robe':
        b.robe(L.top, L.trim);
        b.boots();
        break;
    }
    return face;
  }

  /** Rigid gear parented to bones. */
  private buildGear(): void {
    const L = this.look;
    const s = this.scale;
    const by = this.rig.byName;
    const mat = animeMaterial(this.lighting, { vertexColors: true, key: 'gear' });
    this.gearMats.push(mat);
    const outline = outlineMaterial(0.0055 * s, false);
    const add = (bone: BoneName, geo: THREE.BufferGeometry, pos: THREE.Vector3, rot = new THREE.Euler(), worldAligned = false) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      const ol = new THREE.Mesh(geo, outline);
      mesh.add(ol);
      const holder = new THREE.Group();
      holder.add(mesh);
      holder.position.copy(pos);
      holder.rotation.copy(rot);
      if (worldAligned) {
        // Undo the bone's bind rotation so gear can be authored in character space.
        holder.quaternion.copy(this.rig.bindRot[bone].clone().invert()).multiply(new THREE.Quaternion().setFromEuler(rot));
      }
      by[bone].add(holder);
      return holder;
    };
    const head = (geo: THREE.BufferGeometry) => {
      const hb = this.rig.bindWorld.head;
      const off = this.headCenter.clone().sub(hb).applyQuaternion(this.rig.bindRot.head.clone().invert());
      add('head', geo, off, new THREE.Euler(), true);
    };
    // Weapons in the right hand: grip through the fist, blade toward the thumb side (+Z local).
    const grip = new THREE.Vector3(-0.024 * s, 0.075 * s, 0.0);
    if (L.weapon === 'sword') add('handR', Arm.sword(s), grip);
    if (L.weapon === 'axe') add('handR', Arm.axe(s), grip);
    if (L.weapon === 'club') add('handR', Arm.club(s), grip);
    if (L.weapon === 'staff') {
      const st = Arm.staff(s);
      const h = add('handR', st.shaft, grip);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 * s, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 3.2), toneMapped: false }),
      );
      orb.position.copy(st.orbPos);
      h.children[0].add(orb);
      (this as { orb: THREE.Object3D | null }).orb = orb;
    }
    // Shield strapped to the outer (back-of-hand) side of the left forearm, face pointing away from the arm.
    if (L.shield) add('foreArmL', Arm.shield(s), new THREE.Vector3(-0.07 * s, 0.15 * s, 0), new THREE.Euler(0, -Math.PI / 2, 0));
    if (L.outfit === 'knight') {
      head(Arm.helmet(s));
      add('upperChest', Arm.breastplate(s), new THREE.Vector3(0, -0.03 * s, 0.02 * s), new THREE.Euler(), true);
      // Clavicle frames point outward; rotate the dome so it caps the shoulder from above.
      add('clavicleL', Arm.pauldron(s), new THREE.Vector3(-0.035 * s, 0.17 * s, 0.0), new THREE.Euler(0, 0, Math.PI / 2));
      add('clavicleR', Arm.pauldron(s), new THREE.Vector3(0.035 * s, 0.17 * s, 0.0), new THREE.Euler(0, 0, -Math.PI / 2));
      add('foreArmL', Arm.bracer(s, 0.2, 0.052), new THREE.Vector3(0, 0.06 * s, 0));
      add('foreArmR', Arm.bracer(s, 0.2, 0.052), new THREE.Vector3(0, 0.06 * s, 0));
      add('shinL', Arm.bracer(s, 0.3, 0.075), new THREE.Vector3(0, 0.08 * s, 0.01 * s));
      add('shinR', Arm.bracer(s, 0.3, 0.075), new THREE.Vector3(0, 0.08 * s, 0.01 * s));
      add('thighL', Arm.bracer(s, 0.26, 0.105), new THREE.Vector3(0, 0.08 * s, 0.01 * s));
      add('thighR', Arm.bracer(s, 0.26, 0.105), new THREE.Vector3(0, 0.08 * s, 0.01 * s));
    }
    if (L.outfit === 'robe') head(Arm.hood(s, L.top));
    if (L.outfit === 'brigand') head(Arm.bandana(s, L.sash));
    if (L.outfit === 'golem') {
      let seed = 1;
      const rock = (bone: BoneName, x: number, y: number, z: number, r: number) =>
        add(bone, Arm.boulder(r * s, seed++, seed % 3 === 0 ? '#6e685d' : '#827b6e'), new THREE.Vector3(x * s, y * s, z * s));
      rock('upperChest', 0.12, 0.02, 0.0, 0.12);
      rock('upperChest', -0.12, 0.02, 0.0, 0.12);
      rock('chest', 0, 0.02, 0.1, 0.11);
      rock('chest', 0, 0.02, -0.12, 0.13);
      rock('spine', 0.0, 0.05, 0.08, 0.09);
      rock('clavicleL', 0, 0.17, 0, 0.12);
      rock('clavicleR', 0, 0.17, 0, 0.12);
      rock('upperArmL', 0, 0.12, 0, 0.09);
      rock('upperArmR', 0, 0.12, 0, 0.09);
      rock('foreArmL', 0, 0.14, 0, 0.085);
      rock('foreArmR', 0, 0.14, 0, 0.085);
      rock('handL', 0, 0.05, 0, 0.075);
      rock('handR', 0, 0.05, 0, 0.075);
      rock('thighL', 0, 0.14, 0.02, 0.1);
      rock('thighR', 0, 0.14, 0.02, 0.1);
      rock('shinL', 0, 0.16, 0.02, 0.085);
      rock('shinR', 0, 0.16, 0.02, 0.085);
      rock('head', 0, 0.14, -0.02, 0.07);
    }
  }

  /* --------------------------------------------------------------- appearance */

  private hairKey(style: number, color: string): string {
    return `${style}|${color}`;
  }

  /** Switch hair style/color; `morph` > 0 animates a grow-in over that many seconds. */
  setHair(style: number, color: string, emissive: number, instant = false): void {
    const key = this.hairKey(style, color);
    let set = this.hairSets.get(key);
    if (!set) {
      const built = buildHair(style, this.scale * this.look.proportions.headScale);
      if (!built) return;
      const geo = built.geometry;
      geo.translate(this.headCenter.x, this.headCenter.y, this.headCenter.z);
      // Skin: short spikes to the head, long locks along the back hair chain.
      const p = geo.getAttribute('position');
      const si: number[] = [];
      const sw: number[] = [];
      const soft = Math.pow(0.04 * this.scale, 2);
      for (let i = 0; i < p.count; i++) {
        if (built.longMask[i] > 0) {
          _v.fromBufferAttribute(p, i);
          const w = this.builder.weightsFor(_v, ['head', 'hairBack1', 'hairBack2'], soft);
          si.push(...w.idx);
          sw.push(...w.w);
        } else {
          si.push(BONE_INDEX.head, 0, 0, 0);
          sw.push(1, 0, 0, 0);
        }
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      geo.computeBoundingSphere();
      const mat = animeMaterial(this.lighting, { color, key: 'hair' });
      mat.userData.anime.uGrowCenter.value.copy(this.headCenter);
      mat.userData.anime.uRimStrength.value = 0.8;
      const mesh = new THREE.SkinnedMesh(geo, mat);
      const ol = new THREE.SkinnedMesh(geo, this.outlineMat);
      for (const m of [mesh, ol]) {
        m.bind(this.rig.skeleton, new THREE.Matrix4());
        m.frustumCulled = false;
        m.visible = false;
        this.group.add(m);
      }
      mesh.castShadow = true;
      set = { mesh, outline: ol, mat };
      this.hairSets.set(key, set);
    }
    set.mat.color.set(color);
    set.mat.userData.anime.uGlowColor.value.set(color);
    this.hairGlow = emissive;
    if (set === this.hair) return;
    if (this.hairOld && this.hairOld !== set) {
      this.hairOld.mesh.visible = false;
      this.hairOld.outline.visible = false;
    }
    this.hairOld = instant ? null : this.hair;
    if (instant && this.hair) {
      this.hair.mesh.visible = false;
      this.hair.outline.visible = false;
    }
    this.hair = set;
    set.mesh.visible = true;
    set.outline.visible = true;
    this.hairBlend = instant ? 1 : 0;
  }

  /** Apply a transformation form's look (hair, eyes, brows, glow colors). */
  setForm(form: FormDef, baseStyle: number, instant = false): void {
    const style = form.tier === 0 ? baseStyle : form.hairStyle;
    const color = form.tier === 0 ? this.look.hairColor : form.hairColor;
    this.setHair(style, color, form.hairEmissive, instant);
    this.faceState.powered = form.tier > 0;
    this.faceState.eyeColor = form.tier === 0 ? this.look.eyeColor : form.eyeColor;
    this.faceState.browColor = form.tier === 0 ? this.look.browColor : form.hairColor;
    this.faceState.noBrows = form.id === 'asc3';
    this.face.draw(this.faceState);
    this.glowColor.set(form.auraColor);
  }

  setExpression(e: Expression): void {
    if (this.faceState.expr === e) return;
    this.faceState.expr = e;
    this.face.draw(this.faceState);
  }

  /* --------------------------------------------------------------- queries */

  /** Currently visible hair mesh (afterimages copy it). */
  get hairMesh(): THREE.SkinnedMesh | null {
    return this.hair?.mesh ?? null;
  }

  bone(name: BoneName): THREE.Bone {
    return this.rig.byName[name];
  }

  boneWorld(name: BoneName, out = new THREE.Vector3()): THREE.Vector3 {
    return this.rig.byName[name].getWorldPosition(out);
  }

  /** Approximate fist/palm center in world space. */
  handWorld(side: 'L' | 'R', out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.rig.byName[side === 'L' ? 'handL' : 'handR'];
    return out.set(0, 0.06 * this.scale, 0).applyMatrix4(h.matrixWorld);
  }

  footWorld(side: 'L' | 'R', out = new THREE.Vector3()): THREE.Vector3 {
    return this.boneWorld(side === 'L' ? 'toeL' : 'toeR', out);
  }

  get headWorld(): THREE.Vector3 {
    return _v2.copy(this.headCenter).applyMatrix4(this.rig.byName.head.matrixWorld.clone().multiply(this.headBindInv()));
  }

  private _headBindInv: THREE.Matrix4 | null = null;
  private headBindInv(): THREE.Matrix4 {
    if (!this._headBindInv) {
      const m = new THREE.Matrix4().compose(this.rig.bindWorld.head, this.rig.bindRot.head, new THREE.Vector3(1, 1, 1));
      this._headBindInv = m.invert();
    }
    return this._headBindInv;
  }

  /* --------------------------------------------------------------- update */

  update(dt: number, ctx: CharacterUpdateCtx = {}): void {
    this.time += dt;
    const A = this.animator;
    const add = A.additive;
    const set = (b: BoneName, x: number, y: number, z: number) => {
      const i = BONE_INDEX[b] * 3;
      add[i] += x;
      add[i + 1] += y;
      add[i + 2] += z;
    };
    // Breathing.
    const br = Math.sin(this.time * Math.PI * 2 * 0.28) * this.breathAmt;
    set('chest', -br * 1.2, 0, 0);
    set('upperChest', -br * 0.8, 0, 0);
    set('clavicleL', 0, 0, br * 0.9);
    set('clavicleR', 0, 0, br * 0.9);
    set('neck', br * 0.6, 0, 0);
    // Look-at (head/neck/upper spine), smoothed.
    let wantYaw = 0;
    let wantPitch = 0;
    if (this.lookTarget) {
      const head = this.boneWorld('head', _v);
      const local = _v2.copy(this.lookTarget).sub(head);
      const inv = this.group.getWorldQuaternion(_q).invert();
      local.applyQuaternion(inv);
      wantYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z) / D2R, -75, 75);
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)) / D2R, -35, 30);
      if (Math.abs(Math.atan2(local.x, local.z)) > Math.PI * 0.62) wantYaw = 0;
    }
    const k = 1 - Math.exp(-dt * 8);
    this.lookYaw += (wantYaw - this.lookYaw) * k;
    this.lookPitch += (wantPitch - this.lookPitch) * k;
    set('head', this.lookPitch * 0.55, this.lookYaw * 0.5, 0);
    set('neck', this.lookPitch * 0.35, this.lookYaw * 0.32, 0);
    set('upperChest', 0, this.lookYaw * 0.12, 0);
    // Tremble (power charging).
    if (this.tremble > 0) {
      const t = this.time * 47;
      const n = (o: number) => (Math.sin(t + o) * 0.6 + Math.sin(t * 1.7 + o * 2.3) * 0.4) * this.tremble;
      set('spine', n(1) * 1.5, n(2), n(3) * 1.2);
      set('chest', n(4) * 1.5, n(5), n(6));
      set('neck', n(7) * 2, n(8) * 2, n(9));
      set('upperArmL', n(10) * 2, 0, n(11) * 2);
      set('upperArmR', n(12) * 2, 0, n(13) * 2);
      set('foreArmL', n(14) * 2, 0, 0);
      set('foreArmR', n(15) * 2, 0, 0);
    }
    // Lean into acceleration / turns.
    A.additiveRoot[3] += this.leanPitch;
    A.additiveRoot[5] += this.leanRoll;

    A.update(dt);

    // Whole-body root transform about the hips pivot.
    const r = A.root;
    const s = this.scale;
    this.pivot.position.set(r[0] * s, this.hipY + r[1] * s, r[2] * s);
    this.pivot.rotation.set(r[3] * D2R, r[4] * D2R, r[5] * D2R, 'YXZ');
    this.group.updateMatrixWorld(true);

    // Foot IK on uneven ground.
    if (ctx.groundAt && (ctx.ik ?? 0) > 0) this.footIK(ctx.groundAt, ctx.ik ?? 0);

    // Secondary cloth / hair.
    const wind = _v.set(0, 0, 0);
    if (ctx.wind) wind.add(ctx.wind);
    if (ctx.velocity) wind.addScaledVector(ctx.velocity, -4.5);
    for (const sp of this.springs) sp.update(dt, wind);

    // Hair morph (transformations).
    if (this.hairBlend < 1) {
      this.hairBlend = Math.min(1, this.hairBlend + dt / 0.28);
      const e = 1 - Math.pow(1 - this.hairBlend, 3);
      if (this.hair) this.hair.mat.userData.anime.uGrow.value = 0.25 + 0.75 * e + Math.sin(e * Math.PI) * 0.12;
      if (this.hairOld) {
        this.hairOld.mat.userData.anime.uGrow.value = 1 - e;
        if (this.hairBlend >= 1) {
          this.hairOld.mesh.visible = false;
          this.hairOld.outline.visible = false;
          this.hairOld.mat.userData.anime.uGrow.value = 1;
          this.hairOld = null;
        }
      }
    }
    // Glow / flash uniforms.
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 9);
    for (const m of [this.bodyMat, ...this.gearMats]) {
      const u = m.userData.anime;
      u.uGlow.value = this.glow * 0.35 * pulse;
      u.uGlowColor.value.copy(this.glowColor);
      u.uHitFlash.value = this.hitFlash;
    }
    this.faceMat.userData.anime.uHitFlash.value = this.hitFlash;
    if (this.hair) {
      const u = this.hair.mat.userData.anime;
      u.uGlow.value = (this.hairGlow * 0.9 + this.glow * 0.25) * pulse;
      u.uHitFlash.value = this.hitFlash;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 11);
    // Blink.
    this.blinkTimer -= dt;
    const wasBlink = this.faceState.blink;
    if (this.blinkTimer < 0) {
      this.faceState.blink = 1;
      if (this.blinkTimer < -0.11) {
        this.faceState.blink = 0;
        this.blinkTimer = 2.2 + Math.random() * 3;
      }
    }
    if (wasBlink !== this.faceState.blink) this.face.draw(this.faceState);
  }

  /** Plant feet on uneven ground: lower the pelvis as needed, then two-bone IK each leg. */
  private footIK(groundAt: (x: number, z: number) => number, weight: number): void {
    const by = this.rig.byName;
    const base = this.group.position.y;
    const legs: [THREE.Bone, THREE.Bone, THREE.Bone][] = [
      [by.thighL, by.shinL, by.footL],
      [by.thighR, by.shinR, by.footR],
    ];
    const targets: THREE.Vector3[] = [];
    let drop = 0;
    for (const [, , foot] of legs) {
      const a = foot.getWorldPosition(new THREE.Vector3());
      const g = groundAt(a.x, a.z);
      const want = a.clone();
      want.y = a.y + (g - base);
      targets.push(want);
      drop = Math.min(drop, g - base);
    }
    drop = Math.max(drop, -0.35 * this.scale);
    if (drop < 0) {
      this.pivot.position.y += drop * weight;
      this.group.updateMatrixWorld(true);
    }
    legs.forEach(([a, b, c], i) => {
      const t = targets[i];
      // Only push feet up onto higher ground or down into dips the pelvis drop allows.
      solveTwoBone(a, b, c, t, weight);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.body.geometry.dispose();
    this.faceMesh.geometry.dispose();
    for (const h of this.hairSets.values()) h.mesh.geometry.dispose();
  }
}
