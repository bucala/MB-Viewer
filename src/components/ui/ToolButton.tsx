import type { ComponentType, SVGProps } from 'react';

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export function ToolButton({
  icon: Icon, label, active, disabled, onClick, title, expanded,
}: {
  icon: IconType;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  /** Set for buttons that open a popover: exposes aria-expanded/haspopup. */
  expanded?: boolean;
}) {
  return (
    // On phones the toolbar is icon-only (labels hidden, aria-label kept),
    // so it fits in one or two rows instead of three.
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      aria-pressed={expanded === undefined && active !== undefined ? active : undefined}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[10px] font-medium transition-colors max-sm:min-w-[38px] max-sm:px-1
        ${active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-hover'}
        ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent' : ''}`}
    >
      <Icon className="text-[19px]" />
      <span className="leading-none max-sm:hidden">{label}</span>
    </button>
  );
}

export const ToolbarDivider = () => <div className="mx-1.5 h-7 w-px shrink-0 bg-line max-sm:mx-0.5" />;
