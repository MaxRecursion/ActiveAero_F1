/** node scripts/model/analyze.mjs <file.glb> — list the model's solid bodies with bounds (model units). */
import { components, readSoup, weld } from './components.mjs';

const file = process.argv[2];
console.time('read');
const soup = await readSoup(file);
console.timeEnd('read');
console.time('weld');
const welded = weld(soup, 0.01);
console.timeEnd('weld');
console.log(`corners ${soup.length / 3} → welded verts ${welded.positions.length / 3}`);
console.time('components');
const { comps } = components(welded);
console.timeEnd('components');
console.log(`components: ${comps.length}`);
const f = (v) => v.map((x) => Math.round(x)).join(',');
comps
  .sort((a, b) => b.tris - a.tris)
  .forEach((c, i) => {
    if (i < 140) console.log(`#${c.id} tris ${c.tris} min [${f(c.min)}] max [${f(c.max)}] size [${f(c.max.map((m, k) => m - c.min[k]))}]`);
  });
