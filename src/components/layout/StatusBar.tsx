import { useViewer } from '@/store/viewerStore';
import { useNumberFormat, useT } from '@/i18n';

export function StatusBar() {
  const t = useT();
  const nf = useNumberFormat();
  const model = useViewer((s) => s.model);
  const notice = useViewer((s) => s.notice);
  const measurements = useViewer((s) => s.measurements);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-panel/85 px-3 text-[11px] text-ink-faint backdrop-blur">
      <span className="truncate">
        {notice ?? (model ? model.name : t('status.ready'))}
      </span>
      {model && (
        <span className="hidden shrink-0 sm:block">
          {t('status.parts')}: {nf.format(model.partCount)} · {t('status.triangles')}:{' '}
          {nf.format(model.triangleCount)}
          {measurements.length > 0 && <> · {t('chip.measurements', { n: measurements.length })}</>}
          {' '}· mm
        </span>
      )}
    </footer>
  );
}
