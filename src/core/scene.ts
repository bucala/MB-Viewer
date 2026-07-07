import * as THREE from 'three';
import type { LoadedModel, MaterialAssignment, ModelNode, RenderEntry } from '@/core/types';

/**
 * One traversal of the assembly tree resolves everything the renderer needs:
 * visibility (a hidden node hides its subtree), material inheritance
 * (nearest ancestor override, else the global assignment) and selection
 * highlighting (selecting a group highlights all of its parts).
 */
export function collectRenderEntries(
  model: LoadedModel,
  hidden: Record<string, true>,
  translucent: Record<string, true>,
  overrides: Record<string, MaterialAssignment>,
  globalMaterial: MaterialAssignment,
  selectedId: string | null,
): RenderEntry[] {
  const entries: RenderEntry[] = [];

  const walk = (
    node: ModelNode,
    inherited: MaterialAssignment | null,
    selected: boolean,
    ghost: boolean,
  ) => {
    if (hidden[node.id]) return;
    const assignment = overrides[node.id] ?? inherited;
    const isSelected = selected || node.id === selectedId;
    const isGhost = ghost || Boolean(translucent[node.id]);
    for (const meshId of node.meshIds) {
      const mesh = model.meshes[meshId];
      if (!mesh) continue;
      entries.push({
        mesh,
        nodeId: node.id,
        assignment: assignment ?? globalMaterial,
        selected: isSelected,
        translucent: isGhost,
      });
    }
    for (const child of node.children) walk(child, assignment, isSelected, isGhost);
  };

  walk(model.root, null, false, false);
  return entries;
}

const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/** Model bounds in world space, i.e. after the up-axis display rotation. */
export function getWorldBox(model: LoadedModel): THREE.Box3 {
  const box = model.boundingBox.clone();
  if (model.upAxis === 'z') box.applyMatrix4(Z_UP_TO_Y_UP);
  return box;
}

/** Round to a "nice" 1/2/5×10ⁿ step, for grid sizing. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / power;
  const step = mantissa < 1.5 ? 1 : mantissa < 3.5 ? 2 : mantissa < 7.5 ? 5 : 10;
  return step * power;
}
