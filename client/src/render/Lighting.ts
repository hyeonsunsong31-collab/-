import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { QualityPreset } from './Quality.ts';

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

const LIT_TYPES = new Set([
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
  'MeshLambertMaterial',
  'MeshPhongMaterial',
  'MeshToonMaterial',
]);

/**
 * Sun + sky light + cascaded shadow maps. Every lit material must go through `register` so its shader
 * gets the CSM cascade selection (otherwise each cascade light would add up).
 */
export class Lighting {
  readonly sunDir = new THREE.Vector3();
  readonly sunColor = new THREE.Color('#fff1d6');
  readonly hemi: THREE.HemisphereLight;
  readonly csm: CSM;
  private registered = new WeakSet<THREE.Material>();
  private scanTimer = 0;
  sunIntensity = 4.6;

  constructor(
    private scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: QualityPreset,
  ) {
    // Afternoon sun from the south-west, high enough for crisp shadows, low enough for long warm light.
    const elev = THREE.MathUtils.degToRad(36);
    const azim = THREE.MathUtils.degToRad(218);
    this.sunDir.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).normalize();

    this.hemi = new THREE.HemisphereLight('#a9c8ff', '#4f4a30', 0.35);
    scene.add(this.hemi);

    this.csm = new CSM({
      camera,
      parent: scene,
      cascades: quality.cascades,
      maxFar: quality.shadowFar,
      mode: 'practical',
      shadowMapSize: quality.shadowMapSize,
      lightDirection: this.sunDir.clone().negate(),
      lightIntensity: this.sunIntensity,
      lightNear: 1,
      lightFar: 2400,
      lightMargin: 220,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.color.copy(this.sunColor);
      l.shadow.bias = -0.00018;
      l.shadow.normalBias = 0.035;
      l.shadow.radius = 1.5;
    }
  }

  /** Register a lit material: CSM defines + optional extra shader patch, chained. */
  register<M extends THREE.Material>(mat: M, patch?: Patch, cacheKey?: string): M {
    if (this.registered.has(mat)) return mat;
    this.registered.add(mat);
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      patch?.(shader, renderer);
      csmHook.call(mat, shader, renderer);
    };
    if (cacheKey) mat.customProgramCacheKey = () => cacheKey;
    return mat;
  }

  /** Safety net: auto-register any lit material that was added without going through `register`. */
  private scan(): void {
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      for (const mat of arr) {
        if (LIT_TYPES.has(mat.type) && !this.registered.has(mat)) {
          this.register(mat);
          mat.needsUpdate = true;
        }
      }
    });
  }

  update(dt: number): void {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 1.0;
      this.scan();
    }
    this.csm.update();
  }

  setSunIntensity(v: number): void {
    this.sunIntensity = v;
    for (const l of this.csm.lights) l.intensity = v;
  }

  setSunColor(c: THREE.Color): void {
    for (const l of this.csm.lights) l.color.copy(c);
  }

  updateFrustums(): void {
    this.csm.updateFrustums();
  }
}
