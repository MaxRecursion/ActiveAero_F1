/**
 * Part classification of the fused body shell, in the car frame (metres, +X forward, |z| = distance
 * from the centre line). The export is one welded skin, so parts are found by (1) region rules on
 * triangle centroids, (2) a connectivity pass that gives tiny islands to their neighbours, and (3) cutting
 * the wings apart at the end plates so the active flap elements fall out as their own connected pieces.
 */
export const PART_IDS = [
  'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR',
  'frontWing', 'frontWingFlaps', 'rearWing', 'rearWingFlap',
  'nose', 'survivalCell', 'halo', 'bodywork', 'floor',
  'suspensionFront', 'suspensionRear', 'rearStructure',
];
export const PART_INDEX = Object.fromEntries(PART_IDS.map((id, i) => [id, i]));
const P = PART_INDEX;

/** Piecewise-linear lookup through (x, y) knots sorted by x; clamps outside. */
function lerpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++)
    if (x <= table[i][0]) return table[i - 1][1] + ((table[i][1] - table[i - 1][1]) * (x - table[i - 1][0])) / (table[i][0] - table[i - 1][0]);
  return table[table.length - 1][1];
}
/** Half-width of the gearbox / rear crash structure (read off x-slices), so the wishbones start outside it. */
const REAR_HW = [[-2.1, 0.1], [-1.9, 0.1], [-1.75, 0.14], [-1.6, 0.19], [-1.5, 0.21], [-1.4, 0.24], [-1.3, 0.26]];
/** Half-width of the survival cell forward of the cockpit, likewise. */
const FRONT_HW = [[1.0, 0.243], [1.7, 0.163], [2.05, 0.123]];

/** Region rules for one triangle of the body shell (component 0). */
export function classifyBody(x, y, az) {
  // ── front: wing below, nose above ────────────────────────────────────────────
  if (x > 2.04) {
    if (y >= 0.42) return P.nose;
    if (az < 0.2 && y > 0.2) return P.nose;
    if (x > 2.78 && az < 0.13 && y > 0.135) return P.nose;
    return P.frontWing;
  }
  // ── rear: wishbones and the wing ─────────────────────────────────────────────
  if (x < -1.3 && x > -2.1 && az > lerpTable(REAR_HW, x) + 0.012 && az < 0.535 && y > 0.26 && y < 0.58) return P.suspensionRear;
  if (x < -1.85 && (y > 0.42 || (az > 0.38 && y > 0.29))) return P.rearWing;
  // ── front wishbones and pushrods ─────────────────────────────────────────────
  if (x > 1.0 && az > lerpTable(FRONT_HW, x) + 0.01 && az < 0.62 && y > 0.26 && y < 0.68) return P.suspensionFront;
  // ── floor ────────────────────────────────────────────────────────────────────
  if (y < 0.13) return P.floor;
  if (x > 0.5 && x < 1.33 && az > 0.4 && y < 0.55) return P.floor;
  if (x < -1.3 && y < 0.25 && az > 0.2) return P.floor;
  if (x < -1.6 && y < 0.42) return P.floor;
  // ── halo: the hoop only; the airbox behind it is bodywork ────────────────────
  if (x > -0.02 && x < 1.05 && y > 0.7 && az < 0.35) return P.halo;
  // ── chassis ──────────────────────────────────────────────────────────────────
  if (x > 1.3) return P.nose;
  if (x > -0.05 && az < 0.3) return P.survivalCell;
  return P.bodywork;
}
