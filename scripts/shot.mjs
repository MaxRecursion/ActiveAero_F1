#!/usr/bin/env node
/**
 * Headless screenshot of any page in this project, with console errors printed.
 * Starts its own Vite dev server on a free port, so several can run at once.
 *
 *   node scripts/shot.mjs <page-path?query> <out.png> [--size 1440x900] [--wait 2500] [--mobile] [--no-webgl]
 *
 * Examples:
 *   node scripts/shot.mjs "dev/car.html?view=hero" shots/car-hero.png
 *   node scripts/shot.mjs "index.html" shots/app.png --size 390x844 --mobile
 *
 * The page may set `window.__ready = true` when its first good frame is on screen; the script
 * waits for that (up to 15 s), then `--wait` ms more, then captures.
 */
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--size', '--wait']);
const opts = { size: '1440x900', wait: '2500', mobile: false };
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUE_FLAGS.has(a)) opts[a.slice(2)] = args[++i];
  else if (a === '--mobile') opts.mobile = true;
  else if (a === '--no-webgl') opts.noWebgl = true;
  else positional.push(a);
}
const [pagePath, outPath] = positional;
if (!pagePath || !outPath) {
  console.error('usage: node scripts/shot.mjs <page-path?query> <out.png> [--size WxH] [--wait ms] [--mobile]');
  process.exit(2);
}
const [width, height] = opts.size.split('x').map(Number);
const extraWait = Number(opts.wait);
const mobile = opts.mobile;

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.listen();
const { port } = server.httpServer.address();
const url = `http://127.0.0.1:${port}/${pagePath.replace(/^\//, '')}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
let failed = false;
try {
  const page = await browser.newPage();
  if (opts.noWebgl) await page.evaluateOnNewDocument(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (text.includes('GL Driver Message') || text.includes('favicon')) return;
    if (type === 'error' || type === 'warn' || type === 'warning') console.log(`[console.${type}] ${text}`);
  });
  page.on('pageerror', (err) => {
    failed = true;
    console.log(`[pageerror] ${err.message}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  try {
    await page.waitForFunction('window.__ready === true', { timeout: 15000 });
  } catch {
    console.log('[shot] window.__ready not set within 15 s — capturing anyway');
  }
  await new Promise((r) => setTimeout(r, extraWait));
  mkdirSync(dirname(resolve(root, outPath)), { recursive: true });
  await page.screenshot({ path: resolve(root, outPath) });
  console.log(`[shot] ${url} → ${outPath}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
