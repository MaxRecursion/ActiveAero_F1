/**
 * One visual time-scale for everything that moves with the air: rolling road, wheel spin,
 * airflow streaks. Real speeds are far too fast to read (300 km/h = 83 m/s), so motion is
 * shown slowed down by a fixed factor. Keeping one factor means the belt, the tyres and the
 * air always agree with each other.
 */

/** On-screen metres per second for each km/h of real speed (≈ 9× slow motion). */
export const VISUAL_MPS_PER_KMH = 0.03;

/** How many times slower than real the motion is shown (for the UI note). */
export const SLOW_MOTION_FACTOR = 1 / 3.6 / VISUAL_MPS_PER_KMH;

/** On-screen speed in m/s for a real speed in km/h. */
export const visualSpeed = (kmh: number): number => kmh * VISUAL_MPS_PER_KMH;
