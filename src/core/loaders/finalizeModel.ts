import * as THREE from 'three';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';

/**
 * Shared last mile for every loader: index the tree, compute bounds and
 * stats, build BVHs for fast picking.
 */
export function finalizeModel(
  name: string,
  root: ModelNode,
  meshes: ModelMesh[],
  upAxis: 'y' | 'z',
): LoadedModel {
  const meshToNode: Record<number, string> = {};
  const nodeIndex: Record<string, ModelNode> = {};
  let partCount = 0;

  const walk = (node: ModelNode) => {
    nodeIndex[node.id] = node;
    if (node.children.length === 0) partCount += 1;
    for (const meshId of node.meshIds) meshToNode[meshId] = node.id;
    node.children.forEach(walk);
  };
  walk(root);

  const boundingBox = new THREE.Box3();
  let triangleCount = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    if (geometry.boundingBox) boundingBox.union(geometry.boundingBox);
    triangleCount += Math.floor(
      (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
    );
    try {
      geometry.computeBoundsTree();
    } catch {
      // BVH is an optimization only — picking falls back to linear raycast.
    }
  }
  if (boundingBox.isEmpty()) {
    boundingBox.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }

  return { name, root, meshes, meshToNode, nodeIndex, boundingBox, triangleCount, partCount, upAxis };
}

/** Free GPU resources when a model is replaced or closed. */
export function disposeModel(model: LoadedModel): void {
  for (const mesh of model.meshes) {
    mesh.geometry.disposeBoundsTree?.();
    mesh.geometry.dispose();
    mesh.originalMaterial?.dispose();
  }
}
