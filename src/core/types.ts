import type * as THREE from 'three';

/** Plain-array point, safe to keep in the store. World coordinates, mm. */
export type Vec3 = [number, number, number];

export type ToolId =
  | 'select'
  | 'measure-auto'
  | 'measure-distance'
  | 'measure-angle'
  | 'measure-radius';

export type MaterialPresetId = 'original' | 'matte' | 'shiny' | 'metal' | 'glass';

export interface MaterialAssignment {
  preset: MaterialPresetId;
  /** CSS hex. Undefined = keep the color embedded in the CAD file. */
  color?: string;
}

/** A node of the assembly tree (product structure). */
export interface ModelNode {
  id: string;
  name: string;
  /** Indices into LoadedModel.meshes rendered by this node. */
  meshIds: number[];
  children: ModelNode[];
}

/** One tessellated body. Transforms are baked — geometry is in world space. */
export interface ModelMesh {
  id: number;
  name: string;
  geometry: THREE.BufferGeometry;
  /** Color from the CAD file, as CSS hex. */
  color?: string;
  /** Material embedded in the source file (glTF), used by the 'original' preset. */
  originalMaterial?: THREE.Material;
}

export interface LoadedModel {
  name: string;
  root: ModelNode;
  meshes: ModelMesh[];
  /** meshId -> owning tree node id (for picking). */
  meshToNode: Record<number, string>;
  nodeIndex: Record<string, ModelNode>;
  /** Box of the raw geometry, before the up-axis display rotation. */
  boundingBox: THREE.Box3;
  triangleCount: number;
  partCount: number;
  /** CAD data is usually Z-up; the scene rotates it to three.js Y-up. */
  upAxis: 'y' | 'z';
}

export interface Circle3 {
  center: Vec3;
  radius: number;
  normal: Vec3;
}

export type MeasurementType = 'distance' | 'angle' | 'radius';

export interface Measurement {
  id: string;
  type: MeasurementType;
  points: Vec3[];
  /** mm for distance/radius(Ø), degrees for angle. */
  value: number;
  label: string;
  /** Fitted circle, for diameter measurements. */
  circle?: Circle3;
}

/** A mesh ready to draw this frame, with its resolved appearance. */
export interface RenderEntry {
  mesh: ModelMesh;
  nodeId: string;
  assignment: MaterialAssignment;
  selected: boolean;
  translucent: boolean;
}
