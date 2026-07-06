import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

let installed = false;

/**
 * CAD tessellations easily reach millions of triangles; three's linear
 * raycast makes picking/measuring unusable there. three-mesh-bvh swaps in a
 * bounding-volume-hierarchy raycast (the BVH itself is built once per
 * geometry in finalizeModel). The package ships the matching `three` module
 * type augmentation.
 */
export function installBvhRaycast(): void {
  if (installed) return;
  installed = true;
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast as unknown as typeof THREE.Mesh.prototype.raycast;
}
