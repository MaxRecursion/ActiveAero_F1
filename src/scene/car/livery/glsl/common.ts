/**
 * Shared GLSL for the paint schemes. Every scheme is an analytic function of the panel's own
 * rest-pose position, in the car frame: metres, +X forward, +Y up, +Z to the car's right, ground
 * at y = 0. The position rides on the vertices, so paint cannot slide when parts explode, pitch,
 * open their wings or hang from the ceiling. There are no textures and no UVs.
 *
 * A scheme supplies `Paint paintAt(vec3 p, vec3 n)`: `p` is the rest-pose position, `n` the
 * rest-pose surface normal (unit, car frame). `uPaintPart` says which panel is being shaded.
 */
export const PART = {
  nose: 0,
  cell: 1,
  body: 2,
  frontWing: 3,
  rearWing: 4,
  halo: 5,
  rim: 6,
  helmet: 7,
} as const;

export type PaintPart = (typeof PART)[keyof typeof PART];

export const COMMON_GLSL = /* glsl */ `
#define PART_NOSE ${PART.nose}
#define PART_CELL ${PART.cell}
#define PART_BODY ${PART.body}
#define PART_FWING ${PART.frontWing}
#define PART_RWING ${PART.rearWing}
#define PART_HALO ${PART.halo}
#define PART_RIM ${PART.rim}
#define PART_HELMET ${PART.helmet}

uniform int uPaintPart;
varying vec3 vPaintPos;
varying vec3 vPaintNrm;

struct Paint {
  vec3 albedo;
  float rough;
  float metal;
};

// sRGB triplet (0..1) to the linear working space.
vec3 srgb(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
// 0xRRGGBB written as the sRGB colour a designer sees, returned linear.
vec3 hex(int h) {
  return srgb(vec3(float((h >> 16) & 255), float((h >> 8) & 255), float(h & 255)) / 255.0);
}

// Coverage of a signed field d (positive inside), feathered by about one pixel.
float cover(float d) {
  float w = max(fwidth(d) * 0.8, 1e-6);
  return smoothstep(-w, w, d);
}
// Coverage with a fixed feather in metres (soft fades, not crisp edges).
float soft(float d, float feather) {
  return smoothstep(-feather, feather, d);
}
// 0 below a, 1 above b, smooth between.
float ramp(float v, float a, float b) {
  return smoothstep(a, b, v);
}
// Stroke of half-width w around a distance d (d >= 0 is the distance to the line). A line thinner than
// a pixel fades out in proportion to its width instead of flickering as it crosses pixel centres.
float stroke(float d, float w) {
  float fw = max(fwidth(d), 1e-6);
  return smoothstep(-fw, fw, w - d) * clamp(w / fw, 0.0, 1.0);
}

// Inside-positive box in 2D: c centre, h half-size.
float sdBox(vec2 p, vec2 c, vec2 h) {
  vec2 q = h - abs(p - c);
  return min(q.x, q.y);
}
float dSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float dSeg3(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}
`;
