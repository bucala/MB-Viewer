import * as THREE from 'three';
import type { MaterialPresetId, RenderEntry } from '@/core/types';

export const PRESET_LABELS: Record<MaterialPresetId, string> = {
  original: 'Original',
  matte: 'Matte Plastic',
  shiny: 'Shiny Plastic',
  metal: 'Metal',
  glass: 'Glass',
};

export const PRESET_ORDER: MaterialPresetId[] = ['original', 'matte', 'shiny', 'metal', 'glass'];

export const SWATCH_COLORS = [
  '#e5e7eb', '#9ca3af', '#475569', '#1e293b',
  '#dc2626', '#ea580c', '#f59e0b', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777',
];

/** Neutral fallback when the CAD file carries no color. */
const DEFAULT_CAD_COLOR = '#aab4bf';
const SELECTION_TINT = '#3b82f6';

function createPresetMaterial(preset: MaterialPresetId, color: string): THREE.MeshPhysicalMaterial {
  const base = { color: new THREE.Color(color) };
  switch (preset) {
    case 'matte':
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.92, metalness: 0 });
    case 'shiny':
      return new THREE.MeshPhysicalMaterial({
        ...base, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
      });
    case 'metal':
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.32, metalness: 1 });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({
        ...base, roughness: 0.06, metalness: 0, transmission: 0.92, thickness: 2,
        ior: 1.5, transparent: true, side: THREE.DoubleSide,
      });
    case 'original':
    default:
      return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.55, metalness: 0.25 });
  }
}

function applySelectionTint(material: THREE.Material): void {
  const std = material as THREE.MeshStandardMaterial;
  if ('emissive' in std) {
    std.emissive = new THREE.Color(SELECTION_TINT);
    std.emissiveIntensity = 0.3;
  }
}

// Materials are shared across meshes and memoized by appearance key — a
// 5,000-part assembly with one global preset uses a handful of materials.
const cache = new Map<string, THREE.Material>();

export function resolveMaterial(entry: RenderEntry): THREE.Material {
  const { assignment, mesh, selected } = entry;

  // 'original' on a glTF model keeps the material shipped in the file.
  if (assignment.preset === 'original' && !assignment.color && mesh.originalMaterial) {
    if (!selected) return mesh.originalMaterial;
    const key = `orig:${mesh.originalMaterial.uuid}`;
    let material = cache.get(key);
    if (!material) {
      material = mesh.originalMaterial.clone();
      applySelectionTint(material);
      cache.set(key, material);
    }
    return material;
  }

  const color = assignment.color ?? mesh.color ?? DEFAULT_CAD_COLOR;
  const key = `${assignment.preset}:${color}:${selected ? 1 : 0}`;
  let material = cache.get(key);
  if (!material) {
    material = createPresetMaterial(assignment.preset, color);
    if (selected) applySelectionTint(material);
    cache.set(key, material);
  }
  return material;
}
