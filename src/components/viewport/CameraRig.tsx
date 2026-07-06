import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@/store/viewerStore';
import { getWorldBox } from '@/core/scene';

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * Frames the model whenever one is loaded or a re-fit is requested, and
 * adapts the clipping planes to the model's scale (CAD files range from
 * millimeter screws to buildings).
 */
export function CameraRig() {
  const model = useViewer((s) => s.model);
  const fitSignal = useViewer((s) => s.fitSignal);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;

  useEffect(() => {
    if (!model || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const persp = camera as THREE.PerspectiveCamera;

    const box = getWorldBox(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const distance = (radius / Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) * 1.15;

    persp.position
      .copy(center)
      .add(new THREE.Vector3(1, 0.62, 1).normalize().multiplyScalar(distance));
    persp.near = Math.max(distance / 1000, radius / 1000);
    persp.far = distance + radius * 20;
    persp.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else {
      persp.lookAt(center);
    }
  }, [model, fitSignal, camera, controls]);

  return null;
}
