import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { GLSL_NOISE } from './glsl.ts';

/**
 * Exponential height fog + aerial perspective + sun in-scattering, reconstructed from the depth buffer.
 * Gives the "heavy sunshine" haze without patching every material.
 */
export class AtmosphereEffect extends Effect {
  constructor() {
    super(
      'AtmosphereEffect',
      /* glsl */ `
      uniform mat4 uProjInv;
      uniform mat4 uViewInv;
      uniform vec3 uCamPos;
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunColor;
      uniform float uDensity;
      uniform float uFalloff;
      uniform float uAerial;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        if (depth >= 0.99999) { outputColor = inputColor; return; }
        vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 vp = uProjInv * clip;
        vp /= vp.w;
        vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
        vec3 rd = wp - uCamPos;
        float dist = length(rd);
        rd /= max(dist, 1e-4);
        // Analytic exponential height fog along the view ray.
        float k = uFalloff;
        float h0 = max(uCamPos.y, -20.0);
        float dy = rd.y * k;
        float fogInt = uDensity * exp(-h0 * k) * dist;
        if (abs(dy) > 1e-4) fogInt *= (1.0 - exp(-dist * dy)) / (dist * dy);
        float aerial = 1.0 - exp(-dist * uAerial);
        float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
        vec3 fogCol = mix(uFogColor, uHorizonColor, smoothstep(0.0, 0.25, rd.y + 0.05));
        fogCol = mix(fogCol, uSunColor, sunAmt * 0.65);
        float f = clamp(1.0 - exp(-fogInt), 0.0, 1.0);
        f = max(f, aerial * 0.85);
        outputColor = vec4(mix(inputColor.rgb, fogCol, f), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
          ['uViewInv', new THREE.Uniform(new THREE.Matrix4())],
          ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
          ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
          ['uFogColor', new THREE.Uniform(new THREE.Color('#b9cde0'))],
          ['uHorizonColor', new THREE.Uniform(new THREE.Color('#cfe0ef'))],
          ['uSunColor', new THREE.Uniform(new THREE.Color('#ffe2b0'))],
          ['uDensity', new THREE.Uniform(0.00042)],
          ['uFalloff', new THREE.Uniform(0.018)],
          ['uAerial', new THREE.Uniform(0.00011)],
        ]),
      },
    );
  }

  sync(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3): void {
    const u = this.uniforms;
    (u.get('uProjInv')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.get('uViewInv')!.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.get('uCamPos')!.value as THREE.Vector3).copy(camera.position);
    (u.get('uSunDir')!.value as THREE.Vector3).copy(sunDir);
  }
}

/** Warm sunshine grade: lifted warm highlights, slightly cool shadows, saturation and contrast. */
export class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      uniform float uSaturation;
      uniform float uContrast;
      uniform vec3 uHighlights;
      uniform vec3 uShadows;
      uniform float uExposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * uExposure;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        c = (c - 0.5) * uContrast + 0.5;
        float hl = smoothstep(0.45, 1.0, l);
        float sh = 1.0 - smoothstep(0.0, 0.4, l);
        c *= mix(vec3(1.0), uHighlights, hl);
        c *= mix(vec3(1.0), uShadows, sh);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['uSaturation', new THREE.Uniform(1.08)],
          ['uContrast', new THREE.Uniform(1.06)],
          ['uHighlights', new THREE.Uniform(new THREE.Vector3(1.04, 1.0, 0.92))],
          ['uShadows', new THREE.Uniform(new THREE.Vector3(0.94, 0.98, 1.06))],
          ['uExposure', new THREE.Uniform(1.0)],
        ]),
      },
    );
  }
}

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

/**
 * All the "screen impact" effects in one pass: perfect-dodge greyscale slow-mo with edge preservation,
 * anime impact frames, radial zoom blur, chromatic aberration, shockwave ripples, heat haze,
 * manga speed lines, flashes, tints and vignette pulses.
 */
export class CombatFxEffect extends Effect {
  constructor() {
    super(
      'CombatFxEffect',
      GLSL_NOISE +
        /* glsl */ `
      uniform float uGrey;
      uniform float uEdge;
      uniform float uImpact;
      uniform float uImpactMode;
      uniform float uImpactDepth;
      uniform float uFlash;
      uniform vec3 uFlashColor;
      uniform float uRadial;
      uniform vec2 uRadialCenter;
      uniform float uCA;
      uniform float uSpeed;
      uniform vec2 uSpeedCenter;
      uniform float uVig;
      uniform vec3 uTint;
      uniform float uTintAmt;
      uniform float uT;

      float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      float linDepth(vec2 uv) { return -getViewZ(readDepth(uv)); }

      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        vec2 asp = vec2(aspect, 1.0);
        if (uRadial > 0.001) {
          vec2 dir = uv - uRadialCenter;
          vec3 acc = c;
          for (int i = 1; i < 12; i++) {
            float t = float(i) / 12.0 * uRadial * 0.14;
            acc += texture2D(inputBuffer, uv - dir * t).rgb;
          }
          c = acc / 12.0;
        }
        if (uCA > 0.001) {
          vec2 dir = (uv - 0.5) * uCA * 0.016;
          vec3 ca = vec3(texture2D(inputBuffer, uv - dir).r, c.g, texture2D(inputBuffer, uv + dir).b);
          c = mix(c, ca, 0.9);
        }
        if (uGrey > 0.001) {
          float l = lumaOf(c);
          // Contrast S-curve keeps planes separated in greyscale.
          float ls = smoothstep(0.0, 1.0, pow(clamp(l, 0.0, 1.0), 0.85));
          ls = mix(ls, ls * ls * (3.0 - 2.0 * ls), 0.6);
          // Edge detection on luminance + linear depth (Sobel) to keep silhouettes crisp.
          vec2 t = texelSize * 1.25;
          float d0 = linDepth(uv);
          float dx = abs(linDepth(uv + vec2(t.x, 0.0)) - linDepth(uv - vec2(t.x, 0.0)));
          float dy = abs(linDepth(uv + vec2(0.0, t.y)) - linDepth(uv - vec2(0.0, t.y)));
          float de = smoothstep(0.02, 0.09, (dx + dy) / max(d0, 0.5));
          float lx = abs(lumaOf(texture2D(inputBuffer, uv + vec2(t.x, 0.0)).rgb) - lumaOf(texture2D(inputBuffer, uv - vec2(t.x, 0.0)).rgb));
          float ly = abs(lumaOf(texture2D(inputBuffer, uv + vec2(0.0, t.y)).rgb) - lumaOf(texture2D(inputBuffer, uv - vec2(0.0, t.y)).rgb));
          float le = smoothstep(0.08, 0.3, lx + ly);
          float e = max(de, le * 0.7);
          vec3 g = vec3(0.08 + ls * 0.9) * vec3(0.97, 0.99, 1.03);
          // Near objects slightly brighter than the far background for depth separation.
          g *= mix(1.06, 0.88, smoothstep(6.0, 140.0, d0));
          g = mix(g, vec3(0.04), e * uEdge);
          c = mix(c, g, uGrey);
        }
        if (uImpact > 0.001) {
          // Manga impact frame: everything near the strike becomes an ink silhouette over a blown-out
          // background with radial streaks (mode 1 = crimson variant when the player is the one hit).
          float dz = linDepth(uv);
          float sil = 1.0 - smoothstep(uImpactDepth - 1.5, uImpactDepth + 1.5, dz);
          vec2 d = (uv - uRadialCenter) * asp;
          float ang = atan(d.y, d.x);
          float streak = smoothstep(0.55, 0.95, akVnoise(vec2(ang * 30.0, 3.7))) * smoothstep(0.05, 0.6, length(d));
          float l = lumaOf(c);
          vec3 bg = uImpactMode < 0.5 ? vec3(0.97, 0.96, 0.92) : vec3(0.95, 0.12, 0.06);
          vec3 ink = uImpactMode < 0.5 ? vec3(0.02) : vec3(0.03, 0.0, 0.0);
          vec3 a = mix(bg * (1.0 - streak * 0.35), ink + vec3(smoothstep(0.75, 1.0, l)) * 0.25, sil);
          c = mix(c, a, uImpact);
        }
        if (uSpeed > 0.001) {
          vec2 d = (uv - uSpeedCenter) * asp;
          float ang = atan(d.y, d.x);
          float r = length(d);
          float seed = floor(uT * 20.0);
          float n = akVnoise(vec2(ang * 48.0, seed * 7.13));
          float lines = smoothstep(0.78, 0.86, n) * smoothstep(0.18, 0.75, r + (n - 0.8) * 0.6);
          c = mix(c, vec3(1.0), lines * uSpeed * 0.75);
        }
        c = mix(c, c * uTint, uTintAmt);
        c = mix(c, uFlashColor, uFlash);
        if (uVig > 0.001) {
          float v = smoothstep(0.35, 1.1, length((uv - 0.5) * asp * 1.2));
          c *= 1.0 - v * uVig;
        }
        outputColor = vec4(c, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['uGrey', new THREE.Uniform(0)],
          ['uEdge', new THREE.Uniform(0.85)],
          ['uImpact', new THREE.Uniform(0)],
          ['uImpactMode', new THREE.Uniform(0)],
          ['uImpactDepth', new THREE.Uniform(8)],
          ['uFlash', new THREE.Uniform(0)],
          ['uFlashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))],
          ['uRadial', new THREE.Uniform(0)],
          ['uRadialCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
          ['uCA', new THREE.Uniform(0)],
          ['uSpeed', new THREE.Uniform(0)],
          ['uSpeedCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
          ['uVig', new THREE.Uniform(0)],
          ['uTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
          ['uTintAmt', new THREE.Uniform(0)],
          ['uT', new THREE.Uniform(0)],
        ]),
      },
    );
  }

  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }
}

/** Screen-space distortion: expanding shockwave ripples and heat haze around charging auras. */
export class DistortEffect extends Effect {
  constructor() {
    super(
      'DistortEffect',
      GLSL_NOISE +
        /* glsl */ `
      uniform vec4 uRipples[4];
      uniform vec4 uHeat;
      uniform float uT;
      void mainUv(inout vec2 uv) {
        vec2 asp = vec2(aspect, 1.0);
        for (int i = 0; i < 4; i++) {
          vec4 r = uRipples[i];
          if (r.w <= 0.0) continue;
          vec2 d = (uv - r.xy) * asp;
          float dist = length(d);
          float x = (dist - r.z) / 0.07;
          float wave = exp(-x * x) * sin(x * 2.6);
          uv -= (d / max(dist, 1e-4)) / asp * wave * r.w * 0.028;
        }
        if (uHeat.w > 0.0) {
          vec2 d = (uv - uHeat.xy) * asp;
          float m = 1.0 - smoothstep(uHeat.z * 0.55, uHeat.z, length(d));
          vec2 n = vec2(akVnoise(uv * 38.0 + vec2(0.0, uT * 3.2)), akVnoise(uv * 38.0 + vec2(17.0, uT * 3.7))) - 0.5;
          uv += n * m * uHeat.w * 0.014;
        }
      }

      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = inputColor;
      }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map<string, THREE.Uniform>([
          ['uRipples', new THREE.Uniform([new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()])],
          ['uHeat', new THREE.Uniform(new THREE.Vector4())],
          ['uT', new THREE.Uniform(0)],
        ]),
      },
    );
  }

  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }
}
