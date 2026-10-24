import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '@ak/shared';
import type { WorldData, Scatter } from './WorldData.ts';
import type { Lighting } from '../render/Lighting.ts';
import { barkTexture, leafTexture, rockTexture } from '../render/textures.ts';
import { windUniforms } from './Grass.ts';

type Species = 'oak' | 'pine' | 'birch';
const SPECIES: Species[] = ['oak', 'pine', 'birch'];
const VARIANTS = 3;

interface TreeGeo {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  height: number;
  width: number;
  trunkR: number;
}

/** Builds a tapered, wobbling tube along a path of points with radii. */
function tube(path: THREE.Vector3[], radii: number[], radial: number, vScale: number, flexBase: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const flex: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const nA = new THREE.Vector3();
  const nB = new THREE.Vector3();
  let vAcc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i < path.length - 1) t.subVectors(path[i + 1], p).normalize();
    else t.subVectors(p, path[i - 1]).normalize();
    nA.crossVectors(t, Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    nB.crossVectors(t, nA).normalize();
    if (i > 0) vAcc += path[i].distanceTo(path[i - 1]);
    for (let r = 0; r <= radial; r++) {
      const a = (r / radial) * Math.PI * 2;
      const n = new THREE.Vector3().addScaledVector(nA, Math.cos(a)).addScaledVector(nB, Math.sin(a));
      pos.push(p.x + n.x * radii[i], p.y + n.y * radii[i], p.z + n.z * radii[i]);
      nrm.push(n.x, n.y, n.z);
      uv.push(r / radial, vAcc * vScale);
      flex.push(flexBase[i]);
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let r = 0; r < radial; r++) {
      const a = i * (radial + 1) + r;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  g.setIndex(idx);
  return g;
}

function generateTree(species: Species, variant: number, lod: 0 | 1): TreeGeo {
  const rng = new Rng(1000 + SPECIES.indexOf(species) * 100 + variant * 7);
  const barks: THREE.BufferGeometry[] = [];
  const leafPos: number[] = [];
  const leafNrm: number[] = [];
  const leafUv: number[] = [];
  const leafFlex: number[] = [];
  const radial = lod === 0 ? 7 : 4;
  const height = species === 'pine' ? rng.range(13, 17) : species === 'birch' ? rng.range(10, 13) : rng.range(9, 12);
  const trunkR = species === 'pine' ? 0.38 : species === 'birch' ? 0.2 : 0.48;
  const canopyCenter = new THREE.Vector3(0, height * (species === 'pine' ? 0.55 : 0.68), 0);
  let maxW = 1;

  const addCard = (c: THREE.Vector3, size: number, flex: number, droop = 0) => {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rng.range(-1.2, 1.2) + droop, rng.range(0, Math.PI * 2), rng.range(-0.8, 0.8)),
    );
    const n = c.clone().sub(canopyCenter).normalize();
    n.y = n.y * 0.6 + 0.4;
    n.normalize();
    const corners = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    const base = leafPos.length / 3;
    for (const [x, y, u, v] of corners) {
      const p = new THREE.Vector3(x * size * 0.5, y * size * 0.5, 0).applyQuaternion(q).add(c);
      leafPos.push(p.x, p.y, p.z);
      leafNrm.push(n.x, n.y, n.z);
      leafUv.push(u, v);
      leafFlex.push(flex);
    }
    // Two triangles; double-sided material.
    void base;
    maxW = Math.max(maxW, Math.hypot(c.x, c.z) + size * 0.5);
  };

  const leafIdx: number[] = [];
  const pushCardIdx = () => {
    const b = leafPos.length / 3 - 4;
    leafIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };

  const grow = (start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const segs = lod === 0 ? Math.max(3, Math.round(length / 0.9)) : 2;
    const path: THREE.Vector3[] = [start.clone()];
    const radii: number[] = [radius];
    const flexes: number[] = [];
    const d = dir.clone().normalize();
    const p = start.clone();
    for (let s = 1; s <= segs; s++) {
      // Gravitropism + wobble.
      if (species === 'pine' && depth > 0) d.y -= 0.06;
      else d.y += depth > 0 ? 0.05 : 0.01;
      d.x += rng.range(-0.12, 0.12);
      d.z += rng.range(-0.12, 0.12);
      d.normalize();
      p.addScaledVector(d, length / segs);
      path.push(p.clone());
      radii.push(radius * (1 - (s / segs) * 0.72));
    }
    for (const q of path) {
      const h = Math.max(0, q.y / height);
      flexes.push(depth === 0 ? h * h * 0.15 : 0.15 + depth * 0.25 + h * 0.2);
    }
    barks.push(tube(path, radii, depth === 0 ? radial : Math.max(3, radial - 2), 0.5, flexes));
    const tip = path[path.length - 1];

    if (species === 'pine') {
      if (depth === 0) {
        const whorls = lod === 0 ? 11 : 6;
        for (let w = 0; w < whorls; w++) {
          const t = 0.22 + (w / whorls) * 0.74;
          const idx = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
          const at = path[idx];
          const n = lod === 0 ? rng.int(5, 7) : 4;
          const len = (1 - t) * height * 0.42 + 0.6;
          for (let b = 0; b < n; b++) {
            const a = (b / n) * Math.PI * 2 + rng.range(-0.3, 0.3) + w;
            const bd = new THREE.Vector3(Math.cos(a), rng.range(-0.15, 0.05), Math.sin(a));
            grow(at, bd, len * rng.range(0.85, 1.1), radius * 0.22, 1);
          }
        }
        // Tip tuft.
        for (let k = 0; k < (lod === 0 ? 4 : 2); k++) {
          addCard(tip.clone().add(new THREE.Vector3(0, -0.6 - k * 0.4, 0)), 1.6, 0.7);
          pushCardIdx();
        }
      } else {
        // Needle cards along the branch, slightly drooping.
        const cards = lod === 0 ? Math.max(3, Math.round(length / 0.55)) : Math.max(1, Math.round(length / 1.6));
        for (let c = 0; c < cards; c++) {
          const t = 0.25 + (c / cards) * 0.75;
          const i = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
          addCard(path[i].clone().add(new THREE.Vector3(0, 0.05, 0)), lod === 0 ? 1.25 : 2.1, 0.45 + t * 0.4, 1.2);
          pushCardIdx();
        }
      }
      return;
    }

    const maxDepth = species === 'birch' ? 2 : 3;
    if (depth < maxDepth) {
      const kids = depth === 0 ? (species === 'oak' ? rng.int(4, 6) : rng.int(5, 7)) : rng.int(2, 4);
      for (let k = 0; k < kids; k++) {
        const t = depth === 0 ? rng.range(species === 'oak' ? 0.42 : 0.35, 0.95) : rng.range(0.45, 1);
        const i = Math.min(path.length - 1, Math.round(t * (path.length - 1)));
        const a = (k / kids) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const spread = species === 'birch' ? rng.range(0.45, 0.75) : rng.range(0.6, 1.05);
        const bd = new THREE.Vector3(Math.cos(a) * Math.sin(spread), Math.cos(spread), Math.sin(a) * Math.sin(spread));
        bd.lerp(d, 0.25).normalize();
        const childLen = length * (depth === 0 ? (species === 'oak' ? 0.55 : 0.42) : 0.62) * rng.range(0.85, 1.15);
        grow(path[i], bd, childLen, radii[i] * (depth === 0 ? 0.55 : 0.6), depth + 1);
      }
    }
    if (depth >= (species === 'birch' ? 1 : 2)) {
      // Leaf clusters at and near the tip.
      const cards = lod === 0 ? (species === 'birch' ? 5 : 7) : 2;
      const size = lod === 0 ? (species === 'birch' ? 1.5 : 2.0) : species === 'birch' ? 2.6 : 3.4;
      const spread = species === 'birch' ? 0.9 : 1.3;
      for (let c = 0; c < cards; c++) {
        const off = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.6, 0.9), rng.range(-1, 1)).multiplyScalar(spread);
        addCard(tip.clone().add(off), size * rng.range(0.85, 1.15), 0.6 + depth * 0.15, species === 'birch' ? 0.6 : 0);
        pushCardIdx();
      }
    }
  };

  const trunkLen = species === 'pine' ? height : species === 'birch' ? height * 0.72 : height * 0.5;
  const lean = new THREE.Vector3(rng.range(-0.08, 0.08), 1, rng.range(-0.08, 0.08));
  grow(new THREE.Vector3(0, -0.3, 0), lean, trunkLen, trunkR, 0);
  // Root flare for broadleaf trees.
  if (species !== 'pine' && lod === 0) {
    for (let r = 0; r < 4; r++) {
      const a = (r / 4) * Math.PI * 2 + 0.4;
      const path = [
        new THREE.Vector3(Math.cos(a) * trunkR * 0.5, 0.9, Math.sin(a) * trunkR * 0.5),
        new THREE.Vector3(Math.cos(a) * trunkR * 1.6, 0.05, Math.sin(a) * trunkR * 1.6),
        new THREE.Vector3(Math.cos(a) * trunkR * 2.4, -0.25, Math.sin(a) * trunkR * 2.4),
      ];
      barks.push(tube(path, [trunkR * 0.45, trunkR * 0.3, trunkR * 0.12], 4, 0.5, [0, 0, 0]));
    }
  }

  const bark = mergeGeometries(barks, false)!;
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(leafPos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(leafNrm, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(leafUv, 2));
  leaves.setAttribute('aFlex', new THREE.Float32BufferAttribute(leafFlex, 1));
  leaves.setIndex(leafIdx);
  bark.computeBoundingSphere();
  leaves.computeBoundingSphere();
  return { bark, leaves, height, width: maxW * 2, trunkR };
}

/** Wind sway patch shared by trees and bushes. */
function windPatch(s: THREE.WebGLProgramParametersWithUniforms, leaf: boolean): void {
  Object.assign(s.uniforms, windUniforms);
  s.vertexShader = s.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      attribute float aFlex;
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindStrength;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float ph = dot(ip.xz, vec2(0.071, 0.053));
        float sway = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.1 + ph * 1.7) * 0.3;
        float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ph * 0.2);
        vec2 wd = normalize(uWindDir);
        transformed.xz += wd * sway * aFlex * gust * 0.35 * uWindStrength;
        ${leaf ? 'transformed += normal * sin(uTime * 6.0 + ph * 9.0 + position.y * 3.0) * 0.04 * aFlex * uWindStrength;' : ''}
      }`,
    );
  if (leaf) {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * 0.12;`,
    );
  }
}

interface TreeType {
  lods: { bark: THREE.InstancedMesh; leaves: THREE.InstancedMesh }[];
  impostor: THREE.InstancedMesh;
  geo: TreeGeo;
  trees: Scatter[];
}

/** Trees (3 LODs incl. impostors), bushes and rocks, all instanced. */
export class Vegetation {
  readonly group = new THREE.Group();
  private types: TreeType[] = [];
  private lastBucket = new THREE.Vector3(1e9, 0, 1e9);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  readonly felled = new Set<Scatter>();
  readonly trunkColliders: { x: number; z: number; r: number; tree: Scatter }[] = [];

  constructor(
    private data: WorldData,
    lighting: Lighting,
    renderer: THREE.WebGLRenderer,
    private nearDist: number,
  ) {
    const barkMats = SPECIES.map((sp) => {
      const t = barkTexture(sp);
      const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95 });
      return lighting.register(m, (s) => windPatch(s, false), `bark-${sp}`);
    });
    const leafMats = SPECIES.map((sp) => {
      const m = new THREE.MeshStandardMaterial({
        map: leafTexture(sp),
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      return lighting.register(m, (s) => windPatch(s, true), `leaf-${sp}`);
    });

    const byType = new Map<number, Scatter[]>();
    for (const t of data.trees) {
      const k = Math.floor(t.v / 10) * VARIANTS + (t.v % 10);
      if (!byType.has(k)) byType.set(k, []);
      byType.get(k)!.push(t);
      this.trunkColliders.push({ x: t.x, z: t.z, r: 0.35 + t.s * 0.25, tree: t });
    }

    for (let si = 0; si < SPECIES.length; si++) {
      for (let v = 0; v < VARIANTS; v++) {
        const trees = byType.get(si * VARIANTS + v) ?? [];
        const g0 = generateTree(SPECIES[si], v, 0);
        const g1 = generateTree(SPECIES[si], v, 1);
        const lods = [g0, g1].map((g, li) => {
          const bark = new THREE.InstancedMesh(g.bark, barkMats[si], Math.max(1, trees.length));
          const leaves = new THREE.InstancedMesh(g.leaves, leafMats[si], Math.max(1, trees.length));
          for (const im of [bark, leaves]) {
            im.count = 0;
            im.castShadow = true;
            im.receiveShadow = true;
            im.frustumCulled = false;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.group.add(im);
          }
          void li;
          return { bark, leaves };
        });
        const imp = this.makeImpostor(renderer, g0, barkMats[si], leafMats[si], lighting, SPECIES[si]);
        const impostor = new THREE.InstancedMesh(imp, imp.userData.material as THREE.Material, Math.max(1, trees.length));
        impostor.count = 0;
        impostor.frustumCulled = false;
        impostor.receiveShadow = true;
        impostor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(impostor);
        this.types.push({ lods, impostor, geo: g0, trees });
      }
    }
    this.buildBushes(lighting);
    this.buildRocks(lighting);
  }

  /** Render a tree from the side into a texture and build crossed billboard quads. */
  private makeImpostor(
    renderer: THREE.WebGLRenderer,
    g: TreeGeo,
    barkMat: THREE.Material,
    leafMat: THREE.Material,
    lighting: Lighting,
    sp: Species,
  ): THREE.BufferGeometry {
    const W = 128;
    const H = 256;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    const scene = new THREE.Scene();
    const bm = (barkMat as THREE.MeshStandardMaterial).clone();
    const lm = (leafMat as THREE.MeshStandardMaterial).clone();
    const bmB = new THREE.MeshBasicMaterial({ map: bm.map, color: '#8a8a8a' });
    const lmB = new THREE.MeshBasicMaterial({ map: lm.map, alphaTest: 0.45, side: THREE.DoubleSide, color: '#9a9a9a' });
    scene.add(new THREE.Mesh(g.bark, bmB));
    scene.add(new THREE.Mesh(g.leaves, lmB));
    const w = g.width * 0.55;
    const cam = new THREE.OrthographicCamera(-w, w, g.height + 1.5, -0.5, 0.1, 100);
    cam.position.set(0, 0, 40);
    cam.lookAt(0, 0, 0);
    // Force the frustum to frame the tree from the bottom.
    cam.top = g.height + 1.5;
    cam.bottom = -0.5;
    cam.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: rt.texture,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    lighting.register(mat, undefined, `impostor-${sp}`);
    const quads: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 2; k++) {
      const pg = new THREE.PlaneGeometry(w * 2, g.height + 2);
      pg.translate(0, (g.height + 2) / 2 - 0.5, 0);
      pg.rotateY((k * Math.PI) / 2);
      // Soft up-facing normals so impostors light like canopies, not flat cards.
      const n = pg.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.35, 0.85, n.getZ(i) * 0.35);
      quads.push(pg);
    }
    const geo = mergeGeometries(quads)!;
    geo.userData.material = mat;
    return geo;
  }

  private buildBushes(lighting: Lighting): void {
    const rng = new Rng(77);
    const cards: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const pg = new THREE.PlaneGeometry(1.4, 1.1);
      pg.rotateX(rng.range(-0.6, 0.6));
      pg.rotateY((i / 9) * Math.PI * 2);
      pg.translate(rng.range(-0.4, 0.4), 0.55 + rng.range(-0.1, 0.25), rng.range(-0.4, 0.4));
      const n = pg.getAttribute('normal');
      const p = pg.getAttribute('position');
      const flex = new Float32Array(p.count);
      for (let k = 0; k < n.count; k++) {
        const v = new THREE.Vector3(p.getX(k), p.getY(k) - 0.3, p.getZ(k)).normalize();
        n.setXYZ(k, v.x, v.y * 0.5 + 0.5, v.z);
        flex[k] = 0.15 + Math.max(0, p.getY(k)) * 0.2;
      }
      pg.setAttribute('aFlex', new THREE.BufferAttribute(flex, 1));
      cards.push(pg);
    }
    const geo = mergeGeometries(cards)!;
    const mat = new THREE.MeshStandardMaterial({ map: leafTexture('bush'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
    lighting.register(mat, (s) => windPatch(s, true), 'bush');
    const list = this.data.bushes;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.r);
      this.s.setScalar(b.s);
      this.p.set(b.x, b.y - 0.05, b.z);
      im.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    this.group.add(im);
  }

  private buildRocks(lighting: Lighting): void {
    const tex = rockTexture();
    const mat = lighting.register(
      new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughness: 0.88 }),
      undefined,
      'rock',
    );
    const geos: THREE.BufferGeometry[] = [];
    for (let v = 0; v < 4; v++) {
      const rng = new Rng(300 + v);
      const g = new THREE.IcosahedronGeometry(1, 3);
      const p = g.getAttribute('position');
      const nz = (x: number, y: number, z: number) => Math.sin(x * 3.1 + v) * Math.cos(z * 2.7) * 0.18 + Math.sin(y * 4.3 + x) * 0.08;
      const stretch = new THREE.Vector3(rng.range(0.9, 1.6), rng.range(0.55, 0.9), rng.range(0.9, 1.4));
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const k = 1 + nz(x, y, z);
        // Flatten facets for a chiselled look.
        const f = Math.round(k * 6) / 6;
        p.setXYZ(i, x * f * stretch.x, Math.max(-0.35, y * f * stretch.y), z * f * stretch.z);
      }
      g.computeVertexNormals();
      geos.push(g);
    }
    const byV: Scatter[][] = [[], [], [], []];
    for (const r of this.data.rocks) byV[r.v % 4].push(r);
    for (let v = 0; v < 4; v++) {
      const list = byV[v];
      const im = new THREE.InstancedMesh(geos[v], mat, Math.max(1, list.length));
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        this.q.setFromEuler(new THREE.Euler(0, r.r, 0));
        this.s.setScalar(r.s);
        this.p.set(r.x, r.y - r.s * 0.2, r.z);
        im.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      }
      im.count = list.length;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** Re-bucket trees into LODs as the camera moves. */
  update(cam: THREE.Vector3, force = false): void {
    if (!force && this.lastBucket.distanceToSquared(cam) < 14 * 14) return;
    this.lastBucket.copy(cam);
    const n0 = Math.min(95, this.nearDist * 0.42);
    const n1 = this.nearDist;
    for (const type of this.types) {
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      for (const t of type.trees) {
        if (this.felled.has(t)) continue;
        const d = Math.hypot(t.x - cam.x, t.z - cam.z);
        if (d > 1500) continue;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r);
        this.s.setScalar(t.s);
        this.p.set(t.x, t.y, t.z);
        this.m.compose(this.p, this.q, this.s);
        if (d < n0) {
          type.lods[0].bark.setMatrixAt(c0, this.m);
          type.lods[0].leaves.setMatrixAt(c0++, this.m);
        } else if (d < n1) {
          type.lods[1].bark.setMatrixAt(c1, this.m);
          type.lods[1].leaves.setMatrixAt(c1++, this.m);
        } else {
          // Impostors face roughly toward the camera for best silhouette.
          const yaw = Math.atan2(cam.x - t.x, cam.z - t.z) + Math.PI / 4;
          this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
          this.m.compose(this.p, this.q, this.s);
          type.impostor.setMatrixAt(c2++, this.m);
        }
      }
      const set = (im: THREE.InstancedMesh, c: number) => {
        im.count = c;
        im.instanceMatrix.needsUpdate = true;
      };
      set(type.lods[0].bark, c0);
      set(type.lods[0].leaves, c0);
      set(type.lods[1].bark, c1);
      set(type.lods[1].leaves, c1);
      set(type.impostor, c2);
    }
  }

  /** Fell trees caught in a blast; returns the felled trees (for debris VFX). */
  blast(x: number, z: number, radius: number): Scatter[] {
    const out: Scatter[] = [];
    for (const c of this.trunkColliders) {
      if (this.felled.has(c.tree)) continue;
      if (Math.hypot(c.x - x, c.z - z) < radius) {
        this.felled.add(c.tree);
        out.push(c.tree);
      }
    }
    if (out.length) this.update(this.lastBucket, true);
    return out;
  }
}
