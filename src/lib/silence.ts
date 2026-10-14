// Round 19: a file with (almost) no sound. Measured on the analysis's waveform peaks (absolute
// max |sample| per bucket, 0..1 — never normalized), so analyses from any round answer the same.
// Shared by the process page (the warning) and the designer (no invented sections or climaxes).

import type { AudioAnalysis } from "./types";

/**
 * A bucket whose peak stays under this (≈ −48 dBFS) is near silence: noise whose RMS is about
 * −60 dBFS peaks some 12 dB higher over a bucket of tens of thousands of samples.
 */
export const SILENT_PEAK = 0.004;
/** The file is near silent when at least this share of its buckets is. */
export const SILENT_SHARE = 0.85;

/** RMS below about −60 dBFS over most of the file (or no level at all). */
export function isNearlySilent(analysis: Pick<AudioAnalysis, "peaks" | "energy"> | null | undefined): boolean {
  if (!analysis) return false;
  const peaks = Array.isArray(analysis.peaks) ? analysis.peaks.filter((p) => typeof p === "number" && Number.isFinite(p)) : [];
  if (peaks.length) return peaks.filter((p) => Math.abs(p) < SILENT_PEAK).length >= SILENT_SHARE * peaks.length;
  // no waveform: an energy envelope that is zero everywhere (every frame under the silence floor)
  const energy = Array.isArray(analysis.energy) ? analysis.energy : [];
  return energy.length > 0 && energy.every((e) => !(e > 0));
}

/** The operator-facing wording (process page, designer notes). */
export const SILENT_TITLE = "這個音檔幾乎沒有聲音";
export const SILENT_DETAIL = "整個檔案的音量幾乎都在 −60 dBFS 以下：沒有段落、節拍或高潮可以讀，所以只設計一個安靜的單一畫面。確認檔案沒有選錯、匯出沒有失敗，再上傳有聲音的版本重新設計。";
