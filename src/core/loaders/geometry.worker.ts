/// <reference lib="webworker" />
/**
 * Geometry worker: everything CPU-heavy that would otherwise freeze the UI
 * after a file is read — parsing mesh formats (STL, OBJ) and building the
 * picking BVHs (three-mesh-bvh) for every format. BVHs are built in
 * `indirect` mode so triangle indices keep their original order: the CAD
 * loader's B-rep face ranges refer to that order. All typed arrays travel
 * as transferables (zero-copy, both directions).
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { GeometryWorkerRequest, WorkerGeometry } from '@/core/loaders/geometryWorker';

function withBvh(geometry: THREE.BufferGeometry, name = ''): WorkerGeometry {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const bvh = new MeshBVH(geometry, { indirect: true });
  const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false });
  return {
    name,
    positions: geometry.attributes.position.array as Float32Array,
    normals: geometry.attributes.normal.array as Float32Array,
    indices: (geometry.index?.array as Uint32Array | undefined) ?? null,
    bvhRoots: serialized.roots as ArrayBuffer[],
    bvhIndirect: serialized.indirectBuffer as Uint32Array,
  };
}

function toGeometry(positions: Float32Array, normals: Float32Array | null, indices: Uint32Array | null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals && normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  }
  if (indices) geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function transferablesOf(meshes: WorkerGeometry[]): Transferable[] {
  const out = new Set<ArrayBufferLike>();
  for (const m of meshes) {
    out.add(m.positions.buffer);
    out.add(m.normals.buffer);
    if (m.indices) out.add(m.indices.buffer);
    for (const root of m.bvhRoots) out.add(root);
    out.add(m.bvhIndirect.buffer);
  }
  return [...out] as Transferable[];
}

function parseStl(buffer: ArrayBuffer): WorkerGeometry[] {
  return [withBvh(new STLLoader().parse(buffer))];
}

function parseObj(buffer: ArrayBuffer): WorkerGeometry[] {
  const group = new OBJLoader().parse(new TextDecoder().decode(buffer));
  group.updateMatrixWorld(true);
  const meshes: WorkerGeometry[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = (mesh.geometry as THREE.BufferGeometry).applyMatrix4(mesh.matrixWorld);
    const geometry = toGeometry(
      source.attributes.position.array as Float32Array,
      (source.attributes.normal?.array as Float32Array | undefined) ?? null,
      null,
    );
    meshes.push(withBvh(geometry, mesh.name.trim()));
  });
  return meshes;
}

self.onmessage = (event: MessageEvent<GeometryWorkerRequest>) => {
  const request = event.data;
  try {
    let meshes: WorkerGeometry[];
    if (request.op === 'bvh') {
      meshes = request.meshes.map((m) => withBvh(toGeometry(m.positions, m.normals, m.indices)));
    } else if (request.op === 'stl') {
      meshes = parseStl(request.buffer);
    } else {
      meshes = parseObj(request.buffer);
    }
    self.postMessage({ id: request.id, ok: true, meshes }, { transfer: transferablesOf(meshes) });
  } catch (error) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
