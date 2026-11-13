import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useViewer } from '@/store/viewerStore';
import { useSettings } from '@/store/settingsStore';
import { collectRenderEntries, sectionPlane } from '@/core/scene';
import { resolveMaterial } from '@/core/materials/presets';
import { classifyPickAt, type SmartPick } from '@/core/measure/surface';
import { SectionCaps } from '@/components/viewport/SectionCaps';
import { drawsSeparately, useBatchedParts } from '@/components/viewport/useBatchedParts';
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

/** A hit moved onto the section cap (the click landed on the cut face). */
type CapIntersection = THREE.Intersection & { sectionCap?: true };

/**
 * three.js raycasting ignores clipping planes, so without this, clicks in a
 * section view select and measure the cut-away (invisible) half. Hits on the
 * clipped side are dropped; when the first remaining hit is the inside of
 * the same solid seen through the cut, the click is on the section cap and
 * the point is moved onto the cut plane. Filtering must happen per mesh,
 * because R3F keeps only the first intersection of each object.
 */
function createClippedRaycast(plane: THREE.Plane, active: { current: boolean }) {
  const faceNormal = new THREE.Vector3();
  return function clippedRaycast(
    this: THREE.Mesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) {
    const start = intersects.length;
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);
    if (!active.current || intersects.length === start) return;

    const hits = intersects.splice(start).sort((a, b) => a.distance - b.distance);
    const capDistance = raycaster.ray.distanceToPlane(plane);
    let clippedBeforeCap = false;
    for (const hit of hits) {
      if (plane.distanceToPoint(hit.point) < 0) {
        if (capDistance !== null && hit.distance < capDistance) clippedBeforeCap = true;
        continue;
      }
      if (clippedBeforeCap && capDistance !== null && hit.face) {
        faceNormal.copy(hit.face.normal).transformDirection(this.matrixWorld);
        if (faceNormal.dot(raycaster.ray.direction) > 0) {
          const capHit: CapIntersection = {
            ...hit,
            point: raycaster.ray.at(capDistance, new THREE.Vector3()),
            distance: capDistance,
            sectionCap: true,
          };
          intersects.push(capHit);
          clippedBeforeCap = false;
          continue;
        }
      }
      clippedBeforeCap = false;
      intersects.push(hit);
    }
  };
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

  const { batches, batchedIds } = useBatchedParts(model, entries, overrides, globalMaterial);

  // One stable Plane instance (and array) so slider drags only mutate its
  // coefficients instead of swapping the material's clippingPlanes each frame,
  // which would otherwise trigger a shader recompile per frame.
  const planeRef = useRef(new THREE.Plane());
  const clipArrayRef = useRef<THREE.Plane[]>([planeRef.current]);

  const sectionActive = useMemo(() => {
    if (!model) return false;
    const plane = sectionPlane(model, section);
    if (!plane) return false;
    planeRef.current.copy(plane);
    return true;
  }, [model, section]);

  // The plane is mutated in place (see above), which three.js cannot see:
  // redraw on every move — with or without section caps.
  useEffect(() => {
    invalidate();
  }, [section, invalidate]);

  const sectionActiveRef = useRef(sectionActive);
  sectionActiveRef.current = sectionActive;
  const clippedRaycast = useMemo(
    () => createClippedRaycast(planeRef.current, sectionActiveRef),
    [],
  );

  // Attach the (stable) section plane to just the model's materials (local
  // clipping), so the grid, gizmos and measurements stay whole. Only flag a
  // recompile when clipping toggles on/off, not on every plane move.
  const prevActive = useRef(false);
  useEffect(() => {
    const planes = sectionActive ? clipArrayRef.current : null;
    for (const entry of entries) {
      const material = resolveMaterial(entry, transparency);
      material.clippingPlanes = planes;
      if (sectionActive !== prevActive.current) material.needsUpdate = true;
    }
    prevActive.current = sectionActive;
    invalidate();
  }, [entries, sectionActive, transparency, invalidate]);


  if (!model) return null;

  const handleClick = (entry: RenderEntry) => (event: ThreeEvent<MouseEvent>) => {
    // Ignore clicks at the end of an orbit drag.
    if (event.delta > 5) return;
    event.stopPropagation();
    const store = useViewer.getState();
    // On the section cap there is no tessellated face under the cursor —
    // the hit is the cut plane itself.
    const onCap = (event as ThreeEvent<MouseEvent> & CapIntersection).sectionCap === true;
    const point = onCap ? (event.point.toArray() as Vec3) : resolveSnappedPoint(event, camera, size);
    if (store.tool === 'select') {
      store.setSelected(store.selectedId === entry.nodeId ? null : entry.nodeId);
    } else if (store.tool === 'measure-point') {
      store.addMeasurePoint(point);
    } else {
      // Surface-based tools: classify the face/edge under the cursor; the
      // snapped point serves as the fallback when nothing is recognized.
      const pick: SmartPick = onCap
        ? { kind: 'plane', point, normal: planeRef.current.normal.toArray() as Vec3 }
        : classifyPickAt(
            event.object as THREE.Mesh,
            event.faceIndex ?? null,
            event.point.clone(),
          );
      store.handleSmartPick(pick, point);
    }
  };

  return (
    <>
      {/* CAD files are conventionally Z-up; rotate the whole model to Y-up for
          display. Rigid rotation, so world-space measurements stay valid. */}
      <group rotation={model.upAxis === 'z' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
        {batches.map((batch) => (
          <primitive key={batch.uuid} object={batch} />
        ))}
        {/* Per-part meshes always handle picking; a batched part is drawn by
            its batch and its own mesh stays invisible (raycasts ignore
            visibility). */}
        {entries.map((entry) => (
          <mesh
            key={`${entry.mesh.id}`}
            geometry={entry.mesh.geometry}
            material={resolveMaterial(entry, transparency)}
            visible={!batchedIds.has(entry.mesh.id) || drawsSeparately(entry)}
            raycast={clippedRaycast}
            onClick={handleClick(entry)}
          />
        ))}
      </group>
      {/* Section caps live in world space (they build their own display
          rotation internally), so they are a sibling of the model group. */}
      {sectionActive && section.fill && (
        <SectionCaps
          model={model}
          entries={entries}
          plane={planeRef.current}
          section={section}
        />
      )}
    </>
  );
}
