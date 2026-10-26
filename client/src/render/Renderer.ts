import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  GodRaysEffect,
  KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { AtmosphereEffect, GradeEffect, CombatFxEffect, DistortEffect } from './effects.ts';
import type { QualityPreset } from './Quality.ts';

/** WebGL renderer + full post-processing stack. */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly atmosphere = new AtmosphereEffect();
  readonly grade = new GradeEffect();
  readonly combat = new CombatFxEffect();
  readonly distort = new DistortEffect();
  readonly bloom: BloomEffect;
  private ao: N8AOPostPass | null = null;
  private godRays: GodRaysEffect | null = null;
  private basePixelRatio: number;
  private adaptScale = 1;
  private frameTimes: number[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private quality: QualityPreset,
    sunMesh: THREE.Mesh,
  ) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
    this.gl.setPixelRatio(this.basePixelRatio);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);

    this.composer = new EffectComposer(this.gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality.ao) {
      this.ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
      this.ao.configuration.aoRadius = 2.2;
      this.ao.configuration.distanceFalloff = 1.0;
      this.ao.configuration.intensity = 2.2;
      this.ao.configuration.halfRes = quality.level !== 'ultra';
      this.ao.configuration.color = new THREE.Color('#1d1a26');
      this.ao.setQualityMode(quality.level === 'ultra' ? 'Medium' : 'Low');
      this.composer.addPass(this.ao);
    }
    this.composer.addPass(new EffectPass(camera, this.atmosphere));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.25,
      intensity: 1.05,
      radius: 0.78,
      levels: 7,
    });
    this.bloom.resolution.scale = quality.bloomScale;
    const toneMap = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const effects: ConstructorParameters<typeof EffectPass>[1][] = [];
    if (quality.godRays) {
      this.godRays = new GodRaysEffect(camera, sunMesh, {
        samples: quality.level === 'ultra' ? 72 : 48,
        density: 0.965,
        decay: 0.935,
        weight: 0.34,
        exposure: 0.62,
        clampMax: 1,
        resolutionScale: 0.5,
        kernelSize: KernelSize.SMALL,
        blur: true,
      });
      effects.push(this.godRays);
    }
    effects.push(this.bloom, toneMap, this.grade);
    this.composer.addPass(new EffectPass(camera, ...effects));
    this.composer.addPass(new EffectPass(camera, this.distort));
    this.composer.addPass(new EffectPass(camera, this.combat));
    const finals: ConstructorParameters<typeof EffectPass>[1][] = [new VignetteEffect({ darkness: 0.42, offset: 0.32 })];
    if (quality.smaa) finals.unshift(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));
    this.composer.addPass(new EffectPass(camera, ...finals));

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gl.setPixelRatio(this.basePixelRatio * this.adaptScale);
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h, false);
  }

  /** Dynamic resolution: back off when frames are consistently slow, recover when fast. */
  adapt(realDt: number): void {
    this.frameTimes.push(realDt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let next = this.adaptScale;
    if (avg > 1 / 40) next = Math.max(0.55, this.adaptScale - 0.1);
    else if (avg < 1 / 58 && this.adaptScale < 1) next = Math.min(1, this.adaptScale + 0.05);
    if (next !== this.adaptScale) {
      this.adaptScale = next;
      this.resize();
    }
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  get pixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  get qualityPreset(): QualityPreset {
    return this.quality;
  }
}
