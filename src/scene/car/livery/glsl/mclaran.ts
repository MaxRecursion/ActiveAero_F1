/**
 * McLaran: papaya nose, front wing and engine cover; anthracite flanks, rear bodywork and rear wing;
 * one small teal mark at the sidepod inlet. Colour, panel break and simple geometry only.
 */
export const MCLARAN_GLSL = /* glsl */ `
// ---- palette (linear). Papaya is written as the sRGB it should read as after tone mapping.
vec3 mcPapaya() { return hex(0xf0840a); }
vec3 mcAnthracite() { return hex(0x3d4044); }
vec3 mcAnthraciteLift() { return hex(0x4e5156); }
vec3 mcTeal() { return hex(0x00b2c6); }
vec3 mcGapColour() { return hex(0x0a0b0d); }

// Break coverage with a slightly wider feather than cover(), so a long diagonal seam does not stair-step.
float mcBreak(float d) {
  float w = max(fwidth(d) * 1.1, 1e-6);
  return smoothstep(-w, w, d);
}

// ---- body ------------------------------------------------------------------------------------

// Half-width of the papaya spine on top of the car, by x.
float mcSpineW(float x) {
  float w = mix(0.10, 0.18, ramp(x, -1.70, -1.05));
  w = mix(w, 0.30, ramp(x, -1.05, 0.10));
  w = mix(w, 0.95, ramp(x, 0.45, 1.00));
  return w;
}
// Height of the papaya / anthracite line on the tub, by x (papaya above). It leaves the sidepod
// shoulder, sweeps forward and down along the nose, then drops away under the nose so the
// whole nose cone and its pylons are papaya.
float mcLine(float x) {
  float s = ramp(x, 0.60, 1.45);
  float y = mix(0.60, 0.30, s);
  return mix(y, -0.30, ramp(x, 1.45, 1.95));
}

// Signed distance (metres, roughly) into the papaya area of the body: > 0 papaya, < 0 anthracite.
float mcBodyField(vec3 p) {
  float az = abs(p.z);
  float dTop = mcSpineW(p.x) - az;
  float dTail = (p.x + 1.70) - az * 1.6;
  return min(min(dTop, dTail), p.y - mcLine(p.x));
}

// ---- teal mark: two parallel rounded slashes at the sidepod inlet, about 13 cm long overall. ------
float mcMark(vec3 p, vec3 n) {
  vec2 q = p.xy - vec2(0.585, 0.435);
  vec2 dir = normalize(vec2(1.0, 0.70));
  vec2 nrm = vec2(-dir.y, dir.x);
  // long slash and a shorter one beneath it, sharing a trailing end
  float a = 0.0125 - dSeg(q - nrm * 0.0200, -dir * 0.052, dir * 0.052);
  float b = 0.0125 - dSeg(q + nrm * 0.0200, -dir * 0.052, dir * 0.002);
  float side = smoothstep(0.35, 0.65, abs(n.z));
  return max(cover(a), cover(b)) * side;
}

// ---- assembling a finish -----------------------------------------------------------------------

// papaya: 0 anthracite .. 1 papaya;  gap: 0..1 fine dark panel line;  edge: signed distance to the break;
// pin: 0..1 slim papaya pinline on the anthracite;  antCol / antRough / antMetal: the anthracite finish.
Paint mcPaint(float papaya, float gap, float edge, float pin, float tealMark, vec3 antCol, float antRough, float antMetal) {
  vec3 pap = mcPapaya();
  float cov = max(papaya, pin);
  vec3 col = mix(antCol, pap, cov);
  // papaya: a glossy clear-coat. Anthracite: broad soft highlights.
  float rough = mix(antRough, 0.24, cov);
  float metal = mix(antMetal, 0.06, cov);
  // a few mm of shadow hugging the break, then the panel line itself
  col *= 1.0 - 0.22 * exp(-abs(edge) / 0.008);
  col = mix(col, mcGapColour(), gap);
  rough = mix(rough, 0.55, gap);
  col = mix(col, mcTeal(), tealMark);
  rough = mix(rough, 0.28, tealMark);
  metal = mix(metal, 0.0, tealMark);
  return Paint(col, rough, metal);
}

Paint paintAt(vec3 p, vec3 n) {
  float az = abs(p.z);
  float papaya = 1.0;
  float gap = 0.0;
  float edge = 1.0;
  float pin = 0.0;
  float teal = 0.0;
  vec3 antCol = mcAnthracite();
  float antRough = 0.68;
  float antMetal = 0.0;

  if (uPaintPart == PART_NOSE || uPaintPart == PART_CELL || uPaintPart == PART_BODY) {
    edge = mcBodyField(p);
    papaya = mcBreak(edge);
    gap = stroke(abs(edge), 0.0075) * 0.85;
    // slim papaya pinline echoing the break, 5.8 cm into the anthracite
    pin = stroke(abs(edge + 0.058), 0.0135) * (1.0 - papaya);
    // keep the pinline off the mirror stalks
    pin *= 1.0 - cover(sdBox(p.xy, vec2(0.74, 0.77), vec2(0.22, 0.14))) * smoothstep(0.36, 0.42, az);
    teal = mcMark(p, n);
    // the anthracite sinks toward the floor: calms the pale smears on the undercut
    antCol *= mix(0.74, 1.0, ramp(p.y, 0.14, 0.40));
  } else if (uPaintPart == PART_FWING) {
    // the hair-thin stays between the front wheel and the nose go anthracite, not stray orange lines
    float stay = cover(2.255 - p.x) * cover(0.54 - az) * cover(az - 0.40);
    papaya = 1.0 - stay;
  } else if (uPaintPart == PART_RWING) {
    // Anthracite wing; the endplates carry a papaya trim that sweeps down toward the trailing edge.
    float u = ramp(-p.x, 1.98, 2.46);
    float yb = mix(0.84, 0.50, u * u);
    float below = p.y - yb;
    float plate = az - 0.53;
    // only the flat faces of the plate take the trim: its thin top edge stays anthracite, so no orange hairline
    float face = smoothstep(0.62, 0.90, abs(n.z));
    edge = min(below, plate);
    papaya = mcBreak(edge) * face;
    gap = stroke(abs(below), 0.006) * cover(plate) * face;
    edge = mix(1.0, below, cover(plate) * face);
    antCol = mix(mcAnthracite(), mcAnthraciteLift(), 0.35);
    // flap-edge trim: the last 4 cm of the wing between the endplates takes a papaya stripe
    float trim = cover(-p.x - 2.300) * cover(plate * -1.0 - 0.02) * cover(p.y - 0.66);
    papaya = max(papaya, trim);
    gap = max(gap, stroke(abs(-p.x - 2.300), 0.004) * cover(-plate - 0.02) * cover(p.y - 0.66) * 0.7);
  } else if (uPaintPart == PART_HALO) {
    papaya = 0.0;
    antCol = mcAnthraciteLift();
    antRough = 0.38;
    antMetal = 0.5;
  } else if (uPaintPart == PART_RIM) {
    vec2 c = vec2(p.x > 0.0 ? 1.70 : -1.70, 0.34);
    float rr = length(p.xy - c);
    float outer = smoothstep(0.55, 0.7, az);
    float lip = rr - 0.186;
    float nut = 0.050 - rr;
    papaya = max(cover(lip), cover(nut)) * outer;
    edge = min(abs(lip), abs(nut));
    gap = max(stroke(abs(lip), 0.0025), stroke(abs(nut), 0.0025)) * outer;
    antCol = mcAnthraciteLift();
    antRough = 0.42;
  } else if (uPaintPart == PART_HELMET) {
    vec3 h = p - vec3(0.32, 0.765, 0.0);
    float d = h.y + 0.30 * h.x + 0.01;
    papaya = cover(d);
    edge = d;
    gap = stroke(abs(d), 0.003);
    antRough = 0.40;
  }
  return mcPaint(papaya, gap, edge, pin, teal, antCol, antRough, antMetal);
}
`;
