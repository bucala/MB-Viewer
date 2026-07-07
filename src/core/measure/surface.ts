import * as THREE from 'three';
import { INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import type { Vec3 } from '@/core/types';

/**
 * Local surface/edge classification for the measurement tools. We only have
 * the tessellation (no B-rep), so geometry is recovered around the picked
 * point from the facet normals and the feature edges:
 *  - all facet normals (nearly) equal              → plane
 *  - normals perpendicular to a common axis        → cylinder
 *  - normals at a constant oblique angle to an axis → cone
 *  - sharp-crease edge chain fitting a circle      → circular edge
 *  - sharp-crease edge chain fitting a line        → straight edge
 * Axes come from the null direction of the normal covariance; the axis line
 * from the fact that every normal line of a surface of revolution crosses it.
 */
export type SmartPick =
  | { kind: 'plane'; point: Vec3; normal: Vec3 }
  | { kind: 'cylinder'; point: Vec3; center: Vec3; axis: Vec3; radius: number }
  | {
      kind: 'cone';
      point: Vec3;
      /** Axis foot of the picked point. */
      center: Vec3;
      axis: Vec3;
      apex: Vec3;
      /** Half of the apex (included) angle, degrees. */
      halfAngleDeg: number;
      /** Cone radius at the picked point's height. */
      radiusAtPoint: number;
    }
  | { kind: 'circle'; point: Vec3; center: Vec3; axis: Vec3; radius: number }
  | { kind: 'line'; point: Vec3; origin: Vec3; dir: Vec3 }
  | { kind: 'unknown'; point: Vec3 };

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
/** Max weighted RMS of (normal·axis − mean) for a valid cylinder/cone. */
const MAX_AXIS_RMS = 0.13;
/** Max radial residual of the surface fit, relative to the radius. */
const MAX_RADIAL_RESIDUAL = 0.035;
/** |mean normal·axis| below this reads as a cylinder, above as a cone. */
const CYLINDER_MAX_TILT = 0.05;
/** Cone half-angles outside [3°, 80°] are rejected (sphere-ish or plane-ish). */
const CONE_MIN_HALF_DEG = 3;
const CONE_MAX_HALF_DEG = 80;
/** Dihedral angle (between facet normals) that marks a feature edge. */
const FEATURE_EDGE_DOT = Math.cos(THREE.MathUtils.degToRad(30));
/** Minimum angular coverage for a circular-edge fit, radians. */
const MIN_ARC_SPAN = THREE.MathUtils.degToRad(60);
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

/** Dominant eigenvector of a symmetric 3×3 matrix (power iteration). */
function dominantEigenvector(m: number[][], seed: THREE.Vector3): THREE.Vector3 | null {
  const v = seed.clone();
  if (v.lengthSq() < 1e-20) v.set(1, 0, 0);
  v.normalize();
  const next = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    next.set(
      m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
      m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
      m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
    );
    const len = next.length();
    if (len < 1e-20) return null;
    next.divideScalar(len);
    if (next.dot(v) < 0) next.negate();
    if (next.distanceToSquared(v) < 1e-14) {
      v.copy(next);
      break;
    }
    v.copy(next);
  }
  return v;
}

/**
 * Smallest-eigenvalue direction of a symmetric 3×3 covariance matrix:
 * power-iterate on (tr·I − M), whose dominant direction is M's smallest.
 */
function smallestEigenvector(m: number[][], seed: THREE.Vector3): THREE.Vector3 | null {
  const tr = m[0][0] + m[1][1] + m[2][2];
  const flipped = [
    [tr - m[0][0], -m[0][1], -m[0][2]],
    [-m[1][0], tr - m[1][1], -m[1][2]],
    [-m[2][0], -m[2][1], tr - m[2][2]],
  ];
  return dominantEigenvector(flipped, seed);
}

interface AxialFit {
  kind: 'cylinder' | 'cone';
  axis: THREE.Vector3;
  /** A point on the axis (local space). */
  axisPoint: THREE.Vector3;
  /** Cylinder radius (kind = 'cylinder'). */
  radius: number;
  /** Half apex angle in radians and apex point (kind = 'cone'). */
  halfAngle: number;
  apex: THREE.Vector3 | null;
  /** Radius as a linear function of height t along the axis: r = slope·t + offset. */
  slope: number;
  offset: number;
}

/**
 * Fit a surface of revolution (cylinder or cone) to the sampled facets.
 * Every surface normal of a revolution surface crosses the axis, so the
 * closest-approach midpoints of pairs of facet-normal lines trace the axis
 * line; a PCA line through them gives axis point + direction. The radius as
 * a linear function of height then separates cylinders (constant) from
 * cones (linear) and rejects everything else (spheres, blends…).
 */
function fitAxialSurface(samples: TriSample[]): AxialFit | null {
  const n = samples.length;
  if (n < 4) return null;

  const centroids = samples.map((s) =>
    new THREE.Vector3().copy(s.a).add(s.b).add(s.c).divideScalar(3),
  );

  // Closest-approach midpoints of paired normal lines (a few strides give
  // both angularly-near and angularly-far pairs without O(n²) work).
  const qs: Array<{ q: THREE.Vector3; w: number }> = [];
  const w = new THREE.Vector3();
  const strides = new Set([1, Math.max(1, Math.floor(n / 3)), Math.max(1, Math.floor((2 * n) / 3))]);
  for (const stride of strides) {
    for (let i = 0; i < n && qs.length < 900; i++) {
      const j = (i + stride) % n;
      if (j === i) continue;
      const ni = samples[i].normal;
      const nj = samples[j].normal;
      const b = ni.dot(nj);
      const det = 1 - b * b; // = sin² of the angle between the normals
      if (det < 0.006) continue; // near-parallel: intersection ill-defined
      w.copy(centroids[i]).sub(centroids[j]);
      const dwi = ni.dot(w);
      const dwj = nj.dot(w);
      const ti = (b * dwj - dwi) / det;
      const tj = (dwj - b * dwi) / det;
      const qi = centroids[i].clone().addScaledVector(ni, ti);
      const qj = centroids[j].clone().addScaledVector(nj, tj);
      qs.push({
        q: qi.add(qj).multiplyScalar(0.5),
        w: Math.min(samples[i].area, samples[j].area) * Math.sqrt(det),
      });
    }
  }
  if (qs.length < 6) return null;

  const axisPoint = new THREE.Vector3();
  let qWeight = 0;
  for (const { q, w: qw } of qs) {
    axisPoint.addScaledVector(q, qw);
    qWeight += qw;
  }
  if (qWeight <= 0) return null;
  axisPoint.divideScalar(qWeight);

  // Axis direction candidate 1: PCA of the intersection points.
  const scatter = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const d = new THREE.Vector3();
  let seed: THREE.Vector3 | null = null;
  let seedLength = 0;
  for (const { q, w: qw } of qs) {
    d.copy(q).sub(axisPoint);
    scatter[0][0] += qw * d.x * d.x; scatter[0][1] += qw * d.x * d.y; scatter[0][2] += qw * d.x * d.z;
    scatter[1][1] += qw * d.y * d.y; scatter[1][2] += qw * d.y * d.z;
    scatter[2][2] += qw * d.z * d.z;
    if (d.lengthSq() > seedLength) {
      seedLength = d.lengthSq();
      seed = d.clone();
    }
  }
  scatter[1][0] = scatter[0][1]; scatter[2][0] = scatter[0][2]; scatter[2][1] = scatter[1][2];
  const pcaAxis = seed ? dominantEigenvector(scatter, seed) : null;

  // Candidate 2: area-weighted cross products of facet normals — exact for
  // cylinders, a safety net when the intersection points barely spread
  // (e.g. a single narrow band of facets).
  const reference = samples.reduce((best, s) => (s.area > best.area ? s : best), samples[0]);
  const crossAccum = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let firstCross: THREE.Vector3 | null = null;
  for (const s of samples) {
    cross.crossVectors(reference.normal, s.normal);
    if (cross.length() < 0.02) continue;
    if (!firstCross) firstCross = cross.clone();
    if (cross.dot(firstCross) < 0) cross.negate();
    crossAccum.addScaledVector(cross, s.area);
  }
  const crossAxis = crossAccum.lengthSq() > 1e-14 ? crossAccum.clone().normalize() : null;

  // Pick the candidate along which normal·axis is most constant.
  let weightSum = 0;
  for (const s of samples) weightSum += s.area;
  const tiltRms = (axis: THREE.Vector3): { tilt: number; rms: number } => {
    let tiltSum = 0;
    for (const s of samples) tiltSum += s.area * s.normal.dot(axis);
    const tilt = tiltSum / weightSum;
    let error = 0;
    for (const s of samples) {
      const e = s.normal.dot(axis) - tilt;
      error += s.area * e * e;
    }
    return { tilt, rms: Math.sqrt(error / weightSum) };
  };

  let axis: THREE.Vector3 | null = null;
  let tilt = 0;
  let bestRms = Infinity;
  for (const candidate of [pcaAxis, crossAxis]) {
    if (!candidate) continue;
    const { tilt: candidateTilt, rms } = tiltRms(candidate);
    if (rms < bestRms) {
      bestRms = rms;
      axis = candidate;
      tilt = candidateTilt;
    }
  }
  if (!axis || bestRms > MAX_AXIS_RMS) return null;

  // A genuine revolution surface shows a *fan* of normals around the axis.
  // Two adjacent planes (e.g. both sides of a box edge) can fake a constant
  // normal·axis with a diagonal axis — but they only occupy two azimuths.
  const e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.x) > 0.9) e1.set(0, 1, 0);
  e1.crossVectors(axis, e1).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const azimuthBins = new Map<number, number>();
  for (const s of samples) {
    const azimuth = Math.atan2(s.normal.dot(e2), s.normal.dot(e1));
    const bin = Math.round(azimuth / THREE.MathUtils.degToRad(6));
    azimuthBins.set(bin, (azimuthBins.get(bin) ?? 0) + s.area);
  }
  let populatedBins = 0;
  for (const area of azimuthBins.values()) {
    if (area > 0.02 * weightSum) populatedBins += 1;
  }
  if (populatedBins < 4) return null;

  // Radius along the axis: r(t) = slope·t + offset over the sample vertices
  // (they lie exactly on the true surface).
  let st = 0, sr = 0, stt = 0, str = 0, count = 0;
  const rel = new THREE.Vector3();
  const rt: Array<[number, number]> = [];
  for (const s of samples) {
    for (const p of [s.a, s.b, s.c]) {
      rel.copy(p).sub(axisPoint);
      const t = rel.dot(axis);
      const r = Math.hypot(
        rel.x - t * axis.x,
        rel.y - t * axis.y,
        rel.z - t * axis.z,
      );
      st += t; sr += r; stt += t * t; str += t * r; count += 1;
      rt.push([t, r]);
    }
  }
  if (count < 9) return null;

  const denominator = count * stt - st * st;
  if (Math.abs(denominator) < 1e-12) return null;
  let slope = (count * str - st * sr) / denominator;
  let offset = (sr - slope * st) / count;
  const slopeAngle = Math.atan(Math.abs(slope));
  const isCylinder = slopeAngle < THREE.MathUtils.degToRad(CONE_MIN_HALF_DEG) || Math.abs(tilt) < CYLINDER_MAX_TILT;
  if (isCylinder) {
    slope = 0;
    offset = sr / count;
  } else {
    // The radial growth must agree with the tilt read from the normals, and
    // stay in a sane cone range.
    const tiltAngle = Math.asin(THREE.MathUtils.clamp(Math.abs(tilt), 0, 1));
    if (Math.abs(slopeAngle - tiltAngle) > THREE.MathUtils.degToRad(5)) return null;
    const deg = THREE.MathUtils.radToDeg(slopeAngle);
    if (deg < CONE_MIN_HALF_DEG || deg > CONE_MAX_HALF_DEG) return null;
  }

  if (isCylinder) {
    // Refine center + radius with an in-plane least-squares circle (Kåsa):
    // removes the small tangential bias of the facet-centroid axis estimate.
    let su = 0, sv = 0, suu = 0, svv = 0, suv = 0, m = 0;
    let r0 = 0, r1 = 0, r2 = 0;
    const uvs: Array<[number, number]> = [];
    for (const s of samples) {
      for (const p of [s.a, s.b, s.c]) {
        rel.copy(p).sub(axisPoint);
        const u2 = rel.dot(e1);
        const v2 = rel.dot(e2);
        const q = u2 * u2 + v2 * v2;
        su += u2; sv += v2; suu += u2 * u2; svv += v2 * v2; suv += u2 * v2; m += 1;
        r0 -= u2 * q; r1 -= v2 * q; r2 -= q;
        uvs.push([u2, v2]);
      }
    }
    const circle = solve3(
      [[suu, suv, su], [suv, svv, sv], [su, sv, m]],
      [r0, r1, r2],
    );
    if (!circle) return null;
    const u0 = -circle[0] / 2;
    const v0 = -circle[1] / 2;
    const radiusSq = u0 * u0 + v0 * v0 - circle[2];
    if (!(radiusSq > 0) || !Number.isFinite(radiusSq)) return null;
    const radius = Math.sqrt(radiusSq);
    let circleResidual = 0;
    for (const [u2, v2] of uvs) {
      const e = Math.hypot(u2 - u0, v2 - v0) - radius;
      circleResidual += e * e;
    }
    if (Math.sqrt(circleResidual / m) > MAX_RADIAL_RESIDUAL * radius) return null;
    axisPoint.addScaledVector(e1, u0).addScaledVector(e2, v0);
    return {
      kind: 'cylinder', axis, axisPoint, radius,
      halfAngle: 0, apex: null, slope: 0, offset: radius,
    };
  }

  let residual = 0;
  let meanR = 0;
  for (const [t, r] of rt) {
    const e = r - (slope * t + offset);
    residual += e * e;
    meanR += r;
  }
  meanR /= count;
  if (meanR <= 0 || Math.sqrt(residual / count) > MAX_RADIAL_RESIDUAL * meanR) return null;

  const tApex = -offset / slope;
  const apex = axisPoint.clone().addScaledVector(axis, tApex);
  return {
    kind: 'cone', axis, axisPoint, radius: meanR,
    halfAngle: slopeAngle, apex, slope, offset,
  };
}

function weightedMeanNormal(samples: TriSample[]): THREE.Vector3 {
  const mean = new THREE.Vector3();
  for (const sample of samples) mean.addScaledVector(sample.normal, sample.area);
  return mean.normalize();
}

type FaceFit =
  | { kind: 'plane'; normal: THREE.Vector3 }
  | ({ kind: 'cylinder' | 'cone' } & AxialFit)
  | { kind: 'unknown' };

function classifyFace(samples: TriSample[], hitNormal: THREE.Vector3): FaceFit {
  const near: TriSample[] = [];
  const far: TriSample[] = [];
  let totalArea = 0;
  for (const sample of samples) {
    totalArea += sample.area;
    (sample.normal.dot(hitNormal) > NEAR_CLUSTER_DOT ? near : far).push(sample);
  }

  // Click near a rim: the far cluster is the adjoining cylinder/cone wall —
  // prefer it ("edge of a hole → its diameter").
  const farArea = far.reduce((sum, s) => sum + s.area, 0);
  if (farArea > 0.18 * totalArea) {
    const axial = fitAxialSurface(far);
    if (axial) return axial;
  }

  if (near.length >= 2) {
    const mean = weightedMeanNormal(near);
    let minDot = 1;
    for (const sample of near) minDot = Math.min(minDot, sample.normal.dot(mean));
    if (minDot > PLANE_TIGHT_DOT) return { kind: 'plane', normal: mean };
    const axial = fitAxialSurface(near);
    if (axial) return axial;
    if (minDot > PLANE_LOOSE_DOT) return { kind: 'plane', normal: mean };
  }

  const axial = fitAxialSurface(samples);
  if (axial) return axial;
  return { kind: 'unknown' };
}

/* ------------------------------------------------------------------------ */
/* Feature edges                                                             */
/* ------------------------------------------------------------------------ */

interface EdgeSegment {
  a: THREE.Vector3;
  b: THREE.Vector3;
  keyA: string;
  keyB: string;
  length: number;
}

type EdgeFit =
  | { kind: 'circle'; center: THREE.Vector3; axis: THREE.Vector3; radius: number }
  | { kind: 'line'; origin: THREE.Vector3; dir: THREE.Vector3 }
  | null;

/**
 * Extract sharp feature edges from the sampled triangles. Tessellations
 * duplicate vertices across face borders (and STL is fully unindexed), so
 * adjacency is recovered by quantizing vertex positions.
 */
function collectFeatureEdges(samples: TriSample[], quantum: number): EdgeSegment[] {
  const q = Math.max(quantum, 1e-9);
  const keyOf = (p: THREE.Vector3) =>
    `${Math.round(p.x / q)},${Math.round(p.y / q)},${Math.round(p.z / q)}`;

  interface Entry { a: THREE.Vector3; b: THREE.Vector3; keyA: string; keyB: string; normals: THREE.Vector3[] }
  const edges = new Map<string, Entry>();

  for (const sample of samples) {
    const verts = [sample.a, sample.b, sample.c];
    const keys = verts.map(keyOf);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (keys[i] === keys[j]) continue;
      const [keyA, keyB] = keys[i] < keys[j] ? [keys[i], keys[j]] : [keys[j], keys[i]];
      const id = `${keyA}|${keyB}`;
      let entry = edges.get(id);
      if (!entry) {
        entry = { a: verts[i], b: verts[j], keyA, keyB, normals: [] };
        edges.set(id, entry);
      }
      entry.normals.push(sample.normal);
    }
  }

  const feature: EdgeSegment[] = [];
  for (const entry of edges.values()) {
    if (entry.normals.length < 2) continue; // border of the sample sphere — undecidable
    let minDot = 1;
    for (let i = 0; i < entry.normals.length; i++) {
      for (let j = i + 1; j < entry.normals.length; j++) {
        minDot = Math.min(minDot, entry.normals[i].dot(entry.normals[j]));
      }
    }
    if (minDot < FEATURE_EDGE_DOT) {
      feature.push({
        a: entry.a, b: entry.b, keyA: entry.keyA, keyB: entry.keyB,
        length: entry.a.distanceTo(entry.b),
      });
    }
  }
  return feature;
}

function segmentDistance(point: THREE.Vector3, seg: EdgeSegment): number {
  const ab = new THREE.Vector3().subVectors(seg.b, seg.a);
  const t = THREE.MathUtils.clamp(
    new THREE.Vector3().subVectors(point, seg.a).dot(ab) / Math.max(ab.lengthSq(), 1e-20),
    0,
    1,
  );
  return point.distanceTo(new THREE.Vector3().copy(seg.a).addScaledVector(ab, t));
}

/** Chain feature segments connected (by shared endpoints) to the seed. */
function chainFrom(seed: EdgeSegment, segments: EdgeSegment[]): EdgeSegment[] {
  const byKey = new Map<string, EdgeSegment[]>();
  for (const s of segments) {
    for (const k of [s.keyA, s.keyB]) {
      const list = byKey.get(k);
      if (list) list.push(s);
      else byKey.set(k, [s]);
    }
  }
  const chain: EdgeSegment[] = [];
  const visited = new Set<EdgeSegment>();
  const queue = [seed];
  visited.add(seed);
  while (queue.length > 0 && chain.length < 512) {
    const seg = queue.pop()!;
    chain.push(seg);
    for (const k of [seg.keyA, seg.keyB]) {
      for (const next of byKey.get(k) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }
  return chain;
}

/** Fit the picked edge chain as a straight line or a circle. */
function fitEdgeChain(chain: EdgeSegment[], pick: THREE.Vector3): EdgeFit {
  // Unique endpoints, weighted by the length of their incident segments.
  const points = new Map<string, { p: THREE.Vector3; w: number }>();
  let totalLength = 0;
  for (const seg of chain) {
    totalLength += seg.length;
    for (const [key, p] of [[seg.keyA, seg.a], [seg.keyB, seg.b]] as const) {
      const entry = points.get(key);
      if (entry) entry.w += seg.length / 2;
      else points.set(key, { p, w: seg.length / 2 });
    }
  }
  const list = [...points.values()];
  if (list.length < 3 || totalLength <= 0) return null;

  const centroid = new THREE.Vector3();
  let weightSum = 0;
  for (const { p, w } of list) {
    centroid.addScaledVector(p, w);
    weightSum += w;
  }
  centroid.divideScalar(weightSum);

  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const d = new THREE.Vector3();
  for (const { p, w } of list) {
    d.copy(p).sub(centroid);
    cov[0][0] += w * d.x * d.x; cov[0][1] += w * d.x * d.y; cov[0][2] += w * d.x * d.z;
    cov[1][1] += w * d.y * d.y; cov[1][2] += w * d.y * d.z;
    cov[2][2] += w * d.z * d.z;
  }
  cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];

  const spanSeed = new THREE.Vector3().subVectors(list[list.length - 1].p, list[0].p);
  const dir = dominantEigenvector(cov, spanSeed);
  if (!dir) return null;

  // Straight line: distance of every endpoint from the centroid line.
  let lineErr = 0;
  for (const { p, w } of list) {
    d.copy(p).sub(centroid);
    const t = d.dot(dir);
    lineErr += w * (d.lengthSq() - t * t);
  }
  const lineRms = Math.sqrt(Math.max(lineErr, 0) / weightSum);

  // Circle: fit plane (normal = smallest covariance direction), then a 2D
  // least-squares circle (Kåsa) in that plane.
  let circle: { center: THREE.Vector3; axis: THREE.Vector3; radius: number; rms: number; span: number } | null = null;
  const normal = smallestEigenvector(cov, new THREE.Vector3().crossVectors(dir, spanSeed.lengthSq() > 0 ? spanSeed : new THREE.Vector3(0, 0, 1)));
  if (normal && list.length >= 5) {
    const e1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.x) > 0.9) e1.set(0, 1, 0);
    e1.crossVectors(normal, e1).normalize();
    const e2 = new THREE.Vector3().crossVectors(normal, e1);

    let su = 0, sv = 0, suu = 0, svv = 0, suv = 0, sw = 0;
    let r0 = 0, r1 = 0, r2 = 0;
    let planarErr = 0;
    const uv: Array<[number, number, number]> = [];
    for (const { p, w } of list) {
      d.copy(p).sub(centroid);
      planarErr += w * d.dot(normal) ** 2;
      const u = d.dot(e1);
      const v = d.dot(e2);
      const q = u * u + v * v;
      su += w * u; sv += w * v; suu += w * u * u; svv += w * v * v; suv += w * u * v; sw += w;
      r0 -= w * u * q; r1 -= w * v * q; r2 -= w * q;
      uv.push([u, v, w]);
    }
    const solution = solve3(
      [[suu, suv, su], [suv, svv, sv], [su, sv, sw]],
      [r0, r1, r2],
    );
    if (solution) {
      const [a, b, c] = solution;
      const u0 = -a / 2;
      const v0 = -b / 2;
      const radiusSq = u0 * u0 + v0 * v0 - c;
      if (radiusSq > 0 && Number.isFinite(radiusSq)) {
        const radius = Math.sqrt(radiusSq);
        let radialErr = 0;
        const angles: number[] = [];
        for (const [u, v, w] of uv) {
          const e = Math.hypot(u - u0, v - v0) - radius;
          radialErr += w * e * e;
          angles.push(Math.atan2(v - v0, u - u0));
        }
        angles.sort((x, y) => x - y);
        let largestGap = 2 * Math.PI + angles[0] - angles[angles.length - 1];
        for (let i = 1; i < angles.length; i++) {
          largestGap = Math.max(largestGap, angles[i] - angles[i - 1]);
        }
        const span = 2 * Math.PI - largestGap;
        const rms = Math.sqrt((radialErr + planarErr) / sw);
        const center = centroid.clone().addScaledVector(e1, u0).addScaledVector(e2, v0);
        circle = { center, axis: normal.clone(), radius, rms, span };
      }
    }
  }

  const scale = Math.max(totalLength, 1e-9);
  const circleOk = circle !== null && circle.span >= MIN_ARC_SPAN && circle.rms <= 0.03 * circle.radius;
  const lineOk = chain.length >= 3 && lineRms <= 0.02 * scale;

  // A short arc also fits a line — prefer the circle when it is confident.
  if (circleOk && circle) {
    return { kind: 'circle', center: circle.center, axis: circle.axis, radius: circle.radius };
  }
  if (lineOk) {
    const t = new THREE.Vector3().subVectors(pick, centroid).dot(dir);
    return { kind: 'line', origin: centroid.clone().addScaledVector(dir, t), dir: dir.clone() };
  }
  return null;
}

function classifyEdge(
  samples: TriSample[],
  pick: THREE.Vector3,
  threshold: number,
  quantum: number,
): EdgeFit {
  const feature = collectFeatureEdges(samples, quantum);
  if (feature.length === 0) return null;

  let nearest: EdgeSegment | null = null;
  let nearestDistance = threshold;
  for (const seg of feature) {
    const dist = segmentDistance(pick, seg);
    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearest = seg;
    }
  }
  if (!nearest) return null;

  const chain = chainFrom(nearest, feature);
  const chainLength = chain.reduce((sum, s) => sum + s.length, 0);
  // Ignore stray creases (organic meshes): demand a real, extended edge.
  if (chainLength < threshold * 2 || chain.length < 3) return null;
  return fitEdgeChain(chain, pick);
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Classify the surface or feature edge around a picked point. Works in the
 * mesh's local space (our transforms are rigid) and converts the result to
 * world space. Edges win over faces when the click lands on one — except
 * when a straight edge would shadow a cylinder/cone wall (a rim click should
 * still read the hole).
 */
export function classifyPickAt(
  mesh: THREE.Mesh,
  faceIndex: number | null,
  worldPoint: THREE.Vector3,
  modelDiagonal: number,
): SmartPick {
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
  const initialRadius = THREE.MathUtils.clamp(minEdge * 3, modelDiagonal * 0.004, modelDiagonal * 0.08);
  let radius = initialRadius;
  let samples = collectTriangles(geometry, new THREE.Sphere(localPoint, radius));
  for (let attempt = 0; attempt < 3 && samples.length < 12 && radius < modelDiagonal * 0.3; attempt++) {
    radius *= 2;
    samples = collectTriangles(geometry, new THREE.Sphere(localPoint, radius));
  }
  if (samples.length < 2) return { kind: 'unknown', point };

  const face = classifyFace(samples, hitNormal);
  const edgeThreshold = Math.max(minEdge * 1.2, initialRadius * 0.2);
  const edge = classifyEdge(samples, localPoint, edgeThreshold, initialRadius * 1e-3);

  const matrix = mesh.matrixWorld;
  const toWorldPoint = (p: THREE.Vector3) => p.clone().applyMatrix4(matrix).toArray() as Vec3;
  const toWorldDir = (p: THREE.Vector3) => p.clone().transformDirection(matrix).toArray() as Vec3;

  if (edge?.kind === 'circle') {
    return {
      kind: 'circle',
      point,
      center: toWorldPoint(edge.center),
      axis: toWorldDir(edge.axis),
      radius: edge.radius,
    };
  }
  if (edge?.kind === 'line' && face.kind !== 'cylinder' && face.kind !== 'cone') {
    return {
      kind: 'line',
      point,
      origin: toWorldPoint(edge.origin),
      dir: toWorldDir(edge.dir),
    };
  }

  if (face.kind === 'plane') {
    return { kind: 'plane', point, normal: toWorldDir(face.normal) };
  }

  if (face.kind === 'cylinder' || face.kind === 'cone') {
    const axisWorld = face.axis.clone().transformDirection(matrix);
    const axisPointWorld = face.axisPoint.clone().applyMatrix4(matrix);
    // Axis foot at the height of the picked point.
    const t = worldPoint.clone().sub(axisPointWorld).dot(axisWorld);
    const center = axisPointWorld.clone().addScaledVector(axisWorld, t);

    if (face.kind === 'cylinder') {
      return {
        kind: 'cylinder',
        point,
        center: center.toArray() as Vec3,
        axis: axisWorld.toArray() as Vec3,
        radius: face.radius,
      };
    }
    return {
      kind: 'cone',
      point,
      center: center.toArray() as Vec3,
      axis: axisWorld.toArray() as Vec3,
      apex: face.apex ? toWorldPoint(face.apex) : (center.toArray() as Vec3),
      halfAngleDeg: THREE.MathUtils.radToDeg(face.halfAngle),
      radiusAtPoint: worldPoint.distanceTo(center),
    };
  }

  return { kind: 'unknown', point };
}
