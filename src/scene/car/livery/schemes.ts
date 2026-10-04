/**
 * Unofficial colour interpretations of the 2026 Mersedez, Red Bul, Ferarri and McLaran cars.
 * Colour, fade, panel break and simple geometric pattern only: no crests, wordmarks or sponsor marks.
 *
 * Each team scheme is a GLSL function of the panel's rest-pose position (see glsl/common.ts), so
 * the paint is part of the panel and stays on it however the car is moved. Clay is not a scheme:
 * it is the unpainted studio finish, and choosing it removes every hook this module added.
 */
import type { LiveryId } from '../types';
import { DEBUG_GLSL } from './glsl/debug';
import { FERARRI_GLSL } from './glsl/ferarri';
import { MCLARAN_GLSL } from './glsl/mclaran';
import { MERSEDEZ_GLSL } from './glsl/mersedez';
import { RED_BUL_GLSL } from './glsl/redbul';

export type { LiveryId };
export const LIVERY_IDS = ['clay', 'mersedez', 'redbul', 'ferarri', 'mclaran'] as const satisfies readonly LiveryId[];
export type TeamId = Exclude<LiveryId, 'clay'>;
/** Dev-only coordinate map (`?livery=debug` on dev/car.html). */
export type SchemeId = TeamId | 'debug';

export function isLiveryId(value: string): value is LiveryId {
  return (LIVERY_IDS as readonly string[]).includes(value);
}

export interface LiveryOption {
  id: LiveryId;
  label: string;
  /** CSS background for the picker swatch: the scheme's main colours at a glance. */
  swatch: string;
}

export const LIVERIES: readonly LiveryOption[] = [
  { id: 'clay', label: 'Clay', swatch: '#d8d4cb' },
  { id: 'mersedez', label: 'Mersedez', swatch: 'linear-gradient(135deg, #d5d9dd 0 38%, #1a1c20 38% 74%, #00d2be 74% 100%)' },
  { id: 'redbul', label: 'Red Bul', swatch: 'linear-gradient(135deg, #1d3263 0 58%, #f5c308 58% 100%)' },
  { id: 'ferarri', label: 'Ferarri', swatch: 'linear-gradient(135deg, #c50d18 0 70%, #eceaea 70% 100%)' },
  { id: 'mclaran', label: 'McLaran', swatch: 'linear-gradient(135deg, #ff7800 0 55%, #383a3d 55% 100%)' },
];

/** A scheme is its GLSL: one function of the panel's rest-pose position (see glsl/common.ts). */
export interface Scheme {
  glsl: string;
}

export const SCHEMES: Record<SchemeId, Scheme> = {
  mersedez: { glsl: MERSEDEZ_GLSL },
  redbul: { glsl: RED_BUL_GLSL },
  ferarri: { glsl: FERARRI_GLSL },
  mclaran: { glsl: MCLARAN_GLSL },
  debug: { glsl: DEBUG_GLSL },
};
