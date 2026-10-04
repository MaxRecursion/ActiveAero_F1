#!/usr/bin/env node
/**
 * Render the car sound offline, through the real engine module, so it can be measured.
 * Nobody can listen from a script; this makes WAV files that spectrograms and a sound classifier can judge.
 *
 *   node scripts/render-audio.mjs --out <dir> [--scenarios idle,sweep,pull,lift,brakeStop,straightMode,energyLap]
 *        [--samples <samples.json>] [--engine-only] [--rate 48000]
 *
 * Without --samples the recordings shipped in src/app/sound/samples are used. A samples.json replaces them:
 *   { "power": { "file": "/abs/path.wav", "map": {sr, f0:[…], at:[…]}, "gain": 1, "rev": [[0,100],[1,220]] }, "coast": { … } }
 * Pass --samples none to render with the recordings missing (the engine must then be silent).
 */
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { out: 'shots/audio', scenarios: 'idle,sweep,pull,lift,brakeStop,straightMode,energyLap', rate: '48000' };
const flags = new Set();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--engine-only') flags.add('engine-only');
  else if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
}
const outDir = resolve(root, opt.out);
mkdirSync(outDir, { recursive: true });

let samples;
const files = new Map();
if (opt.samples === 'none') {
  const none = { url: '', map: { sr: 44100, f0: [100, 200], at: [0, 44100] }, gain: 1, rev: [[0, 100], [1, 200]] };
  samples = { power: none, coast: none };
} else if (opt.samples) {
  const spec = JSON.parse(readFileSync(resolve(opt.samples), 'utf8'));
  samples = {};
  for (const voice of ['power', 'coast']) {
    const v = spec[voice];
    files.set(v.file, readFileSync(v.file));
    samples[voice] = { url: v.file, map: v.map, gain: v.gain ?? 1, rev: v.rev };
  }
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
await server.listen();
const { port } = server.httpServer.address();
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

function wav(left, right, sr, path) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const c = Math.max(-1, Math.min(1, left[i]));
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    sum += left[i] * left[i];
    buf.writeInt16LE(Math.round(c * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, buf);
  return { peak, rmsDb: 20 * Math.log10(Math.sqrt(sum / n) + 1e-9) };
}

const decode = (b64) => {
  const raw = Buffer.from(b64, 'base64');
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
};

let failed = false;
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (['error', 'warn', 'warning'].includes(m.type()) && !m.text().includes('GL Driver')) console.log(`[console.${m.type()}] ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => {
    failed = true;
    console.log(`[pageerror] ${e.message}`);
  });
  await page.exposeFunction('__bytes', (key) => files.get(key).toString('base64'));
  await page.goto(`http://127.0.0.1:${port}/dev/sound.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true && window.__render', { timeout: 30000 });
  for (const scenario of opt.scenarios.split(',')) {
    const r = await page.evaluate(
      (s, o) => window.__render(s, o),
      scenario,
      { samples, layers: flags.has('engine-only') ? false : undefined, sampleRate: Number(opt.rate) },
    );
    const stats = wav(decode(r.left), decode(r.right), r.sr, resolve(outDir, `${scenario}.wav`));
    console.log(`[audio] ${scenario}.wav engine=${r.engine} peak=${stats.peak.toFixed(3)} rms=${stats.rmsDb.toFixed(1)} dBFS`);
    writeFileSync(resolve(outDir, `${scenario}.trace.json`), JSON.stringify(r.trace));
    const t = r.trace;
    const share = (pred) => (100 * t.filter(pred).length) / t.length;
    const shifts = t.filter((x, i) => i && x.gear !== t[i - 1].gear).length;
    console.log(
      `        drive: rpm ${Math.min(...t.map((x) => x.rpm)).toFixed(0)}–${Math.max(...t.map((x) => x.rpm)).toFixed(0)}, gear changes ${shifts}, ` +
        `time on power (load>0.7) ${share((x) => x.load > 0.7).toFixed(0)}%, off power (load<0.15) ${share((x) => x.load < 0.15).toFixed(0)}%, braking ${share((x) => x.brake > 0.1).toFixed(0)}%`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
