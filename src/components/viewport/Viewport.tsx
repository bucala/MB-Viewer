import { useMemo } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useViewer } from '@/store/viewerStore';
import { THEME_3D, useSettings } from '@/store/settingsStore';
import { getWorldBox, niceStep } from '@/core/scene';
import { SceneModel } from '@/components/viewport/SceneModel';
import { MeasureOverlay } from '@/components/viewport/MeasureOverlay';
import { CameraRig } from '@/components/viewport/CameraRig';
import { ViewCube } from '@/components/viewport/ViewCube';
import { AxesGizmo } from '@/components/viewport/AxesGizmo';
import { StudioEnvironment } from '@/components/viewport/StudioEnvironment';

/** Ground grid sized to the model (nice 1/2/5 steps, placed under it). */
function AdaptiveGrid() {
  const model = useViewer((s) => s.model);
  const gridVisible = useViewer((s) => s.gridVisible);
  const theme = useSettings((s) => s.theme);

  const config = useMemo(() => {
    if (!model) return null;
    const box = getWorldBox(model);
    const diagonal = box.getSize(new THREE.Vector3()).length() || 1;
    const cellSize = niceStep(diagonal / 30);
    return {
      y: box.min.y - diagonal * 0.001,
      cellSize,
      sectionSize: cellSize * 5,
      fadeDistance: diagonal * 4,
    };
  }, [model]);

  if (!model || !gridVisible || !config) return null;
  return (
    <Grid
      position={[0, config.y, 0]}
      args={[10, 10]}
      cellSize={config.cellSize}
      sectionSize={config.sectionSize}
      cellThickness={0.6}
      sectionThickness={1}
      cellColor={THEME_3D[theme].gridCell}
      sectionColor={THEME_3D[theme].gridSection}
      fadeDistance={config.fadeDistance}
      fadeStrength={1.5}
      infiniteGrid
      followCamera={false}
    />
  );
}

export function Viewport() {
  const theme = useSettings((s) => s.theme);
  const projection = useSettings((s) => s.projection);

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      className="touch-none"
      onPointerMissed={() => {
        const store = useViewer.getState();
        if (store.tool === 'select') store.setSelected(null);
      }}
    >
      <color attach="background" args={[THEME_3D[theme].canvas]} />
      {projection === 'perspective' ? (
        <PerspectiveCamera makeDefault position={[180, 130, 180]} fov={45} near={0.1} far={20000} />
      ) : (
        <OrthographicCamera makeDefault position={[180, 130, 180]} zoom={2} near={0.01} far={200000} />
      )}
      <StudioEnvironment />
      <directionalLight position={[300, 500, 200]} intensity={1.2} />

      <SceneModel />
      <MeasureOverlay />
      <AdaptiveGrid />

      <CameraRig />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <ViewCube />
      <AxesGizmo />
    </Canvas>
  );
}
