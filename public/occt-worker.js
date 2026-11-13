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
 *   in : { id, format: 'step'|'iges'|'brep', buffer: ArrayBuffer,
 *          quality?: 'coarse'|'standard'|'fine' }
 *   out: { id, ok: true, meshes: [...], root: {...} }   (typed arrays transferred)
 *        { id, ok: false, error: string }
 *
 * Each mesh carries `faceRanges` (pairs of first/last triangle index per
 * B-rep face) so measuring can fit the exact clicked face. A body whose
 * faces have different colors is split into one mesh per color.
 */

/* global importScripts, occtimportjs */

importScripts('./step-faceted.js');

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

// OpenCASCADE tessellation tolerances (lengths relative to the bounding box,
// angles in radians). `standard` is occt-import-js's own default.
const TESSELLATION = {
  coarse: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.003, angularDeflection: 0.8 },
  standard: null,
  fine: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0004, angularDeflection: 0.2 },
};

const colorKey = (color) => (color ? color.join(',') : '');

/**
 * One OCCT mesh -> one or more worker meshes. Faces are grouped by color
 * (face color, else the body color); a single group keeps the arrays as
 * they are, several groups get compacted vertex arrays each.
 */
function splitByFaceColor(mesh) {
  const positions = new Float32Array(mesh.attributes.position.array);
  const normals = mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null;
  const indices = mesh.index ? new Uint32Array(mesh.index.array) : null;
  const faces = (mesh.brep_faces || []).slice().sort((a, b) => a.first - b.first);
  const name = mesh.name || '';
  const bodyColor = mesh.color || null;

  const groups = new Map();
  for (const face of faces) {
    const color = face.color || bodyColor;
    const key = colorKey(color);
    if (!groups.has(key)) groups.set(key, { color, faces: [] });
    groups.get(key).faces.push(face);
  }

  if (!indices || groups.size <= 1) {
    const faceRanges = new Uint32Array(faces.length * 2);
    faces.forEach((face, i) => { faceRanges[i * 2] = face.first; faceRanges[i * 2 + 1] = face.last; });
    const color = groups.size === 1 ? [...groups.values()][0].color : bodyColor;
    return [{ name, color, positions, normals, indices, faceRanges }];
  }

  const remap = new Int32Array(positions.length / 3);
  const parts = [];
  for (const { color, faces: groupFaces } of groups.values()) {
    remap.fill(-1);
    let triangles = 0;
    for (const face of groupFaces) triangles += face.last - face.first + 1;
    const newIndices = new Uint32Array(triangles * 3);
    const newPositions = new Float32Array(positions.length);
    const newNormals = normals ? new Float32Array(normals.length) : null;
    const faceRanges = new Uint32Array(groupFaces.length * 2);
    let vertexCount = 0;
    let cursor = 0;
    groupFaces.forEach((face, f) => {
      faceRanges[f * 2] = cursor / 3;
      for (let t = face.first; t <= face.last; t++) {
        for (let k = 0; k < 3; k++) {
          const v = indices[t * 3 + k];
          if (remap[v] < 0) {
            remap[v] = vertexCount;
            newPositions.set(positions.subarray(v * 3, v * 3 + 3), vertexCount * 3);
            if (newNormals) newNormals.set(normals.subarray(v * 3, v * 3 + 3), vertexCount * 3);
            vertexCount += 1;
          }
          newIndices[cursor++] = remap[v];
        }
      }
      faceRanges[f * 2 + 1] = cursor / 3 - 1;
    });
    parts.push({
      name,
      color,
      positions: newPositions.slice(0, vertexCount * 3),
      normals: newNormals ? newNormals.slice(0, vertexCount * 3) : null,
      indices: newIndices,
      faceRanges,
    });
  }
  return parts;
}

/** Point tree nodes at the split meshes (old mesh index -> new indices). */
function remapTree(node, meshMap) {
  return {
    ...node,
    meshes: (node.meshes || []).flatMap((m) => meshMap[m] || []),
    children: (node.children || []).map((child) => remapTree(child, meshMap)),
  };
}

function postResult(id, meshes, root) {
  const transfer = [];
  for (const mesh of meshes) {
    transfer.push(mesh.positions.buffer);
    if (mesh.normals) transfer.push(mesh.normals.buffer);
    if (mesh.indices) transfer.push(mesh.indices.buffer);
    if (mesh.faceRanges) transfer.push(mesh.faceRanges.buffer);
  }
  self.postMessage({ id, ok: true, meshes, root }, transfer);
}

self.onmessage = async (event) => {
  const { id, format, buffer, quality } = event.data;
  try {
    const bytes = new Uint8Array(buffer);
    if (format === 'step') {
      const faceted = self.readFacetedStep(bytes);
      if (faceted) {
        postResult(id, faceted.meshes, faceted.root);
        return;
      }
    }
    const occt = await initOcct();

    const params = TESSELLATION[quality] || null;
    let result;
    if (format === 'step') {
      result = occt.ReadStepFile(bytes, params);
    } else if (format === 'iges') {
      result = occt.ReadIgesFile(bytes, params);
    } else if (format === 'brep') {
      result = occt.ReadBrepFile(bytes, params);
    } else {
      throw new Error('Unsupported CAD format: ' + format);
    }

    if (!result || !result.success) {
      throw new Error('OpenCASCADE could not parse this file. It may be corrupt or use an unsupported schema.');
    }

    // Re-pack tessellation into typed arrays and hand the underlying buffers
    // to postMessage as transferables — zero-copy back to the main thread.
    const meshes = [];
    const meshMap = [];
    for (const mesh of result.meshes) {
      const parts = splitByFaceColor(mesh);
      meshMap.push(parts.map((_, i) => meshes.length + i));
      meshes.push(...parts);
    }

    if (!meshes.some((mesh) => mesh.positions.length >= 9 &&
        (!mesh.indices || mesh.indices.length >= 3))) {
      throw new Error('The CAD file contains no triangle geometry.');
    }
    postResult(id, meshes, remapTree(result.root, meshMap));
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};
