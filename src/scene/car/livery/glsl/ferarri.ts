/**
 * Unofficial Ferarri colour interpretation: a deep Rosso Corsa red with a clear-coat gloss, one large
 * warm-white engine-cover panel (airbox included) with a swept front edge, a fine panel line and a slim
 * red pin line, a red front wing between dark satin endplates, a satin graphite halo, graphite wheels
 * with a slim red lip, and a red and white helmet.
 * Colour and panel break only: no crest, wordmark or sponsor graphic.
 */
export const FERARRI_GLSL = /* glsl */ `
// ---- ferarri helpers -------------------------------------------------------------------------
// Smooth minimum (metres): rounds the corner where two panel edges meet.
float frSmin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Signed distance (metres, positive inside) to the white engine-cover panel, on the bodywork.
// Front edge: an S-sweep from the spine behind the cockpit down and back along the flank. The lower
// edge stays high on the rear flank so the red lower body keeps the tail from reading as a white car,
// then drops away at the very tip so the narrow end of the cover is white right to where the mesh ends
// (no red slivers where the paint stops).
float frCover(vec3 p) {
  float az = abs(p.z);
  float sweep = ramp(p.y, 0.42, 0.76);
  float xEdge = mix(-0.86, -0.02, sweep) - 0.30 * az;
  float front = (xEdge - p.x) * 0.85;
  // lower edge: shallow on the sidepod, climbing towards the tail, falling away at the tip
  float yLow = 0.45 + 0.07 * ramp(-p.x, 0.40, 1.00) - 0.20 * ramp(-p.x, 1.00, 1.62);
  float low = (p.y - yLow) * 0.9;
  // keep the small rear suspension fairings red
  float side = 0.60 - az;
  return min(frSmin(front, low, 0.16), side);
}

Paint paintAt(vec3 p, vec3 n) {
  float az = abs(p.z);
  vec3 red = hex(0xb80c16);
  vec3 redDeep = hex(0x7a0810);
  vec3 white = hex(0xebe8de);
  vec3 carbon = hex(0x27262a);
  vec3 graphite = hex(0x2e2d31);
  vec3 skirtCol = hex(0x34363c);
  vec3 gap = hex(0x1d0a0d);

  if (uPaintPart == PART_BODY) {
    float d = frCover(p);
    float w = cover(d);
    // panel gap: a dark line on the edge, with the red falling into shade just outside it and the
    // white easing off just inside it, so the break reads as a physical seam rather than a bare cut
    float line = stroke(abs(d - 0.002), 0.0105);
    float shadeRed = (1.0 - ramp(-d, 0.004, 0.034)) * (1.0 - w);
    float shadeWhite = (1.0 - ramp(d, 0.004, 0.026)) * w;
    // slim red pin line inside the white edge, 2.5 cm wide so it holds at hero distance; it gives way
    // only when a pixel is far wider than the line, so it never beads
    float pinFade = 1.0 - ramp(fwidth(d), 0.011, 0.018);
    float pin = stroke(abs(d - 0.042), 0.0125) * w * pinFade;
    vec3 col = mix(red, redDeep, 0.6 * shadeRed);
    // dark carbon skirt along the bottom edge: rises towards the tail and at the sidepod inlet,
    // which also hides the ragged lower fringe of the bodywork mesh. Dark rear fairings.
    float skirtY = 0.21 + 0.17 * ramp(-p.x, 0.5, 1.5) + 0.07 * ramp(p.x, 0.15, 0.55);
    float sd = p.y - skirtY;
    float skirt = 1.0 - cover(sd);
    // the red deepens into shade just above the carbon break and a fine dark line marks the seam
    float seamShade = (1.0 - ramp(sd, 0.0, 0.055)) * (1.0 - skirt);
    float seamLine = stroke(abs(sd - 0.005), 0.0075);
    col = mix(col, redDeep, 0.55 * seamShade);
    // warm white: slightly darker low on the flank and on the crown so form shading shows and the
    // lit top never clips flat
    float whiteLevel = mix(0.90, 1.0, ramp(p.y, 0.50, 0.85)) * (1.0 - 0.07 * ramp(n.y, 0.55, 1.0));
    vec3 cream = white * whiteLevel;
    // intake mouth: the front-facing lip and fan of the airbox read as a dark opening, not grey paint
    float mouth = ramp(n.x, 0.35, 0.65) * ramp(p.y, 0.78, 0.82) * ramp(p.x, -0.30, -0.22) * (1.0 - ramp(p.x, -0.02, 0.05));
    cream = mix(cream, carbon, 0.9 * mouth);
    col = mix(col, cream, w);
    col = mix(col, cream * 0.82, 0.6 * shadeWhite);
    col = mix(col, red, pin);
    col = mix(col, gap, line * 0.9);
    float fairing = cover(-1.2 - p.x) * cover(az - 0.60);
    // the open tail end of the cover is torn in the mesh: close it in carbon
    float tail = (1.0 - soft(p.x + 1.74, 0.03)) * (1.0 - ramp(az, 0.36, 0.5));
    col = mix(col, skirtCol, max(skirt, fairing));
    col = mix(col, gap, 0.85 * seamLine * (1.0 - w));
    col = mix(col, carbon, tail);
    float darkBody = max(max(skirt, fairing), max(tail, 0.9 * mouth));
    return Paint(col, mix(mix(0.30, 0.25, w), 0.48, darkBody), 0.0);
  }
  if (uPaintPart == PART_CELL) {
    float sd = p.y - 0.22;
    float skirt = 1.0 - cover(sd);
    float seamShade = (1.0 - ramp(sd, 0.0, 0.05)) * (1.0 - skirt);
    float seamLine = stroke(abs(sd - 0.005), 0.0075);
    vec3 col = mix(red, redDeep, 0.55 * seamShade);
    col = mix(col, skirtCol, skirt);
    col = mix(col, gap, 0.85 * seamLine);
    return Paint(col, 0.30, 0.0);
  }
  if (uPaintPart == PART_NOSE) {
    return Paint(red, 0.28, 0.0);
  }
  if (uPaintPart == PART_FWING) {
    // endplates, the outer cascade and everything outboard of the mainplane tips are one dark satin
    // finish, so no red edge or hairline is left on the plates
    float vert = ramp(abs(n.z), 0.45, 0.75);
    float endplate = max(ramp(az, 0.575, 0.605), vert * ramp(az, 0.46, 0.54));
    // red above, dark satin on the underside and the thin edges (pillars and hangers included)
    float top = ramp(n.y, 0.12, 0.50);
    vec3 wing = mix(carbon, red, top);
    return Paint(mix(wing, graphite, endplate), mix(0.28, 0.46, endplate), 0.0);
  }
  if (uPaintPart == PART_RWING) {
    // red wing, endplates drop into carbon at the foot
    float foot = cover(0.52 - p.y) * ramp(az, 0.5, 0.54);
    // the two centre pylons are carbon: they are thin and torn-looking in white
    float pylon = cover(0.68 - p.y) * cover(0.28 - az);
    return Paint(mix(red, carbon, max(foot, pylon)), 0.3, 0.0);
  }
  if (uPaintPart == PART_HALO) {
    // satin gunmetal: a touch lighter where it faces up so the tube keeps its form against the red
    vec3 halo = mix(hex(0x1f2024), hex(0x383a41), ramp(n.y, -0.3, 0.8));
    return Paint(halo, 0.30, 0.0);
  }
  if (uPaintPart == PART_RIM) {
    vec2 hub = vec2(p.x > 0.0 ? 1.7 : -1.7, p.x > 0.0 ? 0.3525 : 0.355);
    float r = length(p.xy - hub);
    // only the rim lip: other parts on the rim material (brake ducts, fairings) sit outside it
    float lip = cover(r - 0.2175) * cover(0.236 - r);
    return Paint(mix(graphite, red, lip), 0.36, mix(0.2, 0.0, lip));
  }
  if (uPaintPart == PART_HELMET) {
    vec3 q = p - vec3(0.32, 0.765, 0.0);
    float stripe = cover(0.030 - abs(q.z)) * ramp(q.y, -0.03, 0.0);
    // red lower band, rising towards the back, with a hairline of white above it
    float bandEdge = -0.05 + 0.035 * ramp(-q.x, 0.0, 0.1);
    float band = 1.0 - cover(q.y - bandEdge);
    return Paint(mix(white, red, max(stripe, band)), 0.3, 0.0);
  }
  return Paint(red, 0.28, 0.0);
}
`;
