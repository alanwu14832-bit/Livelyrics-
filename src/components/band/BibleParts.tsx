"use client";

// Small read-only pieces of a band's visual bible, shared by the band page, the bible editor and
// the setlist: the palette as apple.com colour dots, a font specimen, scene / treatment tags.

import { Tag, cx } from "@/components/ui";
import { FONTS, fontStack } from "@/lib/font-meta";
import { MEDIA_TREATMENT_LABELS, SCENE_LABELS } from "@/lib/console/labels";
import type { BandBible, BandPaletteColor, FontId, MediaTreatment, SceneId } from "@/lib/types";

/** apple.com colour-picker dots: 44 px circles, name (12 / 600) and role (12, label-2) below. */
export function PaletteDots({ palette, size = 44, className }: { palette: readonly BandPaletteColor[]; size?: number; className?: string }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-3", className)} aria-label="色盤">
      {palette.map((c) => (
        <li key={c.hex} className="flex w-[64px] min-w-0 flex-col items-center text-center" title={`${c.name}（${c.role}）${c.hex}`}>
          <span aria-hidden="true" className="block rounded-full shadow-[inset_0_0_0_1px_var(--separator)]" style={{ width: size, height: size, background: c.hex }} />
          <span className="mt-1.5 w-full truncate text-[12px] leading-4 font-semibold text-label">{c.name}</span>
          <span className="w-full truncate text-[12px] leading-4 text-label-2">{c.role}</span>
        </li>
      ))}
    </ul>
  );
}

/** A thin strip of the palette (cards, rows). */
export function PaletteStrip({ colors, className }: { colors: readonly string[]; className?: string }) {
  if (!colors.length) return null;
  return (
    <span aria-hidden="true" className={cx("flex h-1.5 overflow-hidden rounded-full", className)}>
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

export function FontSpecimen({ cjkFont, latinFont, weight, sample = "舞台上的每一句歌詞", latinSample = "Live Tonight", className }: { cjkFont: FontId; latinFont: FontId; weight: number; sample?: string; latinSample?: string; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <p className="truncate text-[28px] leading-9 text-label" style={{ fontFamily: fontStack(cjkFont, latinFont), fontWeight: weight }}>
        {sample}
      </p>
      <p className="truncate text-[22px] leading-7 text-label-2" style={{ fontFamily: `var(${FONTS[latinFont]?.cssVar ?? "--font-space-grotesk"})`, fontWeight: weight }}>
        {latinSample}
      </p>
      <p className="mt-1 text-[12px] leading-4 text-label-2">
        {FONTS[cjkFont]?.label}＋{FONTS[latinFont]?.label}，字重 {weight}
      </p>
    </div>
  );
}

export function SceneTags({ scenes, tone = "neutral", empty }: { scenes: readonly SceneId[]; tone?: "neutral" | "tint" | "red"; empty?: string }) {
  if (!scenes.length) return empty ? <span className="text-[13px] leading-5 text-label-2">{empty}</span> : null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {scenes.map((s) => (
        <Tag key={s} tone={tone}>
          {SCENE_LABELS[s]}
        </Tag>
      ))}
    </span>
  );
}

export function TreatmentTags({ treatments, empty }: { treatments: readonly MediaTreatment[]; empty?: string }) {
  if (!treatments.length) return empty ? <span className="text-[13px] leading-5 text-label-2">{empty}</span> : null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {treatments.map((t) => (
        <Tag key={t}>{MEDIA_TREATMENT_LABELS[t]}</Tag>
      ))}
    </span>
  );
}

/** Where the bible came from, for a footnote. */
export function bibleSourceLabel(bible: BandBible): string | null {
  const s = bible.source;
  if (!s) return null;
  const when = new Date(s.updatedAt);
  const date = Number.isFinite(when.getTime()) ? `${when.getMonth() + 1} 月 ${when.getDate()} 日` : "";
  const who = s.engine === "claude" ? `Claude${s.model ? `（${s.model}）` : ""}整理` : s.engine === "offline" ? "離線設計師整理" : "手動編輯";
  return date ? `${who}，${date}` : who;
}
