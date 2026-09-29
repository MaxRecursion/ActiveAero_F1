#!/usr/bin/env node
/**
 * Several camera views of one dev/model.html page load (the 40 MB source takes seconds to parse, so
 * shot.mjs per view is slow). Cameras are read off the page's `window.__stage`.
 *
 *   node scripts/model/views.mjs "<page?query>" <out-prefix> <name=px,py,pz,tx,ty,tz>... [--size WxH]
 *   → <out-prefix>-<name>.png ; a bare <name> uses the stage preset of that name (hero, side, …).
 */
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
let size = '1400x800';
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size') size = args[++i];
  else pos.push(args[i]);
}
const [pagePath, prefix, ...views] = pos;
if (!pagePath || !prefix || views.length === 0) {
  console.error('usage: node scripts/model/views.mjs "<page?query>" <out-prefix> <name[=cam]>... [--size WxH]');
  process.exit(2);
}
const [width, height] = size.split('x').map(Number);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.listen();
const { port } = server.httpServer.address();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/${pagePath.replace(/^\//, '')}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__modelLoaded === true', { timeout: 120000 });
  mkdirSync(dirname(resolve(root, prefix)), { recursive: true });
  for (const v of views) {
    const [name, cam] = v.split('=');
    await page.evaluate(
      async (name, cam) => {
        const s = window.__stage;
        s.controls.maxDistance = 100;
        if (cam) {
          const c = cam.split(',').map(Number);
          await s.controls.setLookAt(c[0], c[1], c[2], c[3], c[4], c[5], false);
        } else await s.goTo(name, false);
      },
      name,
      cam ?? '',
    );
    await new Promise((r) => setTimeout(r, 900));
    const out = `${prefix}-${name}.png`;
    await page.screenshot({ path: resolve(root, out) });
    console.log(`[views] ${out}`);
  }
} finally {
  await browser.close();
  await server.close();
}
