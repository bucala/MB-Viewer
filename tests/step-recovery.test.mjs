import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { OcctKernel } from 'occt-wasm';
import { recoverStepByPart } from '../src/core/loaders/stepRecovery.ts';

test('STEP recovery tessellates an AP214 assembly and keeps repeated part placements', async () => {
  const source = new URL('../node_modules/occt-import-js/test/testfiles/cax-if/dm1-oc-214.stp', import.meta.url);
  const kernel = await OcctKernel.init();
  try {
    const { meshes, root } = recoverStepByPart(kernel, await readFile(source));
    assert.equal(root.children.length, 1);
    assert.equal(meshes.length, 7);
    assert.ok(meshes.every((mesh) => mesh.positions.length >= 9 && mesh.indices.length >= 3));

    const bolts = meshes.filter(({ name }) => name === 'bolt');
    assert.equal(bolts.length, 3);
    assert.equal(new Set(bolts.map(({ indices }) => indices.buffer)).size, 3);
    const maxXs = bolts.map(({ positions }) => Math.max(...positions.filter((_, index) => index % 3 === 0)));
    assert.ok(Math.max(...maxXs) - Math.min(...maxXs) > 20);
  } finally {
    kernel[Symbol.dispose]();
  }
});
