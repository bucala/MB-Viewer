import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { collectRenderEntries } from '@/core/scene';
import { resolveMaterial } from '@/core/materials/presets';
import type { LoadedModel, MaterialAssignment, RenderEntry } from '@/core/types';

/** Below this many parts one draw call per part is cheap enough. */
const MIN_PARTS_TO_BATCH = 64;

interface Batch {
  mesh: THREE.BatchedMesh;
  /** model mesh id -> instance id inside `mesh` */
  instances: Map<number, number>;
}

/** Parts shown by their own mesh instead of their batch (different material). */
export const drawsSeparately = (entry: RenderEntry) => entry.selected || entry.translucent;

/**
 * Draws large assemblies with one draw call per material instead of one per
 * part: parts sharing their base material (no selection, no ghosting) go
 * into a THREE.BatchedMesh. The per-part meshes stay in the scene, hidden,
 * so picking keeps its per-part BVHs, face ranges and section filtering.
 * A selected, translucent or hidden part only toggles its batch instance,
 * so batches are rebuilt only when material assignments change.
 */
export function useBatchedParts(
  model: LoadedModel | null,
  entries: RenderEntry[],
  overrides: Record<string, MaterialAssignment>,
  globalMaterial: MaterialAssignment,
) {
  const invalidate = useThree((s) => s.invalidate);

  const batches = useMemo<Batch[]>(() => {
    if (!model || model.meshes.length < MIN_PARTS_TO_BATCH) return [];
    const base = collectRenderEntries(model, {}, {}, overrides, globalMaterial, null);

    // BatchedMesh needs one material and identical attribute layouts.
    const groups = new Map<string, { material: THREE.Material; entries: RenderEntry[] }>();
    for (const entry of base) {
      const material = resolveMaterial(entry);
      const geometry = entry.mesh.geometry;
      const layout = Object.keys(geometry.attributes).sort().join(',');
      const key = `${material.uuid}|${layout}|${geometry.index ? 'i' : 'n'}`;
      const group = groups.get(key);
      if (group) group.entries.push(entry);
      else groups.set(key, { material, entries: [entry] });
    }

    const result: Batch[] = [];
    for (const { material, entries: members } of groups.values()) {
      if (members.length < 2) continue;
      let vertices = 0;
      let indices = 0;
      for (const { mesh } of members) {
        vertices += mesh.geometry.attributes.position.count;
        indices += mesh.geometry.index?.count ?? 0;
      }
      const batched = new THREE.BatchedMesh(members.length, vertices, Math.max(indices, 1), material);
      const instances = new Map<number, number>();
      for (const { mesh } of members) {
        const geometryId = batched.addGeometry(mesh.geometry);
        instances.set(mesh.id, batched.addInstance(geometryId));
      }
      // Never a pick target: the hidden per-part meshes handle events.
      batched.raycast = () => {};
      result.push({ mesh: batched, instances });
    }
    return result;
  }, [model, overrides, globalMaterial]);

  useEffect(() => () => batches.forEach((batch) => batch.mesh.dispose()), [batches]);

  const batchedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const batch of batches) for (const id of batch.instances.keys()) ids.add(id);
    return ids;
  }, [batches]);

  // Show exactly the visible, regularly drawn parts in their batches.
  useEffect(() => {
    if (batches.length === 0) return;
    const shown = new Set<number>();
    for (const entry of entries) if (!drawsSeparately(entry)) shown.add(entry.mesh.id);
    for (const batch of batches) {
      for (const [meshId, instanceId] of batch.instances) {
        batch.mesh.setVisibleAt(instanceId, shown.has(meshId));
      }
    }
    invalidate();
  }, [batches, entries, invalidate]);

  return { batches: batches.map((batch) => batch.mesh), batchedIds };
}
