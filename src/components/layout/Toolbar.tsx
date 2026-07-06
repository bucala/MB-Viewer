import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { useViewer } from '@/store/viewerStore';
import { pickModelFile } from '@/core/loaders/openModelFile';
import { createSampleModel } from '@/core/sample';
import { PRESET_LABELS, PRESET_ORDER, SWATCH_COLORS } from '@/core/materials/presets';
import type { MaterialPresetId, ToolId } from '@/core/types';
import {
  AngleIcon, CubeIcon, CursorIcon, DiameterIcon, FitIcon, FolderOpenIcon,
  GridIcon, PaletteIcon, PanelLeftIcon, RulerIcon, TrashIcon,
} from '@/components/ui/icons';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

function ToolButton({
  icon: Icon, label, active, disabled, onClick, title,
}: {
  icon: IconType;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-[52px] flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors
        ${active ? 'bg-blue-50 text-blue-600' : 'text-neutral-600 hover:bg-neutral-100'}
        ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent' : ''}`}
    >
      <Icon className="text-[19px]" />
      <span className="leading-none">{label}</span>
    </button>
  );
}

const Divider = () => <div className="mx-1.5 h-7 w-px shrink-0 bg-neutral-200" />;

const MEASURE_TOOLS: { id: ToolId; label: string; icon: IconType; title: string }[] = [
  { id: 'select', label: 'Select', icon: CursorIcon, title: 'Select parts (Esc)' },
  { id: 'measure-distance', label: 'Distance', icon: RulerIcon, title: 'Measure a distance between two points' },
  { id: 'measure-angle', label: 'Angle', icon: AngleIcon, title: 'Measure an angle from three points' },
  { id: 'measure-radius', label: 'Diameter', icon: DiameterIcon, title: 'Measure a diameter from three points on a circle' },
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
        label="Material"
        active={open}
        disabled={!model}
        onClick={() => setOpen((value) => !value)}
        title="Materials & colors"
      />
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-[19rem] -translate-x-1/2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-[11px] text-neutral-400">
            Applies to{' '}
            <span className="font-medium text-neutral-600">
              {selectedNode ? `“${selectedNode.name}”` : 'the entire model'}
            </span>
          </p>

          <div className="mb-3 grid grid-cols-5 gap-1">
            {PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyMaterial({ preset })}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 pt-2 transition-colors hover:bg-neutral-100
                  ${current?.preset === preset ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
              >
                <PresetPreview preset={preset} />
                <span className="text-center text-[9.5px] leading-tight text-neutral-600">
                  {PRESET_LABELS[preset]}
                </span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              title="Use colors from the CAD file"
              onClick={() => applyMaterial({ color: undefined })}
              className={`relative size-6 overflow-hidden rounded-full border border-neutral-300 bg-white
                ${!current?.color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
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
                  ${current?.color === color ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => { resetMaterials(); setOpen(false); }}
            className="w-full rounded-lg border border-neutral-200 py-1.5 text-[12px] text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            Reset all materials
          </button>
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const model = useViewer((s) => s.model);
  const tool = useViewer((s) => s.tool);
  const setTool = useViewer((s) => s.setTool);
  const gridVisible = useViewer((s) => s.gridVisible);
  const toggleGrid = useViewer((s) => s.toggleGrid);
  const sidebarOpen = useViewer((s) => s.sidebarOpen);
  const toggleSidebar = useViewer((s) => s.toggleSidebar);
  const requestFit = useViewer((s) => s.requestFit);
  const setModel = useViewer((s) => s.setModel);
  const measurements = useViewer((s) => s.measurements);
  const clearMeasurements = useViewer((s) => s.clearMeasurements);

  return (
    <header className="z-40 flex h-[60px] shrink-0 items-center gap-0.5 border-b border-neutral-200 bg-white/90 px-2 backdrop-blur">
      <div className="mr-1 flex items-center gap-2 pl-1">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-900 text-[11px] font-semibold tracking-tight text-white">
          MB
        </div>
        <span className="hidden text-[13px] font-medium text-neutral-800 md:block">MB Viewer</span>
      </div>

      <Divider />
      <ToolButton icon={PanelLeftIcon} label="Tree" active={sidebarOpen} onClick={toggleSidebar} title="Toggle the project tree" />
      <ToolButton icon={FolderOpenIcon} label="Open" onClick={pickModelFile} title="Open a CAD file (STEP, IGES, BREP, STL, OBJ, GLB)" />
      <ToolButton icon={CubeIcon} label="Sample" onClick={() => setModel(createSampleModel())} title="Load the built-in sample assembly" />

      <Divider />
      {MEASURE_TOOLS.map(({ id, label, icon, title }) => (
        <ToolButton
          key={id}
          icon={icon}
          label={label}
          title={title}
          active={tool === id}
          disabled={!model && id !== 'select'}
          onClick={() => setTool(tool === id && id !== 'select' ? 'select' : id)}
        />
      ))}

      <Divider />
      <MaterialMenu />

      <Divider />
      <ToolButton icon={FitIcon} label="Fit" disabled={!model} onClick={requestFit} title="Fit the model in view" />
      <ToolButton icon={GridIcon} label="Grid" active={gridVisible} onClick={toggleGrid} title="Toggle the ground grid" />

      <div className="flex-1" />
      {measurements.length > 0 && (
        <button
          type="button"
          onClick={clearMeasurements}
          title="Clear all measurements"
          className="mr-1 flex items-center gap-1.5 rounded-full border border-neutral-200 py-1 pl-2.5 pr-3 text-[11px] text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="text-[14px]" />
          {measurements.length} measurement{measurements.length > 1 ? 's' : ''}
        </button>
      )}
    </header>
  );
}
