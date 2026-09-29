// Continuous MIDI controls (phase 5a, 控制器): what a fader or knob (0..1) sets. Pure.
//
// 畫面強度 and 歌詞字級 cover their sliders' ranges in the same 5 % steps. 最高亮度 moves the LED
// safety cap between 20 % and the ceiling it had when the fader first touched it — the preset's
// brightness (LED 牆 70 %, 戶外強光 LED 55 %, …) or the custom value — so a controller can dim the
// wall but never make it brighter than the venue setting. The ceiling is forgotten when the
// operator changes the safety settings on screen. With safe mode off the fader does nothing.

import { SAFETY_MIN_BRIGHTNESS, normalizeSafety, safetyPresetById } from "@/lib/stage/safety";
import type { OutputSafety } from "@/lib/types";

const step = (x: number, s = 0.05) => Math.round(x / s) * s;
const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** 0..1 → intensity 0..1.5 (the 畫面強度 slider). */
export function intensityFromControl(v: number): number {
  return Math.round(step(unit(v) * 1.5) * 100) / 100;
}

/** 0..1 → lyric scale 0.5..2 (the 字級 slider). */
export function lyricScaleFromControl(v: number): number {
  return Math.round(step(0.5 + unit(v) * 1.5) * 100) / 100;
}

export class LedCapFader {
  private ceiling: number | null = null;

  /** The operator changed the safety settings on screen: take the new ceiling next time. */
  reset(): void {
    this.ceiling = null;
  }

  /** The cap a fader at `v` (0..1) asks for, or null when safe mode is off. */
  brightnessFor(safety: OutputSafety | null | undefined, v: number): number | null {
    const s = normalizeSafety(safety ?? undefined);
    if (!s.enabled) return null;
    if (this.ceiling == null) this.ceiling = safetyPresetById(s.preset)?.brightness ?? s.brightness;
    const top = Math.max(SAFETY_MIN_BRIGHTNESS, this.ceiling);
    const b = step(SAFETY_MIN_BRIGHTNESS + (top - SAFETY_MIN_BRIGHTNESS) * unit(v));
    return Math.round(Math.min(top, Math.max(SAFETY_MIN_BRIGHTNESS, b)) * 100) / 100;
  }

  get currentCeiling(): number | null {
    return this.ceiling;
  }
}
