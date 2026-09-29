/**
 * Canvas-drawn textures for the rolling road: the belt surface (fine markings that make its
 * motion readable) and the metre ruler along the deck (a spec-sheet scale that makes the car's
 * real size readable: wheelbase 3.4 m spans exactly the ticks from -1.7 to +1.7).
 */
import * as THREE from 'three';
import { PALETTE } from '../palette';

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** Belt texture tile length along x (m). The texture spans the full belt width across v. */
export const BELT_TILE_M = 1;

/**
 * One metre of belt. Canvas x runs along the belt (the direction of travel); canvas y runs
 * across it. Transverse hairlines and edge-lane dashes are what the eye tracks as the belt moves.
 */
export function createBeltTexture(beltWidthM: number): THREE.CanvasTexture {
  const W = 512;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const pxX = W / BELT_TILE_M;
  const pxZ = H / beltWidthM;

  g.fillStyle = css(PALETTE.belt);
  g.fillRect(0, 0, W, H);

  // Fine grain so the belt reads as a woven/rubber surface, not flat plastic.
  const grain = g.getImageData(0, 0, W, H);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    grain.data[i] += n;
    grain.data[i + 1] += n;
    grain.data[i + 2] += n;
  }
  g.putImageData(grain, 0, 0);

  const mark = css(PALETTE.beltMarking);
  g.fillStyle = mark;
  // Transverse hairlines every 0.25 m, full width.
  g.globalAlpha = 0.09;
  for (let x = 0; x < BELT_TILE_M; x += 0.25) g.fillRect(x * pxX, 0, 2, H);

  // Edge-lane dashes just outside the tyre tracks (|z| ≈ 1.03 m), every 0.5 m.
  g.globalAlpha = 0.5;
  for (const z of [0.12, beltWidthM - 0.12]) {
    for (let x = 0; x < BELT_TILE_M; x += 0.5) {
      g.fillRect(x * pxX, (z - 0.015) * pxZ, 0.16 * pxX, 0.03 * pxZ);
    }
  }
  // Centreline: a longer, quieter dash once per metre.
  g.globalAlpha = 0.28;
  g.fillRect(0.25 * pxX, (beltWidthM / 2) * pxZ - 0.01 * pxZ, 0.3 * pxX, 0.02 * pxZ);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Faces the ruler uses; load them before the final draw. */
export const RULER_FONTS = ['500 56px "IBM Plex Mono"', '600 24px "IBM Plex Sans Condensed"'];

export interface Ruler {
  texture: THREE.CanvasTexture;
  /** Redraw once the webfont is available (the first draw may use a fallback face). */
  redraw(): void;
}

/**
 * Metre ruler, centred on the car frame origin: ticks every 0.1 m, longer every 0.5 m,
 * numbers every metre. It is printed on the deck's vertical side face, which the default
 * cameras see nearly face-on (a flat ruler on the deck top is too foreshortened to read).
 * Canvas top = the top edge of the deck.
 */
export function createRulerTexture(lengthM: number, heightM: number): Ruler {
  const PX = 1000; // px per metre, both axes, so type is not stretched
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(lengthM * PX);
  canvas.height = Math.round(heightM * PX);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const paper = '#f4f2ed';
  const ink = '#16181d';
  const ink3 = '#868b96';

  function redraw() {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = paper;
    g.fillRect(0, 0, W, H);
    // Datum hairline along the top edge.
    g.fillStyle = ink;
    g.fillRect(0, 0, W, 2);

    const half = lengthM / 2;
    for (let i = Math.ceil(-half * 10); i <= Math.floor(half * 10); i++) {
      const x = (i / 10 + half) * PX;
      const metre = i % 10 === 0;
      const halfMetre = i % 5 === 0;
      const h = (metre ? 0.046 : halfMetre ? 0.032 : 0.02) * PX;
      const w = metre ? 3 : 2;
      g.fillStyle = metre || halfMetre ? ink : ink3;
      g.fillRect(x - w / 2, 0, w, h);
    }

    g.fillStyle = ink;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.font = `500 ${Math.round(0.056 * PX)}px "IBM Plex Mono", ui-monospace, monospace`;
    for (let m = Math.ceil(-half); m <= Math.floor(half); m++) {
      const label = m < 0 ? `\u2212${-m}` : String(m);
      g.fillText(label, (m + half) * PX + 0.008 * PX, 0.056 * PX);
    }
    // Axis note at the front end, small caps like a drawing title block.
    g.fillStyle = ink3;
    g.textAlign = 'right';
    g.font = `600 ${Math.round(0.024 * PX)}px "IBM Plex Sans Condensed", system-ui, sans-serif`;
    g.fillText('X  [M]   ROLLING ROAD', W - 0.03 * PX, 0.062 * PX);
    texture.needsUpdate = true;
  }
  redraw();
  return { texture, redraw };
}
