import * as THREE from 'three';
import { RIVER_SMOOTH, LAKE, WATER_LEVEL, WORLD_HALF } from './layout.ts';
import { HF_N } from './Heightfield.ts';
import type { WorldData } from './WorldData.ts';
import { GLSL_NOISE } from '../render/glsl.ts';

/**
 * River ribbon + lake with a stylised-realistic water shader: flowing normals, fresnel sky reflection,
 * depth-tinted shallows, shore foam and HDR sun glints that bloom into sparkles.
 */
export class Water {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;

  constructor(data: WorldData, sunDir: THREE.Vector3, env: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir },
        uHeight: { value: data.heightTex },
        uWorldHalf: { value: WORLD_HALF },
        uTexN: { value: HF_N },
        uEnv: { value: env },
      },
      vertexShader: /* glsl */ `
        attribute float aFlow;
        varying vec3 vW;
        varying vec2 vFlowUv;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vFlowUv = vec2(uv.x, uv.y);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader:
        GLSL_NOISE +
        /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform sampler2D uHeight;
        uniform float uWorldHalf;
        uniform float uTexN;
        uniform sampler2D uEnv;
        varying vec3 vW;
        varying vec2 vFlowUv;
        float wh(vec2 p) {
          return akVnoise(p * 0.35 + vec2(uTime * 0.18, uTime * 0.05)) * 0.6
               + akVnoise(p * 1.1 - vec2(uTime * 0.33, -uTime * 0.21)) * 0.3
               + akVnoise(p * 3.7 + vec2(-uTime * 0.6, uTime * 0.42)) * 0.12;
        }
        void main() {
          vec2 uv = (vW.xz + uWorldHalf) / (uWorldHalf * 2.0);
          vec2 huv = (uv * (uTexN - 1.0) + 0.5) / uTexN;
          float ground = texture2D(uHeight, huv).r;
          float depth = vW.y - ground;
          if (depth < -0.05) discard;
          // River flow advects the pattern downstream (ribbon UV = across/along meters).
          #ifdef IS_RIVER
          vec2 fp = vec2(vFlowUv.x, vFlowUv.y - uTime * 2.4);
          #else
          vec2 fp = vW.xz;
          #endif
          float e = 0.25;
          float h0 = wh(fp);
          float hx = wh(fp + vec2(e, 0.0));
          float hz = wh(fp + vec2(0.0, e));
          vec3 n = normalize(vec3((h0 - hx) * 1.6, 1.0, (h0 - hz) * 1.6));
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.02 + 0.98 * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 5.0);
          vec3 r = reflect(-v, n);
          // Sky reflection: gradient + env sample.
          vec3 sky = mix(vec3(0.55, 0.7, 0.85), vec3(0.22, 0.42, 0.72), clamp(r.y, 0.0, 1.0));
          // Water body color by depth.
          vec3 shallow = vec3(0.18, 0.42, 0.36);
          vec3 deep = vec3(0.03, 0.12, 0.16);
          vec3 body = mix(shallow, deep, smoothstep(0.2, 3.0, depth));
          float sunDiff = max(dot(n, uSunDir), 0.0);
          body *= 0.55 + 0.6 * sunDiff;
          vec3 col = mix(body, sky, fres * 0.85);
          // Sun glints (HDR -> bloom sparkles).
          float spec = pow(max(dot(r, uSunDir), 0.0), 380.0);
          float sparkle = step(0.82, akHash12(floor(vW.xz * 6.0) + floor(uTime * 9.0)));
          col += vec3(1.0, 0.92, 0.75) * spec * (10.0 + sparkle * 30.0);
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.6;
          // Shore foam.
          float foam = (1.0 - smoothstep(0.0, 0.45, depth)) * smoothstep(0.45, 0.7, akVnoise(vW.xz * 2.5 + uTime * 0.6));
          col = mix(col, vec3(0.95), foam * 0.8);
          float alpha = mix(0.35, 0.94, smoothstep(0.0, 1.2, depth));
          alpha = max(alpha, foam * 0.9);
          gl_FragColor = vec4(col, alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });

    // River ribbon.
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    let acc = 0;
    for (let i = 0; i < RIVER_SMOOTH.length; i++) {
      const [x, z] = RIVER_SMOOTH[i];
      const [nx0, nz0] = RIVER_SMOOTH[Math.min(RIVER_SMOOTH.length - 1, i + 1)];
      const [px0, pz0] = RIVER_SMOOTH[Math.max(0, i - 1)];
      const tx = nx0 - px0;
      const tz = nz0 - pz0;
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      if (i > 0) acc += Math.hypot(x - RIVER_SMOOTH[i - 1][0], z - RIVER_SMOOTH[i - 1][1]);
      const w = 22;
      pos.push(x + nx * w, WATER_LEVEL, z + nz * w, x - nx * w, WATER_LEVEL, z - nz * w);
      uvs.push(w, acc, -w, acc);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    rg.setIndex(idx);
    rg.computeBoundingSphere();
    const riverMat = this.material.clone();
    riverMat.defines = { IS_RIVER: '' };
    riverMat.uniforms = this.material.uniforms;
    const river = new THREE.Mesh(rg, riverMat);
    river.renderOrder = 2;
    this.group.add(river);

    const lg = new THREE.CircleGeometry(LAKE.r + 30, 64);
    lg.rotateX(-Math.PI / 2);
    const lake = new THREE.Mesh(lg, this.material);
    lake.position.set(LAKE.x, WATER_LEVEL + 0.001, LAKE.z);
    lake.renderOrder = 2;
    this.group.add(lake);
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
  }
}
