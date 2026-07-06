import { GizmoHelper, GizmoViewcube } from '@react-three/drei';

/**
 * Interactive navigation cube. Clicking a face, edge or corner smoothly
 * tweens the camera to the matching orthographic/isometric direction
 * (GizmoHelper animates against the default OrbitControls).
 */
export function ViewCube() {
  return (
    <GizmoHelper alignment="top-right" margin={[72, 92]}>
      <GizmoViewcube
        color="#fafbfc"
        hoverColor="#bfdbfe"
        strokeColor="#94a3b8"
        textColor="#334155"
        opacity={1}
        faces={['Right', 'Left', 'Top', 'Bottom', 'Front', 'Back']}
      />
    </GizmoHelper>
  );
}
