import { useEffect, useRef, useState } from 'react';
import { useViewer } from '@/store/viewerStore';
import { pickModelFile } from '@/core/loaders/openModelFile';
import { PRESET_ORDER, SWATCH_COLORS } from '@/core/materials/presets';
import type { MaterialPresetId, ToolId } from '@/core/types';
import { useT, type TranslationKey } from '@/i18n';
import { ToolButton, ToolbarDivider, type IconType } from '@/components/ui/ToolButton';
import { SettingsMenu } from '@/components/layout/SettingsMenu';
import {
  AngleIcon, CursorIcon, DiameterIcon, FitIcon, FolderOpenIcon,
  PaletteIcon, PanelLeftIcon, RulerIcon, TrashIcon, WandIcon,
} from '@/components/ui/icons';

const MEASURE_TOOLS: { id: ToolId; labelKey: TranslationKey; tipKey: TranslationKey; icon: IconType }[] = [
  { id: 'select', labelKey: 'toolbar.select', tipKey: 'tip.select', icon: CursorIcon },
  { id: 'measure-auto', labelKey: 'toolbar.auto', tipKey: 'tip.auto', icon: WandIcon },
  { id: 'measure-distance', labelKey: 'toolbar.distance', tipKey: 'tip.distance', icon: RulerIcon },
  { id: 'measure-angle', labelKey: 'toolbar.angle', tipKey: 'tip.angle', icon: AngleIcon },
  { id: 'measure-radius', labelKey: 'toolbar.diameter', tipKey: 'tip.diameter', icon: DiameterIcon },
];

function PresetPreview({ preset }: { preset: MaterialPresetId }) {
  const styles: Record<MaterialPresetId, string> = {
    original: 'bg-[conic-gradient(#f87171,#fbbf24,#4ade80,#38bdf8,#a78bfa,#f87171)]',
    matte: 'bg-neutral-400',
    shiny: 'bg-[radial-gradient(circle_at_30%_25%,#ffffff_0%,#93a1b0_45%,#5b6672_100%)]',
    metal: 'bg-[linear-gradient(135deg,#f4f6f8_0%,#9aa4ae_45%,#dfe4e8_60%,#767f88_100%)]',
    glass: 'border border-sky-200 bg-sky-100/50',
  };
  return <span className={`size-7 rounded-full shadow-inner ${styles[preset]}`} />;
}

function MaterialMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const model = useViewer((s) => s.model);
  const selectedId = useViewer((s) => s.selectedId);
  const overrides = useViewer((s) => s.overrides);
  const globalMaterial = useViewer((s) => s.globalMaterial);
  const applyMaterial = useViewer((s) => s.applyMaterial);
  const resetMaterials = useViewer((s) => s.resetMaterials);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const selectedNode = selectedId && model ? model.nodeIndex[selectedId] : null;
  const current = (selectedId && overrides[selectedId]) || (selectedNode ? null : globalMaterial);

  return (
    <div ref={containerRef} className="relative">
      <ToolButton
        icon={PaletteIcon}
        label={t('toolbar.material')}
        title={t('tip.material')}
        active={open}
        disabled={!model}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-[19rem] -translate-x-1/2 rounded-2xl border border-line bg-panel p-3 shadow-xl">
          <p className="mb-2 text-[11px] text-ink-faint">
            {t('mat.appliesTo')}{' '}
            <span className="font-medium text-ink-soft">
              {selectedNode ? `„${selectedNode.name}“` : t('mat.entireModel')}
            </span>
          </p>

          <div className="mb-3 grid grid-cols-5 gap-1">
            {PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyMaterial({ preset })}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 pt-2 transition-colors hover:bg-hover
                  ${current?.preset === preset ? 'bg-accent-soft hover:bg-accent-soft' : ''}`}
              >
                <PresetPreview preset={preset} />
                <span className="text-center text-[9.5px] leading-tight text-ink-soft">
                  {t(`mat.${preset}` as TranslationKey)}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              title={t('mat.cadColors')}
              onClick={() => applyMaterial({ color: undefined })}
              className={`relative size-6 overflow-hidden rounded-full border border-line bg-panel
                ${!current?.color ? 'ring-2 ring-accent ring-offset-1' : ''}`}
            >
              <span className="absolute left-1/2 top-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-red-400" />
            </button>
            {SWATCH_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => applyMaterial({ color })}
                style={{ backgroundColor: color }}
                className={`size-6 rounded-full border border-black/10 transition-transform hover:scale-110
                  ${current?.color === color ? 'ring-2 ring-accent ring-offset-1' : ''}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => { resetMaterials(); setOpen(false); }}
            className="w-full rounded-lg border border-line py-1.5 text-[12px] text-ink-soft transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
          >
            {t('mat.reset')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const t = useT();
  const model = useViewer((s) => s.model);
  const tool = useViewer((s) => s.tool);
  const setTool = useViewer((s) => s.setTool);
  const sidebarOpen = useViewer((s) => s.sidebarOpen);
  const toggleSidebar = useViewer((s) => s.toggleSidebar);
  const requestFit = useViewer((s) => s.requestFit);
  const measurements = useViewer((s) => s.measurements);
  const clearMeasurements = useViewer((s) => s.clearMeasurements);

  return (
    <header className="z-40 flex h-[60px] shrink-0 items-center gap-0.5 border-b border-line bg-panel/90 px-2 backdrop-blur">
      <div className="mr-1 flex items-center gap-2 pl-1">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-invert text-[11px] font-semibold tracking-tight text-invert-ink">
          MB
        </div>
        <span className="hidden text-[13px] font-medium text-ink md:block">MB Viewer</span>
      </div>

      <ToolbarDivider />
      <SettingsMenu />
      <ToolButton
        icon={PanelLeftIcon}
        label={t('toolbar.tree')}
        title={t('tip.tree')}
        active={sidebarOpen}
        onClick={toggleSidebar}
      />
      <ToolButton icon={FolderOpenIcon} label={t('toolbar.open')} title={t('tip.open')} onClick={pickModelFile} />

      <ToolbarDivider />
      {MEASURE_TOOLS.map(({ id, labelKey, tipKey, icon }) => (
        <ToolButton
          key={id}
          icon={icon}
          label={t(labelKey)}
          title={t(tipKey)}
          active={tool === id}
          disabled={!model && id !== 'select'}
          onClick={() => setTool(tool === id && id !== 'select' ? 'select' : id)}
        />
      ))}

      <ToolbarDivider />
      <MaterialMenu />

      <ToolbarDivider />
      <ToolButton icon={FitIcon} label={t('toolbar.fit')} title={t('tip.fit')} disabled={!model} onClick={requestFit} />

      <div className="flex-1" />
      {measurements.length > 0 && (
        <button
          type="button"
          onClick={clearMeasurements}
          title={t('tip.clear')}
          className="mr-1 flex items-center gap-1.5 rounded-full border border-line py-1 pl-2.5 pr-3 text-[11px] text-ink-soft transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
        >
          <TrashIcon className="text-[14px]" />
          {t('chip.measurements', { n: measurements.length })}
        </button>
      )}
    </header>
  );
}
