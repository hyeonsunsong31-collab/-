import * as THREE from 'three';
import type { Lighting } from '../render/Lighting.ts';

/** Shared per-frame uniforms for every anime-shaded character. */
export const animeShared = {
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uTime: { value: 0 },
};

let gradient: THREE.DataTexture | null = null;

/** 3-band cel ramp: deep shade, soft mid, full light (nearest filtered for crisp anime terminators). */
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([88, 88, 190, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface AnimeUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uGlowColor: { value: THREE.Color };
  uGlow: { value: number };
  uHitFlash: { value: number };
  uShadeTint: { value: THREE.Color };
  /** Scale toward uGrowCenter in bind space (hair morph during transformations). */
  uGrow: { value: number };
  uGrowCenter: { value: THREE.Vector3 };
}

export interface AnimeMaterial extends THREE.MeshToonMaterial {
  userData: { anime: AnimeUniforms };
}

/**
 * Cel-shaded character material: toon ramp + warm/cool shadow tint + sun-side rim light + transform glow +
 * white hit flash. Registered with the lighting system so it receives cascaded sun shadows.
 */
export function animeMaterial(
  lighting: Lighting,
  opts: { color?: THREE.ColorRepresentation; vertexColors?: boolean; map?: THREE.Texture | null; transparent?: boolean; key: string },
): AnimeMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: toonGradient(),
    vertexColors: !!opts.vertexColors,
    map: opts.map ?? null,
    transparent: !!opts.transparent,
  }) as AnimeMaterial;
  const u: AnimeUniforms = {
    uRimColor: { value: new THREE.Color('#fff4dc') },
    uRimStrength: { value: 0.55 },
    uGlowColor: { value: new THREE.Color('#ffcf2e') },
    uGlow: { value: 0 },
    uHitFlash: { value: 0 },
    uShadeTint: { value: new THREE.Color('#6a5a9a') },
    uGrow: { value: 1 },
    uGrowCenter: { value: new THREE.Vector3() },
  };
  mat.userData.anime = u;
  lighting.register(
    mat,
    (s) => {
      Object.assign(s.uniforms, u, animeShared);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uGrow;\nuniform vec3 uGrowCenter;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = uGrowCenter + (transformed - uGrowCenter) * uGrow;');
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uRimColor;
          uniform float uRimStrength;
          uniform vec3 uGlowColor;
          uniform float uGlow;
          uniform float uHitFlash;
          uniform vec3 uShadeTint;
          uniform vec3 uSunView;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
            vec3 V = normalize(vViewPosition);
            vec3 N = normalize(normal);
            float ndv = clamp(dot(N, V), 0.0, 1.0);
            float fres = pow(1.0 - ndv, 3.0);
            float sunSide = clamp(dot(N, uSunView) * 0.5 + 0.5, 0.0, 1.0);
            float rim = smoothstep(0.42, 0.62, fres) * (0.25 + 0.75 * sunSide);
            // Cool tint in the shaded band keeps shadows colourful instead of muddy.
            float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
            float shade = 1.0 - smoothstep(0.08, 0.35, lum / max(0.001, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))));
            outgoingLight = mix(outgoingLight, outgoingLight * (uShadeTint * 1.25), shade * 0.35);
            outgoingLight += uRimColor * rim * uRimStrength;
            outgoingLight += uGlowColor * uGlow * (0.25 + fres * 1.6);
            outgoingLight = mix(outgoingLight, vec3(2.2), uHitFlash);
          }
          #include <opaque_fragment>`,
        );
    },
    `anime-${opts.key}`,
  );
  return mat;
}

export interface OutlineUniforms {
  uOutline: { value: number };
  uOutlineColor: { value: THREE.Color };
}

/** Inverted-hull outline; thickness grows gently with distance to stay readable. */
export function outlineMaterial(thickness = 0.0065, skinned = true): THREE.MeshBasicMaterial & { userData: { outline: OutlineUniforms } } {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }) as THREE.MeshBasicMaterial & {
    userData: { outline: OutlineUniforms };
  };
  const u: OutlineUniforms = { uOutline: { value: thickness }, uOutlineColor: { value: new THREE.Color('#140c10') } };
  mat.userData.outline = u;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace(
        skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>',
        `${skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>'}
        {
          vec4 wpo = modelMatrix * vec4(transformed, 1.0);
          float dist = distance(wpo.xyz, cameraPosition);
          float k = clamp(dist / 5.0, 1.0, 5.0);
          transformed += normalize(${skinned ? 'objectNormal' : 'normal'}) * uOutline * k;
        }`,
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uOutlineColor;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( uOutlineColor, opacity );');
  };
  mat.customProgramCacheKey = () => (skinned ? 'anime-outline' : 'anime-outline-rigid');
  return mat;
}
