import { GizmoHelper, GizmoViewport } from '@react-three/drei';
import { THEME_3D, useSettings } from '@/store/settingsStore';

/**
 * XYZ orientation triad in the bottom-right corner. Clicking an axis head
 * snaps the camera to that axis (same tween as the View Cube). Rendered as a
 * second gizmo pass after the View Cube (renderPriority 2).
 */
export function AxesGizmo() {
  const theme = useSettings((s) => s.theme);
  return (
    <GizmoHelper alignment="bottom-right" margin={[64, 64]} renderPriority={2}>
      <GizmoViewport
        axisColors={['#e5484d', '#46a758', '#3b82f6']}
        labelColor={THEME_3D[theme].gizmoLabel}
        labels={['X', 'Y', 'Z']}
        hideNegativeAxes
      />
    </GizmoHelper>
  );
}
