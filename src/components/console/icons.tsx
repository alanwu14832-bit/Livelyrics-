// Minimal inline icon set for the console (no icon dependency). 16px grid, currentColor.

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="2.6" height="10" rx="0.6" fill="currentColor" stroke="none" />
    <rect x="9.4" y="3" width="2.6" height="10" rx="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPrevLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3v10" />
    <path d="M12.5 3.5 6.5 8l6 4.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconNextLine = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v10" />
    <path d="M3.5 3.5 9.5 8l-6 4.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3 5 8l5 5" />
  </Svg>
);

export const IconMonitor = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" />
    <path d="M5.5 14h5M8 11v3" />
  </Svg>
);

export const IconSparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 2.5 7.6 5.9 11 7 7.6 8.1 6.5 11.5 5.4 8.1 2 7l3.4-1.1z" />
    <path d="M12 10.5l.55 1.45L14 12.5l-1.45.55L12 14.5l-.55-1.45L10 12.5l1.45-.55z" />
  </Svg>
);

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3v.3" />
    <circle cx="8" cy="11.6" r="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2" />
    <path d="M3.5 7.6a4.5 4.5 0 0 0 9 0M8 12.1v2.2" />
  </Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 2.6 13.4 5.4 5.6 13.2H2.8v-2.8z" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
  </Svg>
);

export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" fill="currentColor" stroke="none" />
    <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" />
  </Svg>
);

export const IconMute = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" fill="currentColor" stroke="none" />
    <path d="M11 6l3.5 4M14.5 6 11 10" />
  </Svg>
);

export const IconWarning = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.2 14.3 13H1.7z" />
    <path d="M8 6.4v3" />
    <circle cx="8" cy="11.2" r="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5 6.4 12 13 4.5" />
  </Svg>
);

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5" />
  </Svg>
);
