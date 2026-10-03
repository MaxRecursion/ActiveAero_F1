/**
 * "How it works", Station 04 — braking. Every figure is read from src/physics/braking.ts and the
 * estimates in constants.ts, so the page always agrees with the simulation.
 */
import { aeroState } from '../physics/aero';
import { brakingState, simulateBrakeZone } from '../physics/braking';
import { ESTIMATES, REGS } from '../physics/constants';
import { assumptionsTable, formula, list, p, para, pct, row, section, tag } from './aboutParts';
import { h } from './dom';
import { fmtC, fmtG, fmtKN, fmtKW, fmtKmh, fmtMJ2, fmtMetres, fmtMm, fmtRatio, fmtS } from './format';

/** The zone the text describes: braking from the end of a fast straight. */
const EXAMPLE_KMH = 300;
/** A slow speed to compare with, where the wings hardly help. */
const SLOW_KMH = 100;

/** Disc temperatures are guesses, so they are quoted to the nearest ten. */
const tens = (c: number) => fmtC(Math.round(c / 10) * 10);
const B = ESTIMATES.brakes;
const WINDOW_C = B.workingWindowC;
const kmhText = (kmh: number) => `${fmtKmh(kmh)} km/h`;

export function brakingSections(): HTMLElement[] {
  const zone = simulateBrakeZone(EXAMPLE_KMH);
  const fast = brakingState(EXAMPLE_KMH);
  const slow = brakingState(SLOW_KMH);
  const apex = brakingState(B.apexKmh);
  const weightN = aeroState(EXAMPLE_KMH).weightN;
  const motor = REGS.mguKMaxKw;
  const harvestStart = pct(fast.harvestShare);
  const harvestEnd = pct(apex.harvestShare);
  return [
    section('13', "What you're seeing", [
      p(`Pick a speed to brake from, then press Brake. The car brakes flat out, with the pedal fully down, to a slow corner at ${kmhText(B.apexKmh)}. The faster it starts, the harder it stops.`),
      p('The nose dips because braking throws weight forward: the front tyres carry more and the rear tyres less. The dip is drawn several times bigger than the real one so you can see it; the panel says how many times.'),
      para([
        ['energy', 'Green'],
        ' is braking power the motor-generator puts back into the battery. ',
        ['heat', 'Red'],
        ' is braking power that becomes heat in the carbon discs, which glow as they warm. See-through wheels lets you look at them. The chart is the whole stop, second by second: drag along it, or use the arrow keys, to move the car through the stop.',
      ]),
    ]),
    section('14', 'The model', [
      p('A point-mass car in a straight line, pedal fully down, wings closed:'),
      h('div', 'formulas formulas--stacked', [
        formula('F', 'μ_long · (m·g + L)', 'the most force the tyres can give: grip times everything pressing the car onto the road'),
        formula('a', '(F + D) / m', 'the tyres and the air both slow the car'),
        formula('P', 'F · v', 'power the brakes take out of the car; the air takes D · v on top'),
        formula('ΔN', 'm · a · h / wheelbase', 'load moved from the rear axle to the front; h is the centre-of-gravity height'),
        formula('bias', 'front load / total load', 'the ideal share of the braking at the front'),
      ]),
      list([
        `Why early braking is so hard: downforce grows with the square of the speed. At ${kmhText(EXAMPLE_KMH)} the wings press the car down with about ${fmtKN(fast.downforceN)} kN, ${fmtRatio(fast.downforceN / weightN)} times its weight, so the tyres can hold about ${fmtG(fast.decelG)} g. At ${kmhText(SLOW_KMH)} the wings press with only ${fmtKN(slow.downforceN)} kN and the same tyres hold about ${fmtG(slow.decelG)} g. The stop is fiercest at the start and eases as the car slows and the downforce fades.`,
        `Weight transfer: the car's weight acts ${Math.round(ESTIMATES.cgHeightM * 100)} cm above the road, so braking pushes load onto the front tyres. At ${kmhText(EXAMPLE_KMH)} about ${fmtKN(fast.transferN)} kN moves from the rear axle to the front, and the nose dips ${fmtMm(fast.noseDropM * 1000)} mm.`,
        `Brake balance: the best split of the braking between front and rear follows the load on each axle, so no tyre locks before the others. It is the front axle's share of the total load: ${pct(fast.frontShare)} % at ${kmhText(EXAMPLE_KMH)}, and it moves as the load moves.`,
        `Harvest or heat: at ${kmhText(EXAMPLE_KMH)} the brakes take about ${fmtKW(fast.brakePowerW)} kW out of the car. The motor-generator drives the rear axle only and can take back at most ${motor.value} kW (FIA ${motor.ref}), about ${harvestStart} % of it. The rest turns into heat in the discs. As the car slows the power falls and the motor's share grows, to about ${harvestEnd} % at ${kmhText(B.apexKmh)}.`,
        `Disc temperature: carbon-carbon discs work best between about ${WINDOW_C.min} and ${WINDOW_C.max} °C. They start at ${B.startDiscC} °C; in this stop the front discs peak near ${tens(zone.peakFrontDiscC)} °C and the rear discs near ${tens(zone.peakRearDiscC)} °C (estimates). The front works harder because it carries more of the load.`,
      ]),
      p(`Result: from ${kmhText(EXAMPLE_KMH)} to ${kmhText(B.apexKmh)} takes ${fmtS(zone.timeS)} s and ${fmtMetres(zone.distanceM)} m, with a peak of ${fmtG(zone.peakDecelG)} g. The car sheds ${fmtMJ2(zone.kineticMJ)} MJ: the air takes ${fmtMJ2(zone.dragMJ)} MJ, the battery gets back ${fmtMJ2(zone.harvestMJ)} MJ and the discs turn ${fmtMJ2(zone.heatMJ)} MJ into heat.`),
    ]),
    section('15', 'Assumptions', [
      p(`Apart from the car's minimum mass, which the rules set, only two numbers here are quoted from public sources: the ${motor.value} kW motor limit and the carbon-carbon working window. Everything else is an estimate, a round guess that gives sensible results.`),
      assumptionsTable([
        row('Corner speed the stop ends at', kmhText(B.apexKmh), tag('estimate', 'Estimate')),
        row('Tyre grip, braking, μ_long', String(ESTIMATES.gripLongitudinal), tag('estimate', 'Estimate')),
        row('Minimum mass, with driver (724 kg + about 46 kg of tyres)', `${REGS.minMassKg.value} kg`, tag('reg', `Reg ${REGS.minMassKg.ref} + tyre estimate`)),
        row('Downforce area, ClA (wings closed)', `${ESTIMATES.clA} m²`, tag('estimate', 'Estimate')),
        row('Centre-of-gravity height', `${ESTIMATES.cgHeightM} m`, tag('estimate', 'Estimate')),
        row('Share of the weight on the front axle', `${pct(ESTIMATES.staticFrontShare)} %`, tag('estimate', 'Estimate')),
        row('Electric motor (MGU-K) maximum, all of it at the rear axle', `${motor.value} kW`, tag('reg', `Reg ${motor.ref}`)),
        row('Carbon-carbon working window', `${WINDOW_C.min}–${WINDOW_C.max} °C`, tag('phys', 'Public reports')),
        row('Disc temperature when the pedal goes down', `${B.startDiscC} °C`, tag('estimate', 'Estimate')),
        row('Disc mass, front / rear (each)', `${B.frontDiscKg} / ${B.rearDiscKg} kg`, tag('estimate', 'Estimate')),
        row('Specific heat of the discs', `${B.discSpecificHeat} J/(kg·K)`, tag('estimate', 'Estimate')),
        row('Share of the brake heat that warms the disc', String(B.discHeatShare), tag('estimate', 'Estimate')),
        row(`Cooling of each disc, per kelvin above the air (${B.ambientC} °C)`, `${B.discCoolingWPerK} W`, tag('estimate', 'Estimate')),
        row('Ride rate of the front / rear axle', `${B.frontAxleRateNPerMm} / ${B.rearAxleRateNPerMm} N/mm`, tag('estimate', 'Estimate')),
      ]),
    ]),
    section('16', 'What is simplified', [
      list([
        'The car is a point in a straight line with the pedal fully down all the way; there is no driver, no anti-lock system and no lock-up.',
        'The brake balance is always the ideal one. Real cars set a fixed balance and adjust it by hand.',
        'The wings stay closed and the downforce follows the speed. Nothing is drawn from the battery limits of Station 03: the motor may always take what the rear brake gives it, up to its limit.',
        'Each axle has one disc temperature, one lump with one cooling figure. Real discs have hot spots, pads, calipers and ducts that change with speed.',
        'The nose dip is small in reality, a few millimetres, and is drawn much bigger. Its size comes from the load moved and an estimated ride rate.',
      ]),
    ]),
  ];
}
