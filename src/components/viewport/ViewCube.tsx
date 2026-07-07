import { GizmoHelper, GizmoViewcube } from '@react-three/drei';
import { useT } from '@/i18n';

/**
 * Interactive navigation cube. Clicking a face, edge or corner smoothly
 * tweens the camera to the matching orthographic/isometric direction
 * (GizmoHelper animates against the default OrbitControls). Face labels are
 * localized; the key remounts the cube so its canvas textures re-render on
 * language change.
 */
export function ViewCube() {
  const t = useT();
  const faces = [
    t('cube.right'), t('cube.left'),
    t('cube.top'), t('cube.bottom'),
    t('cube.front'), t('cube.back'),
  ];

  return (
    <GizmoHelper alignment="top-right" margin={[72, 92]}>
      <GizmoViewcube
        key={faces.join('|')}
        color="#fafbfc"
        hoverColor="#bfdbfe"
        strokeColor="#94a3b8"
        textColor="#111827"
        font="bold 26px Inter, 'Segoe UI', Arial, sans-serif"
        opacity={1}
        faces={faces}
      />
    </GizmoHelper>
  );
}
