import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useViewer } from '@/store/viewerStore';
import { useSettings } from '@/store/settingsStore';
import { useT } from '@/i18n';
import { openModelFile, pickModelFile } from '@/core/loaders/openModelFile';
import { createSampleModel } from '@/core/sample';
import { Toolbar } from '@/components/layout/Toolbar';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { Viewport } from '@/components/viewport/Viewport';
import { CubeIcon, XIcon } from '@/components/ui/icons';

function EmptyState() {
  const t = useT();
  const setModel = useViewer((s) => s.setModel);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center rounded-3xl border border-line bg-panel/90 p-8 text-center shadow-sm backdrop-blur">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-hover text-[28px] text-ink-faint">
          <CubeIcon />
        </div>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">{t('empty.title')}</h2>
        <p className="mb-5 text-[12.5px] leading-relaxed text-ink-faint">
          {t('empty.sub')}
          <br />
          STEP · IGES · BREP · STL · OBJ · GLB
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pickModelFile}
            className="rounded-full bg-invert px-4 py-2 text-[13px] font-medium text-invert-ink transition-opacity hover:opacity-85"
          >
            {t('empty.open')}
          </button>
          <button
            type="button"
            onClick={() => setModel(createSampleModel())}
            className="rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-hover"
          >
            {t('empty.sample')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingOverlay({ fileName }: { fileName?: string }) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-app/60 backdrop-blur-sm">
      <div className="flex flex-col items-center rounded-2xl border border-line bg-panel px-8 py-6 shadow-lg">
        <div className="mb-3 size-7 animate-spin rounded-full border-[3px] border-line border-t-accent" />
        <p className="text-[13px] font-medium text-ink">
          {t('load.parsing', { name: fileName ?? '…' })}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-faint">{t('load.engine')}</p>
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  const t = useT();
  const dismissError = useViewer((s) => s.dismissError);
  return (
    <div className="absolute left-1/2 top-3 z-30 flex max-w-[min(90%,540px)] -translate-x-1/2 items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-500 shadow-sm backdrop-blur">
      <span className="min-w-0 break-words">{message}</span>
      <button
        type="button"
        aria-label={t('err.dismiss')}
        onClick={dismissError}
        className="mt-0.5 shrink-0 text-red-400 hover:text-red-600"
      >
        <XIcon className="text-[13px]" />
      </button>
    </div>
  );
}

export default function App() {
  const t = useT();
  const model = useViewer((s) => s.model);
  const load = useViewer((s) => s.load);
  const sidebarOpen = useViewer((s) => s.sidebarOpen);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Reflect the skin and language on the document element (CSS custom
  // properties and native form controls pick them up from there).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'white' ? 'light' : 'dark';
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Esc walks back: pending points -> active tool -> selection.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const store = useViewer.getState();
      if (store.pendingPoints.length > 0 || store.pendingEntity) store.cancelPending();
      else if (store.tool !== 'select') store.setTool('select');
      else store.setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void openModelFile(file);
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-app text-ink"
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Toolbar />

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}

        <main
          className="relative min-w-0 flex-1"
          onContextMenu={(event) => {
            const store = useViewer.getState();
            if (store.pendingPoints.length > 0 || store.pendingEntity) {
              event.preventDefault();
              store.cancelPending();
            }
          }}
        >
          <Viewport />
          {!model && load.state === 'idle' && <EmptyState />}
          {load.state === 'loading' && <LoadingOverlay fileName={load.fileName} />}
          {load.state === 'error' && load.error && <ErrorBanner message={load.error} />}
        </main>
      </div>

      <StatusBar />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-accent-soft/60 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-panel/90 px-10 py-6 text-[14px] font-medium text-accent shadow-xl">
            {t('drop.hint')}
          </div>
        </div>
      )}
    </div>
  );
}
