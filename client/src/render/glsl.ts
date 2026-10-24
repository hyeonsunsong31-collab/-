/** Shared GLSL snippets. */

export const GLSL_NOISE = /* glsl */ `
#ifndef AK_NOISE
#define AK_NOISE
float akHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float akHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 akHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float akVnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = akHash12(i);
  float b = akHash12(i + vec2(1.0, 0.0));
  float c = akHash12(i + vec2(0.0, 1.0));
  float d = akHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float akVnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = akHash13(i);
  float n100 = akHash13(i + vec3(1, 0, 0));
  float n010 = akHash13(i + vec3(0, 1, 0));
  float n110 = akHash13(i + vec3(1, 1, 0));
  float n001 = akHash13(i + vec3(0, 0, 1));
  float n101 = akHash13(i + vec3(1, 0, 1));
  float n011 = akHash13(i + vec3(0, 1, 1));
  float n111 = akHash13(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float akFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * akVnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float akFbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * akVnoise3(p); p = p * 2.02 + 11.7; a *= 0.5; }
  return s;
}
// Voronoi edge distance: x = distance to nearest cell point, y = distance to the cell border.
vec2 akVoronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = akHash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float be = 8.0;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = akHash22(n + g);
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) be = min(be, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec2(sqrt(md), be);
}
#endif
`;
