import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'sk' | 'en';
export type ThemeId = 'white' | 'gray' | 'black';
export type ProjectionMode = 'perspective' | 'parallel';

export interface SettingsValues {
  language: Lang;
  theme: ThemeId;
  projection: ProjectionMode;
  /** Opacity used for parts toggled translucent in the tree (0.1–0.9). */
  transparency: number;
  /** Per-extension opt-in for OS file association (applied by the desktop installer). */
  fileAssociations: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  language: 'sk',
  theme: 'white',
  projection: 'perspective',
  transparency: 0.35,
  fileAssociations: {},
};

interface SettingsState extends SettingsValues {
  apply(values: Partial<SettingsValues>): void;
  reset(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      apply: (values) => set(values),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    { name: 'mb-viewer-settings', version: 1 },
  ),
);

/** 3D scene colors that must match the active UI skin. */
export const THEME_3D: Record<ThemeId, { canvas: string; gridCell: string; gridSection: string; gizmoLabel: string }> = {
  white: { canvas: '#eef0f3', gridCell: '#d3d7dc', gridSection: '#b4bac2', gizmoLabel: '#374151' },
  gray: { canvas: '#484d55', gridCell: '#575d66', gridSection: '#6b727d', gizmoLabel: '#e5e7eb' },
  black: { canvas: '#131519', gridCell: '#242830', gridSection: '#353b46', gizmoLabel: '#d1d5db' },
};
