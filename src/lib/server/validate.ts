// Validation / sanitization of untrusted request payloads.

import { z } from "zod";
import { normalizeLyrics } from "@/lib/lyrics/lrc";
import type { ProcessRequest } from "@/lib/api-client";
import { DesignPlanSchema } from "@/lib/schema";
import type { AudioAnalysis, AudioSectionGuess, DesignPlan, Lyrics, SongMeta } from "@/lib/types";
import { HttpError } from "./http";

const MAX_TEXT = 300;
const MAX_DURATION = 24 * 3600;

function clean(s: string, max = MAX_TEXT): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function issuesText(error: z.ZodError, limit = 4): string {
  return error.issues
    .slice(0, limit)
    .map((i) => `${i.path.join(".") || "(root)"}：${i.message}`)
    .join("；");
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

const CreateMetaSchema = z.object({
  title: z.string().optional().nullable(),
  artist: z.string().optional().nullable(),
  album: z.string().optional().nullable(),
  year: z.number().optional().nullable(),
  duration: z.number().optional().nullable(),
});

function validYear(y: number | null | undefined): number | undefined {
  return typeof y === "number" && Number.isInteger(y) && y >= 1000 && y <= 9999 ? y : undefined;
}

function validDuration(d: number | null | undefined): number | undefined {
  return typeof d === "number" && Number.isFinite(d) && d > 0 && d <= MAX_DURATION ? Math.round(d * 1000) / 1000 : undefined;
}

/** The `meta` form field of POST /api/projects. */
export function parseCreateMeta(
  raw: string | undefined,
  file: { fileName: string; mimeType: string },
  analysis: AudioAnalysis | null,
): SongMeta {
  let value: unknown = {};
  if (raw && raw.trim()) {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "meta 不是有效的 JSON");
    }
  }
  const parsed = CreateMetaSchema.safeParse(value ?? {});
  if (!parsed.success) throw new HttpError(400, `meta 格式錯誤：${issuesText(parsed.error)}`);
  const m = parsed.data;
  const fallbackTitle = file.fileName.replace(/\.[^.]+$/, "");
  const meta: SongMeta = {
    title: clean(m.title ?? "") || clean(fallbackTitle) || "未命名歌曲",
    artist: clean(m.artist ?? ""),
    duration: validDuration(m.duration) ?? validDuration(analysis?.duration) ?? 0,
    fileName: file.fileName,
    mimeType: file.mimeType,
  };
  const album = clean(m.album ?? "");
  if (album) meta.album = album;
  const year = validYear(m.year);
  if (year) meta.year = year;
  return meta;
}

const MetaPatchSchema = z.object({
  title: z.string().max(1000).optional(),
  artist: z.string().max(1000).optional(),
  album: z.string().max(1000).nullable().optional(),
  year: z.number().int().min(1000).max(9999).nullable().optional(),
  duration: z.number().min(0).max(MAX_DURATION).optional(),
});

/** Apply a PATCH `meta` object. fileName / mimeType are server-owned and ignored. */
export function applyMetaPatch(current: SongMeta, raw: unknown): SongMeta {
  const parsed = MetaPatchSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `meta 格式錯誤：${issuesText(parsed.error)}`);
  const p = parsed.data;
  const next: SongMeta = { ...current };
  if (p.title !== undefined) {
    const title = clean(p.title);
    if (!title) throw new HttpError(400, "歌名不能是空的");
    next.title = title;
  }
  if (p.artist !== undefined) next.artist = clean(p.artist);
  if (p.album !== undefined) {
    const album = clean(p.album ?? "");
    if (album) next.album = album;
    else delete next.album;
  }
  if (p.year !== undefined) {
    if (p.year == null) delete next.year;
    else next.year = p.year;
  }
  if (p.duration !== undefined) next.duration = Math.round(p.duration * 1000) / 1000;
  return next;
}

// ---------------------------------------------------------------------------
// analysis (computed in the browser; accepted leniently, stored compactly)
// ---------------------------------------------------------------------------

const MAX_FRAMES = 200_000;

function numberArray(v: unknown, clamp01: boolean, max = MAX_FRAMES): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = new Array(Math.min(v.length, max));
  for (let i = 0; i < out.length; i++) {
    const x = typeof v[i] === "number" && Number.isFinite(v[i]) ? (v[i] as number) : 0;
    const y = clamp01 ? Math.min(1, Math.max(0, x)) : x;
    out[i] = Math.round(y * 10000) / 10000;
  }
  return out;
}

function finite(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * The `analysis` form field. Returns null for "null"/missing input or when the payload
 * has no usable duration; throws 400 only for malformed JSON.
 */
export function parseAnalysis(raw: string | undefined): AudioAnalysis | null {
  if (!raw || !raw.trim() || raw.trim() === "null") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "analysis 不是有效的 JSON");
  }
  return sanitizeAnalysis(value);
}

export function sanitizeAnalysis(value: unknown): AudioAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  const duration = finite(a.duration);
  if (!(duration > 0) || duration > MAX_DURATION) return null;
  const beats = numberArray(a.beats, false)
    .filter((t) => t >= 0 && t <= duration + 1)
    .sort((x, y) => x - y);
  const sections: AudioSectionGuess[] = Array.isArray(a.sections)
    ? (a.sections as unknown[])
        .slice(0, 500)
        .map((s) => {
          const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          return {
            start: Math.round(finite(o.start, -1) * 1000) / 1000,
            end: Math.round(finite(o.end, -1) * 1000) / 1000,
            energy: Math.min(1, Math.max(0, Math.round(finite(o.energy) * 10000) / 10000)),
          };
        })
        .filter((s) => s.start >= 0 && s.end > s.start)
        .sort((x, y) => x.start - y.start)
    : [];
  const envelopeRate = finite(a.envelopeRate);
  return {
    duration: Math.round(duration * 1000) / 1000,
    sampleRate: Math.max(0, Math.round(finite(a.sampleRate))),
    bpm: Math.min(400, Math.max(0, Math.round(finite(a.bpm) * 100) / 100)),
    bpmConfidence: Math.min(1, Math.max(0, finite(a.bpmConfidence))),
    beats,
    envelopeRate: envelopeRate > 0 && envelopeRate <= 1000 ? envelopeRate : 0,
    energy: numberArray(a.energy, true),
    onset: numberArray(a.onset, true),
    brightness: numberArray(a.brightness, true),
    bass: numberArray(a.bass, true),
    peaks: numberArray(a.peaks, true, 20_000),
    sections,
  };
}

// ---------------------------------------------------------------------------
// lyrics
// ---------------------------------------------------------------------------

const LyricWordInput = z.object({
  text: z.string().max(500),
  start: z.number(),
  end: z.number(),
});

const LyricLineInput = z.object({
  id: z.string().max(64).optional(),
  text: z.string().max(4000),
  translation: z.string().max(4000).nullable().optional(),
  start: z.number().nullable().optional(),
  end: z.number().nullable().optional(),
  words: z.array(LyricWordInput).max(1000).nullable().optional(),
});

const LyricsInput = z.object({
  source: z.enum(["lrclib-synced", "lrclib-plain", "user", "embedded", "none"]).optional(),
  synced: z.boolean().optional(),
  language: z.string().max(35).nullable().optional(),
  lines: z.array(LyricLineInput).max(5000),
});

/** Validate a PATCH `lyrics` object and normalize it (ids, sort, ends, synced). */
export function parseLyricsPatch(raw: unknown): Lyrics {
  const parsed = LyricsInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `歌詞格式錯誤：${issuesText(parsed.error)}`);
  const l = parsed.data;
  const lyrics: Lyrics = {
    source: l.source ?? "user",
    synced: false,
    lines: l.lines.map((line) => ({
      id: line.id ?? "",
      text: line.text,
      translation: line.translation ?? undefined,
      start: line.start ?? null,
      end: line.end ?? null,
      words: line.words ?? undefined,
    })),
  };
  if (l.language) lyrics.language = l.language;
  return normalizeLyrics(lyrics);
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

export function parsePlanPatch(raw: unknown): DesignPlan {
  const parsed = DesignPlanSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `設計方案格式錯誤：${issuesText(parsed.error)}`);
  const plan = parsed.data;
  if (plan.sections.length === 0) throw new HttpError(400, "設計方案至少需要一個段落");
  return plan;
}

// ---------------------------------------------------------------------------
// process request
// ---------------------------------------------------------------------------

const ProcessRequestSchema = z.object({
  steps: z.array(z.enum(["lyrics", "research", "design"])).max(10).optional(),
  lyricsText: z.string().max(500_000).optional(),
  instruction: z.string().max(4000).optional(),
});

export function parseProcessRequest(raw: unknown): ProcessRequest {
  const parsed = ProcessRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, `處理參數錯誤：${issuesText(parsed.error)}`);
  const r = parsed.data;
  const out: ProcessRequest = {};
  if (r.steps && r.steps.length) out.steps = [...new Set(r.steps)];
  if (r.lyricsText && r.lyricsText.trim()) out.lyricsText = r.lyricsText;
  if (r.instruction && r.instruction.trim()) out.instruction = r.instruction.trim();
  return out;
}
