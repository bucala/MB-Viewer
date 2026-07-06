/**
 * MB Viewer — CAD parsing worker.
 *
 * Runs occt-import-js (OpenCASCADE compiled to WebAssembly) off the main
 * thread so multi-hundred-MB STEP/IGES tessellation never blocks the UI.
 *
 * This is intentionally a *classic* worker living in public/ instead of a
 * bundled module worker: the Emscripten UMD build of occt-import-js is
 * loaded verbatim via importScripts(), which keeps it out of the bundler's
 * module graph and makes dev/prod behave identically. The runtime files are
 * copied to public/vendor/occt by scripts/copy-occt.mjs on `npm install`.
 *
 * Protocol:
 *   in : { id, format: 'step'|'iges'|'brep', buffer: ArrayBuffer }
 *   out: { id, ok: true, meshes: [...], root: {...} }   (typed arrays transferred)
 *        { id, ok: false, error: string }
 */

/* global importScripts, occtimportjs */

let occtPromise = null;

function initOcct() {
  if (!occtPromise) {
    // Paths resolve relative to this worker's URL, so this works from any
    // deploy base (web sub-path, tauri://, capacitor https://localhost).
    importScripts('./vendor/occt/occt-import-js.js');
    occtPromise = occtimportjs({
      locateFile: (file) => './vendor/occt/' + file,
    });
  }
  return occtPromise;
}

self.onmessage = async (event) => {
  const { id, format, buffer } = event.data;
  try {
    const occt = await initOcct();
    const bytes = new Uint8Array(buffer);

    let result;
    if (format === 'step') {
      result = occt.ReadStepFile(bytes, null);
    } else if (format === 'iges') {
      result = occt.ReadIgesFile(bytes, null);
    } else if (format === 'brep') {
      result = occt.ReadBrepFile(bytes, null);
    } else {
      throw new Error('Unsupported CAD format: ' + format);
    }

    if (!result || !result.success) {
      throw new Error('OpenCASCADE could not parse this file. It may be corrupt or use an unsupported schema.');
    }

    // Re-pack tessellation into typed arrays and hand the underlying buffers
    // to postMessage as transferables — zero-copy back to the main thread.
    const meshes = [];
    const transfer = [];
    for (const mesh of result.meshes) {
      const positions = new Float32Array(mesh.attributes.position.array);
      const normals = mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null;
      const indices = mesh.index ? new Uint32Array(mesh.index.array) : null;
      meshes.push({
        name: mesh.name || '',
        color: mesh.color || null,
        positions,
        normals,
        indices,
      });
      transfer.push(positions.buffer);
      if (normals) transfer.push(normals.buffer);
      if (indices) transfer.push(indices.buffer);
    }

    self.postMessage({ id, ok: true, meshes, root: result.root }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
