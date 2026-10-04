/**
 * Mersedez, 2026 interpretation: satin silver dissolving into charcoal from nose to tail, one
 * turquoise flow line, a long white break on the engine cover and fin, and a harlequin rhombus
 * lattice on the sidepod tops and shoulders.
 * Colour, fade, panel break and simple pattern only: no crests, wordmarks or sponsor marks.
 *
 * The fade is the whole idea: silver holds on the nose and tub, lets go over ~1.4 m of flank (later
 * above the flow line and on up-facing tops, sooner below it and toward the floor) through a cool
 * blue steel, and ends in a satin charcoal that still shows form. Paint is satin throughout and
 * never mirror-bright: roughness stays broad so highlights are wide and soft, not streaky.
 *
 * Colours are written as sRGB triplets and mixed in sRGB (so fades stay perceptually even), then
 * converted once at the end.
 */
export const MERSEDEZ_GLSL = /* glsl */ `
const vec3 MB_CHAR = vec3(0.192, 0.201, 0.222);
const vec3 MB_STEEL = vec3(0.350, 0.380, 0.420);
const vec3 MB_SILVER = vec3(0.640, 0.660, 0.690);
const vec3 MB_TURQ = vec3(0.0, 0.75, 0.70);
const vec3 MB_WHITE = vec3(0.890, 0.895, 0.902);

Paint mbOut(vec3 srgbCol, float rough, float metal) {
  return Paint(srgb(srgbCol), rough, metal);
}

float mbLum(vec3 c) {
  return dot(c, vec3(0.30, 0.55, 0.15));
}

// Silver (t = 1) through a cool blue steel (t = 0.5) to charcoal (t = 0).
vec3 mbFadeCol(float t) {
  vec3 c = mix(MB_CHAR, MB_STEEL, smoothstep(0.0, 0.55, t));
  return mix(c, MB_SILVER, smoothstep(0.50, 1.0, t));
}

// Harlequin lattice of diamonds in a flat (x, s) plane: x = tile coverage, y = light/dark parity,
// z = detail kept (0 when the cells are too small to resolve). L = the two diagonals in metres;
// size = tile size 0..1 (tiles shrink to nothing as size falls, so the edge dissolves, never clips).
vec3 mbLattice(vec2 xs, vec2 L, float size, float gapW) {
  vec2 uv = vec2(xs.x / L.x + xs.y / L.y, xs.x / L.x - xs.y / L.y);
  vec2 f = fract(uv) - 0.5;
  float k = length(vec2(1.0 / L.x, 1.0 / L.y));
  float hs = 0.5 * size / k;
  float edge = hs - max(abs(f.x), abs(f.y)) / k - gapW * smoothstep(0.7, 1.0, size);
  float fw = max(fwidth(edge), 1e-6);
  float tile = cover(edge) * smoothstep(0.0, 0.08, size) * smoothstep(0.4, 1.6, hs / fw);
  float s = sin(3.14159265 * uv.x) * sin(3.14159265 * uv.y);
  float ws = max(fwidth(s) * 0.8, 1e-4);
  float par = smoothstep(-ws, ws, s);
  float foot = max(fwidth(uv.x), fwidth(uv.y));
  float keep = 1.0 - smoothstep(0.30, 0.62, foot);
  return vec3(tile, par, keep);
}

// Where the lattice lives: the sidepod tops and their upper shoulders. Every edge is a soft ramp that
// the tiles dissolve along, so nothing is clipped on a straight line.
float mbPodMask(vec3 p, vec3 n) {
  float az = abs(p.z);
  float surf = smoothstep(0.14, 0.42, n.y);
  float hy = smoothstep(0.42, 0.56, p.y) * (1.0 - smoothstep(0.80, 0.90, p.y));
  // inboard edge: the engine-cover wall behind the cockpit, the tub seam beside it
  float inner = mix(0.15, 0.31, smoothstep(-0.30, -0.02, p.x));
  float gi = smoothstep(inner, inner + 0.11, az);
  float gx = smoothstep(-1.10, -0.76, p.x) * (1.0 - smoothstep(0.40, 0.70, p.x));
  return surf * hy * gi * gx;
}

// Flow line: angle (degrees from straight up, about the section centre) as a function of x.
float mbTheta(float x) {
  float t = 2.9 - x;
  return 10.0 + 48.0 * smoothstep(0.0, 1.8, t) + 34.0 * smoothstep(1.9, 2.7, t) - 36.0 * smoothstep(3.0, 4.7, t);
}

// Signed distance (m) over the surface from the flow line: positive above it, negative below.
float mbFlowSigned(vec3 p) {
  float az = abs(p.z);
  float yc = mix(0.40, 0.22, smoothstep(1.2, 2.9, p.x));
  vec2 q = vec2(az, p.y - yc);
  float r = length(q);
  float th = atan(q.x, q.y);
  float thL = radians(mbTheta(p.x));
  float slope = radians(mbTheta(p.x + 0.05) - mbTheta(p.x - 0.05)) / 0.1;
  return r * (thL - th) / sqrt(1.0 + r * r * slope * slope);
}

// 0 = charcoal .. 1 = silver, front to back over ~1.4 m. Silver holds longer above the flow line and
// on the up-facing tops, and lets go sooner below the line, so the fade also runs down the flank.
float mbFade(vec3 p, float sd, float topF) {
  float lift = clamp(sd, -0.25, 0.25) * (1.0 - smoothstep(0.80, 0.95, p.y)) + 0.30 * topF;
  float t = smoothstep(-0.62, 0.86, p.x + lift);
  return mix(t, t * t * (3.0 - 2.0 * t), 0.35);
}

Paint mbBody(vec3 p, vec3 n) {
  float az = abs(p.z);
  float isBody = float(uPaintPart == PART_BODY);
  float sd = mbFlowSigned(p);

  // up-facing sidepod top: shared by the fade (silver clings to it) and the lattice
  float topF = smoothstep(0.40, 0.70, n.y) * smoothstep(0.52, 0.62, p.y) * (1.0 - smoothstep(0.78, 0.84, p.y));

  float t = mbFade(p, sd, topF);
  vec3 col = mbFadeCol(t);
  // and a little top to bottom: the silver lets go toward the floor
  float under = 1.0 - smoothstep(0.28, 0.50, p.y);
  col = mix(col, MB_CHAR, under * 0.60 * t);
  // satin all the way: broad, soft highlights; a touch of metal only where the silver is
  float rough = mix(0.78, 0.50, t) + 0.10 * under;
  float metal = mix(0.03, 0.24, t) * (1.0 - 0.6 * under);

  // rhombus lattice on the sidepod tops, wrapping onto the upper shoulder: tone-on-tone diamonds
  // (~19 x 10.5 cm) with a fine dark seam; the tiles shrink away at every edge of the top.
  float lw = mbPodMask(p, n) * isBody;
  float size = smoothstep(0.0, 0.8, lw);
  // lay the flat pattern along the surface: on the shoulder, count the drop as sideways distance
  float yRef = 0.74 - 0.10 * smoothstep(0.05, 0.30, p.x);
  float zs = az + 0.4 * clamp(yRef - p.y, 0.0, 0.35);
  vec3 lat = mbLattice(vec2(p.x, zs), vec2(0.19, 0.105), size, 0.0042);
  float lum = smoothstep(0.22, 0.58, mbLum(col));
  vec3 light = col + mix(0.100, 0.075, lum);
  vec3 dark = col - mix(0.070, 0.095, lum);
  vec3 tone = mix(dark, light, lat.y);
  vec3 ground = col * mix(1.0, 0.60, smoothstep(0.7, 1.0, size));
  col = mix(col, mix(ground, tone, lat.x), lat.z);
  rough += (0.5 - lat.y) * 0.16 * lat.x * lat.z;

  // white break: one long panel on the engine cover, from the airbox back to the cover's tail, with
  // the shark fin standing in it. Drawn in plan (a teardrop that swells behind the airbox and runs
  // out to a rounded tail) so it reads as a deliberate panel, edged by a fine seam line.
  float xFront = -0.46 - 0.07 * smoothstep(0.0, 0.14, az);
  float sT = clamp((-p.x - 0.95) / 0.68, 0.0, 1.0);
  float wid = (0.142 + 0.016 * smoothstep(0.50, 0.95, -p.x)) * sqrt(max(1.0 - sT * sT, 0.0));
  float dPanel = min(wid - az, xFront - p.x);
  float onCover = smoothstep(0.54, 0.60, p.y) * isBody;
  float white = cover(dPanel) * onCover;
  col = mix(col, MB_WHITE, white);
  // fine panel seam, just inside the edge
  float seam = stroke(abs(dPanel - 0.011), 0.0032) * onCover * white;
  col = mix(col, vec3(0.40, 0.42, 0.45), seam * 0.9);
  rough = mix(rough, 0.34, white);
  metal = mix(metal, 0.0, white);

  // one turquoise flow line from the nose, along the tub shoulder and down the flank
  float fw = 0.0135 * (1.0 - smoothstep(2.62, 2.90, p.x)) * smoothstep(-1.85, -1.2, p.x);
  float edgeD = abs(sd) - fw;
  float flow = stroke(abs(sd), fw);
  col = mix(col, col * 0.55, stroke(abs(edgeD - 0.003), 0.003));
  col = mix(col, MB_TURQ, flow);
  rough = mix(rough, 0.33, flow);
  metal = mix(metal, 0.0, flow);

  return mbOut(col, rough, metal);
}

Paint mbFWing(vec3 p, vec3 n) {
  float az = abs(p.z);
  // silver at the leading edge and centre, dissolving to charcoal toward the tips and trailing edges
  float sv = smoothstep(1.95, 2.62, p.x - 0.25 * smoothstep(0.50, 0.90, az));
  vec3 col = mbFadeCol(sv);
  // the two pillars: satin graphite, so they read as painted parts rather than bare carbon
  float pillar = smoothstep(0.17, 0.21, p.y) * (1.0 - smoothstep(0.30, 0.36, az));
  col = mix(col, vec3(0.215, 0.230, 0.255), pillar);
  // one clean turquoise band across the upper surfaces, kept clear of the thin strakes either side of it
  float up = smoothstep(0.50, 0.80, n.y);
  float band = stroke(abs(az - 0.415), 0.020) * up;
  col = mix(col, col * 0.55, stroke(abs(abs(az - 0.415) - 0.023), 0.003) * up);
  col = mix(col, MB_TURQ, band);
  // endplates: charcoal, with a turquoise stripe
  float ep = smoothstep(0.56, 0.60, az) * smoothstep(0.16, 0.22, p.y);
  col = mix(col, MB_CHAR, ep);
  float stripe = stroke(abs(p.y - 0.352), 0.0135) * ep * (1.0 - smoothstep(0.78, 0.82, az)) * smoothstep(0.62, 0.86, abs(n.z));
  col = mix(col, MB_TURQ, stripe);
  float metal = mix(0.10, 0.30, sv) * (1.0 - ep);
  metal = mix(metal, 0.45, pillar * (1.0 - ep));
  metal = mix(metal, 0.0, band);
  return mbOut(col, mix(0.38, 0.34, band), metal);
}

Paint mbRWing(vec3 p, vec3 n) {
  float az = abs(p.z);
  float ep = smoothstep(0.54, 0.565, az);
  // satin gunmetal planes, a shade deeper on the endplates: metallic enough to catch a broad sheen
  vec3 col = mix(vec3(0.225, 0.240, 0.265), MB_CHAR, ep);
  float stripeY = 0.60 + 0.26 * clamp((-1.83 - p.x) / 0.62, 0.0, 1.0);
  float stripe = stroke(abs(p.y - stripeY), 0.0135) * ep * smoothstep(0.4, 0.7, abs(n.z));
  col = mix(col, MB_TURQ, stripe);
  float metal = mix(0.45, 0.30, ep);
  metal = mix(metal, 0.0, stripe);
  return mbOut(col, mix(0.44, 0.40, stripe), metal);
}

Paint mbHalo(vec3 p, vec3 n) {
  // satin gunmetal: a deliberate anodised finish that reads as painted, darker than the silver tub
  // it stands on and lighter than the black behind, with a broad soft sheen
  vec3 col = mix(vec3(0.380, 0.400, 0.430), vec3(0.520, 0.540, 0.570), smoothstep(-0.05, 0.9, p.x));
  return mbOut(col, 0.38, 0.42);
}

Paint mbRim(vec3 p) {
  float cx = p.x > 0.0 ? 1.70 : -1.70;
  float r = length(vec2(p.x - cx, p.y - 0.36));
  vec3 col = vec3(0.19, 0.20, 0.215);
  col = mix(col, MB_SILVER * 0.8, 1.0 - smoothstep(0.075, 0.095, r));
  float ring = stroke(abs(r - 0.205), 0.011);
  col = mix(col, MB_TURQ, ring);
  return mbOut(col, 0.38, 0.30);
}

Paint mbHelmet(vec3 p) {
  vec3 col = vec3(0.80, 0.82, 0.84);
  float band = stroke(abs(p.y - 0.775), 0.014);
  float top = stroke(abs(p.z), 0.016) * smoothstep(0.76, 0.82, p.y);
  col = mix(col, MB_TURQ, max(band, top));
  return mbOut(col, 0.30, 0.10);
}

Paint paintAt(vec3 p, vec3 n) {
  if (uPaintPart == PART_RIM) return mbRim(p);
  if (uPaintPart == PART_HELMET) return mbHelmet(p);
  if (uPaintPart == PART_HALO) return mbHalo(p, n);
  if (uPaintPart == PART_FWING) return mbFWing(p, n);
  if (uPaintPart == PART_RWING) return mbRWing(p, n);
  return mbBody(p, n);
}
`;
