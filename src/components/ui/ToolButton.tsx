import type { ComponentType, SVGProps } from 'react';

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export function ToolButton({
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
      className={`flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 text-[10px] font-medium transition-colors
        ${active ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-hover'}
        ${disabled ? 'cursor-not-allowed opacity-35 hover:bg-transparent' : ''}`}
    >
      <Icon className="text-[19px]" />
      <span className="leading-none">{label}</span>
    </button>
  );
}

export const ToolbarDivider = () => <div className="mx-1.5 h-7 w-px shrink-0 bg-line" />;
