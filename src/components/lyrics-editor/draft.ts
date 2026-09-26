// Unsaved lyric edits are mirrored to localStorage so a crash, a closed tab or a stray
// back-navigation does not lose a tap-sync session.

import type { LyricWord, LyricsSource } from "@/lib/types";
import { newLineKey, type EditorLine } from "./editor-model";

export interface LyricsDraft {
  v: 1;
  /** epoch ms */
  savedAt: number;
  /** project.updatedAt the draft was based on */
  baseUpdatedAt: string;
  source: LyricsSource;
  lines: Array<Omit<EditorLine, "key">>;
}

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function draftKey(projectId: string): string {
  return `livelyrics:lyrics-draft:${projectId}`;
}

function local(): MinimalStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const SOURCES: readonly LyricsSource[] = ["lrclib-synced", "lrclib-plain", "user", "embedded", "none"];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function words(v: unknown): LyricWord[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: LyricWord[] = [];
  for (const w of v) {
    if (!w || typeof w !== "object") return undefined;
    const r = w as Record<string, unknown>;
    const start = num(r.start);
    const end = num(r.end);
    if (typeof r.text !== "string" || start == null || end == null) return undefined;
    out.push({ text: r.text, start, end });
  }
  return out;
}

/** Validate an untrusted parsed draft. */
export function parseDraft(raw: unknown): LyricsDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1 || !Array.isArray(d.lines) || typeof d.baseUpdatedAt !== "string") return null;
  const savedAt = num(d.savedAt);
  if (savedAt == null) return null;
  const lines: LyricsDraft["lines"] = [];
  for (const item of d.lines.slice(0, 5000)) {
    if (!item || typeof item !== "object") continue;
    const l = item as Record<string, unknown>;
    if (typeof l.text !== "string") continue;
    const start = num(l.start);
    const line: Omit<EditorLine, "key"> = {
      text: l.text,
      translation: typeof l.translation === "string" ? l.translation : "",
      start,
      end: start != null ? num(l.end) : null,
    };
    const w = start != null ? words(l.words) : undefined;
    if (w) line.words = w;
    lines.push(line);
  }
  const source = SOURCES.includes(d.source as LyricsSource) ? (d.source as LyricsSource) : "user";
  return { v: 1, savedAt, baseUpdatedAt: d.baseUpdatedAt, source, lines };
}

export function loadDraft(projectId: string, storage: MinimalStorage | null = local()): LyricsDraft | null {
  if (!storage) return null;
  try {
    const text = storage.getItem(draftKey(projectId));
    return text ? parseDraft(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveDraft(
  projectId: string,
  data: { lines: readonly EditorLine[]; source: LyricsSource; baseUpdatedAt: string; savedAt: number },
  storage: MinimalStorage | null = local(),
): boolean {
  if (!storage) return false;
  const draft: LyricsDraft = {
    v: 1,
    savedAt: data.savedAt,
    baseUpdatedAt: data.baseUpdatedAt,
    source: data.source,
    lines: data.lines.map((l) => {
      const out: Omit<EditorLine, "key"> = { text: l.text, translation: l.translation, start: l.start, end: l.end };
      if (l.words) out.words = l.words;
      return out;
    }),
  };
  try {
    storage.setItem(draftKey(projectId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(projectId: string, storage: MinimalStorage | null = local()): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(projectId));
  } catch {
    /* ignore */
  }
}

export function draftToLines(draft: LyricsDraft): EditorLine[] {
  return draft.lines.map((l) => ({ ...l, key: newLineKey() }));
}
