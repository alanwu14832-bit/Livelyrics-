// Test fixtures for the designer: the demo song (fixtures/demo-lyrics.lrc) with a
// deterministic synthetic analysis matching fixtures/demo-song.wav
// (73 s, 120 BPM: intro 0–8, verse 8–24, chorus 24–40, breakdown 40–48, chorus 48–64, outro 64–73).

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { AudioAnalysis, Lyrics, SongMeta } from "@/lib/types";
import type { DesignerInput } from "../types";

export const DEMO_DURATION = 73;

const SECTIONS: Array<[number, number, number]> = [
  [0, 8, 0.22],
  [8, 24, 0.45],
  [24, 40, 0.86],
  [40, 48, 0.28],
  [48, 64, 0.92],
  [64, 73, 0.34],
];

export function demoAnalysis(): AudioAnalysis {
  const rate = 20;
  const n = DEMO_DURATION * rate;
  const energy: number[] = [];
  const onset: number[] = [];
  const brightness: number[] = [];
  const bass: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = SECTIONS.find(([s, en]) => t >= s && t < en)?.[2] ?? 0.3;
    const pulse = Math.exp(-(t % 0.5) * 9);
    energy.push(Math.min(1, e * (0.85 + 0.15 * pulse)));
    onset.push(Math.min(1, pulse * (0.3 + e * 0.7)));
    brightness.push(0.3 + e * 0.5);
    bass.push(e * 0.6);
  }
  const beats: number[] = [];
  for (let t = 0; t < DEMO_DURATION; t += 0.5) beats.push(t);
  return {
    duration: DEMO_DURATION,
    sampleRate: 44100,
    bpm: 120,
    bpmConfidence: 0.9,
    beats,
    envelopeRate: rate,
    energy,
    onset,
    brightness,
    bass,
    peaks: Array.from({ length: 200 }, (_, i) => 0.2 + ((i * 37) % 60) / 100),
    sections: SECTIONS.map(([start, end, e]) => ({ start, end, energy: e })),
  };
}

export function demoLyrics(): Lyrics {
  const file = path.resolve(__dirname, "../../../../../fixtures/demo-lyrics.lrc");
  return parseLyricsText(readFileSync(file, "utf8"), "user");
}

export function demoMeta(overrides: Partial<SongMeta> = {}): SongMeta {
  return {
    title: "示範之歌",
    artist: "Livelyrics Band",
    duration: DEMO_DURATION,
    fileName: "demo-song.wav",
    mimeType: "audio/wav",
    ...overrides,
  };
}

export function demoInput(overrides: Partial<DesignerInput> = {}): DesignerInput {
  return { meta: demoMeta(), lyrics: demoLyrics(), analysis: demoAnalysis(), ...overrides };
}
