import { OcctKernel } from 'occt-wasm';
import glueUrl from 'occt-wasm/dist/occt-wasm.js?url';
import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url';
import { recoverStepByPart } from './stepRecovery';

self.onmessage = async ({ data }: MessageEvent<ArrayBuffer>) => {
  try {
    const { default: createModule } = await import(/* @vite-ignore */ glueUrl);
    const kernel = await OcctKernel.init({ createModule, wasm: new URL(wasmUrl, self.location.href) });
    const result = recoverStepByPart(kernel, new Uint8Array(data));
    const transfer: Transferable[] = [];
    for (const { positions, normals, indices } of result.meshes) {
      transfer.push(positions.buffer);
      if (normals) transfer.push(normals.buffer);
      if (indices) transfer.push(indices.buffer);
    }
    self.postMessage({ ok: true, result }, { transfer });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
