import { BufferAttribute, Color, Matrix3, Matrix4, SRGBColorSpace } from 'three';
import type { LabelTag, Mesh, OcctKernel } from 'occt-wasm';
import type { WorkerMesh, WorkerNode, WorkerResult } from './occtLoader';

export function recoverStepByPart(kernel: OcctKernel, bytes: Uint8Array): WorkerResult {
  // Embind accepts the STEP bytes for its std::string parameter. Passing
  // them directly avoids decoding a potentially large file into another copy.
  const doc = kernel.importXCAFFromSTEP(bytes as unknown as string);
  const meshes: WorkerMesh[] = [];
  const prototypes = new Map<LabelTag, Mesh>();

  const walk = (label: LabelTag, parent: Matrix4): WorkerNode => {
    const prototype = doc.getReferredLabel(label) ?? label;
    const info = doc.getLabelInfo(prototype);
    try {
      const loc = doc.getLocation(label);
      const world = parent.clone().multiply(new Matrix4().set(
        loc[0], loc[1], loc[2], loc[3],
        loc[4], loc[5], loc[6], loc[7],
        loc[8], loc[9], loc[10], loc[11],
        0, 0, 0, 1,
      ));
      const node: WorkerNode = { name: info.name, meshes: [], children: [] };
      const labels = doc.getChildren(prototype);
      if (labels.length) {
        node.children = labels.map((child) => walk(child, world));
      } else if (info.shapeHandle !== null) {
        let mesh = prototypes.get(prototype);
        if (!mesh) {
          mesh = kernel.tessellate(info.shapeHandle);
          prototypes.set(prototype, mesh);
        }
        if (mesh.indices.length >= 3 && mesh.positions.length >= 9) {
          // Bake the placement into the vertices and give each instance its
          // own indices so the viewer can reorder them when building its BVH.
          const positions = mesh.positions.slice();
          new BufferAttribute(positions, 3).applyMatrix4(world);
          const normals = mesh.normals.length === positions.length ? mesh.normals.slice() : null;
          if (normals) new BufferAttribute(normals, 3).applyNormalMatrix(new Matrix3().getNormalMatrix(world));
          const color = info.hasColor ? new Color().setRGB(...info.color, SRGBColorSpace) : null;
          node.meshes = [meshes.length];
          meshes.push({
            name: info.name, positions, normals, indices: mesh.indices.slice(),
            color: color ? [color.r, color.g, color.b] : null,
          });
        }
      }
      return node;
    } finally {
      if (info.shapeHandle !== null) kernel.release(info.shapeHandle);
    }
  };

  try {
    const identity = new Matrix4();
    const root = { meshes: [], children: doc.getRoots().map((label) => walk(label, identity)) };
    if (!meshes.length) throw new Error('STEP recovery returned no displayable geometry.');
    return { root, meshes };
  } finally {
    doc.close();
  }
}
