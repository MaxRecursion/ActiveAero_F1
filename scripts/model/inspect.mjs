#!/usr/bin/env node
/**
 * Print a glTF/GLB's node tree with world-space bounds, triangle counts and materials, so a
 * downloaded car can be mapped onto our part ids.
 *
 *   node scripts/model/inspect.mjs models/source/<file>.glb [--depth 6]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const depthArg = process.argv.indexOf('--depth');
const maxDepth = depthArg > 0 ? Number(process.argv[depthArg + 1]) : 6;
if (!file) {
  console.error('usage: node scripts/model/inspect.mjs <file.glb> [--depth N]');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();

const tris = (mesh) =>
  mesh
    ? mesh.listPrimitives().reduce((n, p) => {
        const idx = p.getIndices();
        const pos = p.getAttribute('POSITION');
        return n + Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
      }, 0)
    : 0;
const subtreeTris = (node) => tris(node.getMesh()) + node.listChildren().reduce((n, c) => n + subtreeTris(c), 0);
const fmt = (v) => v.map((x) => x.toFixed(3)).join(', ');

let total = 0;
for (const m of root.listMeshes()) total += tris(m);
console.log(`file: ${file}`);
console.log(`meshes ${root.listMeshes().length} · materials ${root.listMaterials().length} · textures ${root.listTextures().length} · nodes ${root.listNodes().length} · triangles ${total}`);
console.log('materials:', root.listMaterials().map((m) => m.getName() || '(unnamed)').join(' | '));

function walk(node, depth) {
  if (depth > maxDepth) return;
  const b = getBounds(node);
  const size = b.max.map((x, i) => x - b.min[i]);
  const mesh = node.getMesh();
  const mats = mesh ? [...new Set(mesh.listPrimitives().map((p) => p.getMaterial()?.getName() || '-'))].join(',') : '';
  console.log(
    `${'  '.repeat(depth)}- ${node.getName() || '(unnamed)'}  tris ${subtreeTris(node)}  min [${fmt(b.min)}] size [${fmt(size)}]${mats ? `  mat ${mats}` : ''}`,
  );
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const scene of root.listScenes()) {
  const b = getBounds(scene);
  console.log(`scene ${scene.getName() || '(unnamed)'}  min [${fmt(b.min)}] max [${fmt(b.max)}]`);
  for (const n of scene.listChildren()) walk(n, 1);
}
