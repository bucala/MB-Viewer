import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelExtension } from '../src/core/loaders/modelFileType.ts';

const bytes = (text) => new TextEncoder().encode(text).buffer;

test('recognizes a STEP document whose provider returns .bin or an opaque name', () => {
  const step = bytes('\uFEFF\r\nISO-10303-21;\nHEADER;');
  assert.equal(resolveModelExtension('model.BIN', step), 'stp');
  assert.equal(resolveModelExtension('12345', step), 'stp');
});

test('keeps the original format for supported extensions', () => {
  assert.equal(resolveModelExtension('Pozice odebírání rámů.STP', bytes('')), 'stp');
  assert.equal(resolveModelExtension('model.glb', bytes('glTF')), 'glb');
});

test('rejects generic documents without a STEP opening record', () => {
  assert.equal(resolveModelExtension('model.bin', bytes('unknown binary')), 'bin');
  assert.equal(resolveModelExtension('model.bin', bytes('prefix ISO-10303-21;')), 'bin');
  assert.equal(resolveModelExtension('model.bin', bytes('ISO-10303-210;')), 'bin');
});
