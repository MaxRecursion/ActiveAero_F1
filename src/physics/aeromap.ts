/**
 * Station 06 physics: the aero map, the platform and porpoising.
 *
 * A grand-prix car's downforce is not one number. It depends on how high the floor sits above the road
 * at the front and rear axles (the ride heights), and those heights fall as downforce grows because the
 * springs compress. Teams measure the dependence in the wind tunnel and keep it as an "aero map":
 * downforce, drag and balance as functions of dynamic front and rear ride height (Gadola et al. 2022).
 *
 * No team publishes a map, so this one is assembled from published pieces and the 2026 regulations:
 *  - front wing in ground effect: Zerihan's measured lift vs height/chord (Southampton PhD, 2001);
 *  - floor: Ruhrmann & Zhang's measured diffuser downforce vs throat gap (J. Fluids Eng. 2003), spread
 *    along the floor by continuity (gap small → air fast → pressure low);
 *  - rear wing: out of ground effect; only its incidence changes with the car's pitch.
 * Each surface is scaled so that at one reference attitude (REFERENCE_RIDE) the map gives exactly the
 * constant model stations 1–5 use: ClA 3.2 m², CdA 1.1 m², shares 22 / 53 / 25 %, front share ≈ 46.5 %.
 *
 * On top of the map:
 *  - platform: the car settles on its springs as speed builds — h = h_static − load / rate;
 *  - bounce: heave and pitch with the floor's force lagging the ride height by about one convective time.
 *    For slow motion, δL ≈ L_h·(δh − τ·δḣ) (L_h = ∂L/∂h, h up), so the heave equation is
 *        m·z̈ + (c − L_h·τ)·ż + (k + L_h)·z = 0.
 *    Above the floor's peak L_h < 0 (lower → more downforce): the car feels softer but better damped —
 *    it cannot porpoise there. Below the peak (stalled diffuser) L_h > 0: once the aerodynamic damping beats
 *    the dampers, a bounce grows by itself — porpoising, a Hopf bifurcation (Bauer, Papangelo & Habib,
 *    ISMA 2024; Gadola et al. 2022: onset ≈ 210 km/h at ≈ 6 Hz; Symonds: 4.8–5.4 Hz seen in 2022).
 *    At bounce frequencies the full lag gives −L_h·τ / (1 + ω²τ²), at most L_h / (2ω): only the steep drop
 *    just below the floor's peak (Ruhrmann's 0.47 → 0.43) is steep enough. τ = n_c·L/v and q ∝ v², so the
 *    onset is a speed.
 *
 * Every number is either a cited fact (regulation article, paper and figure) or an estimate, named as
 * one, with its reasoning next to it. Ride heights are in mm at the API, metres inside.
 */
import { CAR_FRAME, ESTIMATES, PHYS, REGS, SPEED_RANGE_KMH, type AeroSurfaceId } from './constants';
import type { FloorRegime, RideHeightPreset, RideHeights, Station6View } from '../ui/types';

const X_F = CAR_FRAME.frontAxleX;
const X_R = CAR_FRAME.rearAxleX;
/** Wheelbase, m (3.4 m, FIA C2.3.3). */
const WB = X_F - X_R;
const MM = 1e-3;
const DEG = Math.PI / 180;

/**
 * Every constant of the model. Coordinates: car frame, metres, +x forward, front axle at +1.7, rear axle
 * at −1.7. FIA XF (metres behind the front axle) → x = 1.7 − XF; FIA XR (behind the rear axle) → x = −1.7 − XR.
 * Ride height = height of the reference plane Z = 0 (underside of the flat floor, FIA C2.2a) above the
 * ground at an axle line — the definition aero maps use (Gadola et al. 2022).
 */
export const AEROMAP = {
  plank: {
    /** 10 ± 0.2 mm when new, upper face at Z = 0, so its underside is 10 mm below the reference plane (FIA C3.6.1a, d). */
    thicknessM: 0.01,
    /** RV-PLANK runs from XF = 430 mm … (FIA App C2 §11) */
    frontX: X_F - 0.43,
    /** … to XR = −350 mm. */
    rearX: X_R + 0.35,
    /**
     * Ground contact stiffness of the floor at the plank. Estimate built on regulation minimums: FIA
     * C3.18.7 requires the central floor to be stiffer than 3 kN/mm at the middle plank hole (and 6 kN/mm at
     * the rear hole); the front floor test (C3.18.5) asks about 1 kN/mm at XF = 500. 3 kN/mm is used at both
     * plank ends.
     */
    rateNPerMm: 3000,
  },

  frontWing: {
    /** Middle of the profile box, XF −1250 … −475 mm (FIA App C2 §22, RV-FW-PROFILES). */
    x: X_F + 0.8625,
    /** Lowest allowed profile point above Z = 0 at the centre (|Y| ≤ 100 mm), FIA App C2 §22. */
    lowestZM: 0.06,
    /**
     * Chord, m. Estimate: the regulations' minimum plan chord is 375 mm at Y = 0 inside a 775 mm box and
     * a front wing has up to three elements; 0.50 m is a round middle value.
     */
    chordM: 0.5,
    /** Span of the profiles, |Y| ≤ 675 mm (RV-FW-PROFILES). */
    spanM: 1.35,
    /**
     * Zerihan (Southampton PhD 2001, Fig. 7a; same tests as Zerihan & Zhang 2000): a single-element race
     * wing over a moving ground, free transition. CL vs height/chord; 0.69 is the freestream value
     * (h/c = 3.36), 1.72 the measured maximum at h/c = 0.082. Values between are plot readings (±0.02).
     */
    zerihanHc: [0.045, 0.06, 0.067, 0.082, 0.112, 0.134, 0.179, 0.224, 0.313, 0.447, 0.671, 3.36],
    zerihanCl: [1.61, 1.68, 1.7, 1.72, 1.7, 1.62, 1.42, 1.27, 1.09, 0.95, 0.84, 0.69],
    freestreamCl: 0.69,
    /**
     * A race wing behaves like the fixed-transition case: +117 % from freestream to maximum (Zhang, Toet &
     * Zerihan 2006, §4.5; the thesis, §6.3, gives CL_max 1.39 at h/c 0.112 with a plateau below), against
     * +149 % for the free-transition curve used here (1.72 / 0.69; the review quotes 141 %). Scaling the
     * measured gain by 117/149 (rather than 117/141) is the more conservative choice: a slightly less
     * height-sensitive wing.
     */
    fixedTransitionScale: 117 / 149,
  },

  rearWing: {
    /** RV-RW-PROFILES: span 1150 mm (|Y| ≤ 575), chord box 465 mm (XR 165 … 630), FIA App C2 §30. */
    spanM: 1.15,
    chordM: 0.465,
  },

  /** Span efficiency for the wings' induced drag. Estimate: 1.0, end plates recover what the tips lose. */
  spanEfficiency: 1,

  floor: {
    /** Front of the flat floor RS-FLOOR-REF, XF = 450 mm (FIA App C2 §34). */
    leadingEdgeX: X_F - 0.45,
    /** Diffuser inlet (throat): RS-FLOOR-REF ends at XR = −545 mm. */
    throatX: X_R + 0.545,
    /** The floor ends at XR = +300 mm (App C2 §4.20). */
    exitX: X_R - 0.3,
    /**
     * Diffuser roof height at the exit above Z = 0, m. Estimate: between the 165 mm minimum void line and
     * the 250 mm upper bound (App C2 §4.20–4.23). With the 0.845 m length the ramp is ≈ 13.3°.
     */
    exitRoofM: 0.2,
    /** Centre channel |Y| ≤ 310 mm, roof at Z = 0 (RS-FLOOR-REF). */
    centreWidthM: 0.62,
    /** Step channel RS-FLOOR-STEP, both sides together ≈ 0.50 m wide, roof at Z = 50 mm (App C2 §4.9). */
    stepWidthM: 0.5,
    stepHeightM: 0.05,
    /**
     * Diffuser width between the sidewalls at |Y| 345–400 mm (RV-FLOOR-SIDEWALL). With the channels above
     * the floor's plan area is ≈ 3.3 m², the FIA's RS-FLOOR-BODY minimum (≈ 3.33 m²).
     */
    diffuserWidthM: 0.75,
    /**
     * Ruhrmann & Zhang 2003 (J. Fluids Eng. 125), Figs 2a and 4: downforce of a bluff body with a 10°
     * diffuser over a moving ground vs η = h_t / (d·θ) (throat gap over channel half-width × ramp angle).
     * The 10° curve has no hysteresis, and the FIA calls the 2026 diffuser "lower powered". Plot readings;
     * values above η = 2 are the 5° curve's tail scaled ×1.11 to join. 0.47 → 0.43 is the measured sharp
     * loss of downforce just below the peak.
     */
    ruhrmannEta: [
      0.17, 0.23, 0.29, 0.36, 0.43, 0.47, 0.55, 0.6, 0.7, 0.8, 0.92, 1.1, 1.28, 1.46, 1.65, 1.83, 2, 2.2, 2.56,
      2.92, 3.28, 4,
    ],
    ruhrmannCl: [
      0.9, 1.06, 1.15, 1.22, 1.28, 1.57, 1.62, 1.7, 1.72, 1.7, 1.65, 1.58, 1.54, 1.38, 1.21, 1.08, 0.98, 0.87,
      0.75, 0.67, 0.61, 0.52,
    ],
    /**
     * Width, in η, over which the measured drop between η = 0.43 and 0.47 is rounded. A MODELLING CHOICE,
     * not data: the 10° measurements only bracket the drop. Two shoulder points continue the neighbouring
     * measured slopes up to the edges of a step this wide, centred in the gap, so the slope stays finite.
     * The resulting steepest slope, dF/dη ≈ 13.6 (≈ 7.9 per unit η of the normalised curve), is 1.9× the
     * straight line between the two bracketing points. Why steeper than that line: this floor's ramp is
     * ≈ 13.3°, between Ruhrmann's 10° diffuser (drop bracketed, no hysteresis) and his 15° one, whose
     * measured drop is abrupt — about −33 % of the maximum within Δη ≈ 0.023 (Fig. 3; normalised slope ≈ 14).
     * The cliff is what makes porpoising possible, and the result depends on it: with a straight-line drop
     * between the measured points the low preset's least damping ratio stays at ≈ +0.03 and it does not
     * porpoise (independent review, 2026-10). Treat the porpoising read-out as an illustration of the
     * mechanism, not a prediction.
     */
    cliffWidthEta: 0.03,
    /**
     * Measured maximum CL by diffuser angle: 1.46 (5°), 1.73 (10°), 1.95 (15°), 1.93 (20°) from the same
     * paper (Figs 2a, 4; plot readings) and 1.94 (17°) from Senior & Zhang 2001 (as tabulated in the 2006
     * review / Genua 2009). The floor's amplitude follows CL_max(θ_eff) / CL_max(10°), so pitching the
     * nose down (steeper ramp relative to the ground) adds pumping, as the high-rake era exploited.
     */
    clMaxAngleDeg: [5, 10, 15, 17, 20],
    clMax: [1.46, 1.73, 1.95, 1.94, 1.93],
    /** Maximum downforce at h_t / (d·θ) ≈ 0.7 for every angle (Ruhrmann & Zhang 2003, quoted). */
    peakEta: 0.7,
    /**
     * d_eff, m: effective half-width of one diffuser channel between fences and keel — the one free scale
     * of the floor. Estimate: the regulations allow fences at |Y| 170–310 mm and a keel to |Y| 240 mm
     * (C3.5.9, App C2 §4.21), so 0.08–0.25 m is plausible. 0.23 m puts the peak throat gap at ≈ 40 mm, so
     * the baseline set-up runs on the attached side (η ≈ 1.16 at the reference) with the measured ride-height
     * sensitivity of a ground-effect car (+0.4–0.5 % ClA per mm, cf. GP2 map +0.48 %/mm, Gadola 2022) and
     * stays attached to 350 km/h, while a low 2022-style set-up reaches the stall side before the plank lands.
     */
    channelHalfWidthM: 0.23,
    /** Diffuser exit pressure when attached. Estimate: Ruhrmann measured −0.15 … −0.3 at the exit. */
    exitCp: -0.2,
    /**
     * Pressure of the separated (flat) region. Ruhrmann's 20° diffuser at 5 mm is "flat at about −0.4"
     * once fully separated, and −0.37 at 20 mm, part separated (Fig. 6a).
     */
    stalledCp: -0.4,
    /** Separation starts at the exit at the peak (η = 0.7) and reaches the throat at η ≈ 0.3 (estimate). */
    separationStartEta: 0.7,
    separationFullEta: 0.3,
    /**
     * Edge leakage: air leaks in under the floor's edges, so the suction builds from the leading edge toward
     * the throat, λ(ξ) = λ_LE + (1 − λ_LE)·ξ^p (ξ = 0 at the leading edge, 1 at the throat). Estimates.
     * p = 8 follows Ruhrmann's centreline pressures (Fig. 6): about ⅓ of the inlet's peak suction one
     * model half-width upstream of the inlet — ξ ≈ 0.81 when scaled by the fraction of the underbody length
     * (x/d 4.0 of 4.95) — (λ 0.25–0.33) and about half at ξ ≈ 0.88 (λ 0.37–0.66); p = 8 gives
     * 0.28 and 0.43. λ_LE then sets the floor's centre of pressure at the reference to −0.45 m, the value
     * that holds the other stations' balance (calibrated to 4 digits; 0.11 → −0.46 m, 0.12 → −0.43 m).
     */
    leadingEdgeLeak: 0.1125,
    leakPower: 8,
    /** Cap on the continuity ratio (h_t / g)² so a nearly-touching floor edge cannot suck without limit (estimate). */
    ratioCap: 2.5,
    /**
     * Starvation gap δ, m: a part of the floor much closer to the ground than the throat starves of mass
     * flow, s(g) = g² / (g² + δ²). Estimate: Ruhrmann's lowest region "e" starts when the gap is of the
     * order of the underbody boundary layer; 5 mm at full scale.
     */
    starvationGapM: 0.005,
    /**
     * Drag added per unit of floor downforce, ΔCdA / ΔClA_floor. Estimate from a whole-car map: in the
     * published GP2 ground-effect map drag spans 95.8–100 % while downforce spans 76.7–100 % (Gadola et al.
     * 2022), i.e. ≈ (0.042·1.1)/(0.233·3.2) ≈ 0.06 in our units. (An isolated bluff body is steeper —
     * Ruhrmann's 10° body gives ΔCD/ΔCL ≈ 0.15 — but most of a car's drag does not come from its floor.)
     * Drag falls again past the peak. The wings' induced drag adds to this, so the whole map still spans
     * roughly −12 % … +4 % of 1.1 m², most of it at nose-up or stalled corners.
     */
    dragPerDownforce: 0.06,
    /**
     * Read-out bands (definitions, not measurements): "attached" above the band where the curve is within 2 %
     * of its maximum; "peak" from there down to the measured drop; "stalled" once on the drop itself
     * (below its rounded top, η < 0.465), where Ruhrmann's flow separates and the downforce falls away.
     */
    peakBand: 0.98,
    stalledBelowEta: 0.465,
  },

  platform: {
    /**
     * Height above the ground at which drag acts, m. Estimate: about the wheel-centre height plus a little
     * for the rear wing. Drag is reacted at the rear tyres' contact patches, so D·z/WB moves from the front
     * axle to the rear.
     */
    dragHeightM: 0.45,
  },

  bounce: {
    /**
     * Pitch radius of gyration, m. Estimate: I = m·r² with r = 1.2 m gives undamped body modes of 4.1 Hz
     * (heave) and 6.2 Hz (pitch) at rest (Symonds: bounce "around four or five hertz", pitch "maybe up to
     * seven hertz").
     */
    pitchRadiusM: 1.2,
    /**
     * Damping ratio of each axle's uncoupled bounce. Estimate at the low end of the usual 0.3–0.5 for ride
     * dampers: stiff, low aero cars run little damping to keep the tyres on the road. With 0.3 the low
     * 2022-style set-up porpoises on the floor's cliff and the baseline never does.
     */
    dampingRatio: 0.3,
    /**
     * Lag of the floor's force behind the ride height, in convective times L/v. Estimate (spec range 1–3):
     * separated diffuser flow does not re-attach instantly; Ruhrmann and Senior & Zhang report hysteresis
     * and unsteady flow below the peak. No source gives a value for a real car.
     * Why the low end: a first-order lag gives an aerodynamic damping −L_h·τ / (1 + ω²τ²), never more
     * negative than −L_h / (2ω), reached at τ = 1/ω. At 280–300 km/h and ≈ 5 Hz that is n_c ≈ 0.8–1; with
     * n_c = 3 (ωτ ≈ 3) the lag would filter the floor's response so much that even the cliff could not
     * beat ζ = 0.3 dampers.
     */
    lagConvectiveTimes: 1,
    /** Floor length the lag is measured over, leading edge to exit, m. */
    floorLengthM: 3.25,
    /** Integration substep of the time-domain bounce, s, and the most substeps one call will take. */
    maxSubstepS: 0.001,
    maxSubsteps: 100,
    /** Deterministic disturbance on reset or set-up change so an instability can show itself, mm. */
    seedMm: 0.5,
    /** Window for the peak-to-peak read-out, s. */
    amplitudeWindowS: 0.5,
  },
} as const;

/**
 * Static set-ups the UI offers (mm, reference plane above the ground at each axle, car at rest). All are
 * estimates: no 2026 set-up is published.
 *  - Baseline: inside the plausibility window the FIA Legality Setup implies (front 33–63, rear 70–130 mm,
 *    C10.1) and, as 2026 cars are expected to be (Shovlin, Tombazis), free of porpoising to 350 km/h, with
 *    the plank clear of the ground.
 *  - Low, 2022-style: the low, flatter attitude of the 2022–25 ground-effect era (static rear "in the 60mms",
 *    Allison) on the 2026 floor. At speed its throat gap falls onto the floor's cliff and it porpoises
 *    (onset ≈ 280 km/h, ≈ 5.5 Hz). The front is just high enough that the plank is still clear there.
 *  - High rake: the 2017–21 nose-down attitude (≈ 120–140 mm rear, Allison). Stable.
 */
export const RIDE_PRESETS: readonly RideHeightPreset[] = [
  { id: 'baseline', label: 'Baseline', frontMm: 40, rearMm: 95 },
  { id: 'low', label: 'Low, 2022-style', frontMm: 28, rearMm: 55 },
  { id: 'highRake', label: 'High rake', frontMm: 35, rearMm: 125 },
];

export const DEFAULT_SETUP: RideHeights = { frontMm: RIDE_PRESETS[0].frontMm, rearMm: RIDE_PRESETS[0].rearMm };

/**
 * The map point where every surface equals the constant model: the default set-up's dynamic ride heights
 * at 250 km/h, rounded to 0.5 mm (found by iterating: normalise at a guess → platform → new guess).
 */
export const REFERENCE_RIDE: RideHeights = { frontMm: 27, rearMm: 73 };

/**
 * Axes of the aero-map chart, mm: every static set-up the sliders allow and every attitude a preset
 * reaches between rest and 350 km/h (the low preset gets down to ≈ 8 / 19 mm).
 */
export const MAP_RANGE: { frontMm: [number, number]; rearMm: [number, number] } = {
  // Down to −5 mm: with the rear high, the reference plane extended to the front axle line can pass below the
  // ground at speed while the plank (which starts 430 mm behind that line) is only just touching.
  frontMm: [-5, 60],
  rearMm: [10, 150],
};

/** Ranges of the static ride-height sliders, mm. */
export const SETUP_RANGE: { frontMm: [number, number]; rearMm: [number, number] } = {
  frontMm: [20, 55],
  rearMm: [45, 140],
};

// ── Small numerical tools ──────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Monotone piecewise cubic (Fritsch–Carlson / PCHIP) through measured points: it passes through every
 * point and never overshoots between them, so a measured maximum stays the maximum.
 */
interface Monotone {
  x: Float64Array;
  y: Float64Array;
  m: Float64Array;
}

function endSlope(h0: number, h1: number, d0: number, d1: number): number {
  const s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(s) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > 3 * Math.abs(d0)) return 3 * d0;
  return s;
}

function monotone(xs: readonly number[], ys: readonly number[]): Monotone {
  const n = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const m = new Float64Array(n);
  const h = new Float64Array(n - 1);
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = (y[i + 1] - y[i]) / h[i];
  }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  m[0] = endSlope(h[0], h[1], d[0], d[1]);
  m[n - 1] = endSlope(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return { x, y, m };
}

/** Value inside the table's range (callers handle the ends). */
function monotoneAt(c: Monotone, v: number): number {
  const { x, y, m } = c;
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= v) lo = mid;
    else hi = mid;
  }
  const h = x[hi] - x[lo];
  const t = (v - x[lo]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * y[hi] + (t3 - t2) * h * m[hi]
  );
}

// ── Measured curves ────────────────────────────────────────────────────────────────────────────

const FW = AEROMAP.frontWing;
const RW = AEROMAP.rearWing;
const FL = AEROMAP.floor;

const ZERIHAN = monotone(FW.zerihanHc, FW.zerihanCl);

/** Ruhrmann's points plus the two shoulders that round the measured drop (see cliffWidthEta). */
function withRoundedCliff(): { eta: number[]; cl: number[] } {
  const eta: number[] = [...FL.ruhrmannEta];
  const cl: number[] = [...FL.ruhrmannCl];
  // The drop: the largest rise between neighbouring points, going up in η.
  let k = 1;
  for (let i = 1; i < eta.length - 1; i++) {
    const s = (cl[i + 1] - cl[i]) / (eta[i + 1] - eta[i]);
    if (s > (cl[k + 1] - cl[k]) / (eta[k + 1] - eta[k])) k = i;
  }
  const mid = 0.5 * (eta[k] + eta[k + 1]);
  const a = mid - 0.5 * FL.cliffWidthEta;
  const b = mid + 0.5 * FL.cliffWidthEta;
  const left = (cl[k] - cl[k - 1]) / (eta[k] - eta[k - 1]);
  const right = (cl[k + 2] - cl[k + 1]) / (eta[k + 2] - eta[k + 1]);
  const clA = cl[k] + left * (a - eta[k]);
  const clB = cl[k + 1] - right * (eta[k + 1] - b);
  eta.splice(k + 1, 0, a, b);
  cl.splice(k + 1, 0, clA, clB);
  return { eta, cl };
}
const ROUNDED = withRoundedCliff();
const RUHRMANN = monotone(ROUNDED.eta, ROUNDED.cl);
const CLMAX_BY_ANGLE = monotone(FL.clMaxAngleDeg, FL.clMax);

/** Zerihan's CL at height/chord hc. Above the freestream height: 0.69. Below the lowest point: the curve's end slope, never below 1.0. */
function zerihanCl(hc: number): number {
  const c = ZERIHAN;
  const n = c.x.length;
  if (hc >= c.x[n - 1]) return c.y[n - 1];
  if (hc <= c.x[0]) return Math.max(1, c.y[0] + c.m[0] * (hc - c.x[0]));
  return monotoneAt(c, hc);
}

/** Front-wing ground-effect gain over freestream, fixed-transition scaling. */
function wingGain(hc: number): number {
  return 1 + FW.fixedTransitionScale * (zerihanCl(hc) / FW.freestreamCl - 1);
}

/**
 * Ruhrmann's floor curve F(η). Above η = 4 it continues as a power law with the curve's end slope;
 * below η = 0.17 it falls linearly with the end slope (estimates: outside the measured range).
 */
export function floorCurve(eta: number): number {
  const c = RUHRMANN;
  const n = c.x.length;
  const e = Math.max(0, eta);
  if (e >= c.x[n - 1]) return c.y[n - 1] * Math.pow(e / c.x[n - 1], (c.m[n - 1] * c.x[n - 1]) / c.y[n - 1]);
  if (e <= c.x[0]) return c.y[0] + c.m[0] * (e - c.x[0]);
  return monotoneAt(c, e);
}

/** CL_max at a diffuser angle in degrees, clamped to the measured 5–20°. */
function clMaxAt(deg: number): number {
  const c = CLMAX_BY_ANGLE;
  return monotoneAt(c, clamp(deg, c.x[0], c.x[c.x.length - 1]));
}
const CLMAX_10 = clMaxAt(10);

/** Lifting-line slope of a finite wing, per radian: a = 2π / (1 + 2/AR). */
const liftSlope = (span: number, chord: number): number => (2 * Math.PI) / (1 + 2 / (span / chord));

// ── Floor geometry and quadrature ─────────────────────────────────────────────────────────────

const L_FLAT = FL.leadingEdgeX - FL.throatX;
const L_DIFF = FL.throatX - FL.exitX;
const ROOF_SLOPE = FL.exitRoofM / L_DIFF;
/** Diffuser ramp angle, rad (≈ 13.3°). */
export const DIFFUSER_ANGLE_RAD = Math.atan(ROOF_SLOPE);
/** Smallest gap the formulas use, m (keeps every ratio finite when a corner of the floor touches). */
const GAP_MIN = 0.001;
/** Smallest effective ramp angle, rad (nose far up); keeps η finite. */
const THETA_MIN = 2 * DEG;

const N_FLAT = 72;
const N_DIFF = 48;
/** Samples along the floor: 72 on the flat floor (leading edge → throat), 48 in the diffuser (throat → exit). */
export const FLOOR_SAMPLES = N_FLAT + N_DIFF;
const NODE_X = new Float64Array(FLOOR_SAMPLES);
const NODE_WT = new Float64Array(FLOOR_SAMPLES);
const NODE_LAMBDA = new Float64Array(N_FLAT);
const NODE_ROOF = new Float64Array(FLOOR_SAMPLES);

/** Trapezoid weights for nodes in decreasing x, within [from, to). */
function trapezoid(from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const left = i > from ? NODE_X[i - 1] - NODE_X[i] : 0;
    const right = i < to - 1 ? NODE_X[i] - NODE_X[i + 1] : 0;
    NODE_WT[i] = 0.5 * (left + right);
  }
}

/** Edge-leakage build-up λ(ξ), ξ = 0 at the leading edge, 1 at the throat. */
const leak = (xi: number): number => FL.leadingEdgeLeak + (1 - FL.leadingEdgeLeak) * Math.pow(xi, FL.leakPower);

{
  // Nodes crowd toward the throat, where the suction peaks and the diffuser recovers fastest.
  for (let i = 0; i < N_FLAT; i++) {
    const t = i / (N_FLAT - 1);
    const xi = 1 - (1 - t) * (1 - t);
    NODE_X[i] = FL.leadingEdgeX - xi * L_FLAT;
    NODE_LAMBDA[i] = leak(xi);
  }
  NODE_X[N_FLAT - 1] = FL.throatX;
  for (let j = 0; j < N_DIFF; j++) {
    const t = j / (N_DIFF - 1);
    const d = L_DIFF * t * t;
    NODE_X[N_FLAT + j] = FL.throatX - d;
    NODE_ROOF[N_FLAT + j] = ROOF_SLOPE * d;
  }
  NODE_X[FLOOR_SAMPLES - 1] = FL.exitX;
  NODE_ROOF[FLOOR_SAMPLES - 1] = FL.exitRoofM;
  trapezoid(0, N_FLAT);
  trapezoid(N_FLAT, FLOOR_SAMPLES);
}
let SUM_LAMBDA = 0;
for (let i = 0; i < N_FLAT; i++) SUM_LAMBDA += NODE_WT[i] * NODE_LAMBDA[i];

const starve = (g: number): number => (g * g) / (g * g + FL.starvationGapM * FL.starvationGapM);

// ── The map ───────────────────────────────────────────────────────────────────────────────────

const SURFACES = ESTIMATES.surfaces;
const FW_SHARE = SURFACES[0].share;
const FLOOR_SHARE = SURFACES[1].share;
const RW_SHARE = SURFACES[2].share;
const FW_CPX = SURFACES[0].cpX;
const RW_CPX = SURFACES[2].cpX;
const CLA_FW_REF = FW_SHARE * ESTIMATES.clA;
const CLA_FLOOR_REF = FLOOR_SHARE * ESTIMATES.clA;
const CLA_RW_REF = RW_SHARE * ESTIMATES.clA;

/** Relative incidence sensitivity of each wing, per radian of pitch: a / CL_ref (lifting line). */
const FW_PITCH_GAIN = liftSlope(FW.spanM, FW.chordM) / (CLA_FW_REF / (FW.spanM * FW.chordM));
const RW_PITCH_GAIN = liftSlope(RW.spanM, RW.chordM) / (CLA_RW_REF / (RW.spanM * RW.chordM));
/** Induced-drag factor 1 / (π·e·b²) of each wing. */
const FW_INDUCED = 1 / (Math.PI * AEROMAP.spanEfficiency * FW.spanM * FW.spanM);
const RW_INDUCED = 1 / (Math.PI * AEROMAP.spanEfficiency * RW.spanM * RW.spanM);

/** Scratch result of one map evaluation (reused: the map is evaluated thousands of times a second). */
interface MapEval {
  hF: number;
  hR: number;
  /** dh/dx along the car, m per m. */
  slope: number;
  pitch: number;
  throat: number;
  thetaEff: number;
  eta: number;
  sepFrac: number;
  sepX: number;
  cpPlateau: number;
  cpThroat: number;
  clFW: number;
  clFloor: number;
  clRW: number;
  floorX: number;
  clA: number;
  cdA: number;
  frontShare: number;
}
const ev: MapEval = {
  hF: 0,
  hR: 0,
  slope: 0,
  pitch: 0,
  throat: 0,
  thetaEff: 0,
  eta: 0,
  sepFrac: 0,
  sepX: 0,
  cpPlateau: 0,
  cpThroat: 0,
  clFW: 0,
  clFloor: 0,
  clRW: 0,
  floorX: 0,
  clA: 0,
  cdA: 0,
  frontShare: 0,
};

// Normalisation, set once below from REFERENCE_RIDE.
let PITCH_REF = 0;
let GAIN_FW_REF = 1;
let K_FLOOR = 1;

/**
 * Evaluate the map at ride heights hF, hR (m). Fills `ev`.
 *
 * Floor: the measured curve sets the floor's total for a level floor, F(η)·CL_max(θ_eff)/CL_max(10°),
 * because Ruhrmann's CL is the whole underbody's force (flat floor plus diffuser) of a level body. The
 * pressure along the floor then spreads it:
 *  - flat floor: Cp = Cp_t·λ(ξ)·min(R, (h_t/g)²)·s(g)/s(h_t) — continuity (local speed ∝ 1/gap), edge
 *    leakage λ, starvation s where the floor is far closer to the ground than the throat;
 *  - diffuser: quasi-1D recovery from Cp_t at the throat to the exit, Cp = Cp_e + (Cp_t − Cp_e)·φ,
 *    φ = [(g_t/g)² − (g_t/g_e)²] / [1 − (g_t/g_e)²]; below the peak a flat separated plateau grows from the
 *    exit forward.
 * Rake changes the gap along the floor; Π = (∫ shape at this attitude) / (∫ shape of a level floor with
 * the same throat gap) is how much more the forward floor sucks than a level one would, so
 * floor ClA = K·F(η)·A(θ)·Π, and Cp_t is whatever makes ∫ −Cp·W dx equal that.
 */
function evaluate(hF: number, hR: number): MapEval {
  const slope = (hF - hR) / WB;
  const h0 = hR - slope * X_R; // h(x) = h0 + slope·x
  const pitch = -slope;
  const ht = Math.max(GAP_MIN, h0 + slope * FL.throatX);
  const thetaEff = Math.max(THETA_MIN, DIFFUSER_ANGLE_RAD + pitch);
  const eta = ht / (FL.channelHalfWidthM * thetaEff);
  const amplitude = clMaxAt(thetaEff / DEG) / CLMAX_10;
  const sepFrac = clamp((FL.separationStartEta - eta) / (FL.separationStartEta - FL.separationFullEta), 0, 1);
  const sepX = FL.exitX + L_DIFF * sepFrac;
  const cpPlateau = FL.exitCp + (FL.stalledCp - FL.exitCp) * sepFrac;
  const sT = starve(ht);

  // Flat floor: centre channel (roof at Z = 0) and step channel (roof at Z = 50 mm).
  let uFlat = 0;
  let uFlatX = 0;
  for (let i = 0; i < N_FLAT; i++) {
    const x = NODE_X[i];
    const g = Math.max(GAP_MIN, h0 + slope * x);
    const gs = g + FL.stepHeightM;
    const rc = ht / g;
    const rs = ht / gs;
    const u =
      (NODE_LAMBDA[i] *
        (FL.centreWidthM * Math.min(FL.ratioCap, rc * rc) * starve(g) +
          FL.stepWidthM * Math.min(FL.ratioCap, rs * rs) * starve(gs))) /
      sT;
    const w = NODE_WT[i] * u;
    uFlat += w;
    uFlatX += w * x;
  }

  // Diffuser, at this attitude and (for Π) level with the same throat gap.
  const attached = FL.throatX - sepX > 1e-4;
  const roofSep = ROOF_SLOPE * (FL.throatX - sepX);
  const rSep = ht / Math.max(GAP_MIN, h0 + slope * sepX + roofSep);
  const rSep2 = rSep * rSep;
  const rSepL = ht / (ht + roofSep);
  const rSepL2 = rSepL * rSepL;
  let uDiff = 0;
  let uDiffX = 0;
  let uDiffLevel = 0;
  let vDiff = 0;
  let vDiffX = 0;
  for (let j = N_FLAT; j < FLOOR_SAMPLES; j++) {
    const x = NODE_X[j];
    let phi = 0;
    let phiL = 0;
    if (attached && x >= sepX) {
      const r = ht / Math.max(GAP_MIN, h0 + slope * x + NODE_ROOF[j]);
      phi = (r * r - rSep2) / (1 - rSep2);
      const rL = ht / (ht + NODE_ROOF[j]);
      phiL = (rL * rL - rSepL2) / (1 - rSepL2);
    }
    const w = NODE_WT[j];
    uDiff += w * phi;
    uDiffX += w * phi * x;
    uDiffLevel += w * phiL;
    vDiff += w * (1 - phi);
    vDiffX += w * (1 - phi) * x;
  }
  const gStepLevel = ht + FL.stepHeightM;
  const rStepLevel = ht / gStepLevel;
  const uLevel =
    SUM_LAMBDA *
      (FL.centreWidthM + (FL.stepWidthM * Math.min(FL.ratioCap, rStepLevel * rStepLevel) * starve(gStepLevel)) / sT) +
    FL.diffuserWidthM * uDiffLevel;
  const uAct = uFlat + FL.diffuserWidthM * uDiff;
  const attitude = uAct / uLevel;
  const clFloor = K_FLOOR * floorCurve(eta) * amplitude * attitude;

  // Fixed (exit / plateau) part of the diffuser pressure, then the throat suction that closes the integral.
  let plateau = -cpPlateau * FL.diffuserWidthM * vDiff;
  let plateauScale = 1;
  if (plateau > 0.5 * clFloor) {
    // Only at extreme nose-up attitudes: keep the throat suction at least as strong as the exit's.
    plateauScale = (0.5 * clFloor) / plateau;
    plateau = 0.5 * clFloor;
  }
  const cpThroat = -(clFloor - plateau) / uAct;
  const moment =
    -cpThroat * (uFlatX + FL.diffuserWidthM * uDiffX) - cpPlateau * plateauScale * FL.diffuserWidthM * vDiffX;

  // Wings.
  const hc = Math.max(0, FW.lowestZM + h0 + slope * FW.x) / FW.chordM;
  const clFW = (CLA_FW_REF * wingGain(hc)) / GAIN_FW_REF * Math.max(0.2, 1 + FW_PITCH_GAIN * (pitch - PITCH_REF));
  const clRW = CLA_RW_REF * Math.max(0.2, 1 + RW_PITCH_GAIN * (pitch - PITCH_REF));

  const clA = clFW + clFloor + clRW;
  const floorX = moment / clFloor;
  ev.hF = hF;
  ev.hR = hR;
  ev.slope = slope;
  ev.pitch = pitch;
  ev.throat = ht;
  ev.thetaEff = thetaEff;
  ev.eta = eta;
  ev.sepFrac = sepFrac;
  ev.sepX = sepX;
  ev.cpPlateau = cpPlateau * plateauScale;
  ev.cpThroat = cpThroat;
  ev.clFW = clFW;
  ev.clFloor = clFloor;
  ev.clRW = clRW;
  ev.floorX = floorX;
  ev.clA = clA;
  ev.cdA =
    ESTIMATES.cdA +
    (clFW * clFW - CLA_FW_REF * CLA_FW_REF) * FW_INDUCED +
    (clRW * clRW - CLA_RW_REF * CLA_RW_REF) * RW_INDUCED +
    FL.dragPerDownforce * (clFloor - CLA_FLOOR_REF);
  ev.frontShare = (clFW * (FW_CPX - X_R) + clFloor * (floorX - X_R) + clRW * (RW_CPX - X_R)) / (WB * clA);
  return ev;
}

// Normalise every surface at the reference point.
{
  const hF = REFERENCE_RIDE.frontMm * MM;
  const hR = REFERENCE_RIDE.rearMm * MM;
  PITCH_REF = (hR - hF) / WB;
  GAIN_FW_REF = wingGain((FW.lowestZM + hR + ((hF - hR) / WB) * (FW.x - X_R)) / FW.chordM);
  K_FLOOR = 1;
  K_FLOOR = CLA_FLOOR_REF / evaluate(hF, hR).clFloor;
}

/** Upper end of the "peak" band, in units of η: above it the floor reads "attached". */
const PEAK_ETA_HIGH = bandEdge(FL.peakEta, 2);
function bandEdge(a: number, b: number): number {
  const target = FL.peakBand * floorCurve(FL.peakEta);
  const rising = floorCurve(a) < floorCurve(b);
  let lo = a;
  let hi = b;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (floorCurve(mid) < target === rising) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function regimeOf(eta: number): FloorRegime {
  if (eta < FL.stalledBelowEta) return 'stalled';
  if (eta > PEAK_ETA_HIGH) return 'attached';
  return 'peak';
}

export interface MapPoint {
  frontMm: number;
  rearMm: number;
  /** Rake: nose-down pitch, degrees. */
  pitchDeg: number;
  clA: number;
  cdA: number;
  /** Share of the downforce on the front axle (0–1). */
  frontShare: number;
  surfaces: { id: AeroSurfaceId; label: string; clA: number; cpX: number }[];
  floor: {
    /** Gap at the diffuser inlet (throat), mm. */
    throatGapMm: number;
    /** Throat gap of maximum floor downforce at this pitch, 0.7·d_eff·θ_eff, mm. */
    peakGapMm: number;
    regime: FloorRegime;
    /** h_t / (d_eff·θ_eff): Ruhrmann's ride-height parameter. */
    eta: number;
    /**
     * Pressure coefficient at the throat (the deepest suction when attached). It is solved so the pressure
     * integral equals the floor's ClA, so away from the reference it can go about 25 % beyond the −1.3 … −2.4
     * Ruhrmann measured at a diffuser inlet (down to ≈ −3.0 on the chart).
     */
    throatCp: number;
    /** Where the diffuser flow separates (null when attached), m. */
    separationX: number | null;
  };
  /** Gap under the plank's lowest point at this attitude, mm (negative: the plank would be in the ground). */
  plankClearanceMm: number;
}

function plankClearance(hF: number, hR: number): number {
  const slope = (hF - hR) / WB;
  const front = hR + slope * (AEROMAP.plank.frontX - X_R);
  const rear = hR + slope * (AEROMAP.plank.rearX - X_R);
  return Math.min(front, rear) - AEROMAP.plank.thicknessM;
}

function toPoint(e: MapEval): MapPoint {
  return {
    frontMm: e.hF / MM,
    rearMm: e.hR / MM,
    pitchDeg: e.pitch / DEG,
    clA: e.clA,
    cdA: e.cdA,
    frontShare: e.frontShare,
    surfaces: [
      { id: 'frontWing', label: SURFACES[0].label, clA: e.clFW, cpX: FW_CPX },
      { id: 'floor', label: SURFACES[1].label, clA: e.clFloor, cpX: e.floorX },
      { id: 'rearWing', label: SURFACES[2].label, clA: e.clRW, cpX: RW_CPX },
    ],
    floor: {
      throatGapMm: e.throat / MM,
      peakGapMm: (FL.peakEta * FL.channelHalfWidthM * e.thetaEff) / MM,
      regime: regimeOf(e.eta),
      eta: e.eta,
      throatCp: e.cpThroat,
      separationX: e.sepFrac > 0 ? e.sepX : null,
    },
    plankClearanceMm: plankClearance(e.hF, e.hR) / MM,
  };
}

/** The aero map at one pair of (dynamic) ride heights. */
export function aeroMapAt(rh: RideHeights): MapPoint {
  return toPoint(evaluate(rh.frontMm * MM, rh.rearMm * MM));
}

export type FloorPressure = Station6View['pressure'] & {
  x: Float64Array;
  cp: Float64Array;
  /** Width each sample stands for, m: ∫ −cp·width dx over the samples equals the floor's ClA. */
  widthM: Float64Array;
  throatCp: number;
};

/** Centreline Cp (and effective width) at node i of the current evaluation `ev`. */
function nodeSection(i: number, out: { cp: number; w: number }): void {
  const x = NODE_X[i];
  sectionAt(x, i < N_FLAT ? NODE_LAMBDA[i] : 0, i < N_FLAT ? 0 : NODE_ROOF[i], i < N_FLAT, out);
}

function sectionAt(x: number, lambda: number, roof: number, flat: boolean, out: { cp: number; w: number }): void {
  const e = ev;
  const h0 = e.hR - e.slope * X_R;
  const ht = e.throat;
  if (flat) {
    const g = Math.max(GAP_MIN, h0 + e.slope * x);
    const gs = g + FL.stepHeightM;
    const rc = ht / g;
    const rs = ht / gs;
    const sT = starve(ht);
    const uc = (lambda * Math.min(FL.ratioCap, rc * rc) * starve(g)) / sT;
    const us = (lambda * Math.min(FL.ratioCap, rs * rs) * starve(gs)) / sT;
    out.cp = e.cpThroat * uc;
    out.w = FL.centreWidthM + (FL.stepWidthM * us) / uc;
    return;
  }
  let phi = 0;
  if (FL.throatX - e.sepX > 1e-4 && x >= e.sepX) {
    const roofSep = ROOF_SLOPE * (FL.throatX - e.sepX);
    const rSep = ht / Math.max(GAP_MIN, h0 + e.slope * e.sepX + roofSep);
    const r = ht / Math.max(GAP_MIN, h0 + e.slope * x + roof);
    phi = (r * r - rSep * rSep) / (1 - rSep * rSep);
  }
  out.cp = e.cpPlateau * (1 - phi) + e.cpThroat * phi;
  out.w = FL.diffuserWidthM;
}

const SECTION = { cp: 0, w: 0 };
/** Widths written when the caller reuses x / cp but brings no width array (shared between such calls). */
const SHARED_WIDTH = new Float64Array(FLOOR_SAMPLES);

/**
 * Underfloor pressure along the car's centreline, from the floor's leading edge (x high) to the diffuser
 * exit, at FLOOR_SAMPLES fixed points (denser near the throat). Pass `out` to reuse arrays (no allocation).
 */
export function floorPressure(
  rh: RideHeights,
  out?: { x: Float64Array; cp: Float64Array; widthM?: Float64Array },
): FloorPressure {
  const e = evaluate(rh.frontMm * MM, rh.rearMm * MM);
  const x = out?.x ?? new Float64Array(FLOOR_SAMPLES);
  const cp = out?.cp ?? new Float64Array(FLOOR_SAMPLES);
  const widthM = out ? (out.widthM ?? SHARED_WIDTH) : new Float64Array(FLOOR_SAMPLES);
  for (let i = 0; i < FLOOR_SAMPLES; i++) {
    nodeSection(i, SECTION);
    x[i] = NODE_X[i];
    cp[i] = SECTION.cp;
    widthM[i] = SECTION.w;
  }
  return {
    x,
    cp,
    widthM,
    throatX: FL.throatX,
    exitX: FL.exitX,
    separationX: e.sepFrac > 0 ? e.sepX : null,
    throatCp: e.cpThroat,
  };
}

/** Centreline Cp and effective width at any x on the floor (for checks and finer plots). */
export function floorSectionAt(rh: RideHeights, x: number): { cp: number; widthM: number } {
  evaluate(rh.frontMm * MM, rh.rearMm * MM);
  const xc = clamp(x, FL.exitX, FL.leadingEdgeX);
  const flat = xc >= FL.throatX;
  const xi = (FL.leadingEdgeX - xc) / L_FLAT;
  sectionAt(xc, flat ? leak(xi) : 0, flat ? 0 : ROOF_SLOPE * (FL.throatX - xc), flat, SECTION);
  return { cp: SECTION.cp, widthM: SECTION.w };
}

export interface MapGrid {
  /** Axis values, mm. */
  front: Float64Array;
  rear: Float64Array;
  /** Row-major [rear][front]: index = iRear·nFront + iFront. */
  clA: Float32Array;
  frontShare: Float32Array;
  cdA: Float32Array;
  /** 0 attached, 1 peak, 2 stalled. */
  regime: Uint8Array;
  /** 1 where the plank's underside is at or below the ground at that attitude. */
  plankOnGround: Uint8Array;
}

/** The map sampled over MAP_RANGE for the chart. */
export function aeroMapGrid(nFront: number, nRear: number): MapGrid {
  const front = new Float64Array(nFront);
  const rear = new Float64Array(nRear);
  const [f0, f1] = MAP_RANGE.frontMm;
  const [r0, r1] = MAP_RANGE.rearMm;
  for (let i = 0; i < nFront; i++) front[i] = nFront > 1 ? f0 + ((f1 - f0) * i) / (nFront - 1) : f0;
  for (let j = 0; j < nRear; j++) rear[j] = nRear > 1 ? r0 + ((r1 - r0) * j) / (nRear - 1) : r0;
  const n = nFront * nRear;
  const grid: MapGrid = {
    front,
    rear,
    clA: new Float32Array(n),
    frontShare: new Float32Array(n),
    cdA: new Float32Array(n),
    regime: new Uint8Array(n),
    plankOnGround: new Uint8Array(n),
  };
  for (let j = 0; j < nRear; j++) {
    for (let i = 0; i < nFront; i++) {
      const k = j * nFront + i;
      const e = evaluate(front[i] * MM, rear[j] * MM);
      grid.clA[k] = e.clA;
      grid.frontShare[k] = e.frontShare;
      grid.cdA[k] = e.cdA;
      const r = regimeOf(e.eta);
      grid.regime[k] = r === 'attached' ? 0 : r === 'peak' ? 1 : 2;
      grid.plankOnGround[k] = plankClearance(e.hF, e.hR) <= 0 ? 1 : 0;
    }
  }
  return grid;
}

// ── Platform: the car settling on its springs ────────────────────────────────────────────────

/** Axle ride rates including tyres, N/m (the same the braking dive uses). */
const K_F = ESTIMATES.brakes.frontAxleRateNPerMm * 1000;
const K_R = ESTIMATES.brakes.rearAxleRateNPerMm * 1000;
const K_PLANK = AEROMAP.plank.rateNPerMm * 1000;
const MASS = REGS.minMassKg.value;
const PLANK_F_SHARE = (AEROMAP.plank.frontX - X_R) / WB;
const PLANK_R_SHARE = (AEROMAP.plank.rearX - X_R) / WB;
const FW_F_SHARE = (FW_CPX - X_R) / WB;
const RW_F_SHARE = (RW_CPX - X_R) / WB;

/** Axle loads from the map at one attitude and dynamic pressure, N (downward positive). */
interface AxleLoads {
  /** Wings plus the drag pitch transfer (quasi-steady). */
  wingF: number;
  wingR: number;
  /** Floor (lags in the bounce model). */
  floorF: number;
  floorR: number;
  /** Plank contact, upward, at each axle. */
  contactF: number;
  contactR: number;
  contactN: number;
  drag: number;
}
const LOADS: AxleLoads = { wingF: 0, wingR: 0, floorF: 0, floorR: 0, contactF: 0, contactR: 0, contactN: 0, drag: 0 };

function axleLoads(hF: number, hR: number, q: number): AxleLoads {
  const e = evaluate(hF, hR);
  const fw = q * e.clFW;
  const rw = q * e.clRW;
  const fl = q * e.clFloor;
  const drag = q * e.cdA;
  const pitchTransfer = (drag * AEROMAP.platform.dragHeightM) / WB;
  const floorShare = (e.floorX - X_R) / WB;
  LOADS.wingF = fw * FW_F_SHARE + rw * RW_F_SHARE - pitchTransfer;
  LOADS.wingR = fw * (1 - FW_F_SHARE) + rw * (1 - RW_F_SHARE) + pitchTransfer;
  LOADS.floorF = fl * floorShare;
  LOADS.floorR = fl * (1 - floorShare);
  // The rigid plank touches at whichever end is lower (both, if level).
  const t = AEROMAP.plank.thicknessM;
  const penFront = t - (hR + e.slope * (AEROMAP.plank.frontX - X_R));
  const penRear = t - (hR + e.slope * (AEROMAP.plank.rearX - X_R));
  const cFront = penFront > 0 ? K_PLANK * penFront : 0;
  const cRear = penRear > 0 ? K_PLANK * penRear : 0;
  LOADS.contactF = cFront * PLANK_F_SHARE + cRear * PLANK_R_SHARE;
  LOADS.contactR = cFront + cRear - LOADS.contactF;
  LOADS.contactN = cFront + cRear;
  LOADS.drag = drag;
  return LOADS;
}

const RES = { f: 0, r: 0 };
/** Spring equilibrium residual, m: h − h_static + (aero − contact)/rate at each axle. */
function residual(hF: number, hR: number, q: number, f0: number, r0: number): typeof RES {
  const l = axleLoads(hF, hR, q);
  RES.f = hF - f0 + (l.wingF + l.floorF - l.contactF) / K_F;
  RES.r = hR - r0 + (l.wingR + l.floorR - l.contactR) / K_R;
  return RES;
}

const SOL = { hF: 0, hR: 0 };
/** Damped Newton from a guess. Returns false if it does not converge. */
function newton(q: number, f0: number, r0: number, gF: number, gR: number): boolean {
  let hF = gF;
  let hR = gR;
  let r = residual(hF, hR, q, f0, r0);
  let rf = r.f;
  let rr = r.r;
  let norm = Math.hypot(rf, rr);
  const d = 1e-6;
  for (let it = 0; it < 40; it++) {
    if (norm < 1e-9) {
      SOL.hF = hF;
      SOL.hR = hR;
      return true;
    }
    r = residual(hF + d, hR, q, f0, r0);
    const a11 = (r.f - rf) / d;
    const a21 = (r.r - rr) / d;
    r = residual(hF, hR + d, q, f0, r0);
    const a12 = (r.f - rf) / d;
    const a22 = (r.r - rr) / d;
    const det = a11 * a22 - a12 * a21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return false;
    let dF = -(a22 * rf - a12 * rr) / det;
    let dR = -(-a21 * rf + a11 * rr) / det;
    const big = Math.max(Math.abs(dF), Math.abs(dR));
    if (big > 0.004) {
      dF *= 0.004 / big;
      dR *= 0.004 / big;
    }
    let step = 1;
    let accepted = false;
    for (let k = 0; k < 12; k++) {
      r = residual(hF + step * dF, hR + step * dR, q, f0, r0);
      const n = Math.hypot(r.f, r.r);
      if (n < norm * (1 - 1e-4 * step) || n < 1e-9) {
        hF += step * dF;
        hR += step * dR;
        rf = r.f;
        rr = r.r;
        norm = n;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) return false;
  }
  if (norm < 1e-7) {
    SOL.hF = hF;
    SOL.hR = hR;
    return true;
  }
  return false;
}

/**
 * Fallback: let the car settle (an under-relaxed fixed point, h ← h − α·residual), which only ever finds
 * equilibria a real car could rest on, then polish with Newton. α = 0.08 keeps the iteration contracting
 * even with the plank in contact (its 3 kN/mm is ≈ 10× an axle rate).
 */
function settle(q: number, f0: number, r0: number, gF: number, gR: number): void {
  let hF = gF;
  let hR = gR;
  for (let it = 0; it < 4000; it++) {
    const r = residual(hF, hR, q, f0, r0);
    if (Math.hypot(r.f, r.r) < 1e-8) break;
    hF -= 0.08 * r.f;
    hR -= 0.08 * r.r;
  }
  if (!newton(q, f0, r0, hF, hR)) {
    SOL.hF = hF;
    SOL.hR = hR;
  }
}

const dynamicPressureKmh = (kmh: number): number => 0.5 * PHYS.rho * (Math.max(0, kmh) / 3.6) ** 2;

/** Continuation from speed a to b (km/h), starting at the equilibrium (gF, gR) found at a. Writes SOL. */
function continueTo(a: number, b: number, f0: number, r0: number, gF: number, gR: number, depth = 0): void {
  if (newton(dynamicPressureKmh(b), f0, r0, gF, gR)) return;
  if (depth < 6 && b - a > 0.2) {
    const mid = 0.5 * (a + b);
    continueTo(a, mid, f0, r0, gF, gR, depth + 1);
    continueTo(mid, b, f0, r0, SOL.hF, SOL.hR, depth + 1);
    return;
  }
  settle(dynamicPressureKmh(b), f0, r0, gF, gR);
}

/** Equilibria on a 10 km/h ladder for a few recent set-ups, so the per-frame solve is one short step. */
const LADDER_STEP = 10;
const LADDER_N = 41; // 0 … 400 km/h
interface Ladder {
  f0: number;
  r0: number;
  hF: Float64Array;
  hR: Float64Array;
  filled: number;
}
const ladders: Ladder[] = [];

function ladderFor(f0: number, r0: number): Ladder {
  for (let i = 0; i < ladders.length; i++) {
    const l = ladders[i];
    if (l.f0 === f0 && l.r0 === r0) {
      if (i > 0) {
        ladders.splice(i, 1);
        ladders.unshift(l);
      }
      return l;
    }
  }
  const l: Ladder = { f0, r0, hF: new Float64Array(LADDER_N), hR: new Float64Array(LADDER_N), filled: 0 };
  // At rest the car sits on its static ride heights (unless the plank is in the ground).
  if (!newton(0, f0, r0, f0, r0)) settle(0, f0, r0, f0, r0);
  l.hF[0] = SOL.hF;
  l.hR[0] = SOL.hR;
  l.filled = 1;
  ladders.unshift(l);
  if (ladders.length > 6) ladders.pop();
  return l;
}

/** Equilibrium ride heights (m) at a speed, following the branch the car reaches from rest. Writes SOL. */
function equilibrium(speedKmh: number, f0: number, r0: number): typeof SOL {
  const v = clamp(speedKmh, 0, LADDER_STEP * (LADDER_N - 1));
  const l = ladderFor(f0, r0);
  const k = Math.floor(v / LADDER_STEP);
  while (l.filled <= k) {
    const i = l.filled;
    continueTo((i - 1) * LADDER_STEP, i * LADDER_STEP, f0, r0, l.hF[i - 1], l.hR[i - 1]);
    l.hF[i] = SOL.hF;
    l.hR[i] = SOL.hR;
    l.filled++;
  }
  if (v === k * LADDER_STEP) {
    SOL.hF = l.hF[k];
    SOL.hR = l.hR[k];
  } else {
    continueTo(k * LADDER_STEP, v, f0, r0, l.hF[k], l.hR[k]);
  }
  return SOL;
}

export interface Platform {
  speedKmh: number;
  /** Dynamic pressure, Pa. */
  q: number;
  setup: RideHeights;
  /** Ride heights at speed, mm. */
  dynamic: RideHeights;
  point: MapPoint;
  downforceN: number;
  dragN: number;
  dragPowerW: number;
  surfaces: { id: AeroSurfaceId; label: string; downforceN: number }[];
  /** Aero load on each axle including the drag pitch transfer, N. */
  frontAxleAeroN: number;
  rearAxleAeroN: number;
  /** Gap under the plank's lowest point, mm (0 or less: touching). */
  plankClearanceMm: number;
  /** Force of the ground on the plank, N. */
  plankContactN: number;
  bottoming: boolean;
}

/**
 * The car at a steady speed: ride heights where springs balance aero load (and the plank, if it touches).
 * Linear springs, no bump stops (a simplification: real cars stiffen near the end of travel).
 */
export function platformAt(speedKmh: number, setup: RideHeights): Platform {
  const kmh = Math.max(0, speedKmh);
  const q = dynamicPressureKmh(kmh);
  const sol = equilibrium(kmh, setup.frontMm * MM, setup.rearMm * MM);
  const hF = sol.hF;
  const hR = sol.hR;
  const l = axleLoads(hF, hR, q);
  const point = toPoint(ev);
  const clearance = plankClearance(hF, hR);
  return {
    speedKmh: kmh,
    q,
    setup: { frontMm: setup.frontMm, rearMm: setup.rearMm },
    dynamic: { frontMm: hF / MM, rearMm: hR / MM },
    point,
    downforceN: q * point.clA,
    dragN: l.drag,
    dragPowerW: (l.drag * kmh) / 3.6,
    surfaces: point.surfaces.map((s) => ({ id: s.id, label: s.label, downforceN: q * s.clA })),
    frontAxleAeroN: l.wingF + l.floorF,
    rearAxleAeroN: l.wingR + l.floorR,
    plankClearanceMm: Math.max(0, clearance / MM),
    plankContactN: l.contactN,
    bottoming: clearance <= 0,
  };
}

/** The platform from rest to `toKmh` in steps of `stepKmh`. */
export function platformSweep(setup: RideHeights, toKmh: number = SPEED_RANGE_KMH.max, stepKmh = 5): Platform[] {
  const out: Platform[] = [];
  const n = Math.max(1, Math.round(toKmh / stepKmh));
  for (let i = 0; i <= n; i++) out.push(platformAt((toKmh * i) / n, setup));
  return out;
}

// ── Bounce: heave + pitch with a lagged floor ────────────────────────────────────────────────

const B = AEROMAP.bounce;
/** CG position as a share of the wheelbase from the rear axle (0.45: the front axle carries 45 %). */
const BETA_F = (CAR_FRAME.cgX - X_R) / WB;
const BETA_R = 1 - BETA_F;
const INERTIA = MASS * B.pitchRadiusM * B.pitchRadiusM;
/**
 * Mass matrix in axle ride-height coordinates (h_F, h_R): heave y = β_F·h_F + β_R·h_R, pitch (h_F − h_R)/WB.
 * Axle rates include the tyres, so the whole 770 kg is treated as sprung (a simplification).
 */
const M11 = MASS * BETA_F * BETA_F + INERTIA / (WB * WB);
const M12 = MASS * BETA_F * BETA_R - INERTIA / (WB * WB);
const M22 = MASS * BETA_R * BETA_R + INERTIA / (WB * WB);
const M_DET = M11 * M22 - M12 * M12;
const MI11 = M22 / M_DET;
const MI12 = -M12 / M_DET;
const MI22 = M11 / M_DET;
/** Axle dampers giving each uncoupled axle bounce the damping ratio ζ, N·s/m. */
const C_F = 2 * B.dampingRatio * Math.sqrt(K_F * MASS * BETA_F);
const C_R = 2 * B.dampingRatio * Math.sqrt(K_R * MASS * BETA_R);

/** Floor lag time constant τ = n_c·L/v, s. */
const lagTime = (speedMs: number): number => (B.lagConvectiveTimes * B.floorLengthM) / Math.max(1, speedMs);

/** Physical constants of the bounce model (for the About sheet and tests). */
export const BOUNCE_MODEL = {
  massKg: MASS,
  pitchInertiaKgM2: INERTIA,
  frontDamperNsPerM: C_F,
  rearDamperNsPerM: C_R,
  lagTimeS: (speedKmh: number) => lagTime(speedKmh / 3.6),
} as const;

/**
 * Eigenvalues of a small real n×n matrix (row-major): balance, reduce to Hessenberg form with Householder
 * reflections, then shifted QR iterations in complex arithmetic with deflation.
 */
export function eigenvalues(a: ArrayLike<number>, n: number): { re: Float64Array; im: Float64Array } {
  const out = { re: new Float64Array(n), im: new Float64Array(n) };
  eigenInto(a, n, new Float64Array(n * n), new Float64Array(n * n), out.re, out.im);
  return out;
}

/** eigenvalues() into caller-owned work arrays (hr, hi: n×n; re, im: n). */
function eigenInto(
  a: ArrayLike<number>,
  n: number,
  hr: Float64Array,
  hi: Float64Array,
  re: Float64Array,
  im: Float64Array,
): void {
  for (let i = 0; i < n * n; i++) {
    hr[i] = a[i];
    hi[i] = 0;
  }
  balance(hr, n);
  hessenberg(hr, n);
  hessenbergQR(hr, hi, n, re, im);
}

/** Diagonal similarity scaling (powers of 2) so rows and columns have comparable norms. */
function balance(a: Float64Array, n: number): void {
  let done = false;
  for (let sweep = 0; sweep < 100 && !done; sweep++) {
    done = true;
    for (let i = 0; i < n; i++) {
      let c = 0;
      let r = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        c += Math.abs(a[j * n + i]);
        r += Math.abs(a[i * n + j]);
      }
      if (c === 0 || r === 0) continue;
      const s = c + r;
      let f = 1;
      let g = r / 2;
      while (c < g) {
        f *= 2;
        c *= 4;
      }
      g = r * 2;
      while (c > g) {
        f /= 2;
        c /= 4;
      }
      if ((c + r) / f < 0.95 * s) {
        done = false;
        for (let j = 0; j < n; j++) a[i * n + j] /= f;
        for (let j = 0; j < n; j++) a[j * n + i] *= f;
      }
    }
  }
}

/** Scratch for the eigen-solver: the Householder vector, then the Givens rotations (4n numbers). */
let EIG_WORK = new Float64Array(64);
function eigWork(n: number): Float64Array {
  if (EIG_WORK.length < 4 * n) EIG_WORK = new Float64Array(4 * n);
  return EIG_WORK;
}

/** Householder reduction to upper Hessenberg form (similarity, in place). */
function hessenberg(a: Float64Array, n: number): void {
  const v = eigWork(n);
  for (let k = 0; k < n - 2; k++) {
    let norm = 0;
    for (let i = k + 1; i < n; i++) norm += a[i * n + k] * a[i * n + k];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = a[(k + 1) * n + k] > 0 ? -norm : norm;
    let vv = 0;
    for (let i = k + 1; i < n; i++) {
      v[i] = a[i * n + k] - (i === k + 1 ? alpha : 0);
      vv += v[i] * v[i];
    }
    if (vv === 0) continue;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = k + 1; i < n; i++) s += v[i] * a[i * n + j];
      s *= 2 / vv;
      for (let i = k + 1; i < n; i++) a[i * n + j] -= s * v[i];
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = k + 1; j < n; j++) s += a[i * n + j] * v[j];
      s *= 2 / vv;
      for (let j = k + 1; j < n; j++) a[i * n + j] -= s * v[j];
    }
    for (let i = k + 2; i < n; i++) a[i * n + k] = 0;
  }
}

/**
 * Shifted QR on an upper Hessenberg matrix in complex arithmetic (hr + i·hi), Wilkinson shift from the
 * trailing 2×2, Givens rotations, deflation when a subdiagonal entry becomes negligible.
 */
function hessenbergQR(hr: Float64Array, hi: Float64Array, n: number, re: Float64Array, im: Float64Array): void {
  const EPS = 2.220446049250313e-16;
  // Rotation k: cosine at w[n + k], sine (complex) at w[2n + k] + i·w[3n + k].
  const w = eigWork(n);
  let norm = 0;
  for (let i = 0; i < n * n; i++) norm += Math.abs(hr[i]);
  let last = n - 1;
  let iter = 0;
  while (last >= 0) {
    // Find the start of the unreduced block that ends at `last`.
    let lo = last;
    while (lo > 0) {
      const sub = Math.hypot(hr[lo * n + lo - 1], hi[lo * n + lo - 1]);
      let diag = Math.hypot(hr[(lo - 1) * n + lo - 1], hi[(lo - 1) * n + lo - 1]) + Math.hypot(hr[lo * n + lo], hi[lo * n + lo]);
      if (diag === 0) diag = norm;
      if (sub <= EPS * diag) {
        hr[lo * n + lo - 1] = 0;
        hi[lo * n + lo - 1] = 0;
        break;
      }
      lo--;
    }
    if (lo === last) {
      re[last] = hr[last * n + last];
      im[last] = hi[last * n + last];
      last--;
      iter = 0;
      continue;
    }
    if (++iter > 200) {
      for (let i = 0; i <= last; i++) {
        re[i] = NaN;
        im[i] = NaN;
      }
      return;
    }
    // Shift: eigenvalue of the trailing 2×2 closest to its bottom-right entry.
    const ar = hr[(last - 1) * n + last - 1];
    const ai = hi[(last - 1) * n + last - 1];
    const br = hr[(last - 1) * n + last];
    const bi = hi[(last - 1) * n + last];
    const cr = hr[last * n + last - 1];
    const ci = hi[last * n + last - 1];
    const dr = hr[last * n + last];
    const di = hi[last * n + last];
    let mr: number;
    let mi: number;
    if (iter % 11 === 10) {
      // Exceptional shift to break a cycle.
      mr = dr + Math.hypot(cr, ci);
      mi = di;
    } else {
      const hr2 = 0.5 * (ar - dr);
      const hi2 = 0.5 * (ai - di);
      // disc = sqrt(((a − d)/2)² + b·c)
      const zr = hr2 * hr2 - hi2 * hi2 + (br * cr - bi * ci);
      const zi = 2 * hr2 * hi2 + (br * ci + bi * cr);
      const mod = Math.hypot(zr, zi);
      let qr = Math.sqrt(0.5 * (mod + Math.abs(zr)));
      let qi = qr === 0 ? 0 : zi / (2 * qr);
      if (zr < 0) {
        const t = qr;
        qr = Math.abs(qi);
        qi = zi >= 0 ? t : -t;
      }
      const tr = 0.5 * (ar + dr);
      const ti = 0.5 * (ai + di);
      const m1r = tr + qr;
      const m1i = ti + qi;
      const m2r = tr - qr;
      const m2i = ti - qi;
      if (Math.hypot(m1r - dr, m1i - di) <= Math.hypot(m2r - dr, m2i - di)) {
        mr = m1r;
        mi = m1i;
      } else {
        mr = m2r;
        mi = m2i;
      }
    }
    for (let k = lo; k <= last; k++) {
      hr[k * n + k] -= mr;
      hi[k * n + k] -= mi;
    }
    // H − μI = QR with Givens rotations from the left …
    for (let k = lo; k < last; k++) {
      const xr = hr[k * n + k];
      const xi = hi[k * n + k];
      const yr = hr[(k + 1) * n + k];
      const yi = hi[(k + 1) * n + k];
      const ax = Math.hypot(xr, xi);
      const r = Math.hypot(ax, Math.hypot(yr, yi));
      let c = 1;
      let s1 = 0;
      let s2 = 0;
      if (r > 0) {
        c = ax / r;
        // s = (x/|x|)·conj(y)/r, with x/|x| = 1 when x = 0
        const pr = ax > 0 ? xr / ax : 1;
        const pi = ax > 0 ? xi / ax : 0;
        s1 = (pr * yr + pi * yi) / r;
        s2 = (pi * yr - pr * yi) / r;
      }
      w[n + k] = c;
      w[2 * n + k] = s1;
      w[3 * n + k] = s2;
      for (let j = lo; j <= last; j++) {
        const pr = hr[k * n + j];
        const pi = hi[k * n + j];
        const qr = hr[(k + 1) * n + j];
        const qi = hi[(k + 1) * n + j];
        // row k ← c·p + s·q ; row k+1 ← −conj(s)·p + c·q
        hr[k * n + j] = c * pr + (s1 * qr - s2 * qi);
        hi[k * n + j] = c * pi + (s1 * qi + s2 * qr);
        hr[(k + 1) * n + j] = -(s1 * pr + s2 * pi) + c * qr;
        hi[(k + 1) * n + j] = -(s1 * pi - s2 * pr) + c * qi;
      }
    }
    // … then RQ: the conjugate-transposed rotations from the right.
    for (let k = lo; k < last; k++) {
      const c = w[n + k];
      const s1 = w[2 * n + k];
      const s2 = w[3 * n + k];
      for (let i = lo; i <= last; i++) {
        const pr = hr[i * n + k];
        const pi = hi[i * n + k];
        const qr = hr[i * n + k + 1];
        const qi = hi[i * n + k + 1];
        // col k ← c·p + conj(s)·q ; col k+1 ← −s·p + c·q
        hr[i * n + k] = c * pr + (s1 * qr + s2 * qi);
        hi[i * n + k] = c * pi + (s1 * qi - s2 * qr);
        hr[i * n + k + 1] = -(s1 * pr - s2 * pi) + c * qr;
        hi[i * n + k + 1] = -(s1 * pi + s2 * pr) + c * qi;
      }
    }
    for (let k = lo; k <= last; k++) {
      hr[k * n + k] += mr;
      hi[k * n + k] += mi;
    }
  }
}

export interface BounceMode {
  /** Damped frequency of the least-damped oscillatory body mode, Hz. */
  frequencyHz: number;
  /** Its damping ratio: negative means the bounce grows by itself. */
  dampingRatio: number;
  unstable: boolean;
}

/** Scale for the lagged floor-load states in the linear system, N (keeps the matrix well balanced). */
const LOAD_SCALE = 1e4;
const A6 = new Float64Array(36);
const EIG_HR = new Float64Array(36);
const EIG_HI = new Float64Array(36);
const EIG_RE = new Float64Array(6);
const EIG_IM = new Float64Array(6);
const JQ = new Float64Array(4);
const JP = new Float64Array(4);

/** Quasi-steady (wings, drag, plank) and floor load Jacobians at an attitude, N/m, by central differences. */
function loadJacobians(hF: number, hR: number, q: number): void {
  const d = 2e-5;
  for (let c = 0; c < 2; c++) {
    const pF = c === 0 ? d : 0;
    const pR = c === 1 ? d : 0;
    let l = axleLoads(hF + pF, hR + pR, q);
    const qF = l.wingF - l.contactF;
    const qR = l.wingR - l.contactR;
    const fF = l.floorF;
    const fR = l.floorR;
    l = axleLoads(hF - pF, hR - pR, q);
    JQ[c] = (qF - (l.wingF - l.contactF)) / (2 * d);
    JQ[2 + c] = (qR - (l.wingR - l.contactR)) / (2 * d);
    JP[c] = (fF - l.floorF) / (2 * d);
    JP[2 + c] = (fR - l.floorR) / (2 * d);
  }
}

/**
 * Eigenvalues of the heave + pitch system linearised at the platform equilibrium:
 * state (h_F, h_R, ḣ_F, ḣ_R, floor load F, floor load R),
 *   M·ḧ = −(K + J_Q)·h − C·ḣ − p,   τ·ṗ = J_P·h − p
 * J_Q: wings, drag pitch transfer and plank (instant); J_P: the floor (lagged by τ).
 */
function linearEigen(speedKmh: number, setup: RideHeights): { re: Float64Array; im: Float64Array } {
  const kmh = Math.max(0, speedKmh);
  const q = dynamicPressureKmh(kmh);
  const sol = equilibrium(kmh, setup.frontMm * MM, setup.rearMm * MM);
  loadJacobians(sol.hF, sol.hR, q);
  const tau = lagTime(kmh / 3.6);
  const kq11 = K_F + JQ[0];
  const kq12 = JQ[1];
  const kq21 = JQ[2];
  const kq22 = K_R + JQ[3];
  A6.fill(0);
  const set = (i: number, j: number, v: number) => {
    A6[i * 6 + j] = v;
  };
  set(0, 2, 1);
  set(1, 3, 1);
  // ḧ = −M⁻¹(K + J_Q)·h − M⁻¹C·ḣ − M⁻¹·p   (p in units of LOAD_SCALE)
  set(2, 0, -(MI11 * kq11 + MI12 * kq21));
  set(2, 1, -(MI11 * kq12 + MI12 * kq22));
  set(3, 0, -(MI12 * kq11 + MI22 * kq21));
  set(3, 1, -(MI12 * kq12 + MI22 * kq22));
  set(2, 2, -MI11 * C_F);
  set(2, 3, -MI12 * C_R);
  set(3, 2, -MI12 * C_F);
  set(3, 3, -MI22 * C_R);
  set(2, 4, -MI11 * LOAD_SCALE);
  set(2, 5, -MI12 * LOAD_SCALE);
  set(3, 4, -MI12 * LOAD_SCALE);
  set(3, 5, -MI22 * LOAD_SCALE);
  set(4, 0, JP[0] / (tau * LOAD_SCALE));
  set(4, 1, JP[1] / (tau * LOAD_SCALE));
  set(5, 0, JP[2] / (tau * LOAD_SCALE));
  set(5, 1, JP[3] / (tau * LOAD_SCALE));
  set(4, 4, -1 / tau);
  set(5, 5, -1 / tau);
  eigenInto(A6, 6, EIG_HR, EIG_HI, EIG_RE, EIG_IM);
  return { re: EIG_RE, im: EIG_IM };
}

/** Every oscillatory body mode (heave- and pitch-like) at a speed, lowest frequency first. */
export function bodyModes(speedKmh: number, setup: RideHeights): BounceMode[] {
  const { re, im } = linearEigen(speedKmh, setup);
  const modes: BounceMode[] = [];
  for (let i = 0; i < re.length; i++) {
    const w = Math.hypot(re[i], im[i]);
    if (!(im[i] > 1e-6 * w) || w === 0) continue;
    const zeta = -re[i] / w;
    modes.push({ frequencyHz: im[i] / (2 * Math.PI), dampingRatio: zeta, unstable: zeta < 0 });
  }
  return modes.sort((a, b) => a.frequencyHz - b.frequencyHz);
}

/**
 * Body modes (heave and pitch of the car on its springs) sit at 3.5–7 Hz. When the plank touches, a stiff
 * plank-contact mode near 16 Hz appears: that is the floor bearing on the ground, not the car bouncing, so
 * the read-out leaves it out unless it is the one growing.
 */
const BODY_MODE_MAX_HZ = 10;

/** The least-damped body mode at a speed: its frequency, damping ratio and whether it grows (porpoising). */
export function bounceModes(speedKmh: number, setup: RideHeights): BounceMode {
  const { re, im } = linearEigen(speedKmh, setup);
  let best = Infinity;
  let freq = 0;
  let worstAny = Infinity;
  let worstAnyFreq = 0;
  for (let i = 0; i < re.length; i++) {
    const w = Math.hypot(re[i], im[i]);
    if (!(im[i] > 1e-6 * w) || w === 0) continue;
    const zeta = -re[i] / w;
    const hz = im[i] / (2 * Math.PI);
    if (zeta < worstAny) {
      worstAny = zeta;
      worstAnyFreq = hz;
    }
    if (hz < BODY_MODE_MAX_HZ && zeta < best) {
      best = zeta;
      freq = hz;
    }
  }
  if (worstAny < 0 && worstAny < best) return { frequencyHz: worstAnyFreq, dampingRatio: worstAny, unstable: true };
  if (best === Infinity) return { frequencyHz: 0, dampingRatio: 1, unstable: false };
  return { frequencyHz: freq, dampingRatio: best, unstable: best < 0 };
}

/**
 * Lowest speed (km/h) at which the set-up porpoises — its least-damped mode goes unstable — or null if it
 * stays stable up to maxKmh. A 2 km/h scan, then bisection to 0.1 km/h.
 */
export function porpoiseOnsetKmh(setup: RideHeights, maxKmh: number = SPEED_RANGE_KMH.max): number | null {
  const step = 2;
  let prev = 0;
  for (let v = step; v <= maxKmh + 1e-9; v += step) {
    if (bounceModes(v, setup).unstable) {
      let lo = prev;
      let hi = v;
      while (hi - lo > 0.1) {
        const mid = 0.5 * (lo + hi);
        if (bounceModes(mid, setup).unstable) hi = mid;
        else lo = mid;
      }
      return Math.round(hi * 10) / 10;
    }
    prev = v;
  }
  return null;
}

/**
 * The speeds between which the set-up porpoises, [onset, end] km/h, or null if it never does up to maxKmh.
 * The window can close again: further down the stall side the floor's slope flattens, and once the plank
 * is on the road the ground holds the car. A 2 km/h scan, then bisection at each edge; the first window.
 */
export function porpoiseRangeKmh(setup: RideHeights, maxKmh: number = SPEED_RANGE_KMH.max): [number, number] | null {
  const onset = porpoiseOnsetKmh(setup, maxKmh);
  if (onset === null) return null;
  const step = 2;
  let prev = onset;
  for (let v = onset + step; v <= maxKmh + 1e-9; v += step) {
    if (!bounceModes(v, setup).unstable) {
      let lo = prev;
      let hi = v;
      while (hi - lo > 0.1) {
        const mid = 0.5 * (lo + hi);
        if (bounceModes(mid, setup).unstable) lo = mid;
        else hi = mid;
      }
      return [onset, Math.round(lo * 10) / 10];
    }
    prev = v;
  }
  return [onset, maxKmh];
}

export interface BounceSim {
  /** Start at the platform equilibrium for this set-up and speed, plus a small fixed disturbance. */
  reset(setup: RideHeights, speedKmh: number): void;
  /** Advance by dt seconds (at most maxSubsteps × 1 ms are simulated per call). */
  step(dt: number, speedKmh: number, setup: RideHeights): void;
  /** Ride heights now, mm (the same object every call). */
  readonly rideHeights: RideHeights;
  /** Largest peak-to-peak swing of either axle about its equilibrium over the last 0.5 s, mm. */
  readonly amplitudeMm: number;
}

/**
 * Time-domain heave + pitch: the full nonlinear map at the instantaneous ride heights, the floor's force
 * lagging by τ, the plank's contact, RK4 with ≤ 1 ms substeps. When the set-up is stable it settles on the
 * platform; when not, the bounce grows until the floor curve's shape bounds it.
 * Honest scale: the limit cycle is small — about 2 mm peak to peak (≈ 0.06° of pitch) for the low preset —
 * because only the narrow rounded cliff (cliffWidthEta) destabilises the car and the 10° data have no
 * hysteresis loop to widen it; the plank is not reached. Real 2022 porpoising was far larger (Gadola et al.
 * 2022 model > 1° of pitch, ±0.6 g). The station must draw it exaggerated and say so.
 */
export function createBounceSim(): BounceSim {
  const s = new Float64Array(6); // hF, hR, vF, vR, pF, pR (m, m/s, N)
  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const k3 = new Float64Array(6);
  const k4 = new Float64Array(6);
  const tmp = new Float64Array(6);
  const SAMPLE_S = 0.005;
  const nSamples = Math.round(B.amplitudeWindowS / SAMPLE_S);
  const devF = new Float64Array(nSamples);
  const devR = new Float64Array(nSamples);
  let head = 0;
  let count = 0;
  let clock = 0;
  let f0 = DEFAULT_SETUP.frontMm * MM;
  let r0 = DEFAULT_SETUP.rearMm * MM;
  const rh: RideHeights = { frontMm: f0 / MM, rearMm: r0 / MM };

  const deriv = (x: Float64Array, q: number, tau: number, out: Float64Array) => {
    const l = axleLoads(x[0], x[1], q);
    const fF = K_F * (f0 - x[0]) - C_F * x[2] - (l.wingF - l.contactF) - x[4];
    const fR = K_R * (r0 - x[1]) - C_R * x[3] - (l.wingR - l.contactR) - x[5];
    out[0] = x[2];
    out[1] = x[3];
    out[2] = MI11 * fF + MI12 * fR;
    out[3] = MI12 * fF + MI22 * fR;
    out[4] = (l.floorF - x[4]) / tau;
    out[5] = (l.floorR - x[5]) / tau;
  };

  const seed = () => {
    s[0] += B.seedMm * MM;
    s[1] -= B.seedMm * MM;
  };

  const sync = () => {
    rh.frontMm = s[0] / MM;
    rh.rearMm = s[1] / MM;
  };

  const sim: BounceSim = {
    reset(setup, speedKmh) {
      f0 = setup.frontMm * MM;
      r0 = setup.rearMm * MM;
      const kmh = Math.max(0, speedKmh);
      const sol = equilibrium(kmh, f0, r0);
      s[0] = sol.hF;
      s[1] = sol.hR;
      s[2] = 0;
      s[3] = 0;
      const l = axleLoads(sol.hF, sol.hR, dynamicPressureKmh(kmh));
      s[4] = l.floorF;
      s[5] = l.floorR;
      seed();
      head = 0;
      count = 0;
      clock = 0;
      sync();
    },
    step(dt, speedKmh, setup) {
      const nf = setup.frontMm * MM;
      const nr = setup.rearMm * MM;
      if (nf !== f0 || nr !== r0) {
        f0 = nf;
        r0 = nr;
        seed();
      }
      const kmh = Math.max(0, speedKmh);
      const q = dynamicPressureKmh(kmh);
      const tau = lagTime(kmh / 3.6);
      const total = clamp(dt, 0, B.maxSubstepS * B.maxSubsteps);
      const n = Math.ceil(total / B.maxSubstepS - 1e-9);
      if (n <= 0) return;
      const h = total / n;
      const eq = equilibrium(kmh, f0, r0);
      const eqF = eq.hF;
      const eqR = eq.hR;
      for (let it = 0; it < n; it++) {
        deriv(s, q, tau, k1);
        for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
        deriv(tmp, q, tau, k2);
        for (let i = 0; i < 6; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
        deriv(tmp, q, tau, k3);
        for (let i = 0; i < 6; i++) tmp[i] = s[i] + h * k3[i];
        deriv(tmp, q, tau, k4);
        for (let i = 0; i < 6; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        clock += h;
        if (clock >= SAMPLE_S) {
          clock -= SAMPLE_S;
          devF[head] = s[0] - eqF;
          devR[head] = s[1] - eqR;
          head = (head + 1) % nSamples;
          if (count < nSamples) count++;
        }
      }
      sync();
    },
    get rideHeights() {
      return rh;
    },
    get amplitudeMm() {
      if (count === 0) return 0;
      let fMin = Infinity;
      let fMax = -Infinity;
      let rMin = Infinity;
      let rMax = -Infinity;
      for (let i = 0; i < count; i++) {
        fMin = Math.min(fMin, devF[i]);
        fMax = Math.max(fMax, devF[i]);
        rMin = Math.min(rMin, devR[i]);
        rMax = Math.max(rMax, devR[i]);
      }
      return Math.max(fMax - fMin, rMax - rMin) / MM;
    },
  };
  return sim;
}
