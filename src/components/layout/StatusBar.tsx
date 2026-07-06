import { useViewer } from '@/store/viewerStore';

export function StatusBar() {
  const model = useViewer((s) => s.model);
  const notice = useViewer((s) => s.notice);
  const measurements = useViewer((s) => s.measurements);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-200 bg-white/85 px-3 text-[11px] text-neutral-500 backdrop-blur">
      <span className="truncate">
        {notice ?? (model ? model.name : 'Ready — open a CAD file to begin')}
      </span>
      {model && (
        <span className="hidden shrink-0 sm:block">
          {model.partCount.toLocaleString()} parts · {model.triangleCount.toLocaleString()} triangles
          {measurements.length > 0 && <> · {measurements.length} measurement{measurements.length > 1 ? 's' : ''}</>}
          {' '}· mm
        </span>
      )}
    </footer>
  );
}
