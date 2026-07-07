import { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useViewer } from '@/store/viewerStore';
import { useT } from '@/i18n';
import type { Measurement, Vec3 } from '@/core/types';

const ACCENT = '#2563eb';

const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

function arcPoints(vertex: Vec3, a: Vec3, b: Vec3, radius: number): Vec3[] {
  const va = v(a).sub(v(vertex));
  const vb = v(b).sub(v(vertex));
  if (va.lengthSq() === 0 || vb.lengthSq() === 0) return [];
  va.normalize();
  vb.normalize();
  const axis = new THREE.Vector3().crossVectors(va, vb);
  if (axis.lengthSq() < 1e-12) return [];
  axis.normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(va.dot(vb), -1, 1));

  const points: Vec3[] = [];
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i <= 24; i++) {
    quaternion.setFromAxisAngle(axis, (angle * i) / 24);
    const point = va.clone().applyQuaternion(quaternion).multiplyScalar(radius).add(v(vertex));
    points.push(point.toArray() as Vec3);
  }
  return points;
}

function circlePoints(center: Vec3, normal: Vec3, through: Vec3, radius: number): Vec3[] {
  const n = v(normal).normalize();
  const u = v(through).sub(v(center)).normalize();
  const w = new THREE.Vector3().crossVectors(n, u).normalize();
  const points: Vec3[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const point = v(center)
      .addScaledVector(u, Math.cos(t) * radius)
      .addScaledVector(w, Math.sin(t) * radius);
    points.push(point.toArray() as Vec3);
  }
  return points;
}

function Marker({ position, radius, pending = false }: { position: Vec3; radius: number; pending?: boolean }) {
  return (
    <mesh position={position} renderOrder={1000}>
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={pending ? '#f59e0b' : ACCENT} depthTest={false} transparent />
    </mesh>
  );
}

function Label({ position, text, onClick }: { position: Vec3; text: string; onClick?: () => void }) {
  const t = useT();
  return (
    <Html position={position} center zIndexRange={[30, 0]}>
      <button
        type="button"
        title={t('measure.remove')}
        onClick={onClick}
        className="cursor-pointer whitespace-nowrap rounded-full bg-neutral-900/85 px-2 py-0.5 text-[11px] font-medium text-white shadow-md backdrop-blur transition-colors hover:bg-red-600/90"
      >
        {text}
      </button>
    </Html>
  );
}

function MeasurementGraphics({ measurement, markerRadius }: { measurement: Measurement; markerRadius: number }) {
  const remove = useViewer((s) => s.removeMeasurement);
  const { points, label, type, circle, id } = measurement;

  if (type === 'distance') {
    return (
      <group>
        <Line points={[points[0], points[1]]} color={ACCENT} lineWidth={2} />
        <Marker position={points[0]} radius={markerRadius} />
        <Marker position={points[1]} radius={markerRadius} />
        <Label position={mid(points[0], points[1])} text={label} onClick={() => remove(id)} />
      </group>
    );
  }

  if (type === 'angle') {
    const [a, vertex, b] = points;
    const legRadius = Math.min(v(a).distanceTo(v(vertex)), v(b).distanceTo(v(vertex))) * 0.4;
    const arc = arcPoints(vertex, a, b, legRadius);
    return (
      <group>
        <Line points={[vertex, a]} color={ACCENT} lineWidth={2} />
        <Line points={[vertex, b]} color={ACCENT} lineWidth={2} />
        {arc.length > 1 && <Line points={arc} color={ACCENT} lineWidth={1.5} />}
        {points.map((p, i) => <Marker key={i} position={p} radius={markerRadius} />)}
        <Label position={vertex} text={label} onClick={() => remove(id)} />
      </group>
    );
  }

  // Diameter: draw the fitted circle through the three picked points.
  return (
    <group>
      {circle && (
        <Line
          points={circlePoints(circle.center, circle.normal, points[0], circle.radius)}
          color={ACCENT}
          lineWidth={2}
        />
      )}
      {points.map((p, i) => <Marker key={i} position={p} radius={markerRadius * 0.8} />)}
      <Label position={circle ? circle.center : points[0]} text={label} onClick={() => remove(id)} />
    </group>
  );
}

export function MeasureOverlay() {
  const model = useViewer((s) => s.model);
  const measurements = useViewer((s) => s.measurements);
  const pendingPoints = useViewer((s) => s.pendingPoints);

  const markerRadius = useMemo(() => {
    if (!model) return 0.5;
    const diagonal = model.boundingBox.getSize(new THREE.Vector3()).length();
    return Math.max(diagonal * 0.0045, 1e-4);
  }, [model]);

  if (!model) return null;

  return (
    <group>
      {measurements.map((measurement) => (
        <MeasurementGraphics key={measurement.id} measurement={measurement} markerRadius={markerRadius} />
      ))}
      {pendingPoints.map((point, i) => (
        <Marker key={`pending-${i}`} position={point} radius={markerRadius} pending />
      ))}
    </group>
  );
}
