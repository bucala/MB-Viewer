import { create } from 'zustand';
import type {
  LoadedModel, MaterialAssignment, Measurement, ToolId, Vec3,
} from '@/core/types';
import {
  angleAtVertexDeg, circleFrom3Points, distanceBetween, formatMm,
} from '@/core/measure/geometry';
import { disposeModel } from '@/core/loaders/finalizeModel';

interface LoadState {
  state: 'idle' | 'loading' | 'error';
  fileName?: string;
  error?: string;
}

interface ViewerState {
  model: LoadedModel | null;
  load: LoadState;

  /** Node ids explicitly hidden by the user (hides the whole subtree). */
  hidden: Record<string, true>;
  selectedId: string | null;

  tool: ToolId;
  pendingPoints: Vec3[];
  measurements: Measurement[];

  globalMaterial: MaterialAssignment;
  overrides: Record<string, MaterialAssignment>;

  gridVisible: boolean;
  sidebarOpen: boolean;
  /** Bumped to ask the camera rig to re-frame the model. */
  fitSignal: number;
  /** Transient hint shown in the status bar. */
  notice: string | null;

  beginLoad(fileName: string): void;
  failLoad(error: string): void;
  dismissError(): void;
  setModel(model: LoadedModel): void;

  toggleHidden(id: string): void;
  showAll(): void;
  setSelected(id: string | null): void;

  setTool(tool: ToolId): void;
  addMeasurePoint(point: Vec3): void;
  cancelPending(): void;
  removeMeasurement(id: string): void;
  clearMeasurements(): void;

  applyMaterial(patch: Partial<MaterialAssignment>): void;
  resetMaterials(): void;

  requestFit(): void;
  toggleGrid(): void;
  toggleSidebar(): void;
  setNotice(notice: string | null): void;
}

let measurementSeq = 0;

const TOOL_HINTS: Record<Exclude<ToolId, 'select'>, string[]> = {
  'measure-distance': [
    'Distance — pick the first point (snaps to vertices)',
    'Distance — pick the second point',
  ],
  'measure-angle': [
    'Angle — pick a point on the first leg',
    'Angle — pick the corner (vertex) point',
    'Angle — pick a point on the second leg',
  ],
  'measure-radius': [
    'Diameter — pick a first point on the circular edge or face',
    'Diameter — pick a second point along the same circle',
    'Diameter — pick a third point to fit the circle',
  ],
};

const pointsNeeded = (tool: ToolId): number => (tool === 'measure-distance' ? 2 : 3);

export const useViewer = create<ViewerState>()((set, get) => ({
  model: null,
  load: { state: 'idle' },
  hidden: {},
  selectedId: null,
  tool: 'select',
  pendingPoints: [],
  measurements: [],
  globalMaterial: { preset: 'original' },
  overrides: {},
  gridVisible: true,
  sidebarOpen: true,
  fitSignal: 0,
  notice: null,

  beginLoad: (fileName) => set({ load: { state: 'loading', fileName } }),

  failLoad: (error) => set({ load: { state: 'error', error } }),

  dismissError: () => set({ load: { state: 'idle' } }),

  setModel: (model) => {
    const previous = get().model;
    if (previous) disposeModel(previous);
    set({
      model,
      load: { state: 'idle' },
      hidden: {},
      selectedId: null,
      tool: 'select',
      pendingPoints: [],
      measurements: [],
      globalMaterial: { preset: 'original' },
      overrides: {},
      notice: null,
      fitSignal: get().fitSignal + 1,
    });
  },

  toggleHidden: (id) => {
    const hidden = { ...get().hidden };
    if (hidden[id]) delete hidden[id];
    else hidden[id] = true;
    set({ hidden });
  },

  showAll: () => set({ hidden: {} }),

  setSelected: (id) => set({ selectedId: id }),

  setTool: (tool) =>
    set({
      tool,
      pendingPoints: [],
      notice: tool === 'select' ? null : TOOL_HINTS[tool][0],
    }),

  addMeasurePoint: (point) => {
    const { tool, pendingPoints, measurements } = get();
    if (tool === 'select') return;
    const points = [...pendingPoints, point];
    const needed = pointsNeeded(tool);

    if (points.length < needed) {
      set({ pendingPoints: points, notice: TOOL_HINTS[tool][points.length] });
      return;
    }

    let measurement: Measurement;
    if (tool === 'measure-distance') {
      const value = distanceBetween(points[0], points[1]);
      measurement = {
        id: `m${++measurementSeq}`, type: 'distance', points, value,
        label: `${formatMm(value)} mm`,
      };
    } else if (tool === 'measure-angle') {
      const value = angleAtVertexDeg(points[0], points[1], points[2]);
      measurement = {
        id: `m${++measurementSeq}`, type: 'angle', points, value,
        label: `${value.toFixed(1)}°`,
      };
    } else {
      const circle = circleFrom3Points(points[0], points[1], points[2]);
      if (!circle) {
        set({
          pendingPoints: [],
          notice: 'Those points are collinear — pick three points spread around the curve.',
        });
        return;
      }
      const value = circle.radius * 2;
      measurement = {
        id: `m${++measurementSeq}`, type: 'radius', points, value,
        label: `Ø ${formatMm(value)} mm`, circle,
      };
    }

    set({
      pendingPoints: [],
      measurements: [...measurements, measurement],
      notice: `${measurement.label} — ${TOOL_HINTS[tool][0]}`,
    });
  },

  cancelPending: () => set({ pendingPoints: [], notice: null }),

  removeMeasurement: (id) =>
    set({ measurements: get().measurements.filter((m) => m.id !== id) }),

  clearMeasurements: () => set({ measurements: [], pendingPoints: [] }),

  applyMaterial: (patch) => {
    const { selectedId, overrides, globalMaterial } = get();
    if (selectedId) {
      const current = overrides[selectedId] ?? { ...globalMaterial };
      set({ overrides: { ...overrides, [selectedId]: { ...current, ...patch } } });
    } else {
      set({ globalMaterial: { ...globalMaterial, ...patch } });
    }
  },

  resetMaterials: () => set({ overrides: {}, globalMaterial: { preset: 'original' } }),

  requestFit: () => set({ fitSignal: get().fitSignal + 1 }),

  toggleGrid: () => set({ gridVisible: !get().gridVisible }),

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

  setNotice: (notice) => set({ notice }),
}));
