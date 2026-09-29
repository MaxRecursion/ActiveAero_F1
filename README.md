# UNSEEN — the 2026 grand-prix car, opened up

An interactive 3D explainer of the 2026 Formula 1™ car. Each **station** takes one control and makes one invisible
thing visible — drawn on the car, with live numbers and a one-line *why*.

| # | Station | Control | What becomes visible |
|---|---------|---------|----------------------|
| 01 | **Downforce** | Speed | Downforce and drag arrows growing with speed², the floor doing most of the work, and the speed at which the car could drive on the ceiling |
| 02 | **Active aero** | Speed · Corner / Straight Mode | 2026 wings opening (no DRS any more), drag vs downforce, and why top speed is where *power available* meets *power the air takes* |
| 03 | **Energy** | A lap you can scrub | The half-electric power unit: braking recovery, deployment, super clipping and a 4 MJ battery that often runs dry |

Numbers come from small, documented physics models. Regulation facts cite the FIA 2026 Technical Regulations
(Section C, Issue 20); anything not published (aero coefficients, grip, …) is labelled **estimate** in the app.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics unit tests (vitest)
npm run build      # type-check + production build into dist/
```

Requires Node 22+. The site is fully static (`dist/`), see [docs/DEPLOY.md](docs/DEPLOY.md) for hosting.

## How it's built

- **Vite + TypeScript**, **three.js** (WebGL renderer, GTAO), **camera-controls** — no UI framework.
- `src/physics/` — aero, power unit, lap simulation (unit-tested); `src/physics/constants.ts` holds every number with its source.
- `src/scene/` — stage, the car, force arrows, airflow, wind tunnel, energy flow.
- `src/stations/` — one folder per station (logic + captions); `src/app/` — routing, shared "garage" scene.
- `src/ui/` — the spec-sheet interface (DOM + hand-drawn SVG charts).
- `scripts/shot.mjs` — headless screenshots for visual checks; `scripts/model/` — the 3D model pipeline.

## Credits

- Car body model: "F1 2026 concept (polygon model)"
  (https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42) by Qvist_designs
  (https://sketchfab.com/Qvist_Designs), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
  Modified: re-meshed, split into parts, decimated, materials replaced.
- Fonts: Archivo, IBM Plex Sans Condensed, IBM Plex Mono (SIL Open Font License) via Fontsource.
- three.js and camera-controls (MIT).

## Licence

Code: GNU GPL v3 (see [LICENSE](LICENSE)). The 3D model keeps its own CC BY 4.0 licence.

## Disclaimer

UNSEEN is an independent fan project. It is unofficial and is not associated in any way with the Formula 1
companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are
trade marks of Formula One Licensing B.V. No team's car or livery is depicted.
