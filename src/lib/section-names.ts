// Round 24 (m6): the section names an operator reads — one Traditional Chinese vocabulary for the
// console, the timeline, the design tab and the designers. A label with no Chinese in it (a raw
// 「Verse 1」, 「chorus」, an id) is replaced by the kind's name and its ordinal (「主歌二」).

import type { SectionKind } from "./types";

export const SECTION_NAMES: Record<SectionKind, string> = {
  intro: "前奏",
  verse: "主歌",
  "pre-chorus": "導歌",
  chorus: "副歌",
  bridge: "橋段",
  solo: "獨奏",
  breakdown: "抽離段",
  outro: "尾奏",
  interlude: "間奏",
};

const NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const CJK = /\p{Script=Han}/u;

/** 「主歌二」: the kind's name, numbered when the song has more than one of the kind. */
export function kindLabel(kind: SectionKind, ordinal: number, total: number): string {
  const base = SECTION_NAMES[kind] ?? "段落";
  return total > 1 ? `${base}${NUMS[ordinal] ?? String(ordinal + 1)}` : base;
}

/** True when a label reads as Chinese to the operator (not empty, not a raw English name or id). */
export function isReadableLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && CJK.test(label);
}

/** The sections with every unreadable label replaced (same objects when nothing changes). */
export function readableLabels<T extends { kind: SectionKind; label: string }>(sections: readonly T[]): T[] {
  const total = new Map<SectionKind, number>();
  for (const s of sections) total.set(s.kind, (total.get(s.kind) ?? 0) + 1);
  const seen = new Map<SectionKind, number>();
  return sections.map((s) => {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    return isReadableLabel(s.label) ? s : { ...s, label: kindLabel(s.kind, n, total.get(s.kind) ?? 1) };
  });
}
