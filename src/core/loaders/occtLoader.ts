import * as THREE from 'three';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';

export type CadFormat = 'step' | 'iges' | 'brep';

export interface WorkerMesh {
  name: string;
  color: [number, number, number] | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
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

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
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
      // Release the original WASM heap before attempting another large import.
      if (pending.size === 0) {
        worker?.terminate();
        worker = null;
      }
      recoverStep(retryStep).then(request.resolve, () => request.reject(new Error(error)));
    } else {
      request.reject(new Error(error));
    }
  };
  worker.onerror = (event) => {
    const err = new Error(event.message || 'The CAD parsing worker crashed.');
    pending.forEach((request) => request.reject(err));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function recoverStep(buffer: ArrayBuffer): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const recovery = new Worker(new URL('./stepRecovery.worker.ts', import.meta.url), { type: 'module' });
    const fail = (error: string) => {
      recovery.terminate();
      reject(new Error(error));
    };
    recovery.onmessage = ({ data }) => {
      recovery.terminate();
      if (data.ok) resolve(data.result);
      else reject(new Error(data.error));
    };
    recovery.onerror = (event) => fail(event.message);
    recovery.onmessageerror = () => fail('Could not receive STEP recovery result.');
    try {
      recovery.postMessage(buffer, [buffer]);
    } catch (error) {
      fail(String(error));
    }
  });
}

/**
 * Parse STEP/IGES/BREP in the occt (OpenCASCADE WASM) worker.
 * The buffer is transferred, not copied — do not reuse it afterwards.
 */
export function parseCadInWorker(buffer: ArrayBuffer, format: CadFormat): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, format, buffer }, [buffer]);
  });
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${new THREE.Color(r, g, b).getHexString()}`;
}

/** Turn the worker's transferable payload into geometries + assembly tree. */
export function buildModelFromCad(fileName: string, data: WorkerResult): LoadedModel {
  const meshes: ModelMesh[] = data.meshes.map((wm, i) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(wm.positions, 3));
    if (wm.normals && wm.normals.length === wm.positions.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(wm.normals, 3));
    }
    if (wm.indices) {
      geometry.setIndex(new THREE.BufferAttribute(wm.indices, 1));
    }
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
