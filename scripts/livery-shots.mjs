#!/usr/bin/env node
/**
 * Screenshots of the running app (index.html) in each paint scheme, from chosen cameras and in
 * chosen states, so paint can be judged by eye. One browser, one dev server, many shots.
 *
 *   node scripts/livery-shots.mjs --out <dir> --liveries mersedez,redbul --shots hero,side,top,hero:explode
 *       [--size 1280x800] [--ui] [--gpu] [--wait 1200] [--theme light|dark]
 *
 * Shot spec:  <view>[:<state>[+<state>…]]   view = hero|side|front|rear|top|low|ceiling or
 *             nose|fwing|pod|cover|topcover|rear34|hero_left|rearwing|pit (close-ups, see EXTRA) or
 *             cam=px/py/pz/tx/ty/tz (a custom camera);   state = explode | xray | ceiling | highlight=frontWing,nose
 *  explode and ceiling use the Downforce station (#/downforce), xray uses the Energy station (#/energy),
 *  the same buttons and keys a reader uses. Livery 'clay' is the unpainted default; 'debug' is the
 *  dev coordinate map. Without --ui the interface is hidden so the car fills the frame.
 */
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { size: '1280x800', wait: '1200', liveries: 'clay', shots: 'hero', out: 'shots/livery', theme: 'light' };
const flags = new Set();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--ui' || a === '--gpu') flags.add(a.slice(2));
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
}
const [width, height] = opt.size.split('x').map(Number);
const outDir = resolve(root, opt.out);
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.listen();
const { port } = server.httpServer.address();

const chromeArgs = ['--hide-scrollbars', '--ignore-gpu-blocklist'];
chromeArgs.push(...(flags.has('gpu') ? ['--use-angle=metal', '--enable-gpu-rasterization'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: chromeArgs });
let failed = false;

/** Extra cameras beyond the stage's own: [position, target]. */
const EXTRA = {
  nose: [[5.2, 1.3, 3.2], [2.2, 0.4, 0]],
  fwing: [[4.6, 0.9, 2.2], [2.5, 0.2, 0]],
  pod: [[2.6, 1.5, 3.4], [-0.3, 0.55, 0.3]],
  cover: [[-3.8, 2.4, 2.4], [-0.9, 0.8, 0]],
  topcover: [[-0.8, 5, 1.2], [-0.8, 0.7, 0]],
  rear34: [[-6.2, 2.0, 4.5], [-0.5, 0.55, 0]],
  hero_left: [[6.46, 2.56, -7.44], [0.1, 0.4, 0]],
  rearwing: [[-5.5, 1.6, 2.0], [-2.2, 0.7, 0]],
  pit: [[3.8, 1.0, 5.2], [0.2, 0.5, 0]],
};

const frames = (page, n) =>
  page.evaluate(
    (count) =>
      new Promise((done) => {
        let seen = 0;
        const off = window.__app.stage.onFrame(() => {
          if (++seen >= count) {
            off();
            done();
          }
        });
      }),
    n,
  );

try {
  for (const livery of opt.liveries.split(',')) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('GL Driver Message') || text.includes('favicon')) return;
      if (['error', 'warn', 'warning'].includes(msg.type())) {
        if (/Shader Error|VALIDATE_STATUS|useProgram|program not valid|ERROR:/.test(text)) failed = true;
        console.log(`[console.${msg.type()}] ${text.slice(0, 600)}`);
      }
    });
    page.on('pageerror', (err) => {
      failed = true;
      console.log(`[pageerror] ${err.message}`);
    });
    await page.evaluateOnNewDocument(
      (id, theme) => {
        try {
          localStorage.setItem('unseen-livery', id === 'debug' ? 'clay' : id);
          localStorage.setItem('unseen-theme', theme);
        } catch {}
      },
      livery,
      opt.theme,
    );
    await page.goto(`http://127.0.0.1:${port}/index.html#/downforce`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction('window.__ready === true && window.__app', { timeout: 60000 });
    if (!flags.has('ui')) await page.addStyleTag({ content: '#ui,.label-layer,.fx-tag{visibility:hidden !important}' });
    if (livery === 'debug') await page.evaluate(() => window.__app.car.setLivery('debug'));

    let station = 'downforce';
    for (const spec of opt.shots.split(',')) {
      const [view, stateSpec = ''] = spec.split(':');
      const states = stateSpec ? stateSpec.split('+') : [];
      const want = states.includes('xray') ? 'energy' : 'downforce';
      if (station !== want) {
        await page.evaluate((h) => (location.hash = h), `#/${want}`);
        await page.waitForFunction((w) => window.__app.station === w, { timeout: 10000 }, want);
        station = want;
        await frames(page, 6);
      }
      // reset toggles to a plain car
      await page.evaluate(() => {
        const g = window.__app.garage;
        g.setExploded(false);
        g.setCeiling(false);
        g.setXray(false);
        g.setAirflow(false);
        g.setForceArrows(false);
        window.__app.car.setHighlight(null);
      });
      for (const s of states) {
        if (s === 'explode') await page.evaluate(() => window.__app.garage.setExploded(true));
        else if (s === 'ceiling') await page.evaluate(() => window.__app.garage.setCeiling(true));
        else if (s === 'xray') await page.evaluate(() => window.__app.garage.setXray(true));
        else if (s.startsWith('highlight=')) await page.evaluate((ids) => window.__app.car.setHighlight(ids.split(',')), s.slice(10));
      }
      await page.waitForFunction(
        (e, c) => (!e || window.__app.garage.explodeT > 0.995) && (!c || window.__app.garage.flipT > 0.995),
        { timeout: 90000, polling: 250 },
        states.includes('explode'),
        states.includes('ceiling'),
      );
      await frames(page, 6);
      await page.evaluate((v, extra) => {
        const stage = window.__app.stage;
        if (extra[v]) stage.goTo({ position: extra[v][0], target: extra[v][1] }, false);
        else if (v.startsWith('cam=')) {
          const [px, py, pz, tx, ty, tz] = v.slice(4).split('/').map(Number);
          stage.goTo({ position: [px, py, pz], target: [tx, ty, tz] }, false);
        } else stage.goTo(v, false);
      }, view, EXTRA);
      await frames(page, 8);
      await new Promise((r) => setTimeout(r, Number(opt.wait)));
      const name = `${livery}-${view.replace(/[^a-z0-9./-]/gi, '_')}${states.length ? '-' + states.join('+').replace(/[^a-z0-9+=,]/gi, '') : ''}.png`;
      await page.screenshot({ path: resolve(outDir, name) });
      console.log(`[shot] ${name}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
