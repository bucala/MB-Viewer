import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const FolderOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19h13.4a2 2 0 0 0 1.94-1.5l1.4-5.5A1 1 0 0 0 19.77 11H7.2a2 2 0 0 0-1.94 1.5L4 17.5V6a2 2 0 0 1 2-2h3.6l2 2h6.4a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const CubeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 8.2 12 3.5 3 8.2v7.6l9 4.7 9-4.7Z" />
    <path d="M3 8.2l9 4.7 9-4.7M12 12.9v7.6" />
  </Svg>
);

export const CursorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4l6.5 15 2.2-6.3L20 10.5Z" />
  </Svg>
);

export const RulerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.7 15.3 15.3 2.7l6 6L8.7 21.3Z" />
    <path d="M7.2 13.8l1.7 1.7M10.2 10.8l1.7 1.7M13.2 7.8l1.7 1.7" />
  </Svg>
);

export const AngleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16M4 20 15.5 5.5" />
    <path d="M12 20a8.5 8.5 0 0 0-2.8-6.3" />
  </Svg>
);

export const DiameterIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M6.8 17.2 17.2 6.8" />
  </Svg>
);

export const PaletteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3.2-3.2 3.2h-1.6a2.1 2.1 0 0 0-1.5 3.6c.5.5.3 2.2-2.7 2.2Z" />
    <circle cx="7.8" cy="11" r="0.6" fill="currentColor" />
    <circle cx="11" cy="7.5" r="0.6" fill="currentColor" />
    <circle cx="15.5" cy="8.5" r="0.6" fill="currentColor" />
  </Svg>
);

export const FitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </Svg>
);

export const PanelLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 4v16" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.8 3.5M6.2 6.7A16.9 16.9 0 0 0 2.5 12S6 18.5 12 18.5a8.9 8.9 0 0 0 3.5-.7" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20.5 20.5 16 16" />
  </Svg>
);

export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12" />
  </Svg>
);
