// Audio mood for the free research: BPM, the energy curve, brightness (spectral centroid), bass and
// the contrast between sections become one of five moods a designer can act on —
//   冷冽推進 (driving, dark / cold)     溫暖律動 (grooving, bright / warm)
//   陰鬱緩慢 (slow, dark)               溫柔漂浮 (slow, bright)
//   爆發釋放 (quiet parts that explode: a big contrast and a real peak)
// plus the shape of the energy over the song (rising, falling, an arch, waves, flat) and where it
// peaks. Deterministic; works from the section energies alone when the envelopes are missing.

import type { AudioAnalysis } from "@/lib/types";
import { formatTimeShort } from "@/lib/timeline";
import { clamp, meanEnvelope, type SongStructure } from "./structure";

export type MoodQuadrant = "cold-drive" | "warm-groove" | "dark-slow" | "gentle-float" | "release";

export const QUADRANT_LABEL: Record<MoodQuadrant, string> = {
  "cold-drive": "冷冽推進",
  "warm-groove": "溫暖律動",
  "dark-slow": "陰鬱緩慢",
  "gentle-float": "溫柔漂浮",
  release: "爆發釋放",
};

export type EnergyShape = "rising" | "falling" | "arch" | "waves" | "flat";

const SHAPE_LABEL: Record<EnergyShape, string> = {
  rising: "一路往上堆",
  falling: "開頭最滿、慢慢收",
  arch: "中段最高、兩頭收",
  waves: "起伏好幾次",
  flat: "起伏不大",
};

export interface AudioMood {
  quadrant: MoodQuadrant;
  label: string;
  /** 0 calm .. 1 driving */
  arousal: number;
  /** 0 dark / cold .. 1 bright / warm */
  light: number;
  bpm: number;
  tempo: "slow" | "mid" | "fast" | "unknown";
  energy: number;
  peak: number;
  /** peak minus the quietest section */
  contrast: number;
  brightness: number;
  bass: number;
  onset: number;
  shape: EnergyShape;
  shapeLabel: string;
  /** start of the loudest section (seconds) */
  peakAt: number | null;
  /** 繁中, the numbers behind the reading */
  why: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function shapeOf(energies: readonly number[]): EnergyShape {
  const n = energies.length;
  if (n < 3) return "flat";
  const third = Math.max(1, Math.floor(n / 3));
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const first = mean(energies.slice(0, third));
  const middle = mean(energies.slice(third, n - third));
  const last = mean(energies.slice(n - third));
  let swings = 0;
  for (let i = 1; i < n; i++) if (Math.abs(energies[i] - energies[i - 1]) >= 0.2) swings++;
  if (swings >= 3) return "waves";
  if (middle > Math.max(first, last) + 0.1) return "arch";
  if (last > first + 0.15 && last >= middle - 0.05) return "rising";
  if (first > last + 0.15) return "falling";
  return "flat";
}

export function analyzeAudioMood(analysis: AudioAnalysis | null, st: SongStructure): AudioMood {
  const bpm = analysis && Number.isFinite(analysis.bpm) && analysis.bpm > 0 ? Math.round(analysis.bpm) : 0;
  const tempo = bpm === 0 ? "unknown" : bpm < 90 ? "slow" : bpm < 125 ? "mid" : "fast";
  const energies = st.sections.map((s) => s.energy);
  const energy = r2(st.meanEnergy);
  const peak = energies.length ? Math.max(...energies) : energy;
  const low = energies.length ? Math.min(...energies) : energy;
  const contrast = r2(peak - low);
  const brightness = r2(meanEnvelope(analysis, "brightness", 0, st.duration) ?? 0.5);
  const bass = r2(meanEnvelope(analysis, "bass", 0, st.duration) ?? 0.4);
  const onset = r2(meanEnvelope(analysis, "onset", 0, st.duration) ?? 0.35);
  const tempoNorm = bpm ? clamp((bpm - 60) / 110, 0, 1) : 0.5;
  const arousal = r2(clamp(0.45 * energy + 0.3 * tempoNorm + 0.25 * onset, 0, 1));
  const light = r2(clamp(0.5 + (brightness - 0.5) * 0.9 - (bass - 0.45) * 0.45, 0, 1));
  let quadrant: MoodQuadrant;
  if (contrast >= 0.45 && peak >= 0.78) quadrant = "release";
  else if (arousal >= 0.5) quadrant = light < 0.5 ? "cold-drive" : "warm-groove";
  else quadrant = light < 0.5 ? "dark-slow" : "gentle-float";
  const shape = shapeOf(energies);
  let peakAt: number | null = null;
  let best = -1;
  for (const s of st.sections) {
    if (s.energy > best) {
      best = s.energy;
      peakAt = s.start;
    }
  }
  const parts = [
    bpm ? `約 ${bpm} BPM` : "速度未知",
    `平均能量 ${energy.toFixed(2)}`,
    `最高 ${peak.toFixed(2)}${peakAt != null ? `（${formatTimeShort(peakAt)} 起）` : ""}`,
    `段落落差 ${contrast.toFixed(2)}`,
    `亮度 ${brightness.toFixed(2)}、低頻 ${bass.toFixed(2)}`,
  ];
  const reading: Record<MoodQuadrant, string> = {
    release: "安靜與爆發的反差很大：畫面要真的收，才能在高潮真的放。",
    "cold-drive": "節奏推進但音色偏暗：冷色、線條與速度感。",
    "warm-groove": "律動明亮：暖色、跟著拍子呼吸的光。",
    "dark-slow": "慢而暗：大片留白、低亮度、慢速的流動。",
    "gentle-float": "慢而明亮：柔焦、漂浮、溫柔的光。",
  };
  return {
    quadrant,
    label: QUADRANT_LABEL[quadrant],
    arousal,
    light,
    bpm,
    tempo,
    energy,
    peak: r2(peak),
    contrast,
    brightness,
    bass,
    onset,
    shape,
    shapeLabel: SHAPE_LABEL[shape],
    peakAt,
    why: `${parts.join("、")}；能量${SHAPE_LABEL[shape]}。${reading[quadrant]}`,
  };
}
