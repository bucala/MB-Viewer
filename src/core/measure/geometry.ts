import * as THREE from 'three';
import type { Circle3, Vec3 } from '@/core/types';

const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const arr = (p: THREE.Vector3) => p.toArray() as Vec3;

const PARALLEL_DOT = Math.cos(THREE.MathUtils.degToRad(5));

export function distanceBetween(a: Vec3, b: Vec3): number {
  return v(a).distanceTo(v(b));
}

/** Angle at `vertex` between rays to `a` and `b`, in degrees. */
export function angleAtVertexDeg(a: Vec3, vertex: Vec3, b: Vec3): number {
  const va = v(a).sub(v(vertex));
  const vb = v(b).sub(v(vertex));
  if (va.lengthSq() === 0 || vb.lengthSq() === 0) return 0;
  const cos = THREE.MathUtils.clamp(va.normalize().dot(vb.normalize()), -1, 1);
  return THREE.MathUtils.radToDeg(Math.acos(cos));
}

/**
 * Circle through three points in 3D (circumscribed circle), used as the
 * fallback diameter measurement from three picked points.
 * Returns null for (near-)collinear input.
 */
export function circleFrom3Points(pa: Vec3, pb: Vec3, pc: Vec3): Circle3 | null {
  const a = v(pa);
  const ab = v(pb).sub(a);
  const ac = v(pc).sub(a);
  const n = new THREE.Vector3().crossVectors(ab, ac);
  const n2 = n.lengthSq();
  // Scale-aware collinearity test.
  if (n2 <= 1e-12 * ab.lengthSq() * ac.lengthSq()) return null;

  // center = A + (|AB|² (AC × n) + |AC|² (n × AB)) / (2 |n|²)
  const term1 = new THREE.Vector3().crossVectors(ac, n).multiplyScalar(ab.lengthSq());
  const term2 = new THREE.Vector3().crossVectors(n, ab).multiplyScalar(ac.lengthSq());
  const center = a.clone().add(term1.add(term2).divideScalar(2 * n2));
  const radius = center.distanceTo(a);
  const normal = n.normalize();
  return {
    center: arr(center),
    radius,
    normal: arr(normal),
  };
}

/**
 * A measurable entity captured by one click: a snapped point, an (infinite)
 * plane through the picked point, or an (infinite) line — a straight feature
 * edge or the axis of a cylinder/cone.
 */
export type MeasureEntity =
  | { kind: 'point'; point: Vec3 }
  | { kind: 'plane'; point: Vec3; normal: Vec3 }
  | { kind: 'line'; point: Vec3; dir: Vec3 };

export interface PairResult {
  type: 'distance' | 'angle';
  value: number;
  /** Geometry for the overlay: [a, b] for distances, [a, vertex, b] for angles. */
  points: Vec3[];
  /** Distances only: whether the pair was treated as parallel. */
  parallel?: boolean;
}

/** Angle between two undirected directions, folded to [0°, 90°]. */
function foldedAngleDeg(a: THREE.Vector3, b: THREE.Vector3): number {
  const cos = THREE.MathUtils.clamp(Math.abs(a.dot(b)), 0, 1);
  return THREE.MathUtils.radToDeg(Math.acos(cos));
}

function pointToPlane(point: Vec3, plane: { point: Vec3; normal: Vec3 }): PairResult {
  const n = v(plane.normal).normalize();
  const t = v(point).sub(v(plane.point)).dot(n);
  const foot = v(point).addScaledVector(n, -t);
  return { type: 'distance', value: Math.abs(t), points: [point, arr(foot)], parallel: true };
}

function pointToLine(point: Vec3, line: { point: Vec3; dir: Vec3 }): PairResult {
  const d = v(line.dir).normalize();
  const rel = v(point).sub(v(line.point));
  const foot = v(line.point).addScaledVector(d, rel.dot(d));
  return { type: 'distance', value: v(point).distanceTo(foot), points: [point, arr(foot)], parallel: true };
}

function planeToPlane(
  a: { point: Vec3; normal: Vec3 },
  b: { point: Vec3; normal: Vec3 },
  mode: 'auto' | 'distance' | 'angle',
): PairResult {
  const n1 = v(a.normal).normalize();
  const n2 = v(b.normal).normalize();
  const parallel = Math.abs(n1.dot(n2)) > Math.cos(THREE.MathUtils.degToRad(10));

  if (mode === 'angle' || (mode === 'auto' && !parallel)) {
    const value = foldedAngleDeg(n1, n2);
    if (parallel) {
      // No intersection line — degenerate arc, label sits between the picks.
      const mid = v(a.point).add(v(b.point)).multiplyScalar(0.5);
      return { type: 'angle', value, points: [a.point, arr(mid), b.point] };
    }
    // Vertex: the point of the planes' intersection line closest to the picks.
    const d1 = v(a.point).dot(n1);
    const d2 = v(b.point).dot(n2);
    const dot = n1.dot(n2);
    const det = 1 - dot * dot;
    const c1 = (d1 - d2 * dot) / det;
    const c2 = (d2 - d1 * dot) / det;
    const linePoint = n1.clone().multiplyScalar(c1).addScaledVector(n2, c2);
    const lineDir = new THREE.Vector3().crossVectors(n1, n2).normalize();
    const mid = v(a.point).add(v(b.point)).multiplyScalar(0.5);
    const vertex = linePoint.addScaledVector(lineDir, mid.sub(linePoint).dot(lineDir));
    return { type: 'angle', value, points: [a.point, arr(vertex), b.point] };
  }

  if (parallel) {
    const t = v(b.point).sub(v(a.point)).dot(n1);
    const end = v(a.point).addScaledVector(n1, t);
    return { type: 'distance', value: Math.abs(t), points: [a.point, arr(end)], parallel: true };
  }
  // Distance requested between non-parallel faces: fall back to the picks.
  return { type: 'distance', value: distanceBetween(a.point, b.point), points: [a.point, b.point], parallel: false };
}

function lineToLine(
  a: { point: Vec3; dir: Vec3 },
  b: { point: Vec3; dir: Vec3 },
  mode: 'auto' | 'distance' | 'angle',
): PairResult {
  const d1 = v(a.dir).normalize();
  const d2 = v(b.dir).normalize();
  const parallel = Math.abs(d1.dot(d2)) > PARALLEL_DOT;

  if (mode === 'angle' || (mode === 'auto' && !parallel)) {
    const value = foldedAngleDeg(d1, d2);
    if (parallel) {
      const mid = v(a.point).add(v(b.point)).multiplyScalar(0.5);
      return { type: 'angle', value, points: [a.point, arr(mid), b.point] };
    }
    const [c1, c2] = closestPointsOnLines(a, b);
    const vertex = c1.clone().add(c2).multiplyScalar(0.5);
    return { type: 'angle', value, points: [a.point, arr(vertex), b.point] };
  }

  if (parallel) {
    const w = v(b.point).sub(v(a.point));
    const perp = w.clone().addScaledVector(d1, -w.dot(d1));
    const end = v(a.point).add(perp);
    return { type: 'distance', value: perp.length(), points: [a.point, arr(end)], parallel: true };
  }
  // Skew lines: the (unique) shortest connector.
  const [c1, c2] = closestPointsOnLines(a, b);
  return { type: 'distance', value: c1.distanceTo(c2), points: [arr(c1), arr(c2)], parallel: false };
}

function closestPointsOnLines(
  a: { point: Vec3; dir: Vec3 },
  b: { point: Vec3; dir: Vec3 },
): [THREE.Vector3, THREE.Vector3] {
  const p1 = v(a.point);
  const p2 = v(b.point);
  const d1 = v(a.dir).normalize();
  const d2 = v(b.dir).normalize();
  const w = p1.clone().sub(p2);
  const bDot = d1.dot(d2);
  const det = 1 - bDot * bDot;
  const dw1 = d1.dot(w);
  const dw2 = d2.dot(w);
  const t1 = det > 1e-12 ? (bDot * dw2 - dw1) / det : 0;
  const t2 = det > 1e-12 ? (dw2 - bDot * dw1) / det : 0;
  return [p1.addScaledVector(d1, t1), p2.addScaledVector(d2, t2)];
}

function planeToLine(
  plane: { point: Vec3; normal: Vec3 },
  line: { point: Vec3; dir: Vec3 },
  linePick: Vec3,
  mode: 'auto' | 'distance' | 'angle',
): PairResult | null {
  const n = v(plane.normal).normalize();
  const d = v(line.dir).normalize();
  const sin = Math.abs(n.dot(d));
  const parallel = sin < Math.sin(THREE.MathUtils.degToRad(5));

  if (parallel) {
    if (mode === 'angle') {
      const mid = v(linePick).add(v(plane.point)).multiplyScalar(0.5);
      return { type: 'angle', value: 0, points: [linePick, arr(mid), plane.point] };
    }
    const t = v(line.point).sub(v(plane.point)).dot(n);
    const foot = v(line.point).addScaledVector(n, -t);
    return { type: 'distance', value: Math.abs(t), points: [line.point, arr(foot)], parallel: true };
  }

  if (mode === 'distance') return null; // caller falls back to picked points
  // Angle between the line and the plane, rendered at their intersection.
  const value = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sin, 0, 1)));
  const t = v(plane.point).sub(v(line.point)).dot(n) / n.dot(d);
  const vertex = v(line.point).addScaledVector(d, t);
  const pickRel = v(linePick).sub(v(plane.point)).dot(n);
  const projected = v(linePick).addScaledVector(n, -pickRel);
  if (projected.distanceToSquared(vertex) < 1e-12) projected.addScaledVector(d, 1e-6);
  return { type: 'angle', value, points: [linePick, arr(vertex), arr(projected)] };
}

/**
 * Measure between two captured entities. `mode` biases ambiguous pairs:
 * 'auto' turns non-parallel pairs into angles, 'distance' insists on a
 * length (falling back to the picked points), 'angle' insists on an angle
 * (returns null when the pair cannot form one).
 */
export function pairMeasure(
  a: MeasureEntity,
  b: MeasureEntity,
  mode: 'auto' | 'distance' | 'angle',
): PairResult | null {
  if (a.kind === 'point' && b.kind === 'point') {
    if (mode === 'angle') return null;
    return { type: 'distance', value: distanceBetween(a.point, b.point), points: [a.point, b.point] };
  }
  if (a.kind === 'point' || b.kind === 'point') {
    if (mode === 'angle') return null;
    const point = a.kind === 'point' ? a.point : b.point;
    const other = (a.kind === 'point' ? b : a) as Exclude<MeasureEntity, { kind: 'point' }>;
    return other.kind === 'plane' ? pointToPlane(point, other) : pointToLine(point, other);
  }
  if (a.kind === 'plane' && b.kind === 'plane') return planeToPlane(a, b, mode);
  if (a.kind === 'line' && b.kind === 'line') return lineToLine(a, b, mode);
  const plane = (a.kind === 'plane' ? a : b) as Extract<MeasureEntity, { kind: 'plane' }>;
  const line = (a.kind === 'line' ? a : b) as Extract<MeasureEntity, { kind: 'line' }>;
  const result = planeToLine(plane, line, line.point, mode);
  if (result) return result;
  return { type: 'distance', value: distanceBetween(a.point, b.point), points: [a.point, b.point], parallel: false };
}

/** Format a millimeter value with sensible precision. */
export function formatMm(value: number): string {
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}
