import { useEffect, useRef, useState } from 'react';
import { useViewer } from '@/store/viewerStore';
import {
  DEFAULT_SETTINGS, useSettings,
  type Lang, type ProjectionMode, type RenderQuality, type SettingsValues, type ThemeId,
} from '@/store/settingsStore';
import { tr, useT } from '@/i18n';
import { applyFileAssociations } from '@/core/desktop';
import { createSampleModel } from '@/core/sample';
import { ACCEPTED_EXTENSIONS } from '@/core/loaders/openModelFile';
import { ToolButton } from '@/components/ui/ToolButton';
import { CubeIcon, GridIcon, MenuIcon } from '@/components/ui/icons';

function snapshot(): SettingsValues {
  const { language, theme, projection, quality, transparency, fileAssociations } = useSettings.getState();
  return { language, theme, projection, quality, transparency, fileAssociations: { ...fileAssociations } };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </p>
  );
}

function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors
            ${value === option.id ? 'bg-panel text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const THEME_PREVIEW: Record<ThemeId, string> = {
  white: '#ffffff',
  gray: '#3d424a',
  black: '#151719',
};

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SettingsValues>(snapshot);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const setModel = useViewer((s) => s.setModel);
  const gridVisible = useViewer((s) => s.gridVisible);
  const toggleGrid = useViewer((s) => s.toggleGrid);

  useEffect(() => {
    if (!open) return;
    setDraft(snapshot());
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const patch = (values: Partial<SettingsValues>) =>
    setDraft((current) => ({ ...current, ...values }));

  const apply = () => {
    const previousProjection = useSettings.getState().projection;
    useSettings.getState().apply(draft);
    if (draft.projection !== previousProjection) useViewer.getState().requestFit();
    // On the desktop shell the file associations register right away —
    // no reinstall needed.
    void applyFileAssociations(draft.fileAssociations)
      .then((applied) => {
        if (applied) useViewer.getState().setNotice(tr('set.assocApplied'));
      })
      .catch((error) => {
        useViewer.getState().setNotice(tr('set.assocFailed', { error: String(error) }));
      });
    setOpen(false);
  };

  const reset = () => {
    const previousProjection = useSettings.getState().projection;
    useSettings.getState().reset();
    setDraft({ ...DEFAULT_SETTINGS, fileAssociations: {} });
    if (previousProjection !== DEFAULT_SETTINGS.projection) useViewer.getState().requestFit();
  };

  return (
    <div ref={containerRef} className="relative">
      <ToolButton
        icon={MenuIcon}
        label={t('toolbar.menu')}
        title={t('tip.menu')}
        active={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[calc(100vh-108px)] w-[19.5rem] overflow-y-auto rounded-2xl border border-line bg-panel p-3 shadow-xl">
          {/* Quick actions (moved out of the toolbar) */}
          <SectionLabel>{t('set.quick')}</SectionLabel>
          <button
            type="button"
            onClick={() => { setModel(createSampleModel()); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-hover hover:text-ink"
          >
            <CubeIcon className="text-[16px]" />
            {t('set.sample')}
          </button>
          <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-hover hover:text-ink">
            <GridIcon className="text-[16px]" />
            <span className="flex-1">{t('set.grid')}</span>
            <input type="checkbox" checked={gridVisible} onChange={toggleGrid} />
          </label>

          <SectionLabel>{t('set.language')}</SectionLabel>
          <Segmented<Lang>
            value={draft.language}
            onChange={(language) => patch({ language })}
            options={[
              { id: 'sk', label: 'Slovenčina' },
              { id: 'en', label: 'English' },
            ]}
          />

          <SectionLabel>{t('set.skin')}</SectionLabel>
          <Segmented<ThemeId>
            value={draft.theme}
            onChange={(theme) => patch({ theme })}
            options={(['white', 'gray', 'black'] as ThemeId[]).map((id) => ({
              id,
              label: (
                <>
                  <span
                    className="size-3 rounded-full border border-line"
                    style={{ backgroundColor: THEME_PREVIEW[id] }}
                  />
                  {t(`set.skin.${id}`)}
                </>
              ),
            }))}
          />

          <SectionLabel>{t('set.projection')}</SectionLabel>
          <Segmented<ProjectionMode>
            value={draft.projection}
            onChange={(projection) => patch({ projection })}
            options={[
              { id: 'perspective', label: t('set.projection.perspective') },
              { id: 'parallel', label: t('set.projection.parallel') },
            ]}
          />

          <SectionLabel>{t('set.quality')}</SectionLabel>
          <Segmented<RenderQuality>
            value={draft.quality}
            onChange={(quality) => patch({ quality })}
            options={[
              { id: 'low', label: t('set.quality.low') },
              { id: 'medium', label: t('set.quality.medium') },
              { id: 'high', label: t('set.quality.high') },
            ]}
          />

          <SectionLabel>
            {t('set.transparency')}: {Math.round((1 - draft.transparency) * 100)} %
          </SectionLabel>
          <input
            type="range"
            min={10}
            max={90}
            value={Math.round((1 - draft.transparency) * 100)}
            onChange={(event) => patch({ transparency: 1 - Number(event.target.value) / 100 })}
            className="w-full"
          />

          <SectionLabel>{t('set.assoc')}</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            {ACCEPTED_EXTENSIONS.map((extension) => (
              <label
                key={extension}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={Boolean(draft.fileAssociations[extension])}
                  onChange={(event) =>
                    patch({
                      fileAssociations: {
                        ...draft.fileAssociations,
                        [extension]: event.target.checked,
                      },
                    })
                  }
                />
                .{extension}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-ink-faint">{t('set.assocNote')}</p>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={apply}
              className="flex-1 rounded-lg bg-invert py-1.5 text-[12.5px] font-medium text-invert-ink transition-opacity hover:opacity-85"
            >
              {t('set.apply')}
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-lg border border-line py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-hover"
            >
              {t('set.reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
