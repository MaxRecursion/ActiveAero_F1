# Hosting on Cloudflare Pages

UNSEEN is a fully static site: `npm run build` writes plain HTML, JS, CSS, fonts and the car model to `dist/`.
There is no server code, no API and no database, so static hosting on **Cloudflare Pages** fits exactly.

## Plan at a glance

| Step | Who | What |
|------|-----|------|
| 1 | you | Cloudflare account (free plan is enough) |
| 2 | you | Workers & Pages → Create → Pages → **Connect to Git** → pick `MaxRecursion/ActiveAero_F1` (installs the Cloudflare GitHub app) |
| 3 | you / me | Build settings below → **Save and Deploy** |
| 4 | me | Check the preview URL: model loads, headers/CSP OK, no console errors, phone + desktop |
| 5 | you | Decide on the production URL (`*.pages.dev` or a custom domain) |

After that, every push to `main` deploys to production and every other branch / pull request gets its own preview URL
(`<branch>.<project>.pages.dev`), with a status check on the PR.

## Build settings

| Setting | Value |
|---------|-------|
| Framework preset | None (or "Vite") |
| Build command | `npm test && npm run build` — the physics tests gate every deploy |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | from `.node-version` (22) — or set `NODE_VERSION=22` |
| Environment variables | none needed |

Pages installs dependencies from `package-lock.json` automatically before the build. `puppeteer-core` and the model tools are
dev-only and download nothing heavy.

**Project name → URL.** The project name becomes the subdomain. Pick one without "F1" (Formula One Licensing's guidelines
ask fan projects not to use its marks in names or domains), e.g. `unseen-aero` → `https://unseen-aero.pages.dev`.

## What's already in the repo

- `.node-version` — pins Node 22 for the build image.
- `public/_headers` — copied to `dist/_headers`; Pages applies it:
  - `/assets/*` cached for a year (`immutable` — Vite fingerprints every file name),
  - `/models/*` cached for a day with background revalidation (the model keeps a fixed name),
  - security headers on every response: `nosniff`, a strict referrer policy, a locked-down `Permissions-Policy`,
    `COOP same-origin`, and a Content-Security-Policy that only allows the site's own files. `'wasm-unsafe-eval'` is there
    for the meshopt model decoder (WebAssembly); `style-src 'unsafe-inline'` covers the inline styles the 3D label layer sets; `font-src data:` covers the tiny font subsets Vite inlines.
- Routing is hash-based (`#/downforce`, `#/active-aero`, `#/energy`), so no `_redirects` or SPA fallback is needed.
- Vite `base: './'`, so the build also works from any sub-path.

## Limits that matter (free plan)

| Limit | Value | UNSEEN today |
|-------|-------|--------------|
| Max file size | 25 MiB | largest file: car model 1.2 MB; JS bundle 1.1 MB (296 KB gzip) |
| Files per deploy | 20,000 | ≈ 50 |
| Builds per month | 500 | — |
| Bandwidth | unmetered for static assets | — |

Keep `models/source/` (the 40 MB original) out of the repo — it is git-ignored; only the processed `public/models/car.glb` ships.

## Before the first production deploy

- [x] Real car body integrated and `car.glb` ≤ 3 MB (1.2 MB)
- [ ] `npm run build && npx wrangler pages dev dist` locally — confirms `_headers` + CSP don't block anything
- [ ] Preview deploy checked on desktop Chrome/Safari/Firefox and a phone (WebGL 2 required)
- [ ] Open Graph image (`og:image`) for link previews
- [ ] Optional: Cloudflare **Web Analytics** (cookie-free) — one toggle in the Pages project

## Alternatives (not needed now)

- **GitHub Actions + `wrangler pages deploy dist`** (`cloudflare/wrangler-action`): more control over CI; needs
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. Worth it only if the build grows extra steps.
- **Workers static assets**: Cloudflare's newer recommended home for new projects; same static `dist/`, configured with a
  `wrangler.jsonc`. Easy to move to later — nothing in the app depends on Pages specifically.
