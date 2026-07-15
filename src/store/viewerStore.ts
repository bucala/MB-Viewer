import { create } from 'zustand';
import type {
  LoadedModel, MaterialAssignment, Measurement, SectionState, ToolId, Vec3,
} from '@/core/types';
import {
  circleFrom3Points, distanceBetween, formatMm,
  pairMeasure, type MeasureEntity, type PairResult,
} from '@/core/measure/geometry';
import type { SmartPick } from '@/core/measure/surface';
import { disposeModel } from '@/core/loaders/finalizeModel';
import { tr, type TranslationKey } from '@/i18n';

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
  /** Node ids rendered translucent (applies to the whole subtree). */
  translucent: Record<string, true>;
  selectedId: string | null;

  tool: ToolId;
  pendingPoints: Vec3[];
  /** First face/edge captured by the surface-based measure tools. */
  pendingEntity: MeasureEntity | null;
  measurements: Measurement[];

  globalMaterial: MaterialAssignment;
  overrides: Record<string, MaterialAssignment>;

  section: SectionState;

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
  /** Point-based tools: point-to-point and the 3-point diameter fallback. */
  addMeasurePoint(point: Vec3): void;
  /** Surface-based tools: auto / distance / angle / diameter. */
  handleSmartPick(pick: SmartPick, snapped: Vec3): void;
  cancelPending(): void;
  removeMeasurement(id: string): void;
  clearMeasurements(): void;

  applyMaterial(patch: Partial<MaterialAssignment>): void;
  resetMaterials(): void;

  setSection(patch: Partial<SectionState>): void;

  requestFit(): void;
  toggleGrid(): void;
  toggleSidebar(): void;
  setNotice(notice: string | null): void;
}

let measurementSeq = 0;

const TOOL_START_HINTS: Record<Exclude<ToolId, 'select'>, TranslationKey> = {
  'measure-auto': 'hint.auto.start',
  'measure-distance': 'hint.distance.start',
  'measure-angle': 'hint.angle.start',
  'measure-radius': 'hint.radius.start',
  'measure-point': 'hint.p2p.0',
};

/** Hint shown after an entity was captured, per tool. */
const SECOND_PICK_HINTS: Partial<Record<ToolId, TranslationKey>> = {
  'measure-auto': 'hint.auto.second',
  'measure-distance': 'hint.distance.second',
  'measure-angle': 'hint.angle.second',
};

const diameterMeasurement = (center: Vec3, axis: Vec3, radius: number, pickPoint: Vec3): Measurement => {
  const value = radius * 2;
  return {
    id: `m${++measurementSeq}`,
    type: 'radius',
    points: [pickPoint],
    value,
    label: `Ø ${formatMm(value)} mm`,
    circle: { center, radius, normal: axis },
  };
};

export const useViewer = create<ViewerState>()((set, get) => ({
  model: null,
  load: { state: 'idle' },
  hidden: {},
  translucent: {},
  selectedId: null,
  tool: 'select',
  pendingPoints: [],
  pendingEntity: null,
  measurements: [],
  globalMaterial: { preset: 'original' },
  overrides: {},
  section: { axis: 'none', position: 0.5, flip: false, fill: true },
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
      pendingEntity: null,
      measurements: [],
      globalMaterial: { preset: 'original' },
      overrides: {},
      section: { axis: 'none', position: 0.5, flip: false, fill: true },
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
      pendingEntity: null,
      notice: tool === 'select' ? null : tr(TOOL_START_HINTS[tool]),
    }),

  addMeasurePoint: (point) => {
    const { tool, pendingPoints, measurements } = get();
    if (tool !== 'measure-point' && tool !== 'measure-radius') return;
    const points = [...pendingPoints, point];
    const needed = tool === 'measure-point' ? 2 : 3;

    if (points.length < needed) {
      const hint: TranslationKey =
        tool === 'measure-point' ? 'hint.p2p.1' : points.length === 1 ? 'hint.radius.1' : 'hint.radius.2';
      set({ pendingPoints: points, notice: tr(hint) });
      return;
    }

    let measurement: Measurement;
    if (tool === 'measure-point') {
      const value = distanceBetween(points[0], points[1]);
      measurement = {
        id: `m${++measurementSeq}`, type: 'distance', points, value,
        label: `${formatMm(value)} mm`,
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
      notice: `${measurement.label} — ${tr(TOOL_START_HINTS[tool])}`,
    });
  },

  handleSmartPick: (pick, snapped) => {
    const { tool, measurements } = get();
    if (tool !== 'measure-auto' && tool !== 'measure-distance' && tool !== 'measure-angle' && tool !== 'measure-radius') {
      return;
    }
    const commit = (measurement: Measurement, extraKey?: TranslationKey) =>
      set({
        measurements: [...measurements, measurement],
        pendingEntity: null,
        pendingPoints: [],
        notice: `${measurement.label} — ${tr(extraKey ?? TOOL_START_HINTS[tool])}`,
      });

    // Single-click results: cylinders, cones and circular edges.
    if (pick.kind === 'cylinder' && (tool === 'measure-auto' || tool === 'measure-radius')) {
      commit(diameterMeasurement(pick.center, pick.axis, pick.radius, pick.point));
      return;
    }
    if (pick.kind === 'circle' && (tool === 'measure-auto' || tool === 'measure-radius')) {
      commit(diameterMeasurement(pick.center, pick.axis, pick.radius, pick.point));
      return;
    }
    if (pick.kind === 'cone') {
      if (tool === 'measure-auto' || tool === 'measure-angle') {
        // Full apex angle, drawn between the picked generator and its mirror.
        const value = pick.halfAngleDeg * 2;
        const mirror: Vec3 = [
          2 * pick.center[0] - pick.point[0],
          2 * pick.center[1] - pick.point[1],
          2 * pick.center[2] - pick.point[2],
        ];
        commit({
          id: `m${++measurementSeq}`,
          type: 'angle',
          points: [pick.point, pick.apex, mirror],
          value,
          label: `${value.toFixed(1)}°`,
        });
        return;
      }
      if (tool === 'measure-radius') {
        // Diameter of the cone at the picked height.
        commit(diameterMeasurement(pick.center, pick.axis, pick.radiusAtPoint, pick.point));
        return;
      }
    }

    // Everything else resolves to a pairable entity (tool-dependent).
    const entity = resolveEntity(pick, snapped, tool);
    if (!entity) {
      if (tool === 'measure-radius') {
        // Unrecognized surface — fall back to the 3-point circle flow.
        get().addMeasurePoint(snapped);
      } else {
        set({ notice: tr(tool === 'measure-angle' ? 'hint.angle.invalid' : 'hint.auto.unknown') });
      }
      return;
    }
    if (tool === 'measure-radius') {
      // Diameter tool wants circles only; other geometry goes to the fallback.
      get().addMeasurePoint(snapped);
      return;
    }

    const { pendingEntity } = get();
    if (!pendingEntity) {
      const hint: TranslationKey =
        SECOND_PICK_HINTS[tool] ?? 'hint.auto.second';
      set({
        pendingEntity: entity,
        pendingPoints: [entity.kind === 'point' ? entity.point : pick.point],
        notice: tr(hint),
      });
      return;
    }

    const mode = tool === 'measure-distance' ? 'distance' : tool === 'measure-angle' ? 'angle' : 'auto';
    const result = pairMeasure(pendingEntity, entity, mode);
    if (!result) {
      set({ notice: tr('hint.angle.invalid') });
      return;
    }
    commit(toMeasurement(result), result.parallel === false ? 'hint.distance.nonparallel' : undefined);
  },

  cancelPending: () => set({ pendingPoints: [], pendingEntity: null, notice: null }),

  removeMeasurement: (id) =>
    set({ measurements: get().measurements.filter((m) => m.id !== id) }),

  clearMeasurements: () => set({ measurements: [], pendingPoints: [], pendingEntity: null }),

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

  setSection: (patch) => set({ section: { ...get().section, ...patch } }),

  requestFit: () => set({ fitSignal: get().fitSignal + 1 }),

  toggleGrid: () => set({ gridVisible: !get().gridVisible }),

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

  setNotice: (notice) => set({ notice }),
}));

/** How a pick participates in a pair, per tool. */
function resolveEntity(pick: SmartPick, snapped: Vec3, tool: ToolId): MeasureEntity | null {
  switch (pick.kind) {
    case 'plane':
      return { kind: 'plane', point: pick.point, normal: pick.normal };
    case 'line':
      return { kind: 'line', point: pick.point, dir: pick.dir };
    case 'cylinder':
    case 'cone':
      // Distance/angle read the axis (hole pitch, axis-to-face angle…).
      return { kind: 'line', point: pick.center, dir: pick.axis };
    case 'circle':
      // Distance measures from the circle's center, angle from its axis.
      return tool === 'measure-angle'
        ? { kind: 'line', point: pick.center, dir: pick.axis }
        : { kind: 'point', point: pick.center };
    case 'unknown':
      return tool === 'measure-distance' ? { kind: 'point', point: snapped } : null;
  }
}

function toMeasurement(result: PairResult): Measurement {
  return {
    id: `m${++measurementSeq}`,
    type: result.type,
    points: result.points,
    value: result.value,
    label: result.type === 'angle' ? `${result.value.toFixed(1)}°` : `${formatMm(result.value)} mm`,
  };
}
