/**
 * Not a livery: a coordinate map for placing paint. Hue steps every half metre along the car,
 * thin dark lines every 0.1 m up and across, heavier ones every 0.5 m. Reached with
 * `?livery=debug` on the dev car page only.
 */
export const DEBUG_GLSL = /* glsl */ `
Paint paintAt(vec3 p, vec3 n) {
  float band = floor((p.x + 3.0) / 0.5);
  vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (band / 6.0 + vec3(0.0, 0.33, 0.67)));
  vec3 base = srgb(mix(vec3(0.82), hue, 0.7));
  float gy = abs(fract(p.y / 0.1 + 0.5) - 0.5) * 0.1;
  float gz = abs(fract(abs(p.z) / 0.1 + 0.5) - 0.5) * 0.1;
  float gx = abs(fract(p.x / 0.5 + 0.5) - 0.5) * 0.5;
  float thin = max(stroke(gy, 0.0035) * (1.0 - abs(n.y)), stroke(gz, 0.0035) * abs(n.y));
  float heavy = stroke(gx, 0.006);
  vec3 col = mix(base, vec3(0.02), thin * 0.8);
  col = mix(col, vec3(0.0), heavy);
  float centre = stroke(abs(p.z), 0.008);
  col = mix(col, vec3(0.9, 0.0, 0.0), centre);
  return Paint(col, 0.6, 0.0);
}
`;
