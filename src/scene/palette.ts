/**
 * Shared colour language. The same meanings are used in 3D, in readouts and in captions:
 * blue = downforce, orange = drag, graphite = weight, green = electrical energy, slate = engine power.
 * Keep in sync with src/styles/tokens.css.
 *
 * Scene look: a wind-tunnel studio. Light, warm-grey cyclorama; the car is a matte clay model
 * (the way aero departments show shapes) with carbon-dark aero surfaces.
 */
export const PALETTE = {
  // studio
  background: 0xe8e6e1,
  floor: 0xe2dfd8,
  belt: 0x2d2f34,
  beltMarking: 0xd9d6cf,
  // car
  clay: 0xd8d4cb,
  clayDark: 0xb9b4aa,
  carbon: 0x34363b,
  carbonLight: 0x4a4d54,
  tyre: 0x1d1e21,
  tyreSidewall: 0x2a2b2f,
  rim: 0x55585f,
  metal: 0x8b9099,
  helmet: 0xf2f0eb,
  visor: 0x16181d,
  // physics (meaningful colours)
  downforce: 0x2356f6,
  drag: 0xf2551d,
  weight: 0x2a2c31,
  flowSlow: 0x9aa3b5,
  flowFast: 0x2356f6,
  /** Electrical energy (battery ↔ motor-generator), both directions. */
  energy: 0x12a36d,
  /** Mechanical power from the engine. */
  engine: 0x6b6f78,
} as const;

/** CSS hex strings for the DOM side (same values as above). */
export const CSS = {
  downforce: '#2356f6',
  drag: '#f2551d',
  weight: '#2a2c31',
  energy: '#12a36d',
  engine: '#6b6f78',
} as const;
