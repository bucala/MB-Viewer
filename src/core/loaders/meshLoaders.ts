import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedModel, ModelMesh, ModelNode } from '@/core/types';
import { finalizeModel } from '@/core/loaders/finalizeModel';

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** STL — single unnamed solid, usually exported Z-up from CAD. */
export function loadStlModel(buffer: ArrayBuffer, fileName: string): LoadedModel {
  const geometry = new STLLoader().parse(buffer);
  const name = baseName(fileName);
  const mesh: ModelMesh = { id: 0, name, geometry };
  const root: ModelNode = { id: 'n0', name, meshIds: [0], children: [] };
  return finalizeModel(fileName, root, [mesh], 'z');
}

/** OBJ — flat list of named objects/groups, Y-up by convention. */
export function loadObjModel(text: string, fileName: string): LoadedModel {
  const group = new OBJLoader().parse(text);
  group.updateMatrixWorld(true);

  const meshes: ModelMesh[] = [];
  const children: ModelNode[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const id = meshes.length;
    const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
    const name = mesh.name.trim() || `Object ${id + 1}`;
    meshes.push({ id, name, geometry });
    children.push({ id: `n${id + 1}`, name, meshIds: [id], children: [] });
  });
  if (meshes.length === 0) throw new Error('The OBJ file contains no geometry.');

  const root: ModelNode = { id: 'n0', name: baseName(fileName), meshIds: [], children };
  return finalizeModel(fileName, root, meshes, 'y');
}

/** GLB — full scene graph mirrored into the assembly tree, materials kept. */
export async function loadGlbModel(buffer: ArrayBuffer, fileName: string): Promise<LoadedModel> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const meshes: ModelMesh[] = [];
  let nodeSeq = 0;

  const convert = (object: THREE.Object3D): ModelNode | null => {
    const children = object.children
      .map(convert)
      .filter((node): node is ModelNode => node !== null);

    const meshIds: number[] = [];
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const id = meshes.length;
      const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      meshes.push({
        id,
        name: object.name.trim() || `Mesh ${id + 1}`,
        geometry,
        originalMaterial: material ?? undefined,
      });
      meshIds.push(id);
    }

    if (children.length === 0 && meshIds.length === 0) return null;
    return {
      id: `n${nodeSeq++}`,
      name: object.name.trim() || (meshIds.length > 0 ? `Mesh ${meshIds[0] + 1}` : 'Group'),
      meshIds,
      children,
    };
  };

  const rootChildren = scene.children
    .map(convert)
    .filter((node): node is ModelNode => node !== null);
  if (meshes.length === 0) throw new Error('The GLB file contains no mesh geometry.');

  const root: ModelNode = {
    id: `n${nodeSeq++}`,
    name: baseName(fileName),
    meshIds: [],
    children: rootChildren,
  };
  return finalizeModel(fileName, root, meshes, 'y');
}
