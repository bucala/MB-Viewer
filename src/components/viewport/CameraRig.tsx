import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@/store/viewerStore';
import { getWorldBox } from '@/core/scene';

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

const FIT_DIRECTION = new THREE.Vector3(1, 0.62, 1).normalize();

/**
 * Frames the model whenever one is loaded, a re-fit is requested or the
 * camera (projection mode) changes, and adapts clipping planes/zoom to the
 * model's scale (CAD files range from millimeter screws to buildings).
 */
export function CameraRig() {
  const model = useViewer((s) => s.model);
  const fitSignal = useViewer((s) => s.fitSignal);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;

  useEffect(() => {
    if (!model) return;

    const box = getWorldBox(model);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const persp = camera as THREE.PerspectiveCamera;
      const distance = (radius / Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) * 1.15;
      persp.position.copy(center).addScaledVector(FIT_DIRECTION, distance);
      persp.near = Math.max(distance / 1000, radius / 1000);
      persp.far = distance + radius * 20;
      persp.updateProjectionMatrix();
    } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      const distance = radius * 4;
      ortho.position.copy(center).addScaledVector(FIT_DIRECTION, distance);
      // drei's OrthographicCamera frustum is in pixels; zoom maps world units
      // so the model's bounding sphere fills ~87% of the shorter side.
      ortho.zoom = Math.min(size.width, size.height) / (2 * radius * 1.15);
      ortho.near = radius / 1000;
      ortho.far = distance + radius * 20;
      ortho.updateProjectionMatrix();
    }

    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else {
      camera.lookAt(center);
    }
  }, [model, fitSignal, camera, size, controls]);

  return null;
}
