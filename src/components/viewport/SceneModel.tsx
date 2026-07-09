import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useViewer } from '@/store/viewerStore';
import { useSettings } from '@/store/settingsStore';
import { collectRenderEntries, sectionPlane } from '@/core/scene';
import { resolveMaterial } from '@/core/materials/presets';
import { classifyPickAt } from '@/core/measure/surface';
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
  const translucent = useViewer((s) => s.translucent);
  const overrides = useViewer((s) => s.overrides);
  const globalMaterial = useViewer((s) => s.globalMaterial);
  const selectedId = useViewer((s) => s.selectedId);
  const section = useViewer((s) => s.section);
  const transparency = useSettings((s) => s.transparency);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const entries = useMemo(
    () =>
      model
        ? collectRenderEntries(model, hidden, translucent, overrides, globalMaterial, selectedId)
        : [],
    [model, hidden, translucent, overrides, globalMaterial, selectedId],
  );

  const clippingPlanes = useMemo(
    () => (model ? sectionPlane(model, section) : null),
    [model, section],
  );

  // Attach the section plane to just the model's materials (local clipping),
  // so the grid, gizmos and measurements stay whole.
  useEffect(() => {
    const planes = clippingPlanes ? [clippingPlanes] : null;
    for (const entry of entries) {
      const material = resolveMaterial(entry, transparency);
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
    invalidate();
  }, [entries, clippingPlanes, transparency, invalidate]);

  const modelDiagonal = useMemo(
    () => (model ? model.boundingBox.getSize(new THREE.Vector3()).length() : 1),
    [model],
  );

  if (!model) return null;

  const handleClick = (entry: RenderEntry) => (event: ThreeEvent<MouseEvent>) => {
    // Ignore clicks at the end of an orbit drag.
    if (event.delta > 5) return;
    event.stopPropagation();
    const store = useViewer.getState();
    if (store.tool === 'select') {
      store.setSelected(store.selectedId === entry.nodeId ? null : entry.nodeId);
    } else if (store.tool === 'measure-point') {
      store.addMeasurePoint(resolveSnappedPoint(event, camera, size));
    } else {
      // Surface-based tools: classify the face/edge under the cursor; the
      // snapped point serves as the fallback when nothing is recognized.
      const pick = classifyPickAt(
        event.object as THREE.Mesh,
        event.faceIndex ?? null,
        event.point.clone(),
        modelDiagonal,
      );
      store.handleSmartPick(pick, resolveSnappedPoint(event, camera, size));
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
          material={resolveMaterial(entry, transparency)}
          onClick={handleClick(entry)}
        />
      ))}
    </group>
  );
}
