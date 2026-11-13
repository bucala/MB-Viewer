import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';
import { buildBvhsInWorker, geometryFromWorker, parseMeshInWorker } from '@/core/loaders/geometryWorker';
import { tr } from '@/i18n';

/** Packed xyz copy — works for interleaved glTF attributes too. */
function packVec3(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** STL — single unnamed solid, usually exported Z-up from CAD. Parsed off-thread. */
export async function loadStlModel(
  buffer: ArrayBuffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const [parsed] = await parseMeshInWorker('stl', buffer, signal);
  const name = baseName(fileName);
  const mesh: ModelMesh = { id: 0, name, geometry: geometryFromWorker(parsed) };
  const root: ModelNode = { id: 'n0', name, meshIds: [0], children: [] };
  return finalizeModel(fileName, root, [mesh], 'z');
}

/** OBJ — flat list of named objects/groups, Y-up by convention. Parsed off-thread. */
export async function loadObjModel(
  buffer: ArrayBuffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const parsed = await parseMeshInWorker('obj', buffer, signal);
  if (parsed.length === 0) throw new Error(tr('err.objEmpty'));

  const meshes: ModelMesh[] = [];
  const children: ModelNode[] = [];
  parsed.forEach((data, id) => {
    const name = data.name || `Object ${id + 1}`;
    meshes.push({ id, name, geometry: geometryFromWorker(data) });
    children.push({ id: `n${id + 1}`, name, meshIds: [id], children: [] });
  });

  const root: ModelNode = { id: 'n0', name: baseName(fileName), meshIds: [], children };
  return finalizeModel(fileName, root, meshes, 'y');
}

/**
 * GLB — full scene graph mirrored into the assembly tree, materials kept.
 * Parsed on the main thread (textures need the DOM); BVHs built off-thread.
 */
export async function loadGlbModel(
  buffer: ArrayBuffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const sources: { name: string; geometry: THREE.BufferGeometry; material?: THREE.Material }[] = [];
  let nodeSeq = 0;

  const convert = (object: THREE.Object3D): ModelNode | null => {
    const children = object.children
      .map(convert)
      .filter((node): node is ModelNode => node !== null);

    const meshIds: number[] = [];
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const id = sources.length;
      const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      sources.push({ name: object.name.trim() || `Mesh ${id + 1}`, geometry, material: material ?? undefined });
      meshIds.push(id);
    }

    if (children.length === 0 && meshIds.length === 0) return null;
    return {
      id: `n${nodeSeq++}`,
      name: object.name.trim() || (meshIds.length > 0 ? `Mesh ${meshIds[0] + 1}` : 'Group'),
      meshIds,
      children,
    };
  };

  const rootChildren = scene.children
    .map(convert)
    .filter((node): node is ModelNode => node !== null);
  if (sources.length === 0) throw new Error(tr('err.glbEmpty'));

  // Only positions/normals/index go to the worker; UVs, colors and other
  // attributes the original material needs stay on the source geometry.
  const built = await buildBvhsInWorker(
    sources.map(({ geometry }) => ({
      positions: packVec3(geometry.attributes.position),
      normals: geometry.attributes.normal ? packVec3(geometry.attributes.normal) : null,
      indices: geometry.index ? Uint32Array.from(geometry.index.array as ArrayLike<number>) : null,
    })),
    signal,
  );

  const meshes: ModelMesh[] = sources.map((source, id) => {
    const fromWorker = geometryFromWorker(built[id]);
    const geometry = source.geometry;
    geometry.setAttribute('position', fromWorker.attributes.position);
    geometry.setAttribute('normal', fromWorker.attributes.normal);
    if (fromWorker.index) geometry.setIndex(fromWorker.index);
    // The BVH only references position + index, which are now shared.
    geometry.boundsTree = fromWorker.boundsTree;
    if (geometry.boundsTree) (geometry.boundsTree as { geometry: THREE.BufferGeometry }).geometry = geometry;
    return { id, name: source.name, geometry, originalMaterial: source.material };
  });

  const root: ModelNode = {
    id: `n${nodeSeq++}`,
    name: baseName(fileName),
    meshIds: [],
    children: rootChildren,
  };
  return finalizeModel(fileName, root, meshes, 'y');
}
