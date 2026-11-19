import * as THREE from 'three';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';
import { buildBvhsInWorker, geometryFromWorker } from '@/core/loaders/geometryWorker';

import type { TessellationQuality } from '@/store/settingsStore';

export type CadFormat = 'step' | 'iges' | 'brep';

export interface WorkerMesh {
  name: string;
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
  /** first/last triangle index per B-rep face (absent for faceted STEP). */
  faceRanges?: Uint32Array;
}

export interface WorkerNode {
  name?: string;
  meshes?: number[];
  children?: WorkerNode[];
}

export interface WorkerResult {
  meshes: WorkerMesh[];
  root: WorkerNode;
}

/** The WASM heap only grows; an idle worker is dropped to give it back. */
const IDLE_TERMINATE_MS = 30_000;

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const pending = new Map<number, {
  resolve: (result: WorkerResult) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  quality: TessellationQuality;
}>();

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
    const { id, ok, error, meshes, root, retryStep } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (ok) {
      request.resolve({ meshes, root });
    } else if (retryStep instanceof ArrayBuffer) {
      // Drop the original WASM heap before starting the fallback if idle.
      if (pending.size === 0) terminateWorker();
      recoverStep(retryStep, request.quality, request.signal).then(request.resolve, () =>
        request.reject(request.signal?.aborted ? request.signal.reason : new Error(error)),
      );
    } else {
      request.reject(new Error(error));
    }
    if (worker) scheduleIdleTermination();
  };
  worker.onerror = (event) => {
    terminateWorker(new Error(event.message || 'The CAD parsing worker crashed.'));
  };
  return worker;
}

function recoverStep(
  buffer: ArrayBuffer, quality: TessellationQuality, signal?: AbortSignal,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const recovery = new Worker(new URL('./stepRecovery.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      recovery.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (reason: unknown) => {
      cleanup();
      reject(reason);
    };
    const abort = () => fail(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    recovery.onmessage = ({ data }) => {
      cleanup();
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error));
    };
    recovery.onerror = (event) => fail(new Error(event.message));
    recovery.onmessageerror = () => fail(new Error('Could not receive STEP recovery result.'));
    try {
      recovery.postMessage({ buffer, quality }, [buffer]);
    } catch (error) {
      fail(error);
    }
  });
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
    const abort = () => {
      if (pending.has(id)) terminateWorker(signal?.reason ?? new Error('CAD loading aborted.'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    pending.set(id, {
      signal,
      quality,
      resolve: (result) => { cleanup(); resolve(result); },
      reject: (error) => { cleanup(); reject(error); },
    });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      ensureWorker().postMessage({ id, format, buffer, quality }, [buffer]);
    } catch (error) {
      pending.delete(id);
      cleanup();
      if (worker) scheduleIdleTermination();
      reject(error);
    }
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
