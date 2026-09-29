/**
 * Car dimensions shared by the part builders (metres, car frame). The authoritative list is the
 * contract in ./types.ts; this file only turns it into numbers the geometry code can use.
 */

export const AXLE_X = { front: 1.7, rear: -1.7 } as const;

/** Outer tyre faces sit on the 1.90 m maximum width (FIA C2.3.1). */
export const HALF_WIDTH = 0.95;

/** 18-inch rim: bead seat radius. */
export const RIM_RADIUS = 0.2286;

export interface TyreSize {
  radius: number;
  width: number;
}

export const TYRE: Record<'front' | 'rear', TyreSize> = {
  front: { radius: 0.3525, width: 0.28 },
  rear: { radius: 0.355, width: 0.375 },
};

/** Wheel centre |z|: outer face on the width limit. */
export const wheelZ = (t: TyreSize): number => HALF_WIDTH - t.width / 2;

/** Floor board heights: plank bottom, floor bottom, floor top. */
export const FLOOR_Y = { plank: 0.03, bottom: 0.045, top: 0.06 } as const;
