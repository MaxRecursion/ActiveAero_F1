#!/usr/bin/env node
/**
 * Cross-section plot of the car in the car frame → PNG (1 px lines, grid every 0.1 m, darker every 0.5 m).
 *   node scripts/model/slice.mjs <axis x|y|z> <value m[,value…]> <u0,u1,v0,v1> <out.png> [--px 1000] [--body]
 * The plot's horizontal/vertical axes are the two other axes in x,y,z order (z-slice: x → , y ↑;
 * y-slice: x → , z ↑; x-slice: z → , y ↑). `--body` keeps only component 0 (the fused body).
 * With `--parts <file.json>` (per-triangle part index written by process.mjs --debug) lines are coloured per part.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCar } from './frame.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--px', '--parts'].includes(argv[i - 1])));
const [axisName, valueStr, win, out] = pos;
const axis = 'xyz'.indexOf(axisName);
const values = valueStr.split(',').map(Number);
const [u0, u1, v0, v1] = win.split(',').map(Number);
const [ua, va] = axis === 0 ? [2, 1] : [0, 1, 2].filter((a) => a !== axis);
const W = Number(opt('--px', 1000));
const H = Math.round((W * (v1 - v0)) / (u1 - u0));

const car = await loadCar();
const { positions: p, index, triComp } = car;
const parts = opt('--parts') ? JSON.parse(readFileSync(opt('--parts'), 'utf8')) : null;
const PALETTE = [[230,25,75],[60,180,75],[200,170,0],[67,99,216],[245,130,49],[145,30,180],[0,170,190],[240,50,230],[130,160,0],[170,110,110],[0,128,128],[120,80,200],[154,99,36],[128,0,0],[0,150,90],[128,128,0],[0,0,117],[110,110,110]];

const img = new Uint8Array(W * H * 3).fill(255);
const px = (u, v) => [Math.round(((u - u0) / (u1 - u0)) * (W - 1)), Math.round(((v1 - v) / (v1 - v0)) * (H - 1))];
const put = (x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  img.set(c, (y * W + x) * 3);
};
const line = (x0, y0, x1, y1, c) => {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    put(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
};
for (let g = Math.ceil(u0 * 10); g <= u1 * 10; g++) {
  const [x] = px(g / 10, v0);
  for (let y = 0; y < H; y++) put(x, y, g % 5 === 0 ? [190, 190, 200] : [232, 232, 238]);
}
for (let g = Math.ceil(v0 * 10); g <= v1 * 10; g++) {
  const [, y] = px(u0, g / 10);
  for (let x = 0; x < W; x++) put(x, y, g % 5 === 0 ? [190, 190, 200] : [232, 232, 238]);
}
let segs = 0;
for (const [vi, value] of values.entries()) for (let t = 0; t < triComp.length; t++) {
  if (flag('--body') && triComp[t] !== 0) continue;
  const c = [0, 1, 2].map((k) => index[t * 3 + k] * 3);
  const d = c.map((o) => p[o + axis] - value);
  if (d.every((x) => x > 0) || d.every((x) => x < 0)) continue;
  const pts = [];
  for (let k = 0; k < 3; k++) {
    const a = k, b = (k + 1) % 3;
    if (d[a] === d[b] || d[a] * d[b] > 0) continue;
    const s = d[a] / (d[a] - d[b]);
    pts.push([p[c[a] + ua] + s * (p[c[b] + ua] - p[c[a] + ua]), p[c[a] + va] + s * (p[c[b] + va] - p[c[a] + va])]);
  }
  if (pts.length !== 2) continue;
  const col = parts ? PALETTE[parts[t] % PALETTE.length] : values.length > 1 ? PALETTE[vi % PALETTE.length] : [20, 20, 30];
  const [x0, y0] = px(...pts[0]);
  const [x1, y1] = px(...pts[1]);
  line(x0, y0, x1, y1, col);
  segs++;
}
// PNG encode
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  raw.set(img.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`[slice] ${axisName}=${valueStr} ${segs} segments → ${out} (${W}x${H}px, ${(W / (u1 - u0)).toFixed(0)} px/m)`);
