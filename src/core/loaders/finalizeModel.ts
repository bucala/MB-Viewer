import * as THREE from 'three';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { clearMaterialCache } from '@/core/materials/presets';

let modelSeq = 0;

/**
 * Shared last mile for every loader: index the tree, compute bounds and
 * stats. Loaders deliver BVHs built in the geometry worker; only geometry
 * without one (the tiny built-in sample) gets a main-thread BVH here.
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
    if (!geometry.boundsTree) {
      try {
        geometry.computeBoundsTree({ indirect: true });
      } catch {
        // BVH is an optimization only — picking falls back to linear raycast.
      }
    }
  }
  if (boundingBox.isEmpty()) {
    boundingBox.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }

  return {
    uid: ++modelSeq, name, root, meshes, meshToNode, nodeIndex, boundingBox, triangleCount, partCount, upAxis,
  };
}

/**
 * Free GPU resources when a model is replaced or closed. `clearMaterials`
 * is false for a model that was never shown (an aborted load): the shared
 * material cache still serves the model on screen.
 */
export function disposeModel(model: LoadedModel, clearMaterials = true): void {
  for (const mesh of model.meshes) {
    mesh.geometry.disposeBoundsTree?.();
    mesh.geometry.dispose();
    mesh.originalMaterial?.dispose();
  }
  if (clearMaterials) clearMaterialCache();
}
