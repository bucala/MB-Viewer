import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** Raw mesh arrays (as produced by a parser) going into the worker. */
export interface RawGeometry {
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
}

/** Mesh arrays + serialized indirect BVH coming back from the worker. */
export interface WorkerGeometry {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array | null;
  bvhRoots: ArrayBuffer[];
  bvhIndirect: Uint32Array;
}

export type GeometryWorkerRequest =
  | { id: number; op: 'bvh'; meshes: RawGeometry[] }
  | { id: number; op: 'stl' | 'obj'; buffer: ArrayBuffer };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

type Pending = { resolve: (m: WorkerGeometry[]) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, error, meshes } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (ok) request.resolve(meshes);
    else request.reject(new Error(error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(new Error(event.message || 'The geometry worker crashed.'));
  };
  return worker;
}

function failAll(error: Error): void {
  pending.forEach((request) => request.reject(error));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function call(request: WithoutId<GeometryWorkerRequest>, transfer: Transferable[], signal?: AbortSignal) {
  return new Promise<WorkerGeometry[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    // A parse/BVH build cannot be interrupted from outside: abandoning a load
    // terminates the worker, which also frees its memory.
    signal?.addEventListener('abort', () => {
      if (pending.has(id)) failAll(signal.reason);
    }, { once: true });
    ensureWorker().postMessage({ ...request, id }, transfer);
  });
}

/** Parse STL/OBJ off the main thread (BVHs included). Transfers `buffer`. */
export function parseMeshInWorker(format: 'stl' | 'obj', buffer: ArrayBuffer, signal?: AbortSignal) {
  return call({ op: format, buffer }, [buffer], signal);
}

/** Build BVHs for already-parsed meshes. Transfers (and returns) their arrays. */
export function buildBvhsInWorker(meshes: RawGeometry[], signal?: AbortSignal) {
  const transfer = new Set<ArrayBufferLike>();
  for (const m of meshes) {
    transfer.add(m.positions.buffer);
    if (m.normals) transfer.add(m.normals.buffer);
    if (m.indices) transfer.add(m.indices.buffer);
  }
  return call({ op: 'bvh', meshes }, [...transfer] as Transferable[], signal);
}

/** Rebuild a BufferGeometry on the main thread with its worker-built BVH attached. */
export function geometryFromWorker(data: WorkerGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  if (data.indices) geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.boundsTree = MeshBVH.deserialize(
    { version: 1, roots: data.bvhRoots, index: data.indices, indirectBuffer: data.bvhIndirect } as never,
    geometry,
    { setIndex: false },
  );
  return geometry;
}
