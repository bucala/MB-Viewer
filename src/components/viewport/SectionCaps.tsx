import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { getWorldBox } from '@/core/scene';
import { PRESET_SURFACE, darkenHex, resolveAppearance } from '@/core/materials/presets';
import type { LoadedModel, MaterialPresetId, RenderEntry, SectionState } from '@/core/types';

/**
 * Solid-looking section: two stencil passes (back faces increment, front faces
 * decrement) mark a part's interior where the clip plane cuts it, then a
 * capping quad fills exactly that region in the part's own color, 30% darker.
 * Closed volumes read as solid; open shells show their (darker) back faces.
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

  const base = new THREE.MeshBasicMaterial();
  base.depthWrite = false;
  base.depthTest = false;
  base.colorWrite = false;
  base.stencilWrite = true;
  base.stencilFunc = THREE.AlwaysStencilFunc;

  const back = base.clone();
  back.side = THREE.BackSide;
  back.clippingPlanes = [plane];
  back.stencilFail = THREE.IncrementWrapStencilOp;
  back.stencilZFail = THREE.IncrementWrapStencilOp;
  back.stencilZPass = THREE.IncrementWrapStencilOp;
  const backMesh = new THREE.Mesh(geometry, back);
  backMesh.renderOrder = renderOrder;
  group.add(backMesh);

  const front = base.clone();
  front.side = THREE.FrontSide;
  front.clippingPlanes = [plane];
  front.stencilFail = THREE.DecrementWrapStencilOp;
  front.stencilZFail = THREE.DecrementWrapStencilOp;
  front.stencilZPass = THREE.DecrementWrapStencilOp;
  const frontMesh = new THREE.Mesh(geometry, front);
  frontMesh.renderOrder = renderOrder;
  group.add(frontMesh);

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
  entry, plane, upAxis, capSize, center, renderOrder,
}: {
  entry: RenderEntry;
  plane: THREE.Plane;
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
  useEffect(() => {
    const cap = capRef.current;
    if (!cap) return;
    const dist = plane.distanceToPoint(center);
    cap.position.copy(center).addScaledVector(plane.normal, -dist);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    invalidate();
  }, [plane, center, entry, invalidate]);

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
          upAxis={model.upAxis}
          capSize={capSize}
          center={center}
          renderOrder={2 + index * 2}
        />
      ))}
    </>
  );
}
