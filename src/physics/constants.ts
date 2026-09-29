/**
 * Numbers the app relies on, in one place, each tagged with where it comes from.
 *
 * Two kinds of number live here and the UI must keep them visibly apart:
 *  - REGS: taken from the FIA 2026 Technical Regulations (a fact, with an article reference).
 *  - ESTIMATES: model assumptions. Teams do not publish aero coefficients, so these are
 *    calibrated guesses and are always labelled "estimate" in the interface.
 */

export interface Source {
  label: string;
  url: string;
}

export const SOURCES = {
  techRegs: {
    label: 'FIA 2026 F1 Technical Regulations, Section C, Issue 20 (5 Aug 2026)',
    url: 'https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf',
  },
  f1Aero2026: {
    label: 'Formula1.com — 2026 aerodynamic regulations explained',
    url: 'https://www.formula1.com/en/latest/article/explained-2026-aerodynamic-regulations-fia-x-mode-z-mode-.26c1CtOzCmN3GfLMywrgb2',
  },
  nasaLift: {
    label: 'NASA Glenn — The lift equation',
    url: 'https://www.grc.nasa.gov/www/k-12/airplane/lifteq.html',
  },
  f1Pu2026: {
    label: 'Formula1.com — 2026 power unit regulations explained',
    url: 'https://www.formula1.com/en/latest/article/explained-2026-power-unit-regulations-fia.68izKQ2tn1voQPWvgLVMXN',
  },
  raceteqStraightMode: {
    label: 'Raceteq — 2026 Straight Mode simulations',
    url: 'https://www.raceteq.com/articles/2025/10/2026-straightline-mode-replacing-drs-simulations',
  },
  raceteqEnergy: {
    label: 'Raceteq — F1’s 2026 energy system explained',
    url: 'https://www.raceteq.com/articles/2026/05/f1s-2026-energy-system-explained',
  },
  raceteqCfd: {
    label: 'Raceteq — CFD aero analysis of the 2026 car',
    url: 'https://www.raceteq.com/articles/2025/06/cfd-aero-analysis-of-2026-formula-1-car',
  },
} satisfies Record<string, Source>;

/** Regulation facts. `ref` is the article in Section C, Issue 20. */
export const REGS = {
  /** 724 kg + Nominal Tyre Mass (~46 kg slick set) outside qualifying. Includes driver, excludes fuel. */
  minMassKg: { value: 770, ref: 'C4.1', note: '724 kg + nominal tyre mass (about 46 kg)' },
  wheelbaseM: { value: 3.4, ref: 'C2.3.3', note: 'maximum' },
  maxWidthM: { value: 1.9, ref: 'C2.3.1', note: 'nothing beyond 950 mm from the centreline except wheels' },
  mguKMaxKw: { value: 350, ref: 'C5.2.7', note: 'electric motor (ERS-K) maximum power, up from 120 kW' },
  mguKTaper: {
    ref: 'C5.2.8',
    note: 'above 290 km/h the allowed ERS-K power falls: 1800 − 5v kW to 340 km/h, then 6900 − 20v, zero at 345',
  },
  energyStoreWindowMJ: {
    value: 4,
    ref: 'C5.2.9',
    note: 'largest allowed difference between the battery’s highest and lowest state of charge',
  },
  harvestPerLapMJ: { value: 8.5, ref: 'C5.2.10', note: 'most energy the ERS-K may recover in one lap' },
  activeAeroSwitchMs: {
    value: 400,
    ref: 'C3.10.10 / C3.11.6',
    note: 'maximum Corner ↔ Straight transition; any failure returns the wings to Corner Mode',
  },
} as const;

/** Physical constants: ISA sea-level air, standard gravity. */
export const PHYS = {
  rho: 1.225, // kg/m³
  g: 9.80665, // m/s²
} as const;

export type AeroSurfaceId = 'frontWing' | 'floor' | 'rearWing';

export interface AeroSurface {
  id: AeroSurfaceId;
  label: string;
  /** Fraction of total downforce this surface makes (estimate). Shares sum to 1. */
  share: number;
  /** Centre of pressure, car frame metres (+x forward, front axle at +1.7, rear axle at -1.7). */
  cpX: number;
}

/**
 * Model estimates for the 2026 car in Corner Mode (wings closed, maximum downforce).
 * 2026 cars carry about 30% less downforce and 55% less drag than 2022–25 cars (F1/FIA).
 *
 * clA 3.2 m² sits mid-range of published 2026 estimates (2.5–3.5 m²).
 * cdA 1.1 m² gives Straight Mode cdA ≈ 0.9 m² (≈ -18%). With the estimated power the model tops out
 * at ≈338.5 km/h in Straight Mode, a calibration target near the 341 km/h reported for Monza 2026
 * qualifying, not a reproduction of it.
 * Surface split gives ≈46% front aero balance, typical of a high-downforce set-up.
 */
export const ESTIMATES = {
  clA: 3.2,
  cdA: 1.1,
  /** Assumed centre-of-gravity height (m). Not published. */
  cgHeightM: 0.28,
  /** Static front weight distribution, near the 44% qualifying front-axle minimum (C4.2). */
  staticFrontShare: 0.45,
  /** Combustion engine output, about 400 kW under the 2026 fuel-energy limit (F1.com). */
  iceKw: 400,
  /** Share of engine + motor power that reaches the tyres. */
  drivelineEfficiency: 0.95,
  /** Rolling resistance coefficient, applied to weight plus downforce. */
  rollingResistance: 0.012,
  /**
   * Straight Mode relative to Corner Mode, from a CFD study of a representative 2026 car
   * (Bramble CFD via Raceteq): about 25% less downforce and 18% less drag.
   */
  straightMode: { clAFactor: 0.75, cdAFactor: 0.82 },
  /** Tyre friction: cornering, and braking / traction (lower — tyres share grip with the brakes and diff). */
  gripLateral: 1.6,
  gripLongitudinal: 1.4,
  /** Share of weight and downforce on the driven rear axle. */
  rearAxleShare: 0.55,
  /** Battery charge when a lap starts (the simulation repeats laps until this settles). */
  startChargeMJ: 2,
  surfaces: [
    { id: 'frontWing', label: 'Front wing', share: 0.22, cpX: 2.4 },
    { id: 'floor', label: 'Floor', share: 0.53, cpX: -0.15 },
    { id: 'rearWing', label: 'Rear wing', share: 0.25, cpX: -2.3 },
  ] as const satisfies readonly AeroSurface[],
} as const;

/** Car-frame geometry every module agrees on (metres). */
export const CAR_FRAME = {
  frontAxleX: 1.7,
  rearAxleX: -1.7,
  /** x of the centre of gravity implied by staticFrontShare: rearAxleX + share × wheelbase. */
  cgX: -1.7 + 0.45 * 3.4,
} as const;

/** Speed range for Station 1's slider. */
export const SPEED_RANGE_KMH = { min: 0, max: 350 } as const;
