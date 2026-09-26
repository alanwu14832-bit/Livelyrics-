"use client";

// ProjectArt: a song's own artwork, drawn from its key-visual palette (UI-AUDIT §3.5 作品庫,
// UI-15). palette[0] is the base, palette[1] a 45 % radial light, palette[2] a small arc and
// palette[3] a faint second light; the project id seeds where the light and the arc sit, so two
// songs with similar colours still read as different covers. A project that has no design yet
// gets the neutral placeholder tile with a music note (Apple Music's missing-artwork look).
//
//   <ProjectArt id={p.id} palette={p.palette} className="aspect-[16/10] rounded-xl" />
//   <ProjectArt id={id} palette={palette} className="size-8 rounded-[7px]" />   header thumbnail
//
// The SVG uses preserveAspectRatio="xMidYMid slice", so any box shape crops the same picture.
// The motif SVG is not in ProjectSummary (src/lib/types.ts); the palette carries the look.

import { useId } from "react";
import { cx } from "@/components/ui";
import { MusicNotesIcon } from "@/components/ui/Icon";

const HEX = /^#[0-9a-f]{6}$/i;

/** Stable 32-bit hash of the project id (FNV-1a). */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function validPalette(palette: readonly (string | null | undefined)[] | undefined): string[] {
  return (palette ?? []).filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 4);
}

export function ProjectArt({
  id,
  palette,
  className,
  placeholderIconSize = 44,
  title,
}: {
  id: string;
  palette?: readonly (string | null | undefined)[];
  className?: string;
  /** music-note size on the placeholder tile (0 hides it) */
  placeholderIconSize?: number;
  /** accessible name; decorative when omitted */
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const colors = validPalette(palette);
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };

  if (colors.length === 0) {
    return (
      <div {...a11y} className={cx("relative flex items-center justify-center overflow-hidden bg-fill-3", className)}>
        {placeholderIconSize > 0 && <MusicNotesIcon size={placeholderIconSize} className="text-label-3" />}
      </div>
    );
  }

  const [base, light = base, arc = light, second = arc] = colors;
  const h = hash(id);
  // light centre in the upper band, arc towards the opposite lower corner
  const lx = 18 + (h % 64); // 18..81 (% of width)
  const ly = 8 + ((h >>> 6) % 30); // 8..37
  const flip = lx > 50 ? -1 : 1;
  const ax = 80 + flip * (22 + ((h >>> 11) % 30)); // arc centre x in a 160 x 100 box
  const ay = 96 + ((h >>> 16) % 22);
  const ar = 26 + ((h >>> 20) % 18);
  const start = (200 + ((h >>> 24) % 70)) * (Math.PI / 180);
  const sweep = (70 + ((h >>> 27) % 40)) * (Math.PI / 180);
  const p1 = [ax + ar * Math.cos(start), ay + ar * Math.sin(start)];
  const p2 = [ax + ar * Math.cos(start + sweep), ay + ar * Math.sin(start + sweep)];
  const f = (n: number) => n.toFixed(2);
  const g1 = `${uid}-l`;
  const g2 = `${uid}-s`;
  const g3 = `${uid}-v`;

  return (
    <div {...a11y} className={cx("relative overflow-hidden", className)} style={{ background: base }}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={g1} cx={`${lx}%`} cy={`${ly}%`} r="75%">
            <stop offset="0" stopColor={light} stopOpacity="0.45" />
            <stop offset="0.55" stopColor={light} stopOpacity="0.12" />
            <stop offset="1" stopColor={light} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={g2} cx={`${100 - lx}%`} cy="100%" r="60%">
            <stop offset="0" stopColor={second} stopOpacity="0.22" />
            <stop offset="1" stopColor={second} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={g3} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.5" stopColor="black" stopOpacity="0" />
            <stop offset="1" stopColor="black" stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <rect width="160" height="100" fill={`url(#${g2})`} />
        <rect width="160" height="100" fill={`url(#${g1})`} />
        <path
          d={`M${f(p1[0])} ${f(p1[1])} A${ar} ${ar} 0 0 1 ${f(p2[0])} ${f(p2[1])}`}
          fill="none"
          stroke={arc}
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.9"
        />
        <circle cx={f(p2[0])} cy={f(p2[1])} r="1.6" fill={arc} opacity="0.9" />
        <rect width="160" height="100" fill={`url(#${g3})`} />
      </svg>
    </div>
  );
}
