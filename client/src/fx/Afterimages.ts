import * as THREE from 'three';
import type { Character } from '../character/Character.ts';

interface Ghost {
  meshes: THREE.SkinnedMesh[];
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  alpha: number;
  drift: THREE.Vector3;
  busy: boolean;
}

/**
 * Pose-frozen ghosts of a fighter (dashes, vanishes, perfect dodges, boosts): a second skinned mesh bound to a
 * detached skeleton whose world matrices are copied at capture time, drawn as an additive fresnel hologram that
 * fades and drifts.
 */
export class Afterimages {
  readonly group = new THREE.Group();
  private pools = new Map<Character, Ghost[]>();

  private makeGhost(ch: Character): Ghost {
    const src = ch.rig.skeleton;
    const bones = src.bones.map(() => {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      return b;
    });
    const skeleton = new THREE.Skeleton(bones, src.boneInverses.map((m) => m.clone()));
    const mat = new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGN;\nvarying vec3 vGV;')
        .replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>
          #if defined( USE_SKINNING )
            vGN = normalize(transformedNormal);
          #else
            vGN = vec3(0.0, 0.0, 1.0);
          #endif
          vGV = -mvPosition.xyz;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGN;\nvarying vec3 vGV;')
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `float fr = clamp(1.0 - abs(dot(normalize(vGN), normalize(vGV))), 0.0, 1.0);
          float rim = pow(fr, 2.2);
          vec4 diffuseColor = vec4(diffuse * (0.18 + rim * 1.8), opacity);`,
        );
    };
    const meshes: THREE.SkinnedMesh[] = [];
    for (const m of [ch.body, ch.hairMesh]) {
      if (!m) continue;
      const g = new THREE.SkinnedMesh(m.geometry, mat);
      // Detached: bone matrices are already in world space, so the mesh transform only adds the drift.
      g.bindMode = THREE.DetachedBindMode;
      g.bind(skeleton, new THREE.Matrix4());
      g.frustumCulled = false;
      g.renderOrder = 17;
      this.group.add(g);
      meshes.push(g);
    }
    return { meshes, bones, skeleton, mat, t: 0, dur: 0.3, alpha: 1, drift: new THREE.Vector3(), busy: false };
  }

  /** Freeze the fighter's current pose as a fading ghost. */
  spawn(ch: Character, color: THREE.ColorRepresentation, dur = 0.32, alpha = 1, drift?: THREE.Vector3): void {
    let pool = this.pools.get(ch);
    if (!pool) this.pools.set(ch, (pool = []));
    let g = pool.find((x) => !x.busy);
    if (!g) {
      if (pool.length < 7) {
        g = this.makeGhost(ch);
        pool.push(g);
      } else g = pool.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    }
    // Hair can change with transformations: rebind the hair ghost to the current hair geometry.
    const hair = ch.hairMesh;
    if (hair && g.meshes[1] && g.meshes[1].geometry !== hair.geometry) g.meshes[1].geometry = hair.geometry;
    const src = ch.rig.skeleton.bones;
    for (let i = 0; i < src.length; i++) g.bones[i].matrixWorld.copy(src[i].matrixWorld);
    g.t = 0;
    g.dur = dur;
    g.alpha = alpha;
    g.busy = true;
    g.mat.color.set(color);
    g.drift.copy(drift ?? new THREE.Vector3());
    for (const m of g.meshes) {
      m.visible = true;
      m.position.set(0, 0, 0);
    }
  }

  update(dt: number): void {
    for (const pool of this.pools.values()) {
      for (const g of pool) {
        if (!g.busy) continue;
        g.t += dt;
        const k = g.t / g.dur;
        if (k >= 1) {
          g.busy = false;
          for (const m of g.meshes) m.visible = false;
          continue;
        }
        g.mat.opacity = g.alpha * (1 - k) * (1 - k);
        for (const m of g.meshes) m.position.addScaledVector(g.drift, dt);
      }
    }
  }

  /** Drop pools of characters that left the scene. */
  forget(ch: Character): void {
    const pool = this.pools.get(ch);
    if (!pool) return;
    for (const g of pool) for (const m of g.meshes) this.group.remove(m);
    this.pools.delete(ch);
  }
}
