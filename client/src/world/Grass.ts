import * as THREE from 'three';
import { Rng } from '@ak/shared';
import type { WorldData } from './WorldData.ts';
import type { Lighting } from '../render/Lighting.ts';
import { GLSL_NOISE } from '../render/glsl.ts';
import { WORLD_HALF, HF_N_TEXELS } from './constants.ts';

const TILE = 8;

export const MAX_BENDERS = 10;

/** Shared uniforms for wind + interaction, also used by trees and bushes. */
export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.5) },
  uWindStrength: { value: 1 },
  uBenders: { value: Array.from({ length: MAX_BENDERS }, () => new THREE.Vector4()) },
};

interface Field {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  tiles: THREE.InstancedBufferAttribute;
  max: number;
}

function buildPatch(blades: number, segs: number, rng: Rng, flower: boolean): THREE.BufferGeometry {
  const vPerBlade = segs * 2 + 1;
  const pos = new Float32Array(blades * vPerBlade * 3);
  const off = new Float32Array(blades * vPerBlade * 2);
  const prm = new Float32Array(blades * vPerBlade * 4);
  const idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const ox = rng.range(0, TILE);
    const oz = rng.range(0, TILE);
    const hs = flower ? rng.range(0.6, 1) : rng.range(0, 1);
    const ws = rng.range(0.7, 1.3);
    const rot = rng.range(0, Math.PI * 2);
    const seed = rng.next();
    const base = b * vPerBlade;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const count = s === segs ? 1 : 2;
      for (let k = 0; k < count; k++) {
        const v = base + (s === segs ? segs * 2 : s * 2 + k);
        const side = s === segs ? 0 : k === 0 ? -1 : 1;
        pos[v * 3] = side;
        pos[v * 3 + 1] = t;
        pos[v * 3 + 2] = 0;
        off[v * 2] = ox;
        off[v * 2 + 1] = oz;
        prm[v * 4] = hs;
        prm[v * 4 + 1] = ws;
        prm[v * 4 + 2] = rot;
        prm[v * 4 + 3] = seed;
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      if (s === segs - 1) {
        const tip = base + segs * 2;
        idx.push(a, a + 1, tip);
      } else {
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aOffset', new THREE.BufferAttribute(off, 2));
  g.setAttribute('aParams', new THREE.BufferAttribute(prm, 4));
  g.setIndex(idx);
  return g;
}

/**
 * Instanced grass + wildflowers around the camera. Tiles are frustum-culled on the CPU every frame;
 * blades are placed on the terrain, masked by ground type, swayed by gusting wind and pushed by "benders"
 * (characters, aura, shockwaves) entirely on the GPU.
 */
export class Grass {
  readonly group = new THREE.Group();
  private fields: { field: Field; near: boolean; flower: boolean }[] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private box = new THREE.Box3();
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(
    private data: WorldData,
    lighting: Lighting,
    private density: number,
    private radius: number,
  ) {
    this.uniforms = {
      ...windUniforms,
      uHeight: { value: data.heightTex },
      uSplat: { value: data.splatTex },
      uDamage: { value: data.damageTex },
      uWorldHalf: { value: WORLD_HALF },
      uTexN: { value: HF_N_TEXELS },
      uRadius: { value: radius },
      uNear: { value: Math.max(14, radius * 0.32) },
      uSunDir: { value: lighting.sunDir },
    };
    const rng = new Rng(4242);
    const nearBlades = Math.round(density * TILE * TILE);
    const farBlades = Math.round(nearBlades * 0.28);
    const flowerCount = Math.max(6, Math.round(density * TILE * TILE * 0.06));
    this.fields.push({ field: this.makeField(buildPatch(nearBlades, 4, rng, false), lighting, 'near', false), near: true, flower: false });
    this.fields.push({ field: this.makeField(buildPatch(farBlades, 1, rng, false), lighting, 'far', false), near: false, flower: false });
    this.fields.push({ field: this.makeField(buildPatch(flowerCount, 2, rng, true), lighting, 'flower', true), near: true, flower: true });
  }

  private makeField(patch: THREE.BufferGeometry, lighting: Lighting, kind: string, flower: boolean): Field {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = patch.index;
    for (const k of Object.keys(patch.attributes)) geo.setAttribute(k, patch.attributes[k]);
    const span = Math.ceil((this.radius * 2) / TILE) + 2;
    const max = span * span;
    const tiles = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    tiles.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', tiles);
    geo.instanceCount = 0;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: flower ? 0.6 : 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    lighting.register(mat, (s) => this.patchShader(s, kind, flower), `grass-${kind}`);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return { mesh, geo, tiles, max };
  }

  private patchShader(s: THREE.WebGLProgramParametersWithUniforms, kind: string, flower: boolean): void {
    Object.assign(s.uniforms, this.uniforms);
    const isNear = kind !== 'far';
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aOffset;
        attribute vec4 aParams;
        attribute vec2 aTile;
        uniform sampler2D uHeight;
        uniform sampler2D uSplat;
        uniform sampler2D uDamage;
        uniform float uWorldHalf;
        uniform float uTexN;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        uniform vec4 uBenders[${MAX_BENDERS}];
        uniform float uRadius;
        uniform float uNear;
        varying vec3 vWPos;
        varying float vT;
        varying vec4 vPrm;
        varying float vDry;
        ${GLSL_NOISE}
        vec3 gWorld;
        vec3 gNormal;
        void grassBlade() {
          // De-tile: rotate/mirror offsets per tile.
          float th = akHash12(aTile * 0.37);
          vec2 o = aOffset - ${TILE / 2}.0;
          if (th > 0.5) o = vec2(-o.y, o.x);
          if (fract(th * 7.0) > 0.5) o.x = -o.x;
          vec2 wxz = aTile + o + ${TILE / 2}.0;
          vec2 uv = (wxz + uWorldHalf) / (uWorldHalf * 2.0);
          vec2 huv = (uv * (uTexN - 1.0) + 0.5) / uTexN;
          float h = texture2D(uHeight, huv).r;
          float hx = texture2D(uHeight, huv + vec2(1.0 / uTexN, 0.0)).r;
          float hz = texture2D(uHeight, huv + vec2(0.0, 1.0 / uTexN)).r;
          float slope = length(vec2(hx - h, hz - h)) * 0.5;
          vec4 sp = texture2D(uSplat, uv);
          vec4 dmg = texture2D(uDamage, uv);
          float camD = length(wxz - cameraPosition.xz);
          float mask = 1.0;
          mask *= 1.0 - smoothstep(0.08, 0.4, sp.r);
          mask *= 1.0 - smoothstep(0.15, 0.5, sp.g);
          mask *= 1.0 - smoothstep(0.3, 0.7, sp.b);
          mask *= mix(1.0, ${flower ? '0.0' : '0.35'}, sp.a);
          mask *= 1.0 - smoothstep(0.55, 0.9, slope);
          mask *= smoothstep(0.25, 0.7, h);
          mask *= 1.0 - smoothstep(60.0, 85.0, h);
          mask *= 1.0 - smoothstep(0.15, 0.5, dmg.r);
          ${
            flower
              ? `// Wildflowers cluster in meadows.
          float meadow = smoothstep(0.42, 0.62, akFbm(wxz * 0.012 + 3.0)) + (1.0 - smoothstep(120.0, 260.0, length(wxz - vec2(150.0, 420.0))));
          mask *= clamp(meadow, 0.0, 1.0);
          float fade = 1.0 - smoothstep(uNear * 0.85, uNear, camD);`
              : isNear
                ? 'float fade = 1.0 - smoothstep(uNear - 4.0, uNear, camD);'
                : 'float fade = smoothstep(uNear - 4.0, uNear, camD) * (1.0 - smoothstep(uRadius * 0.8, uRadius, camD));'
          }
          float macro = akFbm(wxz * 0.02);
          vDry = smoothstep(0.55, 0.8, akFbm(wxz * 0.09 + 100.0));
          float bladeH = ${flower ? '(0.28 + 0.22 * aParams.x)' : '(0.32 + 0.5 * aParams.x) * (0.75 + macro * 0.6)'} * mask * fade;
          float bladeW = ${flower ? '0.05' : isNear ? '0.05' : '0.1'} * aParams.y * (fade > 0.0 ? 1.0 : 0.0);
          float rot = aParams.z;
          vec2 facing = vec2(cos(rot), sin(rot));
          vec2 perp = vec2(-facing.y, facing.x);
          float t = position.y;
          vT = t;
          vPrm = aParams;
          // Wind: travelling gust bands + per-blade flutter.
          vec2 wd = normalize(uWindDir);
          float gust = akVnoise(wxz * 0.045 - wd * uTime * 1.6);
          gust = gust * gust * 1.6;
          float flutter = sin(uTime * (3.0 + aParams.w * 2.0) + aParams.w * 40.0 + dot(wxz, vec2(0.7, 0.3))) * 0.12;
          vec2 bend = wd * (0.18 + gust * 0.55 + flutter) * uWindStrength + facing * 0.12;
          // Interaction benders (characters, aura blasts).
          float flatten = 0.0;
          for (int i = 0; i < ${MAX_BENDERS}; i++) {
            vec4 b = uBenders[i];
            if (b.w <= 0.0) continue;
            vec2 d = wxz - b.xy;
            float dist = length(d);
            float k = (1.0 - smoothstep(b.z * 0.3, b.z, dist)) * b.w;
            bend += (d / max(dist, 0.01)) * k * 1.6;
            flatten = max(flatten, k);
          }
          float bl = length(bend);
          if (bl > 1.4) bend *= 1.4 / bl;
          float tt = t * t;
          vec3 up = vec3(0.0, 1.0, 0.0);
          float hh = bladeH * (1.0 - flatten * 0.55);
          vec3 p = vec3(wxz.x, h, wxz.y);
          p += vec3(perp.x, 0.0, perp.y) * position.x * bladeW * (1.0 - t * 0.85);
          p += up * t * hh * (1.0 - 0.25 * min(1.0, bl) * tt);
          p += vec3(bend.x, 0.0, bend.y) * tt * hh;
          gWorld = p;
          vec3 bn = normalize(vec3(facing.x, 0.35, facing.y));
          gNormal = normalize(mix(bn, up, 0.86));
        }`,
      )
      .replace('#include <beginnormal_vertex>', 'grassBlade();\nvec3 objectNormal = gNormal;')
      .replace('#include <begin_vertex>', 'vec3 transformed = gWorld;\nvWPos = gWorld;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vWPos;
        varying float vT;
        varying vec4 vPrm;
        varying float vDry;
        ${GLSL_NOISE}`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        flower
          ? `float pick = vPrm.w;
          vec3 petal = pick < 0.3 ? vec3(0.95, 0.95, 0.9) : pick < 0.55 ? vec3(1.0, 0.82, 0.12) : pick < 0.78 ? vec3(0.42, 0.45, 1.0) : vec3(0.95, 0.12, 0.08);
          vec3 stem = vec3(0.16, 0.32, 0.07);
          vec4 diffuseColor = vec4(mix(stem, petal, smoothstep(0.55, 0.75, vT)), opacity);`
          : `float var = akVnoise(vWPos.xz * 0.11) * 0.5 + vPrm.w * 0.5;
          vec3 baseC = mix(vec3(0.06, 0.14, 0.022), vec3(0.09, 0.19, 0.03), var);
          vec3 tipC = mix(vec3(0.2, 0.38, 0.06), vec3(0.34, 0.48, 0.1), var);
          tipC = mix(tipC, vec3(0.46, 0.4, 0.14), vDry * 0.55);
          vec4 diffuseColor = vec4(mix(baseC, tipC, smoothstep(0.0, 0.85, vT)), opacity);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Sun translucency through blades when looking toward the sun.
        vec3 vdir = normalize(vWPos - cameraPosition);
        float back = pow(max(dot(vdir, uSunDir), 0.0), 3.0);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.55) * back * vT * ${flower ? '0.25' : '0.55'} * diffuseColor.rgb * 3.0;`,
      );
  }

  update(camera: THREE.PerspectiveCamera): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = camera.position.x;
    const cz = camera.position.z;
    const nearR = Math.max(14, this.radius * 0.32);
    const hf = this.data.hf;
    for (const f of this.fields) {
      const r = f.near ? nearR + TILE : this.radius + TILE;
      const inner = f.near ? -1 : nearR - TILE * 1.5;
      const t0x = Math.floor((cx - r) / TILE);
      const t1x = Math.floor((cx + r) / TILE);
      const t0z = Math.floor((cz - r) / TILE);
      const t1z = Math.floor((cz + r) / TILE);
      const arr = f.field.tiles.array as Float32Array;
      let n = 0;
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const x = tx * TILE;
          const z = tz * TILE;
          const dx = Math.max(Math.abs(x + TILE / 2 - cx) - TILE / 2, 0);
          const dz = Math.max(Math.abs(z + TILE / 2 - cz) - TILE / 2, 0);
          const d = Math.hypot(dx, dz);
          if (d > r) continue;
          const dFar = Math.hypot(Math.abs(x + TILE / 2 - cx) + TILE / 2, Math.abs(z + TILE / 2 - cz) + TILE / 2);
          if (dFar < inner) continue;
          if (Math.abs(x) > WORLD_HALF - TILE || Math.abs(z) > WORLD_HALF - TILE) continue;
          const h = hf.heightAt(x + TILE / 2, z + TILE / 2);
          this.box.min.set(x - 1.5, h - 4, z - 1.5);
          this.box.max.set(x + TILE + 1.5, h + 4, z + TILE + 1.5);
          if (!this.frustum.intersectsBox(this.box)) continue;
          if (n >= f.field.max) break;
          arr[n * 2] = x;
          arr[n * 2 + 1] = z;
          n++;
        }
      }
      f.field.geo.instanceCount = n;
      f.field.tiles.needsUpdate = true;
      f.field.tiles.addUpdateRange(0, n * 2);
    }
  }
}
