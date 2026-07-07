import * as THREE from 'three';
import type { Circle3, Vec3 } from '@/core/types';

const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

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
 * Circle through three points in 3D (circumscribed circle), used to measure
 * diameters of cylindrical faces and circular edges from three picked points.
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
    center: center.toArray() as Vec3,
    radius,
    normal: normal.toArray() as Vec3,
  };
}

/**
 * Distance between two picked faces (smart measure). Near-parallel faces
 * (within 10°) measure along the first face's normal; otherwise fall back to
 * the distance between the picked points.
 */
export function planeToPlane(
  p1: Vec3,
  n1: Vec3,
  p2: Vec3,
  n2: Vec3,
): { parallel: boolean; value: number; end: Vec3 } {
  const normal = v(n1).normalize();
  const parallel =
    Math.abs(normal.dot(v(n2).normalize())) > Math.cos(THREE.MathUtils.degToRad(10));
  if (parallel) {
    const t = v(p2).sub(v(p1)).dot(normal);
    const end = v(p1).addScaledVector(normal, t);
    return { parallel: true, value: Math.abs(t), end: end.toArray() as Vec3 };
  }
  return { parallel: false, value: distanceBetween(p1, p2), end: p2 };
}

/** Format a millimeter value with sensible precision. */
export function formatMm(value: number): string {
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}
