/**
 * 2026 Red Bul, as an unofficial colour interpretation: satin navy body, a clear-coated yellow nose and
 * front wing, one confident red line, yellow rims. Colour, panel break and simple geometry only.
 */
export const RED_BUL_GLSL = /* glsl */ `
// cover() with its feather capped, so a pixel on the edge of a sliver of geometry (where the screen
// derivative blows up) cannot smear red into yellow as an orange speck.
float rbCover(float d) {
  float w = clamp(fwidth(d) * 0.8, 1e-6, 0.01);
  return smoothstep(-w, w, d);
}

// One straight piece of a line drawn in the side (x, y) plane and measured along the painted surface,
// so it keeps its width on the sloping shoulders. Returns inside-positive coverage times visibility;
// visibility fades where the surface lies flat to the line, so it never smears across a shoulder.
float rbSeg(vec3 p, vec3 n, vec2 a, vec2 b, float hw0, float hw1) {
  vec2 ba = b - a;
  vec2 pa = p.xy - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  vec2 v = pa - ba * h;
  float dist = length(v);
  // direction away from the line; falls back to the line's own normal on its centre
  vec3 u = vec3(normalize(v + normalize(vec2(-ba.y, ba.x)) * 1e-4), 0.0);
  float k = length(u - n * dot(u, n));
  float hw = mix(hw0, hw1, h);
  // a stretch thinner than about a pixel fades out instead of crawling as the car moves
  float seen = clamp(2.0 * hw / max(fwidth(dist), 1e-6), 0.0, 1.0);
  return rbCover((hw - dist) / max(k, 0.3)) * ramp(k, 0.1, 0.3) * seen;
}

// Keeps the line on the sides of the car: well off the centreline on the tub, closer in on the narrow nose.
float rbSide(vec3 p) {
  return rbCover(abs(p.z) - mix(0.18, 0.07, ramp(p.x, 0.95, 1.4)));
}

// The red line: from the nose break, back along the tub, over the sidepod waist and up the engine cover.
float rbFlank(vec3 p, vec3 n, float hw) {
  float c = rbSeg(p, n, vec2(1.56, 0.40), vec2(0.80, 0.42), hw, hw);
  c = max(c, rbSeg(p, n, vec2(0.80, 0.42), vec2(0.05, 0.46), hw, hw));
  c = max(c, rbSeg(p, n, vec2(0.05, 0.46), vec2(-0.65, 0.53), hw, hw));
  c = max(c, rbSeg(p, n, vec2(-0.65, 0.53), vec2(-1.05, 0.59), hw, hw * 0.85));
  // the tail draws out to a point on the engine cover
  c = max(c, rbSeg(p, n, vec2(-1.05, 0.59), vec2(-1.45, 0.68), hw * 0.85, hw * 0.1));
  return c * rbSide(p);
}

// The same line carried on through the break and along the yellow nose, drawing out to a point.
float rbNoseTail(vec3 p, vec3 n, float hw) {
  float c = rbSeg(p, n, vec2(1.56, 0.40), vec2(2.15, 0.37), hw, hw * 0.85);
  c = max(c, rbSeg(p, n, vec2(2.15, 0.37), vec2(2.85, 0.31), hw * 0.85, hw * 0.35));
  return c * rbSide(p);
}

// Signed distance (metres, positive on the yellow side) to the nose / tub break. In plan the yellow
// ends in a tongue at the halo and sweeps forward down the flanks; lower down it slips back.
float rbBreak(vec3 p, vec3 n) {
  float az = max(abs(p.z), 1e-4);
  float xb = 0.84 + 6.5 * pow(az, 1.9) + 0.35 * max(0.62 - p.y, 0.0);
  vec3 g = vec3(1.0, 0.35 * step(p.y, 0.62), -9.0 * pow(az, 0.8) * sign(p.z));
  vec3 gt = g - n * dot(g, n);
  return (p.x - xb) / max(length(gt), 0.3);
}

// Clear-coated Red Bul yellow with real tonal range: lit tops stay a saturated yellow, undersides,
// flanks and the low recesses near the floor deepen toward a warm amber instead of clipping flat.
vec3 rbYellowW(vec3 p, vec3 n, float sideAmt, float lowAmt) {
  vec3 lit = hex(0xf2bd0b);
  vec3 deep = hex(0xcf8a00);
  float under = ramp(-n.y, -0.1, 0.9);
  float flank = ramp(abs(n.z), 0.45, 1.0) * sideAmt;
  float low = (1.0 - ramp(p.y, 0.05, 0.34)) * lowAmt;
  return mix(lit, deep, clamp(max(under, flank) + low, 0.0, 1.0));
}
vec3 rbYellow(vec3 p, vec3 n) {
  return rbYellowW(p, n, 0.5, 0.45);
}

Paint paintAt(vec3 p, vec3 n) {
  vec3 navy = hex(0x1d3263);
  vec3 navyDeep = hex(0x13224a);
  vec3 red = hex(0xe3142d);
  float hw = 0.0175;

  if (uPaintPart == PART_RIM) {
    // yellow wheel face and hub with a navy centre nut; the inboard hub, brake side and anything wider than the rim stay dark
    vec2 rc = p.xy - vec2(p.x > 0.0 ? 1.70 : -1.70, 0.354);
    float r = length(rc);
    float face = rbCover(0.285 - r) * ramp(abs(p.z), 0.57, 0.63);
    float nut = rbCover(0.040 - r);
    // a dished face: a deeper hub boss, a lighter mid-disc and a darker bead at the lip
    vec3 y = rbYellowW(p, n, 0.0, 0.0);
    y *= mix(0.74, 1.0, ramp(r, 0.045, 0.19));
    y *= 1.0 - 0.18 * ramp(r, 0.245, 0.275);
    vec3 col = mix(hex(0x23272f), mix(y, navy, nut), face);
    return Paint(col, 0.34, 0.1);
  }

  if (uPaintPart == PART_HELMET) {
    vec3 q = p - vec3(0.32, 0.765, 0.0);
    float stripe = rbCover(0.024 - abs(q.z));
    float pin = rbCover(0.010 - abs(abs(q.z) - 0.040));
    vec3 col = mix(navy, red, pin);
    col = mix(col, rbYellow(p, n), stripe);
    return Paint(col, 0.24, 0.0);
  }

  if (uPaintPart == PART_FWING) {
    return Paint(rbYellow(p, n), 0.30, 0.0);
  }

  if (uPaintPart == PART_HALO) {
    // satin navy with a touch of metal, so the structure reads as a finished carbon-and-paint part
    return Paint(mix(navy, navyDeep, 0.35), 0.40, 0.3);
  }

  if (uPaintPart == PART_RWING) {
    return Paint(navy, 0.52, 0.0);
  }

  // Nose, survival cell, bodywork.
  float db = rbBreak(p, n);
  float yel = rbCover(db);

  vec3 col = navy;

  // the red line begins as piping on the break above the flank, so the two read as one stroke
  float above = ramp(p.y, 0.40, 0.46);
  float pipe = rbCover(db + 0.036) * (1.0 - rbCover(db + 0.004)) * above;

  // a fine dark panel line along the whole break
  float seam = rbCover(0.0055 - abs(db - 0.001));
  col = mix(col, rbYellow(p, n), yel);
  col = mix(col, hex(0x0b1431), seam);

  // the line flows through the break and on along the yellow nose
  float line = max(max(pipe, rbFlank(p, n, hw)), rbNoseTail(p, n, hw));
  col = mix(col, red, line);
  return Paint(col, mix(0.62, 0.30, yel), 0.0);
}
`;
