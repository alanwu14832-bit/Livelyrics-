"use client";

// ProjectArt: a song's own artwork, drawn from its key-visual palette (UI-AUDIT §3.5 作品庫,
// UI-15). palette[0] is the base, palette[1] a 45 % radial light, palette[2] the motif (a small
// arc, two nested arcs, or a horizon with a sun) with a faint glow, palette[3] a second light.
// The project id seeds the composition and where the light and the motif sit, so two songs with
// similar colours still read as different covers. A project that has no design yet
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
  // light centre in the upper band, the motif towards the opposite lower side
  const lx = 18 + (h % 64); // 18..81 (% of width)
  const ly = 8 + ((h >>> 6) % 30); // 8..37
  const flip = lx > 50 ? -1 : 1;
  const ax = 80 + flip * (18 + ((h >>> 11) % 34)); // motif centre x in a 160 x 100 box
  const ay = 92 + ((h >>> 16) % 26);
  const ar = 24 + ((h >>> 20) % 22);
  const start = (200 + ((h >>> 24) % 70)) * (Math.PI / 180);
  const sweep = (70 + ((h >>> 27) % 40)) * (Math.PI / 180);
  const at = (r: number, a: number) => [ax + r * Math.cos(a), ay + r * Math.sin(a)];
  const p1 = at(ar, start);
  const p2 = at(ar, start + sweep);
  // three quiet compositions, chosen by the id: one arc, two nested arcs, or a horizon with a sun
  const variant = (h >>> 4) % 3;
  const q1 = at(ar * 0.72, start + sweep * 0.12);
  const q2 = at(ar * 0.72, start + sweep * 0.88);
  const stroke = 2 + ((h >>> 9) % 3) * 0.5; // 2..3 in viewBox units
  const hy = 62 + ((h >>> 13) % 16); // horizon height
  const sx = 80 + flip * (14 + ((h >>> 18) % 30));
  const f = (n: number) => n.toFixed(2);
  const g1 = `${uid}-l`;
  const g2 = `${uid}-s`;
  const g3 = `${uid}-v`;
  const g4 = `${uid}-a`;

  return (
    <div {...a11y} className={cx("relative overflow-hidden", className)} style={{ background: base }}>
      <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={g1} cx={`${lx}%`} cy={`${ly}%`} r="75%">
            <stop offset="0" stopColor={light} stopOpacity="0.45" />
            <stop offset="0.55" stopColor={light} stopOpacity="0.14" />
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
          <radialGradient id={g4} cx={`${((variant === 2 ? sx : ax) / 160) * 100}%`} cy={`${((variant === 2 ? hy : ay) / 100) * 100}%`} r="45%">
            <stop offset="0" stopColor={arc} stopOpacity="0.2" />
            <stop offset="1" stopColor={arc} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="100" fill={`url(#${g2})`} />
        <rect width="160" height="100" fill={`url(#${g1})`} />
        {/* the motif colour glows faintly where it sits */}
        <rect width="160" height="100" fill={`url(#${g4})`} />
        {variant === 2 ? (
          <>
            <line x1="0" y1={hy} x2="160" y2={hy} stroke={arc} strokeWidth={stroke * 0.5} opacity="0.55" />
            <circle cx={f(sx)} cy={f(hy - 10 - ((h >>> 22) % 8))} r={4 + ((h >>> 25) % 4)} fill={arc} opacity="0.92" />
          </>
        ) : (
          <>
            <path
              d={`M${f(p1[0])} ${f(p1[1])} A${ar} ${ar} 0 0 1 ${f(p2[0])} ${f(p2[1])}`}
              fill="none"
              stroke={arc}
              strokeWidth={stroke}
              strokeLinecap="round"
              opacity="0.92"
            />
            {variant === 1 && (
              <path
                d={`M${f(q1[0])} ${f(q1[1])} A${ar * 0.72} ${ar * 0.72} 0 0 1 ${f(q2[0])} ${f(q2[1])}`}
                fill="none"
                stroke={second}
                strokeWidth={stroke * 0.6}
                strokeLinecap="round"
                opacity="0.5"
              />
            )}
            <circle cx={f(p2[0])} cy={f(p2[1])} r={stroke * 0.7} fill={arc} opacity="0.92" />
          </>
        )}
        <rect width="160" height="100" fill={`url(#${g3})`} />
      </svg>
    </div>
  );
}
