import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { getWorldBox } from '@/core/scene';
import { PRESET_SURFACE, darkenHex, resolveAppearance } from '@/core/materials/presets';
import type { LoadedModel, MaterialPresetId, RenderEntry, SectionState } from '@/core/types';

/**
 * Solid-looking section. Marking the stencil wherever the part has a back face
 * behind the clip plane fills the whole cross-section silhouette, so the cap
 * always covers the cut area for solids AND open shells (e.g. tubes/cones),
 * instead of only closed manifold volumes. The cap quad then fills exactly that
 * region in the part's own color, 30% darker.
 *
 * Each part gets its own stencil+cap pair on an increasing renderOrder, and the
 * stencil buffer is cleared after every cap, so parts never bleed into one
 * another and each cap is colored from that part's outer surface.
 */
function createStencilGroup(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  renderOrder: number,
): THREE.Group {
  const group = new THREE.Group();

  const back = new THREE.MeshBasicMaterial();
  back.depthWrite = false;
  back.depthTest = false;
  back.colorWrite = false;
  back.stencilWrite = true;
  back.stencilFunc = THREE.AlwaysStencilFunc;
  back.side = THREE.BackSide;
  back.clippingPlanes = [plane];
  back.stencilFail = THREE.IncrementWrapStencilOp;
  back.stencilZFail = THREE.IncrementWrapStencilOp;
  back.stencilZPass = THREE.IncrementWrapStencilOp;
  const backMesh = new THREE.Mesh(geometry, back);
  backMesh.renderOrder = renderOrder;
  group.add(backMesh);

  return group;
}

function createCapMaterial(color: string, preset: MaterialPresetId): THREE.MeshStandardMaterial {
  const surface = PRESET_SURFACE[preset];
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(darkenHex(color)),
    roughness: surface.roughness,
    metalness: surface.metalness,
    side: THREE.DoubleSide,
    // Fill only where the stencil marks the part's interior.
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  // Screen-space diagonal hatching over the fill.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float mbHatch = mod(gl_FragCoord.x + gl_FragCoord.y, 6.0);
       if (mbHatch < 1.5) diffuseColor.rgb *= 0.82;`,
    );
  };
  material.customProgramCacheKey = () => 'mbv-cap-hatch';
  return material;
}

/** One part's cross-section cap, colored from its own outer surface. */
function PartCap({
  entry, plane, section, upAxis, capSize, center, renderOrder,
}: {
  entry: RenderEntry;
  plane: THREE.Plane;
  section: SectionState;
  upAxis: LoadedModel['upAxis'];
  capSize: number;
  center: THREE.Vector3;
  renderOrder: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const capRef = useRef<THREE.Mesh>(null);
  const { color, preset } = resolveAppearance(entry);
  const capPreset: MaterialPresetId = preset === 'glass' ? 'matte' : preset;

  const stencilGroup = useMemo(() => {
    const rotated = new THREE.Group();
    rotated.rotation.x = upAxis === 'z' ? -Math.PI / 2 : 0;
    rotated.add(createStencilGroup(entry.mesh.geometry, plane, renderOrder));
    return rotated;
  }, [entry.mesh.geometry, plane, upAxis, renderOrder]);

  const capGeometry = useMemo(() => new THREE.PlaneGeometry(capSize, capSize), [capSize]);
  const capMaterial = useMemo(() => createCapMaterial(color, capPreset), [color, capPreset]);

  // Sit the cap on the clip plane, centered on the model's cross-section.
  // `plane` is a stable, mutated instance, so we key this on `section` (whose
  // identity changes on every slider move) to follow the cut as it slides.
  useEffect(() => {
    const cap = capRef.current;
    if (!cap) return;
    const dist = plane.distanceToPoint(center);
    cap.position.copy(center).addScaledVector(plane.normal, -dist);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    invalidate();
  }, [plane, section, center, invalidate]);

  useEffect(
    () => () => {
      stencilGroup.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
      });
    },
    [stencilGroup],
  );
  useEffect(() => () => { capGeometry.dispose(); }, [capGeometry]);
  useEffect(() => () => { capMaterial.dispose(); }, [capMaterial]);

  return (
    <>
      <primitive object={stencilGroup} />
      <mesh
        ref={capRef}
        geometry={capGeometry}
        material={capMaterial}
        renderOrder={renderOrder + 1}
        onAfterRender={(renderer) => renderer.clearStencil()}
      />
    </>
  );
}

export function SectionCaps({
  model, entries, plane, section,
}: {
  model: LoadedModel;
  entries: RenderEntry[];
  plane: THREE.Plane;
  section: SectionState;
}) {
  const { capSize, center } = useMemo(() => {
    const box = getWorldBox(model);
    return {
      capSize: box.getSize(new THREE.Vector3()).length() * 1.25 || 1,
      center: box.getCenter(new THREE.Vector3()),
    };
  }, [model]);

  return (
    <>
      {entries.map((entry, index) => (
        <PartCap
          key={`${entry.mesh.id}:${section.axis}`}
          entry={entry}
          plane={plane}
          section={section}
          upAxis={model.upAxis}
          capSize={capSize}
          center={center}
          renderOrder={2 + index * 2}
        />
      ))}
    </>
  );
}
