/** Write named parts (positions/normals/index) as one glTF node + mesh each, sharing one neutral material. */
import { Document, NodeIO } from '@gltf-transform/core';

export function buildDocument(parts, sceneExtras) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'unseen scripts/model/process.mjs';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('car');
  if (sceneExtras) scene.setExtras(sceneExtras);
  const material = doc
    .createMaterial('clay')
    .setBaseColorFactor([0.85, 0.83, 0.79, 1])
    .setRoughnessFactor(0.7)
    .setMetallicFactor(0);
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const part of parts) {
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', part.positions))
      .setAttribute('NORMAL', accessor('VEC3', part.normals))
      .setIndices(accessor('SCALAR', part.index))
      .setMaterial(material);
    const mesh = doc.createMesh(part.id).addPrimitive(prim);
    const node = doc.createNode(part.id).setMesh(mesh);
    if (part.extras) node.setExtras(part.extras);
    scene.addChild(node);
  }
  return doc;
}

export const writeGlb = (doc, path, io = new NodeIO()) => io.write(path, doc);

/**
 * Shrink a built document in place: reorder for vertex-cache locality, quantise (14-bit positions, 10-bit
 * normals; the per-node scale/translation KHR_mesh_quantization needs keeps the car frame exact), then
 * EXT_meshopt_compression. Returns the NodeIO that can write it.
 */
export async function compressDocument(doc) {
  const { EXTMeshoptCompression, KHRMeshQuantization } = await import('@gltf-transform/extensions');
  const { meshopt } = await import('@gltf-transform/functions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 14, quantizeNormal: 10 }));
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}
