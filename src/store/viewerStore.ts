import { create } from 'zustand';
import type {
  LoadedModel, MaterialAssignment, Measurement, ToolId, Vec3,
} from '@/core/types';
import {
  angleAtVertexDeg, circleFrom3Points, distanceBetween, formatMm, planeToPlane,
} from '@/core/measure/geometry';
import type { SurfacePick } from '@/core/measure/surface';
import { disposeModel } from '@/core/loaders/finalizeModel';
import { tr, type TranslationKey } from '@/i18n';

interface LoadState {
  state: 'idle' | 'loading' | 'error';
  fileName?: string;
  error?: string;
}

interface PendingPlane {
  point: Vec3;
  normal: Vec3;
}

interface ViewerState {
  model: LoadedModel | null;
  load: LoadState;

  /** Node ids explicitly hidden by the user (hides the whole subtree). */
  hidden: Record<string, true>;
  /** Node ids rendered translucent (applies to the whole subtree). */
  translucent: Record<string, true>;
  selectedId: string | null;

  tool: ToolId;
  pendingPoints: Vec3[];
  /** First face captured by the smart-measure tool. */
  pendingPlane: PendingPlane | null;
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
  toggleTranslucent(id: string): void;
  showAll(): void;
  setSelected(id: string | null): void;

  setTool(tool: ToolId): void;
  addMeasurePoint(point: Vec3): void;
  handleAutoSurface(pick: SurfacePick): void;
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

const TOOL_HINT_KEYS: Record<Exclude<ToolId, 'select'>, TranslationKey[]> = {
  'measure-auto': ['hint.auto.start'],
  'measure-distance': ['hint.distance.0', 'hint.distance.1'],
  'measure-angle': ['hint.angle.0', 'hint.angle.1', 'hint.angle.2'],
  'measure-radius': ['hint.radius.0', 'hint.radius.1', 'hint.radius.2'],
};

const pointsNeeded = (tool: ToolId): number => (tool === 'measure-distance' ? 2 : 3);

export const useViewer = create<ViewerState>()((set, get) => ({
  model: null,
  load: { state: 'idle' },
  hidden: {},
  translucent: {},
  selectedId: null,
  tool: 'select',
  pendingPoints: [],
  pendingPlane: null,
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
      translucent: {},
      selectedId: null,
      tool: 'select',
      pendingPoints: [],
      pendingPlane: null,
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

  toggleTranslucent: (id) => {
    const translucent = { ...get().translucent };
    if (translucent[id]) delete translucent[id];
    else translucent[id] = true;
    set({ translucent });
  },

  showAll: () => set({ hidden: {} }),

  setSelected: (id) => set({ selectedId: id }),

  setTool: (tool) =>
    set({
      tool,
      pendingPoints: [],
      pendingPlane: null,
      notice: tool === 'select' ? null : tr(TOOL_HINT_KEYS[tool][0]),
    }),

  addMeasurePoint: (point) => {
    const { tool, pendingPoints, measurements } = get();
    if (tool === 'select' || tool === 'measure-auto') return;
    const points = [...pendingPoints, point];
    const needed = pointsNeeded(tool);

    if (points.length < needed) {
      set({ pendingPoints: points, notice: tr(TOOL_HINT_KEYS[tool][points.length]) });
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
        set({ pendingPoints: [], notice: tr('hint.collinear') });
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
      notice: `${measurement.label} — ${tr(TOOL_HINT_KEYS[tool][0])}`,
    });
  },

  handleAutoSurface: (pick) => {
    const { pendingPlane, measurements } = get();

    if (pick.kind === 'cylinder' && pick.center && pick.axis && pick.radius) {
      const value = pick.radius * 2;
      const measurement: Measurement = {
        id: `m${++measurementSeq}`,
        type: 'radius',
        points: [pick.point],
        value,
        label: `Ø ${formatMm(value)} mm`,
        circle: { center: pick.center, radius: pick.radius, normal: pick.axis },
      };
      set({
        measurements: [...measurements, measurement],
        pendingPlane: null,
        pendingPoints: [],
        notice: `${measurement.label} — ${tr('hint.auto.start')}`,
      });
      return;
    }

    if (pick.kind === 'plane' && pick.normal) {
      if (!pendingPlane) {
        set({
          pendingPlane: { point: pick.point, normal: pick.normal },
          pendingPoints: [pick.point],
          notice: tr('hint.auto.plane'),
        });
        return;
      }
      const result = planeToPlane(pendingPlane.point, pendingPlane.normal, pick.point, pick.normal);
      const measurement: Measurement = {
        id: `m${++measurementSeq}`,
        type: 'distance',
        points: [pendingPlane.point, result.end],
        value: result.value,
        label: `${formatMm(result.value)} mm`,
      };
      set({
        measurements: [...measurements, measurement],
        pendingPlane: null,
        pendingPoints: [],
        notice: `${measurement.label} — ${tr(result.parallel ? 'hint.auto.start' : 'hint.auto.nonparallel')}`,
      });
      return;
    }

    set({ notice: tr('hint.auto.unknown') });
  },

  cancelPending: () => set({ pendingPoints: [], pendingPlane: null, notice: null }),

  removeMeasurement: (id) =>
    set({ measurements: get().measurements.filter((m) => m.id !== id) }),

  clearMeasurements: () => set({ measurements: [], pendingPoints: [], pendingPlane: null }),

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
