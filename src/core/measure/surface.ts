import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import type { Vec3 } from '@/core/types';

/**
 * Local surface classification for the smart-measure tool. We only have the
 * tessellation (no B-rep), so the surface type is recovered from the facet
 * normals around the picked point:
 *  - all normals (nearly) equal            → plane
 *  - normals perpendicular to a common axis → cylinder (axis from pairwise
 *    normal cross products, radius from a least-squares circle fit — the
 *    tessellation vertices lie exactly on the true surface)
 */
export interface SurfacePick {
  kind: 'plane' | 'cylinder' | 'unknown';
  /** Picked point, world space. */
  point: Vec3;
  /** Plane normal, world space. */
  normal?: Vec3;
  /** Cylinder: circle center at the picked height, axis direction, radius (world). */
  center?: Vec3;
  axis?: Vec3;
  radius?: number;
}

interface TriSample {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  area: number;
}

const NEAR_CLUSTER_DOT = Math.cos(THREE.MathUtils.degToRad(25));
const PLANE_TIGHT_DOT = Math.cos(THREE.MathUtils.degToRad(1.2));
const PLANE_LOOSE_DOT = Math.cos(THREE.MathUtils.degToRad(5));
/** Max weighted RMS of normal·axis for a valid cylinder (≈ sin 8.5°). */
const MAX_AXIS_RMS = 0.15;
/** Max radial RMS residual of the circle fit, relative to the radius. */
const MAX_RADIAL_RESIDUAL = 0.035;
const MAX_TRIANGLES = 4000;

function triangleVertices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const position = geometry.attributes.position;
  if (!position) return null;
  const index = geometry.index;
  const i0 = index ? index.getX(faceIndex * 3) : faceIndex * 3;
  const i1 = index ? index.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const i2 = index ? index.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
  return [
    new THREE.Vector3().fromBufferAttribute(position, i0),
    new THREE.Vector3().fromBufferAttribute(position, i1),
    new THREE.Vector3().fromBufferAttribute(position, i2),
  ];
}

/** Triangles whose surface touches the sphere (local space), BVH-accelerated. */
function collectTriangles(geometry: THREE.BufferGeometry, sphere: THREE.Sphere): TriSample[] {
  const samples: TriSample[] = [];
  const closest = new THREE.Vector3();
  const radiusSq = sphere.radius * sphere.radius;

  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const triangle = new THREE.Triangle(a, b, c);
    triangle.closestPointToPoint(sphere.center, closest);
    if (closest.distanceToSquared(sphere.center) > radiusSq) return false;
    const normal = new THREE.Vector3();
    triangle.getNormal(normal);
    const area = triangle.getArea();
    if (area <= 0 || normal.lengthSq() === 0) return false;
    samples.push({ a: a.clone(), b: b.clone(), c: c.clone(), normal, area });
    return samples.length >= MAX_TRIANGLES;
  };

  const bvh = geometry.boundsTree;
  if (bvh) {
    bvh.shapecast({
      intersectsBounds: (box) => (box.intersectsSphere(sphere) ? INTERSECTED : NOT_INTERSECTED),
      intersectsTriangle: (triangle) => pushTriangle(triangle.a, triangle.b, triangle.c),
    });
    return samples;
  }

  // Fallback without a BVH: linear scan, capped.
  const position = geometry.attributes.position;
  if (!position) return samples;
  const index = geometry.index;
  const count = Math.min(index ? index.count / 3 : position.count / 3, 200_000);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let f = 0; f < count; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    if (pushTriangle(a, b, c)) break;
  }
  return samples;
}

interface CylinderFit {
  axis: THREE.Vector3;
  /** A point on the axis (local space). */
  axisPoint: THREE.Vector3;
  radius: number;
}

/** Solve a symmetric 3×3 linear system via Cramer's rule. */
function solve3(m: number[][], rhs: number[]): [number, number, number] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  const col = (i: number) => m.map((row, r) => row.map((v, c) => (c === i ? rhs[r] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

function fitCylinder(samples: TriSample[]): CylinderFit | null {
  if (samples.length < 3) return null;

  // Axis: pairwise cross products of facet normals all point along it.
  const reference = samples.reduce((best, s) => (s.area > best.area ? s : best), samples[0]);
  const accum = new THREE.Vector3();
  let firstCross: THREE.Vector3 | null = null;
  const cross = new THREE.Vector3();
  for (const sample of samples) {
    cross.crossVectors(reference.normal, sample.normal);
    if (cross.length() < 0.02) continue;
    if (!firstCross) firstCross = cross.clone();
    if (cross.dot(firstCross) < 0) cross.negate();
    accum.addScaledVector(cross, sample.area);
  }
  if (accum.lengthSq() < 1e-14) return null;
  const axis = accum.normalize().clone();

  // All facet normals must be (nearly) perpendicular to the axis.
  let weightedError = 0;
  let weightSum = 0;
  for (const sample of samples) {
    const d = sample.normal.dot(axis);
    weightedError += sample.area * d * d;
    weightSum += sample.area;
  }
  if (weightSum <= 0 || Math.sqrt(weightedError / weightSum) > MAX_AXIS_RMS) return null;

  // Project vertices onto the plane ⟂ axis and fit a circle (Kåsa method).
  const e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.x) > 0.9) e1.set(0, 1, 0);
  e1.crossVectors(axis, e1).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);

  let su = 0, sv = 0, suu = 0, svv = 0, suv = 0, n = 0;
  let r0 = 0, r1 = 0, r2 = 0;
  const points: Array<[number, number]> = [];
  for (const sample of samples) {
    for (const p of [sample.a, sample.b, sample.c]) {
      const u = p.dot(e1);
      const v = p.dot(e2);
      const q = u * u + v * v;
      su += u; sv += v; suu += u * u; svv += v * v; suv += u * v; n += 1;
      r0 -= u * q; r1 -= v * q; r2 -= q;
      points.push([u, v]);
    }
  }
  if (n < 9) return null;

  const solution = solve3(
    [[suu, suv, su], [suv, svv, sv], [su, sv, n]],
    [r0, r1, r2],
  );
  if (!solution) return null;
  const [a, b, c] = solution;
  const u0 = -a / 2;
  const v0 = -b / 2;
  const radiusSq = u0 * u0 + v0 * v0 - c;
  if (!(radiusSq > 0) || !Number.isFinite(radiusSq)) return null;
  const radius = Math.sqrt(radiusSq);

  let residual = 0;
  for (const [u, v] of points) {
    const d = Math.hypot(u - u0, v - v0) - radius;
    residual += d * d;
  }
  if (Math.sqrt(residual / points.length) > MAX_RADIAL_RESIDUAL * radius) return null;

  const axisPoint = new THREE.Vector3()
    .addScaledVector(e1, u0)
    .addScaledVector(e2, v0);
  return { axis, axisPoint, radius };
}

function weightedMeanNormal(samples: TriSample[]): THREE.Vector3 {
  const mean = new THREE.Vector3();
  for (const sample of samples) mean.addScaledVector(sample.normal, sample.area);
  return mean.normalize();
}

function classify(samples: TriSample[], hitNormal: THREE.Vector3):
  | { kind: 'plane'; normal: THREE.Vector3 }
  | ({ kind: 'cylinder' } & CylinderFit)
  | { kind: 'unknown' } {
  const near: TriSample[] = [];
  const far: TriSample[] = [];
  let totalArea = 0;
  for (const sample of samples) {
    totalArea += sample.area;
    (sample.normal.dot(hitNormal) > NEAR_CLUSTER_DOT ? near : far).push(sample);
  }

  // Click near a rim: the far cluster is the adjoining cylinder wall — prefer
  // its diameter ("edge of a cylinder → diameter").
  const farArea = far.reduce((sum, s) => sum + s.area, 0);
  if (farArea > 0.18 * totalArea) {
    const cylinder = fitCylinder(far);
    if (cylinder) return { kind: 'cylinder', ...cylinder };
  }

  if (near.length >= 2) {
    const mean = weightedMeanNormal(near);
    let minDot = 1;
    for (const sample of near) minDot = Math.min(minDot, sample.normal.dot(mean));
    if (minDot > PLANE_TIGHT_DOT) return { kind: 'plane', normal: mean };
    const cylinder = fitCylinder(near);
    if (cylinder) return { kind: 'cylinder', ...cylinder };
    if (minDot > PLANE_LOOSE_DOT) return { kind: 'plane', normal: mean };
  }

  const cylinder = fitCylinder(samples);
  if (cylinder) return { kind: 'cylinder', ...cylinder };
  return { kind: 'unknown' };
}

/**
 * Classify the surface around a picked point. Works in the mesh's local
 * space (our transforms are rigid) and converts the result to world space.
 */
export function classifySurfaceAt(
  mesh: THREE.Mesh,
  faceIndex: number | null,
  worldPoint: THREE.Vector3,
  modelDiagonal: number,
): SurfacePick {
  const point = worldPoint.toArray() as Vec3;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry || faceIndex === null) return { kind: 'unknown', point };

  const localPoint = mesh.worldToLocal(worldPoint.clone());
  const vertices = triangleVertices(geometry, faceIndex);
  if (!vertices) return { kind: 'unknown', point };

  const hitNormal = new THREE.Triangle(...vertices).getNormal(new THREE.Vector3());
  const minEdge = Math.min(
    vertices[0].distanceTo(vertices[1]),
    vertices[1].distanceTo(vertices[2]),
    vertices[2].distanceTo(vertices[0]),
  );

  // Sample sphere: wide enough to span a few tessellation facets, small
  // enough not to swallow neighbouring features. Expand if too sparse.
  let radius = THREE.MathUtils.clamp(minEdge * 3, modelDiagonal * 0.004, modelDiagonal * 0.08);
  let samples = collectTriangles(geometry, new THREE.Sphere(localPoint, radius));
  for (let attempt = 0; attempt < 3 && samples.length < 12 && radius < modelDiagonal * 0.3; attempt++) {
    radius *= 2;
    samples = collectTriangles(geometry, new THREE.Sphere(localPoint, radius));
  }
  if (samples.length < 2) return { kind: 'unknown', point };

  const result = classify(samples, hitNormal);

  if (result.kind === 'plane') {
    const normalWorld = result.normal.clone().transformDirection(mesh.matrixWorld);
    return { kind: 'plane', point, normal: normalWorld.toArray() as Vec3 };
  }

  if (result.kind === 'cylinder') {
    const axisWorld = result.axis.clone().transformDirection(mesh.matrixWorld);
    const axisPointWorld = result.axisPoint.clone().applyMatrix4(mesh.matrixWorld);
    // Circle center on the axis at the height of the picked point.
    const t = worldPoint.clone().sub(axisPointWorld).dot(axisWorld);
    const center = axisPointWorld.addScaledVector(axisWorld, t);
    return {
      kind: 'cylinder',
      point,
      center: center.toArray() as Vec3,
      axis: axisWorld.toArray() as Vec3,
      radius: result.radius,
    };
  }

  return { kind: 'unknown', point };
}
