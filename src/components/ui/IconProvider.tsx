"use client";

// IconProvider (UI-AUDIT §3.3 Icon): defaults for any direct @phosphor-icons/react import in the
// client tree (16 px, bold, currentColor). The kit's own icons (./Icon) set size and weight
// explicitly and work without it. Wrap the app once, in src/app/layout.tsx:
//   <body><IconProvider>{children}</IconProvider></body>

import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import type { ReactNode } from "react";

const DEFAULTS = { size: 16, weight: "bold", color: "currentColor", mirrored: false } as const;

export function IconProvider({ children }: { children: ReactNode }) {
  return <IconContext.Provider value={DEFAULTS}>{children}</IconContext.Provider>;
}
