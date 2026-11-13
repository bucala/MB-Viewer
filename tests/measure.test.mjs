// Regression tests for the measuring core (src/core/measure), run on real
// OpenCASCADE tessellations of the CAx-IF/occt-import-js sample models that
// ship inside the occt-import-js npm package (nothing is checked in here).
//
// Ground truth comes from the exact surface normals OCCT returns per vertex,
// independently of the classifier under test: a B-rep face is a plane when
// all normals agree, a cylinder when they are all perpendicular to one axis
// (then its vertices lie on one circle). Clicks are simulated like the app
// does them: a ray onto the surface, using the BVH's (indirect) face index.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { installBvhRaycast } from '../src/core/bvh.ts';
import { classifyPickAt } from '../src/core/measure/surface.ts';
import { circleFrom3Points, pairMeasure } from '../src/core/measure/geometry.ts';

installBvhRaycast();
const require = createRequire(import.meta.url);
const testfiles = new URL('../node_modules/occt-import-js/test/testfiles/', import.meta.url);
const occt = await require('occt-import-js')();

const FILES = [
  'cax-if/as1_pe_203.stp',
  'cax-if/as1-oc-214.stp',
  'cax-if/s1-c5-214/FOOT_BACK_000.stp',
  'cax-if/s1-c5-214/MAINBODY_BACK.stp',
  'cax-if/io1-cm-214.stp',
  'rounded-cube/rounded-cube.step',
];

function groundTruth(pos, nrm, idx, first, last) {
  const ids = new Set();
  for (let t = first; t <= last; t++) for (let k = 0; k < 3; k++) ids.add(idx[t * 3 + k]);
  const N = [...ids].map((i) => new THREE.Vector3(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).normalize());
  const P = [...ids].map((i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  if (N.every((n) => n.dot(N[0]) > 0.99999)) return { kind: 'plane' };
  // Axis = the direction every normal is perpendicular to: try the cross
  // products of normal pairs and keep the best.
  let axis = null;
  let best = Infinity;
  for (let i = 1; i < N.length; i += Math.max(1, Math.floor(N.length / 24))) {
    const c = new THREE.Vector3().crossVectors(N[0], N[i]);
    if (c.lengthSq() < 1e-6) continue;
    c.normalize();
    const worst = Math.max(...N.map((n) => Math.abs(n.dot(c))));
    if (worst < best) { best = worst; axis = c; }
  }
  if (!axis || best > 2e-3) return { kind: 'other' };
  const e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.x) > 0.9) e1.set(0, 1, 0);
  e1.crossVectors(axis, e1).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  // Circle through three well-spread vertices, then verify all of them.
  const uv = P.map((p) => [p.dot(e1), p.dot(e2)]);
  const [a, b, c] = [uv[0], uv[Math.floor(uv.length / 3)], uv[Math.floor((2 * uv.length) / 3)]];
  const circle = circleFrom3Points([a[0], a[1], 0], [b[0], b[1], 0], [c[0], c[1], 0]);
  if (!circle) return { kind: 'other' };
  const [cx, cy] = circle.center;
  const ok = uv.every(([u, v]) => Math.abs(Math.hypot(u - cx, v - cy) - circle.radius) < 1e-3 * circle.radius);
  return ok ? { kind: 'cylinder', R: circle.radius } : { kind: 'other' };
}

function* clicks() {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const file of FILES) {
    const result = occt.ReadStepFile(new Uint8Array(readFileSync(new URL(file, testfiles))), null);
    for (const m of result.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.attributes.position.array), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.attributes.normal.array), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.index.array), 1));
      g.computeBoundingBox();
      g.computeBoundsTree({ indirect: true });
      const faces = [...m.brep_faces].sort((x, y) => x.first - y.first);
      g.userData.faceRanges = Uint32Array.from(faces.flatMap((f) => [f.first, f.last]));
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.updateMatrixWorld(true);
      const partSize = g.boundingBox.getSize(new THREE.Vector3()).length();
      const pos = m.attributes.position.array;
      const nrm = m.attributes.normal.array;
      const idx = m.index.array;
      for (const face of faces) {
        const truth = groundTruth(pos, nrm, idx, face.first, face.last);
        for (let k = 0; k < 4; k++) {
          const t = face.first + Math.floor(rand() * (face.last - face.first + 1));
          let u = rand(), w = rand();
          if (u + w > 1) { u = 1 - u; w = 1 - w; }
          const vtx = [0, 1, 2].map((j) => new THREE.Vector3().fromArray(pos, idx[t * 3 + j] * 3));
          const p = vtx[0].clone().multiplyScalar(1 - u - w).addScaledVector(vtx[1], u).addScaledVector(vtx[2], w);
          const n = new THREE.Triangle(...vtx).getNormal(new THREE.Vector3());
          const e = 1e-4 * partSize;
          let hit = null;
          for (const sign of [1, -1]) {
            const rc = new THREE.Raycaster(p.clone().addScaledVector(n, sign * e), n.clone().multiplyScalar(-sign));
            rc.firstHitOnly = true;
            const h = rc.intersectObject(mesh)[0];
            if (h && h.point.distanceTo(p) < 3 * e) { hit = h; break; }
          }
          if (!hit) continue;
          yield { truth, partSize, pick: classifyPickAt(mesh, hit.faceIndex, hit.point.clone()) };
        }
      }
    }
  }
}

const results = [...clicks()];

test('STEP: clicks on cylindrical faces measure the exact diameter', () => {
  const onCylinders = results.filter((r) => r.truth.kind === 'cylinder');
  assert.ok(onCylinders.length > 300, `enough cylinder clicks (${onCylinders.length})`);
  const exact = onCylinders.filter(({ pick, truth }) =>
    (pick.kind === 'cylinder' || pick.kind === 'circle') && Math.abs(pick.radius - truth.R) / truth.R < 0.005);
  const rate = exact.length / onCylinders.length;
  assert.ok(rate >= 0.98, `≥ 98 % exact diameters, got ${(rate * 100).toFixed(1)} %`);
});

test('STEP: diameters read from whole B-rep faces are never approximate', () => {
  assert.equal(results.filter(({ pick }) => pick.approx).length, 0);
});

test('STEP: clicks on flat faces never report a diameter of the face itself', () => {
  const onPlanes = results.filter((r) => r.truth.kind === 'plane');
  assert.ok(onPlanes.length > 300, `enough plane clicks (${onPlanes.length})`);
  const asCylinder = onPlanes.filter(({ pick }) => pick.kind === 'cylinder' || pick.kind === 'cone');
  assert.equal(asCylinder.length, 0);
});

test('no measured circle is larger than the part (polygon outlines are not circles)', () => {
  const absurd = results.filter(({ pick, partSize }) =>
    (pick.kind === 'cylinder' || pick.kind === 'circle') && pick.radius * 2 > partSize * 1.01);
  assert.deepEqual(absurd.map(({ pick }) => pick.radius), []);
});

test('pairMeasure: parallel planes measure along the normal', () => {
  const r = pairMeasure(
    { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    { kind: 'plane', point: [3, 4, 12.5], normal: [0, 0, -1] },
    'distance',
  );
  assert.equal(r.type, 'distance');
  assert.ok(Math.abs(r.value - 12.5) < 1e-9);
});

test('pairMeasure: angle between planes', () => {
  const r = pairMeasure(
    { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    { kind: 'plane', point: [5, 0, 0], normal: [Math.SQRT1_2, 0, Math.SQRT1_2] },
    'angle',
  );
  assert.ok(Math.abs(r.value - 45) < 1e-9);
});

test('circleFrom3Points: exact circle, null when collinear', () => {
  const c = circleFrom3Points([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
  assert.ok(Math.abs(c.radius - 10) < 1e-12);
  assert.equal(circleFrom3Points([0, 0, 0], [1, 1, 1], [2, 2, 2]), null);
});
