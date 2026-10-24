import * as THREE from 'three';
import { HF_N, HF_RES } from './Heightfield.ts';
import { WORLD_HALF, WORLD_SIZE } from './layout.ts';
import type { WorldData } from './WorldData.ts';
import type { Lighting } from '../render/Lighting.ts';
import { GLSL_NOISE } from '../render/glsl.ts';

const CHUNK = 128;
const CHUNKS = WORLD_SIZE / CHUNK;
const CELLS = CHUNK / HF_RES; // 64
const LODS = 4;

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh;
  lod: number;
  geos: (THREE.BufferGeometry | null)[];
  center: THREE.Vector3;
}

/** Chunked LOD terrain with skirts, sharing one splatted PBR material. */
export class Terrain {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private chunks: Chunk[] = [];
  readonly uniforms = {
    uSplat: { value: null as THREE.Texture | null },
    uDamage: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uWorldHalf: { value: WORLD_HALF },
  };

  constructor(
    private data: WorldData,
    lighting: Lighting,
    private lodBias: number,
  ) {
    this.uniforms.uSplat.value = data.splatTex;
    this.uniforms.uDamage.value = data.damageTex;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    lighting.register(this.material, (s) => this.patch(s), 'terrain-v1');
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const mesh = new THREE.Mesh(undefined, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        const x0 = cx * CHUNK - WORLD_HALF;
        const z0 = cz * CHUNK - WORLD_HALF;
        const c = new THREE.Vector3(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
        c.y = data.hf.heightAt(c.x, c.z);
        const ch: Chunk = { cx, cz, mesh, lod: -1, geos: new Array(LODS).fill(null), center: c };
        this.chunks.push(ch);
        this.group.add(mesh);
      }
    }
  }

  private patch(s: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(s.uniforms, this.uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform sampler2D uSplat;
        uniform sampler2D uDamage;
        uniform float uWorldHalf;
        uniform float uTime;
        float tRough = 0.9;
        vec3 tDetailN = vec3(0.0);
        ${GLSL_NOISE}
        vec3 terrainAlbedo(vec3 p, vec3 n) {
          vec2 suv = (p.xz + uWorldHalf) / (uWorldHalf * 2.0);
          vec4 sp = texture2D(uSplat, suv);
          vec4 dmg = texture2D(uDamage, suv);
          float macro = akFbm(p.xz * 0.012);
          float meso = akFbm(p.xz * 0.09);
          float micro = akVnoise(p.xz * 1.7);
          // Lush sunlit grass with dry patches.
          vec3 grassA = vec3(0.08, 0.18, 0.028);
          vec3 grassB = vec3(0.15, 0.27, 0.045);
          vec3 dry = vec3(0.26, 0.25, 0.07);
          vec3 grass = mix(grassA, grassB, smoothstep(0.35, 0.7, macro));
          grass = mix(grass, dry, smoothstep(0.58, 0.8, meso) * 0.55);
          grass *= 0.85 + micro * 0.3;
          // Forest floor: dark leaf litter, moss.
          vec3 litter = mix(vec3(0.06, 0.04, 0.018), vec3(0.04, 0.07, 0.015), meso);
          vec3 col = mix(grass, litter * (0.8 + micro * 0.4), sp.a * 0.85);
          // Dirt road with ruts and pebbles.
          vec3 dirt = mix(vec3(0.16, 0.10, 0.045), vec3(0.26, 0.18, 0.09), meso) * (0.85 + micro * 0.3);
          float pebble = smoothstep(0.82, 0.88, akVnoise(p.xz * 9.0));
          dirt = mix(dirt, vec3(0.2, 0.18, 0.15), pebble * 0.45);
          col = mix(col, dirt, smoothstep(0.15, 0.65, sp.r + (meso - 0.5) * 0.35));
          // Village packed earth / cobbles.
          vec2 cob = vec2(0.0, 1.0);
          if (sp.g > 0.02) {
            cob = akVoronoi(p.xz * 1.6);
            vec3 cobble = mix(vec3(0.13, 0.12, 0.10), vec3(0.26, 0.23, 0.19), akHash12(floor(p.xz * 1.6 + cob.x)));
            cobble *= mix(0.55, 1.0, smoothstep(0.02, 0.09, cob.y));
            vec3 village = mix(dirt * 0.95, cobble, smoothstep(0.55, 0.85, sp.g));
            col = mix(col, village, smoothstep(0.1, 0.5, sp.g));
          }
          // Sand & wet bank.
          vec3 sand = mix(vec3(0.42, 0.34, 0.18), vec3(0.14, 0.12, 0.07), smoothstep(0.6, -0.4, p.y));
          col = mix(col, sand * (0.9 + micro * 0.2), sp.b);
          // Rock on steep slopes and high mountains (triplanar-ish noise strata).
          float slope = 1.0 - n.y;
          float rockM = smoothstep(0.28, 0.48, slope + (meso - 0.5) * 0.2);
          rockM = max(rockM, smoothstep(55.0, 95.0, p.y + macro * 30.0) * 0.85);
          float strata = akFbm(vec2(p.y * 0.6, (p.x + p.z) * 0.05));
          vec3 rock = mix(vec3(0.12, 0.11, 0.095), vec3(0.28, 0.26, 0.22), strata) * (0.8 + akVnoise3(p * 0.6) * 0.4);
          col = mix(col, rock, rockM);
          // Snow caps.
          float snow = smoothstep(150.0, 190.0, p.y + macro * 40.0) * smoothstep(0.55, 0.3, slope);
          col = mix(col, vec3(0.82, 0.86, 0.92), snow);
          // Battle damage: scorch + molten crack glow.
          float sc = dmg.r;
          col = mix(col, vec3(0.05, 0.04, 0.035), smoothstep(0.05, 0.6, sc) * 0.85);
          tRough = mix(0.93, 0.8, sp.b) - pebble * 0.1;
          tRough = mix(tRough, 0.72, rockM);
          tRough = mix(tRough, 0.55, snow);
          // Detail normal from noise gradient.
          float e = 0.15;
          float h0 = akVnoise(p.xz * 2.2);
          float hx = akVnoise((p.xz + vec2(e, 0.0)) * 2.2);
          float hz = akVnoise((p.xz + vec2(0.0, e)) * 2.2);
          float bumpK = mix(0.35, 0.9, rockM) + sp.g * 0.6 * smoothstep(0.02, 0.09, cob.y);
          tDetailN = vec3(h0 - hx, 0.0, h0 - hz) * bumpK;
          return col;
        }
        float crackGlow(vec3 p) {
          vec2 suv = (p.xz + uWorldHalf) / (uWorldHalf * 2.0);
          float g = texture2D(uDamage, suv).g;
          if (g < 0.01) return 0.0;
          vec2 v = akVoronoi(p.xz * 0.9);
          float crack = 1.0 - smoothstep(0.0, 0.06, v.y);
          return crack * g;
        }`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec3 tN = normalize(vWNrm);\nvec4 diffuseColor = vec4( terrainAlbedo(vWPos, tN), opacity );',
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(tDetailN, 0.0)).xyz);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float cg = crackGlow(vWPos);
        totalEmissiveRadiance += vec3(3.2, 1.25, 0.35) * cg * 2.5;`,
      );
  }

  private buildGeometry(cx: number, cz: number, lod: number): THREE.BufferGeometry {
    const step = 1 << lod;
    const n = CELLS / step + 1;
    const hf = this.data.hf;
    const i0 = cx * CELLS;
    const j0 = cz * CELLS;
    const x0 = cx * CHUNK - WORLD_HALF;
    const z0 = cz * CHUNK - WORLD_HALF;
    // Grid + one skirt ring.
    const ring = 4 * (n - 1);
    const vcount = n * n + ring;
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const gi = Math.min(HF_N - 1, i0 + i * step);
        const gj = Math.min(HF_N - 1, j0 + j * step);
        pos[v * 3] = x0 + i * step * HF_RES;
        pos[v * 3 + 1] = hf.sample(gi, gj);
        pos[v * 3 + 2] = z0 + j * step * HF_RES;
        hf.gridNormal(gi, gj, Math.max(1, step >> 1), nrm, v * 3);
      }
    }
    // Skirt vertices around the border, dropped down.
    const border: number[] = [];
    for (let i = 0; i < n - 1; i++) border.push(i); // top edge
    for (let j = 0; j < n - 1; j++) border.push(j * n + (n - 1)); // right
    for (let i = n - 1; i > 0; i--) border.push((n - 1) * n + i); // bottom
    for (let j = n - 1; j > 0; j--) border.push(j * n); // left
    const skirtDrop = 2 + step * 1.5;
    for (let b = 0; b < border.length; b++) {
      const src = border[b];
      const v = n * n + b;
      pos[v * 3] = pos[src * 3];
      pos[v * 3 + 1] = pos[src * 3 + 1] - skirtDrop;
      pos[v * 3 + 2] = pos[src * 3 + 2];
      nrm[v * 3] = nrm[src * 3];
      nrm[v * 3 + 1] = nrm[src * 3 + 1];
      nrm[v * 3 + 2] = nrm[src * 3 + 2];
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // Diagonal b-c (matches Heightfield.heightAt).
        idx.push(a, c, b, b, c, d);
      }
    }
    for (let b = 0; b < border.length; b++) {
      const t0 = border[b];
      const t1 = border[(b + 1) % border.length];
      const s0 = n * n + b;
      const s1 = n * n + ((b + 1) % border.length);
      idx.push(t0, t1, s0, t1, s1, s0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  update(camPos: THREE.Vector3): void {
    const b = this.lodBias;
    for (const ch of this.chunks) {
      const d = Math.hypot(camPos.x - ch.center.x, camPos.z - ch.center.z) - CHUNK * 0.5;
      const lod = d < 150 * b ? 0 : d < 360 * b ? 1 : d < 720 * b ? 2 : 3;
      if (lod !== ch.lod) {
        ch.lod = lod;
        let g = ch.geos[lod];
        if (!g) g = ch.geos[lod] = this.buildGeometry(ch.cx, ch.cz, lod);
        ch.mesh.geometry = g;
        // Distant chunks don't need to cast shadows into the cascades.
        ch.mesh.castShadow = lod <= 1;
      }
    }
  }

  /** Rebuild every chunk geometry overlapping a world-space box (after craters). */
  invalidate(minX: number, maxX: number, minZ: number, maxZ: number): void {
    for (const ch of this.chunks) {
      const x0 = ch.cx * CHUNK - WORLD_HALF;
      const z0 = ch.cz * CHUNK - WORLD_HALF;
      if (maxX < x0 - 2 || minX > x0 + CHUNK + 2 || maxZ < z0 - 2 || minZ > z0 + CHUNK + 2) continue;
      for (let l = 0; l < LODS; l++) {
        ch.geos[l]?.dispose();
        ch.geos[l] = null;
      }
      const g = this.buildGeometry(ch.cx, ch.cz, Math.max(0, ch.lod));
      ch.geos[Math.max(0, ch.lod)] = g;
      ch.mesh.geometry = g;
    }
  }
}
