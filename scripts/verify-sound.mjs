#!/usr/bin/env node
/**
 * End-to-end check of the car sound in the BUILT app (dist/), served with the production Content-Security-Policy
 * from public/_headers. Drives the real UI in headless Chrome (run with --mute-audio, so nothing plays aloud) and
 * reads the real-time audio graph through a probe on the AudioContext output.
 *
 *   npm run build && node scripts/verify-sound.mjs
 *
 * It asserts: no AudioContext exists before the listener turns sound on; the context is created by that click and
 * runs; the engine worklet loads under the CSP and the recording decodes; no OscillatorNode is ever created; the output is
 * audible while the car runs and the level follows the speed; muting drops the output to silence and suspends the context;
 * unmuting resumes it; no console errors or CSP violations.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing: run npm run build first');
  process.exit(2);
}

const headersFile = readFileSync(join(root, 'public/_headers'), 'utf8');
const globalBlock = headersFile.split(/\n(?=\S)/).find((b) => b.startsWith('/*')) ?? '';
const headers = Object.fromEntries(
  globalBlock
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]),
);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary', '.flac': 'audio/flac', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const server = createServer((req, res) => {
  let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  const file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, headers).end('not found');
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--mute-audio', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});

const problems = [];
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
  if (!ok) problems.push(what);
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (['error'].includes(m.type()) && !t.includes('GL Driver') && !t.includes('favicon')) errors.push(t.slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument(() => {
    const probe = { contexts: [], oscillators: 0, worklets: 0, analysers: new Map(), violations: [] };
    window.__probe = probe;
    document.addEventListener('securitypolicyviolation', (e) => probe.violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    const OrigContext = window.AudioContext;
    window.AudioContext = class extends OrigContext {
      constructor(...a) {
        super(...a);
        probe.contexts.push(this);
      }
    };
    const osc = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function (...a) {
      probe.oscillators++;
      return osc.apply(this, a);
    };
    if (window.OscillatorNode) {
      const O = window.OscillatorNode;
      window.OscillatorNode = class extends O {
        constructor(...a) {
          super(...a);
          probe.oscillators++;
        }
      };
    }
    const W = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends W {
      constructor(...a) {
        super(...a);
        probe.worklets++;
      }
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      if (dest instanceof AudioDestinationNode && !probe.analysers.has(this.context)) {
        const an = this.context.createAnalyser();
        an.fftSize = 2048;
        connect.call(this, an);
        probe.analysers.set(this.context, an);
      }
      return connect.call(this, dest, ...rest);
    };
    probe.rms = () => {
      let best = 0;
      for (const an of probe.analysers.values()) {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        best = Math.max(best, Math.sqrt(s / buf.length));
      }
      return best;
    };
  });
  await page.goto(`http://127.0.0.1:${port}/index.html#/downforce`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  check((await page.evaluate(() => window.__probe.contexts.length)) === 0, 'no AudioContext before the listener turns sound on');
  const label0 = await page.$eval('.sound-btn', (b) => b.getAttribute('aria-label'));
  check(/unmute/i.test(label0), 'the sound button starts muted', label0);

  // Turn sound on with a real click and drive the car with the Play sweep.
  await page.click('.sound-btn');
  await page.waitForFunction('window.__probe.contexts.length === 1', { timeout: 10000 });
  await page.waitForFunction('window.__probe.worklets === 1', { timeout: 20000 }).catch(() => {});
  const loaded = await page.evaluate(() => ({ worklets: window.__probe.worklets, state: window.__probe.contexts[0]?.state, violations: window.__probe.violations }));
  check(loaded.worklets === 1, 'the engine worklet loaded and the recording decoded under the production CSP');
  check(loaded.state === 'running', 'the context runs after the click', loaded.state);
  check(loaded.violations.length === 0, 'no CSP violations', loaded.violations.join('; '));

  // Parked: idle.
  await new Promise((r) => setTimeout(r, 1200));
  const idleRms = await page.evaluate(() => window.__probe.rms());
  check(idleRms > 0.004, 'the parked car idles audibly', `rms ${idleRms.toFixed(4)}`);

  // Run the car: Play sweeps 0 → 330 km/h.
  await page.click('[aria-label^="Play speed sweep"], [aria-label^="Pause"]');
  const samples = [];
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 250));
    samples.push(await page.evaluate(() => window.__probe.rms()));
  }
  const peak = Math.max(...samples);
  check(peak > 0.02, 'the engine is clearly audible while the car runs', `peak rms ${peak.toFixed(3)}`);
  check(peak > idleRms * 1.0, 'it is not quieter at speed than parked', `idle ${idleRms.toFixed(3)} → ${peak.toFixed(3)}`);

  // Mute.
  await page.click('.sound-btn');
  await new Promise((r) => setTimeout(r, 900));
  const muted = await page.evaluate(() => ({ rms: window.__probe.rms(), state: window.__probe.contexts[0].state }));
  check(muted.rms < 0.0005, 'muting silences the output (engine and every other layer)', `rms ${muted.rms.toExponential(1)}`);
  check(muted.state === 'suspended', 'muting suspends the audio context', muted.state);

  // Unmute again.
  await page.click('.sound-btn');
  await new Promise((r) => setTimeout(r, 1200));
  const back = await page.evaluate(() => ({ rms: window.__probe.rms(), state: window.__probe.contexts[0].state }));
  check(back.state === 'running' && back.rms > 0.004, 'unmuting resumes the sound', `${back.state}, rms ${back.rms.toFixed(3)}`);

  const osc = await page.evaluate(() => window.__probe.oscillators);
  check(osc === 0, 'no OscillatorNode was ever created', `${osc}`);
  check(errors.length === 0, 'no console errors', errors.join(' | '));
  const contexts = await page.evaluate(() => window.__probe.contexts.length);
  check(contexts === 1, 'exactly one audio context', `${contexts}`);
} finally {
  await browser.close();
  server.close();
}
console.log(problems.length ? `\n${problems.length} check(s) failed` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
