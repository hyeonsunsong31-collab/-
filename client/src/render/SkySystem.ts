import * as THREE from 'three';
import { GLSL_NOISE } from './glsl.ts';

/**
 * Physically-inspired sky (Preetham) + a drifting FBM cloud layer with sun-lit edges,
 * a bright sun disk for god rays, and a PMREM environment map for PBR reflections.
 */
export class SkySystem {
  readonly sky: THREE.Mesh;
  readonly clouds: THREE.Mesh;
  readonly sun: THREE.Mesh;
  readonly envMap: THREE.Texture;
  private cloudMat: THREE.ShaderMaterial;

  /** The sun disk (also the god-ray light source — must be transparent and not write depth). */
  static createSun(sunDir: THREE.Vector3): THREE.Mesh {
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(70, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.0, 0.93, 0.8),
        fog: false,
        toneMapped: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    sun.frustumCulled = false;
    sun.userData.sunDir = sunDir.clone();
    return sun;
  }

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    sunDir: THREE.Vector3,
    sun: THREE.Mesh,
  ) {
    // Analytic atmosphere dome: deep zenith blue, luminous hazy horizon, Mie glow around a hot sun disk.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uSun: { value: sunDir.clone() } },
        vertexShader: /* glsl */ `
          varying vec3 vD;
          void main() {
            vD = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
            vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun;
          varying vec3 vD;
          void main() {
            vec3 d = normalize(vD);
            float h = max(d.y, 0.0);
            vec3 zenith = vec3(0.045, 0.16, 0.55);
            vec3 mid = vec3(0.16, 0.38, 0.82);
            vec3 horizon = vec3(0.62, 0.74, 0.86);
            vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            c = mix(c, zenith, smoothstep(0.18, 0.95, h));
            // Below horizon: hazy ground-bounce colour (hidden by mountains mostly).
            c = d.y < 0.0 ? mix(horizon * 0.85, vec3(0.32, 0.36, 0.3), smoothstep(0.0, 0.3, -d.y)) : c;
            float s = max(dot(d, uSun), 0.0);
            // Mie forward scattering glow + broad warm halo.
            c += vec3(1.0, 0.86, 0.62) * (pow(s, 64.0) * 1.6 + pow(s, 8.0) * 0.35 + pow(s, 2.0) * 0.08);
            // Sun disk (HDR so bloom flares it).
            c += vec3(1.0, 0.95, 0.85) * smoothstep(0.99955, 0.9997, s) * 40.0;
            // Brighter horizon band toward the sun side.
            c += vec3(0.25, 0.2, 0.12) * pow(1.0 - h, 6.0) * (0.4 + 0.6 * pow(s, 2.0));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    // Environment: a controlled analytic sky (zenith blue → hazy horizon → warm ground bounce, soft sun glow)
    // so image-based ambient never overpowers the direct sunlight.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSun: { value: sunDir.clone() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 uSun; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD);
          vec3 zenith = vec3(0.10, 0.24, 0.62);
          vec3 horizon = vec3(0.52, 0.62, 0.72);
          vec3 ground = vec3(0.16, 0.15, 0.08);
          vec3 c = d.y > 0.0 ? mix(horizon, zenith, pow(d.y, 0.55)) : mix(horizon * 0.6, ground, smoothstep(0.0, 0.25, -d.y));
          float s = max(dot(d, uSun), 0.0);
          c += vec3(1.0, 0.82, 0.55) * (pow(s, 12.0) * 0.9 + pow(s, 3.0) * 0.15);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), envMat));
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader:
        GLSL_NOISE +
        /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uCam;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          if (d.y < 0.01) discard;
          // Intersect a cloud plane at 1500 m.
          float t = (1500.0 - uCam.y) / d.y;
          vec2 p = (uCam.xz + d.xz * t) * 0.00042 + vec2(uTime * 0.006, uTime * 0.0025);
          float base = akFbm(p);
          float detail = akFbm(p * 3.1 + 9.0);
          float cov = smoothstep(0.5, 0.78, base + detail * 0.22);
          // Thicker toward the horizon, thin overhead (fair-weather cumulus).
          cov *= smoothstep(0.02, 0.2, d.y);
          float dens = cov * (0.55 + 0.45 * detail);
          // Self shadowing: sample toward the sun.
          vec2 ps = p + uSunDir.xz * 0.06;
          float occ = smoothstep(0.5, 0.85, akFbm(ps) + akFbm(ps * 3.1 + 9.0) * 0.22);
          float sunDot = max(dot(d, uSunDir), 0.0);
          vec3 lit = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.98, 0.95), 1.0 - occ * 0.75);
          lit += vec3(1.0, 0.85, 0.6) * pow(sunDot, 10.0) * (1.0 - dens) * 1.5; // silver lining
          float horizonFade = smoothstep(0.0, 0.12, d.y);
          gl_FragColor = vec4(lit * 1.35, dens * 0.92 * horizonFade);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    scene.add(this.clouds);

    this.sun = sun;
    scene.add(this.sun);
  }

  update(dt: number, camera: THREE.Camera): void {
    this.cloudMat.uniforms.uTime.value += dt;
    this.cloudMat.uniforms.uCam.value.copy(camera.position);
    this.sky.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(this.sun.userData.sunDir as THREE.Vector3, 4200);
  }
}
