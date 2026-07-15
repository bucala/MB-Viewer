import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { getWorldBox } from '@/core/scene';
import { PRESET_SURFACE } from '@/core/materials/presets';
import type { LoadedModel, MaterialPresetId, RenderEntry, SectionState } from '@/core/types';

/**
 * Solid-looking section: two stencil passes (back faces increment, front faces
 * decrement) mark the model's interior where the clip plane cuts it, then a
 * capping quad fills exactly that region. Closed volumes read as solid;
 * open shells simply show their (darker) back faces through the cut.
 */
function createStencilGroup(geometry: THREE.BufferGeometry, plane: THREE.Plane): THREE.Group {
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
  backMesh.renderOrder = 1;
  group.add(backMesh);

  const front = base.clone();
  front.side = THREE.FrontSide;
  front.clippingPlanes = [plane];
  front.stencilFail = THREE.DecrementWrapStencilOp;
  front.stencilZFail = THREE.DecrementWrapStencilOp;
  front.stencilZPass = THREE.DecrementWrapStencilOp;
  const frontMesh = new THREE.Mesh(geometry, front);
  frontMesh.renderOrder = 1;
  group.add(frontMesh);

  return group;
}

function createCapMaterial(color: string, preset: MaterialPresetId): THREE.MeshStandardMaterial {
  const surface = PRESET_SURFACE[preset];
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: surface.roughness,
    metalness: surface.metalness,
    side: THREE.DoubleSide,
    // Fill only where the stencil marks the model's interior.
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
       if (mbHatch < 1.5) diffuseColor.rgb *= 0.72;`,
    );
  };
  material.customProgramCacheKey = () => 'mbv-cap-hatch';
  return material;
}

export function SectionCaps({
  model, entries, plane, section, capColor, capPreset,
}: {
  model: LoadedModel;
  entries: RenderEntry[];
  plane: THREE.Plane;
  section: SectionState;
  capColor: string;
  capPreset: MaterialPresetId;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const capRef = useRef<THREE.Mesh>(null);

  const stencilGroup = useMemo(() => {
    const outer = new THREE.Group();
    const rotated = new THREE.Group();
    rotated.rotation.x = model.upAxis === 'z' ? -Math.PI / 2 : 0;
    for (const entry of entries) rotated.add(createStencilGroup(entry.mesh.geometry, plane));
    outer.add(rotated);
    return outer;
  }, [model, entries, plane]);

  const capGeometry = useMemo(() => {
    const size = getWorldBox(model).getSize(new THREE.Vector3()).length() * 1.25 || 1;
    return new THREE.PlaneGeometry(size, size);
  }, [model]);

  const capMaterial = useMemo(() => createCapMaterial(capColor, capPreset), [capColor, capPreset]);

  // Sit the cap on the clip plane, centered on the model's cross-section.
  useEffect(() => {
    const cap = capRef.current;
    if (!cap) return;
    const center = getWorldBox(model).getCenter(new THREE.Vector3());
    const dist = plane.distanceToPoint(center);
    cap.position.copy(center).addScaledVector(plane.normal, -dist);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    invalidate();
  }, [model, plane, section, invalidate]);

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
        renderOrder={1.1}
        onAfterRender={(renderer) => renderer.clearStencil()}
      />
    </>
  );
}
