/**
 * Number formatting for every readout. One place, so the chart, the readouts and the dialog
 * always print the same value the same way (en-GB, fixed decimals, tabular-friendly).
 */

const oneDecimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** Thin space as the thousands separator: "1 390" reads as one number and never as a list. */
const THIN = '\u2009';
const grouped = (n: number) => int.format(Math.round(n)).replace(/,/g, THIN);

/** Newtons → "13.6" (kN, one decimal). Clamped at 0 so rounding noise never prints "-0.0". */
export const fmtKN = (newtons: number): string => oneDecimal.format(Math.max(0, newtons) / 1000);

/** Watts → "390" (kW, integer). */
export const fmtKW = (watts: number): string => grouped(Math.max(0, watts) / 1000);

/** 1 kW = 1.341 hp (mechanical horsepower). */
export const HP_PER_KW = 1.341;
export const fmtHp = (watts: number): string => grouped((Math.max(0, watts) / 1000) * HP_PER_KW);

/** Kilograms → "1 390" (integer, thin-space thousands). */
export const fmtKg = (kg: number): string => grouped(Math.max(0, kg));

/** km/h → "300" (integer). */
export const fmtKmh = (kmh: number): string => grouped(kmh);

/** Downforce / weight → "1.8". */
export const fmtRatio = (r: number): string => oneDecimal.format(Math.max(0, r));

/** Screen-reader text for the speed slider. */
export const spokenSpeed = (kmh: number): string =>
  `${Math.round(kmh)} ${Math.round(kmh) === 1 ? 'kilometre' : 'kilometres'} per hour`;

/** Megajoules → "1.2" (one decimal, clamped at 0). */
export const fmtMJ = (mj: number): string => oneDecimal.format(Math.max(0, mj));

/** A regulated limit as written in the rules: "4", "8.5" (no padding zero). */
export const fmtLimit = (x: number): string => (Number.isInteger(x) ? String(x) : oneDecimal.format(x));

/** Seconds → "86.4" (one decimal). */
export const fmtS = (s: number): string => oneDecimal.format(Math.max(0, s));

/** Real minus sign, so a negative number is as wide as a positive one and reads as "minus". */
export const MINUS = '−';

/** Signed kW → "+350", "−350", "0" (integer). */
export const fmtSignedKw = (kw: number): string => {
  const r = Math.round(kw);
  return r > 0 ? `+${grouped(r)}` : r < 0 ? `${MINUS}${grouped(-r)}` : '0';
};

/** Screen-reader text for the lap timeline: "23 seconds, 1.4 km, after T3". */
export const spokenLapPosition = (tS: number, sM: number, where: string): string =>
  `${Math.round(tS)} ${Math.round(tS) === 1 ? 'second' : 'seconds'}, ${oneDecimal.format(sM / 1000)} km, ${where}`;
