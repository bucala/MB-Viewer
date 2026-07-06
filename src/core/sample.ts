import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';

/**
 * Procedural demo assembly (a small turbine-ish housing) so the app can be
 * explored — tree, materials, measurements — without a CAD file at hand.
 * Dimensions are millimeters. Built Y-up.
 */
export function createSampleModel(): LoadedModel {
  const meshes: ModelMesh[] = [];
  const add = (name: string, geometry: THREE.BufferGeometry, color: string): number => {
    const id = meshes.length;
    meshes.push({ id, name, geometry, color });
    return id;
  };

  // Housing
  const body = new THREE.CylinderGeometry(40, 40, 64, 96);
  const bodyId = add('Housing Body', body, '#b45309');

  const flange = new THREE.CylinderGeometry(56, 56, 10, 96);
  flange.translate(0, 37, 0);
  const flangeId = add('Front Flange', flange, '#b45309');

  const rearCap = new THREE.CylinderGeometry(26, 32, 14, 96);
  rearCap.translate(0, -39, 0);
  const rearCapId = add('Rear Cap', rearCap, '#9aa1a9');

  // Shaft with nose cone
  const shaftGeo = mergeGeometries([
    new THREE.CylinderGeometry(9, 9, 150, 48),
    new THREE.ConeGeometry(9, 22, 48).translate(0, 86, 0),
  ]);
  const shaftId = add('Shaft', shaftGeo, '#c7ccd2');

  // Bolts around the flange
  const boltIds: number[] = [];
  const boltCount = 8;
  for (let i = 0; i < boltCount; i++) {
    const angle = (i / boltCount) * Math.PI * 2;
    const head = new THREE.CylinderGeometry(4.5, 4.5, 4, 6).translate(0, 2, 0);
    const shank = new THREE.CylinderGeometry(2.6, 2.6, 12, 24).translate(0, -6, 0);
    const bolt = mergeGeometries([head, shank]);
    bolt.translate(48 * Math.cos(angle), 42, 48 * Math.sin(angle));
    boltIds.push(add(`Bolt M5 ×${i + 1}`, bolt, '#4b5563'));
  }

  let nodeSeq = 0;
  const nid = () => `n${nodeSeq++}`;
  const leaf = (name: string, meshId: number): ModelNode => ({
    id: nid(), name, meshIds: [meshId], children: [],
  });

  const root: ModelNode = {
    id: nid(),
    name: 'Sample Assembly',
    meshIds: [],
    children: [
      {
        id: nid(),
        name: 'Housing',
        meshIds: [],
        children: [
          leaf('Housing Body', bodyId),
          leaf('Front Flange', flangeId),
          leaf('Rear Cap', rearCapId),
        ],
      },
      leaf('Shaft', shaftId),
      {
        id: nid(),
        name: 'Fasteners',
        meshIds: [],
        children: boltIds.map((meshId, i) => leaf(`Bolt M5 ×${i + 1}`, meshId)),
      },
    ],
  };

  return finalizeModel('Sample Assembly', root, meshes, 'y');
}
