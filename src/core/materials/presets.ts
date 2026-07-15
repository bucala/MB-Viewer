import * as THREE from 'three';
import type { MaterialPresetId, RenderEntry } from '@/core/types';

export const PRESET_ORDER: MaterialPresetId[] = ['original', 'matte', 'shiny', 'metal', 'glass'];

export const SWATCH_COLORS = [
  '#e5e7eb', '#9ca3af', '#475569', '#1e293b',
  '#dc2626', '#ea580c', '#f59e0b', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777',
];

/** Neutral fallback when the CAD file carries no color. */
export const DEFAULT_CAD_COLOR = '#aab4bf';
const SELECTION_TINT = '#d97757';

/** How much darker interior (back-facing) surfaces and section caps are. */
export const INTERIOR_DARKEN = 0.3;

/** Roughness/metalness per preset — reused to build matching section caps. */
export const PRESET_SURFACE: Record<MaterialPresetId, { roughness: number; metalness: number }> = {
  original: { roughness: 0.55, metalness: 0.25 },
  matte: { roughness: 0.92, metalness: 0 },
  shiny: { roughness: 0.16, metalness: 0 },
  metal: { roughness: 0.32, metalness: 1 },
  glass: { roughness: 0.2, metalness: 0 },
};

/** Multiply an sRGB hex color toward black by `factor` (0–1). */
export function darkenHex(hex: string, factor = INTERIOR_DARKEN): string {
  const c = new THREE.Color(hex).multiplyScalar(1 - factor);
  return `#${c.getHexString()}`;
}

/**
 * Render both sides and shade back faces darker, so a section cut reveals the
 * interior in the same look as the outside, just {INTERIOR_DARKEN} darker.
 */
function applyInteriorShading(material: THREE.Material): void {
  material.side = THREE.DoubleSide;
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= ${(1 - INTERIOR_DARKEN).toFixed(3)};`,
    );
  };
  material.customProgramCacheKey = () => 'mbv-interior';
}

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

/** Ghost mode for parts toggled translucent in the tree. */
function applyTranslucency(material: THREE.Material, opacity: number): void {
  material.transparent = true;
  material.opacity = opacity;
  material.depthWrite = false;
}

// Materials are shared across meshes and memoized by appearance key — a
// 5,000-part assembly with one global preset uses a handful of materials.
const cache = new Map<string, THREE.Material>();

/** The outer color and preset a part is actually drawn with. */
export function resolveAppearance(entry: RenderEntry): { color: string; preset: MaterialPresetId } {
  const { assignment, mesh } = entry;
  return {
    color: assignment.color ?? mesh.color ?? DEFAULT_CAD_COLOR,
    preset: assignment.preset,
  };
}

export function resolveMaterial(entry: RenderEntry, translucentOpacity = 0.35): THREE.Material {
  const { assignment, mesh, selected, translucent } = entry;
  const ghostKey = translucent ? `:g${translucentOpacity.toFixed(2)}` : '';

  // 'original' on a glTF model keeps the material shipped in the file.
  if (assignment.preset === 'original' && !assignment.color && mesh.originalMaterial) {
    if (!selected && !translucent) return mesh.originalMaterial;
    const key = `orig:${mesh.originalMaterial.uuid}:${selected ? 1 : 0}${ghostKey}`;
    let material = cache.get(key);
    if (!material) {
      material = mesh.originalMaterial.clone();
      if (selected) applySelectionTint(material);
      if (translucent) applyTranslucency(material, translucentOpacity);
      cache.set(key, material);
    }
    return material;
  }

  const color = assignment.color ?? mesh.color ?? DEFAULT_CAD_COLOR;
  const key = `${assignment.preset}:${color}:${selected ? 1 : 0}${ghostKey}`;
  let material = cache.get(key);
  if (!material) {
    material = createPresetMaterial(assignment.preset, color);
    if (assignment.preset !== 'glass') applyInteriorShading(material);
    if (selected) applySelectionTint(material);
    if (translucent) applyTranslucency(material, translucentOpacity);
    cache.set(key, material);
  }
  return material;
}
