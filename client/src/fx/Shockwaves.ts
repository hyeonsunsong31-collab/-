import * as THREE from 'three';

type Kind = 'ground' | 'air' | 'shell' | 'flash' | 'cone';

interface Wave {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  kind: Kind;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  busy: boolean;
  follow: THREE.Vector3 | null;
}

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
  uniform float uK;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uWidth;
  uniform float uSeed;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float n = vnoise(vec2(ang * 6.0 + uSeed, uK * 3.0)) * 0.6 + vnoise(vec2(ang * 19.0 - uSeed, uK * 5.0)) * 0.4;
    float w = uWidth * (0.7 + n * 0.6);
    float band = exp(-pow((r - 0.86) / w, 2.0));
    // Inner smear trailing behind the wavefront.
    float inner = smoothstep(0.86, 0.3, r) * smoothstep(0.0, 0.86, r) * 0.25 * (1.0 - uK);
    float a = (band + inner) * uAlpha * (1.0 - uK) * (0.6 + n * 0.6);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;
const SHELL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;
const SHELL_FRAG = /* glsl */ `
  uniform float uK;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uSeed;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    float fr = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float n = vnoise(vP * 3.0 + uSeed + uK * 2.0);
    float a = (pow(fr, 2.5) * 1.2 + 0.08) * uAlpha * (1.0 - uK) * (0.7 + n * 0.6);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/**
 * Expanding shock fronts: ground rings hugging the terrain, vertical air rings (punch shockwaves, sonic booms,
 * beam muzzles), fresnel energy shells (explosions, transformation domes) and bright light-flash spheres.
 */
export class Shockwaves {
  readonly group = new THREE.Group();
  private waves: Wave[] = [];
  private plane = new THREE.PlaneGeometry(2, 2);
  private sphere = new THREE.IcosahedronGeometry(1, 4);
  private cone = new THREE.CylinderGeometry(0.15, 1, 1.2, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.6);

  private get(kind: Kind): Wave {
    let w = this.waves.find((x) => !x.busy && x.kind === kind);
    if (!w) {
      const ring = kind === 'ground' || kind === 'air';
      const mat = new THREE.ShaderMaterial({
        uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uWidth: { value: 0.06 }, uSeed: { value: 0 } },
        vertexShader: ring ? RING_VERT : SHELL_VERT,
        fragmentShader: ring ? RING_FRAG : SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const geo = ring ? this.plane : kind === 'cone' ? this.cone : this.sphere;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 16;
      this.group.add(mesh);
      w = { mesh, mat, kind, t: 0, dur: 1, r0: 0, r1: 1, busy: false, follow: null };
      this.waves.push(w);
    }
    w.busy = true;
    w.mesh.visible = true;
    w.t = 0;
    w.follow = null;
    w.mat.uniforms.uSeed.value = Math.random() * 100;
    return w;
  }

  /** Build one of each wave kind up front (hidden) so their shaders compile at boot. */
  prewarm(): void {
    for (const k of ['ground', 'air', 'shell', 'cone'] as Kind[]) {
      const w = this.get(k);
      w.busy = false;
      w.mesh.visible = false;
    }
  }

  /** Flat ring racing outward along the ground. */
  ground(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur = 0.6, alpha = 1, width = 0.07): void {
    const w = this.get('ground');
    w.mesh.position.copy(pos).setY(pos.y + 0.12);
    w.mesh.rotation.set(-Math.PI / 2, 0, 0);
    this.setup(w, 0.2, radius, dur, color, alpha, width);
  }

  /** Vertical ring facing `dir` (punch shockwave, sonic boom). */
  air(pos: THREE.Vector3, dir: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur = 0.35, alpha = 1, width = 0.08): void {
    const w = this.get('air');
    w.mesh.position.copy(pos);
    w.mesh.lookAt(_t.copy(pos).add(dir));
    this.setup(w, radius * 0.15, radius, dur, color, alpha, width);
  }

  /** Expanding fresnel energy sphere. */
  shell(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur = 0.5, alpha = 1, follow: THREE.Vector3 | null = null): void {
    const w = this.get('shell');
    w.mesh.position.copy(pos);
    w.follow = follow;
    this.setup(w, radius * 0.1, radius, dur, color, alpha, 0);
  }

  /** Sonic cone trailing a boost. */
  sonicCone(pos: THREE.Vector3, dir: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, dur = 0.4): void {
    const w = this.get('cone');
    w.mesh.position.copy(pos);
    w.mesh.lookAt(_t.copy(pos).sub(dir));
    this.setup(w, radius * 0.3, radius, dur, color, 0.8, 0);
  }

  private setup(w: Wave, r0: number, r1: number, dur: number, color: THREE.ColorRepresentation, alpha: number, width: number): void {
    w.r0 = r0;
    w.r1 = r1;
    w.dur = dur;
    w.mat.uniforms.uColor.value.set(color);
    w.mat.uniforms.uAlpha.value = alpha;
    w.mat.uniforms.uWidth.value = width;
    w.mesh.scale.setScalar(r0);
  }

  update(dt: number): void {
    for (const w of this.waves) {
      if (!w.busy) continue;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      if (k >= 1) {
        w.busy = false;
        w.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const r = w.r0 + (w.r1 - w.r0) * e;
      w.mesh.scale.setScalar(r);
      if (w.follow) w.mesh.position.copy(w.follow);
      w.mat.uniforms.uK.value = k;
    }
  }
}

const _t = new THREE.Vector3();
