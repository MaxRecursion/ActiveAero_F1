/**
 * Sound-only drive map. The physics model has no gearbox, so rpm is invented here: pitch rises
 * inside a gear, then drops at a shift. Load at a steady speed is the power the air and the road
 * demand divided by the power the car can deliver, so a crawl is a light tick-over and holding top
 * speed is full power. Flap edges turn the animated wing position into one travel and one latch.
 */
import { availablePowerW, requiredPowerW } from '../../physics/powertrain';

/** Combustion idle. Below this the tone sits still, even in first gear. */
export const IDLE_RPM = 4500;
/** Upshift when a gear reaches this. The next gear lands near UPSHIFT_LAND_RPM. */
export const SHIFT_UP_RPM = 11_500;
export const SHIFT_DOWN_RPM = 8_000;
export const UPSHIFT_LAND_RPM = 8_500;
export const GEAR_COUNT = 8;
/** Top gear is this fast at TOP_GEAR_KMH. Above that, top gear just revs higher. */
export const TOP_GEAR_RPM = 12_000;
export const TOP_GEAR_KMH = 340;

const STEP = SHIFT_UP_RPM / UPSHIFT_LAND_RPM;
const TOP_PER_KMH = TOP_GEAR_RPM / TOP_GEAR_KMH;

/** rpm per km/h. Index 0 is unused; gears are 1–8. */
export const RPM_PER_KMH: readonly number[] = Array.from({ length: GEAR_COUNT + 1 }, (_, gear) =>
  gear === 0 ? 0 : TOP_PER_KMH * STEP ** (GEAR_COUNT - gear),
);

export interface GearStep {
  gear: number;
  rpm: number;
}

/**
 * Advance the gearbox by one speed sample. Hysteresis keeps a gear chosen while the speed
 * sits between the downshift and the upshift, including when a jump crosses several gears.
 */
export function stepGear(gear: number, kmh: number, out: GearStep): void {
  const speed = kmh > 0 ? kmh : 0;
  let g = gear < 1 ? 1 : gear > GEAR_COUNT ? GEAR_COUNT : gear;
  for (let i = 0; i < GEAR_COUNT; i++) {
    const raw = speed * RPM_PER_KMH[g];
    if (g < GEAR_COUNT && raw >= SHIFT_UP_RPM) g++;
    else if (g > 1 && raw <= SHIFT_DOWN_RPM) g--;
    else break;
  }
  const raw = speed * RPM_PER_KMH[g];
  out.gear = g;
  out.rpm = raw > IDLE_RPM ? raw : IDLE_RPM;
}

/** 0 overrun … 1 full power, for a car holding `kmh` with flaps at `straightT`. */
export function steadyLoad(kmh: number, straightT: number): number {
  if (!(kmh >= 1)) return 0;
  const available = availablePowerW(kmh);
  if (!(available > 0)) return 1;
  const ratio = requiredPowerW(kmh, straightT).totalW / available;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

export interface FlapStep {
  /** Flaps moved since the previous sample. */
  moving: boolean;
  /** +1 opening, −1 closing, 0 still. */
  direction: number;
  /** Travel arrived at Straight Mode this sample. */
  latchedOpen: boolean;
  /** Travel arrived at Corner Mode this sample. */
  latchedClosed: boolean;
}

const FLAP_MOVE = 1e-4;
const FLAP_END = 1e-3;

/** One sample of flap travel. A latch fires on the sample that reaches an end, then stays quiet. */
export function stepFlaps(prev: number, next: number, out: FlapStep): void {
  const from = prev <= 0 ? 0 : prev >= 1 ? 1 : prev;
  const to = next <= 0 ? 0 : next >= 1 ? 1 : next;
  const d = to - from;
  const opening = d > FLAP_MOVE;
  const closing = d < -FLAP_MOVE;
  out.moving = opening || closing;
  out.direction = opening ? 1 : closing ? -1 : 0;
  out.latchedOpen = from < 1 - FLAP_END && to >= 1 - FLAP_END && d > 0;
  out.latchedClosed = from > FLAP_END && to <= FLAP_END && d < 0;
}
