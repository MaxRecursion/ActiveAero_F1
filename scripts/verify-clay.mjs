#!/usr/bin/env node
/**
 * Proves that choosing Clay again puts the studio finish back exactly. Renders the clay car, cycles the
 * picker through every team scheme (and the keyboard shortcut L), returns to Clay, renders again, and compares
 * the two frames pixel by pixel. Runs the real app in headless Chrome on the GPU.
 *
 *   node scripts/verify-clay.mjs [--out <dir>]
 */
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const outDir = resolve(root, outIdx > 0 ? process.argv[outIdx + 1] : 'shots/verify-clay');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
await server.listen();
const { port } = server.httpServer.address();
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--mute-audio'],
});

const problems = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Shader Error|ERROR:/.test(m.text())) problems.push(m.text().slice(0, 200));
  });
  await page.evaluateOnNewDocument(() => {
    try {
      // Start from a clean slate once; a reload must keep what the picker stored.
      if (!sessionStorage.getItem('verify-started')) {
        sessionStorage.setItem('verify-started', '1');
        localStorage.removeItem('unseen-livery');
        localStorage.setItem('unseen-theme', 'light');
      }
    } catch {}
  });
  await page.goto(`http://127.0.0.1:${port}/index.html#/downforce`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction('window.__ready === true && window.__app', { timeout: 60000 });
  await page.addStyleTag({ content: '#ui,.label-layer,.fx-tag{visibility:hidden !important}' });
  const frames = (n) => page.evaluate((c) => new Promise((done) => { let k = 0; const off = window.__app.stage.onFrame(() => { if (++k >= c) { off(); done(); } }); }), n);
  const still = async (name) => {
    await page.evaluate(() => {
      const g = window.__app.garage;
      g.setAirflow(false);
      g.setForceArrows(false);
      // The rolling road's dashes scroll with time; hide it so only the car is compared.
      g.tunnel.road.visible = false;
      window.__app.stage.goTo('hero', false);
    });
    await frames(90);
    const buf = await page.screenshot();
    writeFileSync(resolve(outDir, `${name}.png`), buf);
    return buf.toString('base64');
  };
  const pick = async (id) => {
    await page.evaluate((i) => document.querySelector(`[data-livery="${i}"]`).click(), id);
    await frames(10);
  };

  // Every material on the live car: finish and shader hooks, as a string.
  const digest = () =>
    page.evaluate(() => {
      const out = [];
      window.__app.car.root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          out.push(
            JSON.stringify([
              o.name || o.parent?.name,
              m.type,
              m.color?.getHex(),
              m.roughness,
              m.metalness,
              m.emissive?.getHex(),
              m.emissiveIntensity,
              m.vertexColors,
              m.side,
              m.transparent,
              m.opacity,
              m.depthWrite,
              m.onBeforeCompile.toString(),
              m.customProgramCacheKey.toString(),
              Object.keys(m.userData).sort(),
            ]),
          );
        }
      });
      return out;
    });
  const digestBefore = await digest();
  const before = await still('clay-before');
  const control = await still('clay-control');
  const seen = new Set();
  for (const id of ['mersedez', 'redbul', 'ferarri', 'mclaran']) {
    await pick(id);
    seen.add(await still(`${id}`));
  }
  if (seen.size !== 4) problems.push(`the four schemes did not render four different images (${seen.size})`);
  const digestPainted = await digest();
  if (digestPainted.join() === digestBefore.join()) problems.push('a scheme left the materials unchanged (nothing was painted)');
  await pick('clay');
  const digestAfter = await digest();
  const changed = digestBefore.filter((d, i) => d !== digestAfter[i]).length;
  console.log(`materials on the car: ${digestBefore.length}; differing from the first clay state after cycling every scheme: ${changed}`);
  if (digestBefore.length !== digestAfter.length || changed) problems.push(`clay materials are not restored exactly (${changed} differ)`);
  const after = await still('clay-after');

  const compare = (a, b) => page.evaluate(async (a, b) => {
    const load = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = `data:image/png;base64,${b64}`; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const da = read(ia);
    const db = read(ib);
    let n = 0;
    let max = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) n++;
      if (d > max) max = d;
    }
    return { differing: n, max, total: da.length / 4 };
  }, a, b);
  const baseline = await compare(before, control);
  console.log(`control: two clay frames with nothing touched differ by ${baseline.differing} pixels (max ${baseline.max})`);
  const diff = await compare(before, after);
  console.log(`clay before vs after cycling every scheme: ${diff.differing} of ${diff.total} pixels differ (largest channel difference ${diff.max})`);
  // Whole-frame equality is not available (temporal AO noise moves edge pixels between any two frames); stay within that noise.
  if (diff.differing > baseline.differing * 1.03) problems.push(`the clay frame changed beyond the noise floor (${diff.differing} vs ${baseline.differing} pixels)`);

  // The L shortcut: five presses return to the same scheme, and the choice is remembered like the theme.
  const sequence = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('l');
    await frames(3);
    sequence.push(await page.evaluate(() => document.querySelector('.livery-btn[aria-pressed="true"]').dataset.livery));
  }
  console.log(`L cycles: ${sequence.join(' → ')}`);
  if (sequence.join() !== 'mersedez,redbul,ferarri,mclaran,clay') problems.push(`L did not cycle through the schemes in order: ${sequence.join()}`);
  await page.keyboard.press('l');
  await frames(3);
  const stored = await page.evaluate(() => localStorage.getItem('unseen-livery'));
  console.log(`remembered choice: ${stored}`);
  if (stored !== 'mersedez') problems.push(`choice not remembered (got ${stored})`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  const restored = await page.evaluate(() => document.querySelector('.livery-btn[aria-pressed="true"]').dataset.livery);
  console.log(`after reload the picker shows: ${restored}`);
  if (restored !== 'mersedez') problems.push(`stored choice not applied at start (got ${restored})`);
} finally {
  await browser.close();
  await server.close();
}
console.log(problems.length ? `FAIL: ${problems.join('; ')}` : 'PASS');
process.exit(problems.length ? 1 : 0);
