import { useMemo } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useViewer } from '@/store/viewerStore';
import { collectRenderEntries } from '@/core/scene';
import { resolveMaterial } from '@/core/materials/presets';
import type { RenderEntry, Vec3 } from '@/core/types';

/** Screen-space radius within which a click snaps to the nearest vertex. */
const SNAP_RADIUS_PX = 14;

/**
 * Snap the picked point to the closest vertex of the hit triangle when it is
 * within SNAP_RADIUS_PX on screen; otherwise keep the raw surface hit.
 * Everything is world space, so measurements are independent of the model's
 * display rotation.
 */
function resolveSnappedPoint(
  event: ThreeEvent<MouseEvent>,
  camera: THREE.Camera,
  size: { width: number; height: number },
): Vec3 {
  const hit = event.point.clone();
  const mesh = event.object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const face = event.face;
  if (!face || !geometry?.attributes.position) return hit.toArray() as Vec3;

  const position = geometry.attributes.position;
  let best: THREE.Vector3 | null = null;
  let bestPx = SNAP_RADIUS_PX;
  for (const index of [face.a, face.b, face.c]) {
    const vertex = new THREE.Vector3()
      .fromBufferAttribute(position, index)
      .applyMatrix4(mesh.matrixWorld);
    const ndc = vertex.clone().project(camera);
    const dx = ((ndc.x - event.pointer.x) * size.width) / 2;
    const dy = ((ndc.y - event.pointer.y) * size.height) / 2;
    const px = Math.hypot(dx, dy);
    if (px < bestPx) {
      bestPx = px;
      best = vertex;
    }
  }
  return (best ?? hit).toArray() as Vec3;
}

export function SceneModel() {
  const model = useViewer((s) => s.model);
  const hidden = useViewer((s) => s.hidden);
  const overrides = useViewer((s) => s.overrides);
  const globalMaterial = useViewer((s) => s.globalMaterial);
  const selectedId = useViewer((s) => s.selectedId);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const entries = useMemo(
    () => (model ? collectRenderEntries(model, hidden, overrides, globalMaterial, selectedId) : []),
    [model, hidden, overrides, globalMaterial, selectedId],
  );

  if (!model) return null;

  const handleClick = (entry: RenderEntry) => (event: ThreeEvent<MouseEvent>) => {
    // Ignore clicks at the end of an orbit drag.
    if (event.delta > 5) return;
    event.stopPropagation();
    const store = useViewer.getState();
    if (store.tool === 'select') {
      store.setSelected(store.selectedId === entry.nodeId ? null : entry.nodeId);
    } else {
      store.addMeasurePoint(resolveSnappedPoint(event, camera, size));
    }
  };

  return (
    // CAD files are conventionally Z-up; rotate the whole model to Y-up for
    // display. Rigid rotation, so world-space measurements stay valid.
    <group rotation={model.upAxis === 'z' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
      {entries.map((entry) => (
        <mesh
          key={`${entry.mesh.id}`}
          geometry={entry.mesh.geometry}
          material={resolveMaterial(entry)}
          onClick={handleClick(entry)}
        />
      ))}
    </group>
  );
}
