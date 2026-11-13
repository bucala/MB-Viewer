import * as THREE from 'three';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';
import { buildBvhsInWorker, geometryFromWorker } from '@/core/loaders/geometryWorker';

import type { TessellationQuality } from '@/store/settingsStore';

export type CadFormat = 'step' | 'iges' | 'brep';

interface WorkerMesh {
  name: string;
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
  /** first/last triangle index per B-rep face (absent for faceted STEP). */
  faceRanges?: Uint32Array;
}

interface WorkerNode {
  name?: string;
  meshes?: number[];
  children?: WorkerNode[];
}

interface WorkerResult {
  meshes: WorkerMesh[];
  root: WorkerNode;
}

/** The WASM heap only grows; an idle worker is dropped to give it back. */
const IDLE_TERMINATE_MS = 30_000;

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>();

function terminateWorker(error?: Error): void {
  clearTimeout(idleTimer);
  if (error) pending.forEach((request) => request.reject(error));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function scheduleIdleTermination(): void {
  clearTimeout(idleTimer);
  if (pending.size === 0) idleTimer = setTimeout(() => terminateWorker(), IDLE_TERMINATE_MS);
}

function ensureWorker(): Worker {
  clearTimeout(idleTimer);
  if (worker) return worker;
  worker = new Worker(`${import.meta.env.BASE_URL}occt-worker.js`);
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, error, meshes, root } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (ok) request.resolve({ meshes, root });
    else request.reject(new Error(error));
    scheduleIdleTermination();
  };
  worker.onerror = (event) => {
    terminateWorker(new Error(event.message || 'The CAD parsing worker crashed.'));
  };
  return worker;
}

/**
 * Parse STEP/IGES/BREP in the occt (OpenCASCADE WASM) worker.
 * The buffer is transferred, not copied — do not reuse it afterwards.
 * Aborting terminates the worker: OpenCASCADE cannot be interrupted.
 */
export function parseCadInWorker(
  buffer: ArrayBuffer,
  format: CadFormat,
  options: { quality?: TessellationQuality; signal?: AbortSignal } = {},
): Promise<WorkerResult> {
  const { quality = 'standard', signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    signal?.addEventListener('abort', () => {
      if (pending.has(id)) terminateWorker(signal.reason);
    }, { once: true });
    ensureWorker().postMessage({ id, format, buffer, quality }, [buffer]);
  });
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${new THREE.Color(r, g, b).getHexString()}`;
}

/** Turn the worker's payload into geometries (BVHs built off-thread) + assembly tree. */
export async function buildModelFromCad(
  fileName: string,
  data: WorkerResult,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const built = await buildBvhsInWorker(
    data.meshes.map((wm) => ({ positions: wm.positions, normals: wm.normals, indices: wm.indices })),
    signal,
  );
  const meshes: ModelMesh[] = data.meshes.map((wm, i) => {
    const geometry = geometryFromWorker(built[i]);
    if (wm.faceRanges && wm.faceRanges.length > 0) geometry.userData.faceRanges = wm.faceRanges;
    return {
      id: i,
      name: wm.name.trim() || `Body ${i + 1}`,
      geometry,
      color: wm.color ? rgbToHex(wm.color) : undefined,
    };
  });

  let counter = 0;
  const toNode = (node: WorkerNode, fallback: string): ModelNode => ({
    id: `n${counter++}`,
    name: (node.name ?? '').trim() || fallback,
    meshIds: node.meshes ?? [],
    children: (node.children ?? []).map((child, i) => toNode(child, `Part ${i + 1}`)),
  });
  const root = toNode(data.root, fileName.replace(/\.[^.]+$/, ''));

  // STEP/IGES models are conventionally Z-up.
  return finalizeModel(fileName, root, meshes, 'z');
}
