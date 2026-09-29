// 免費研究 synthesis: public facts (MusicBrainz / Wikipedia, when found), the genre's visual grammar,
// the lyric analysis and the audio mood become Findings plus DesignHints — the concrete tendencies
// the offline designer and the offline directions follow (palette hue / saturation / scheme and
// temperature, a scene family, motifs, typography, lyric density and styles, motion energy, the
// sing-along phrases and a 世界觀 sentence). Pure and deterministic: the same input gives the same
// findings, so a plan can be re-derived at any time from what is stored on the project.

import { coercePublicInfo } from "@/lib/server/research/public-info";
import type { LyricStyleId, PublicInfo, SceneId } from "@/lib/types";
import { analyzeAudioMood, type AudioMood } from "./audio-mood";
import { matchGenres, type GenreMatch } from "./genre";
import type { GenreRule, LyricDensity, MotionEnergy } from "./lexicon/genres";
import { analyzeLyrics, type ImageryMatch, type LyricAnalysis, type SingalongPhrase } from "./lyric-analysis";
import type { Scheme } from "./palette";
import { analyzeStructure, type SongStructure } from "./structure";
import type { EmblemStyle } from "./svg";
import type { DesignerInput } from "./types";

export interface DesignHints {
  /** base hue for the palette (degrees); null = no strong colour idea, the seed decides */
  hue: number | null;
  /** second hue the song suggests (the genre's or the next image's), null without one */
  hue2: number | null;
  /**
   * With a known genre: [accent, highlight] hues — the genre sets the colour family, the song's
   * strongest image becomes the accent when it is a different colour. Null without a genre.
   */
  accentHues: [number, number] | null;
  /** multiplier on the mood's saturation */
  saturation: number;
  scheme: Scheme | null;
  temperature: "warm" | "cool" | "neutral";
  /** this song's scene family, most fitting first (genre + imagery), without the avoided ones */
  scenes: SceneId[];
  avoidScenes: SceneId[];
  motifs: string[];
  keywords: string[];
  emblem: EmblemStyle | null;
  typography: GenreRule["typography"] | null;
  lyricDensity: LyricDensity;
  verseStyle: LyricStyleId | null;
  chorusStyle: LyricStyleId | null;
  motion: MotionEnergy;
  singalong: SingalongPhrase[];
  /** 世界觀 in one sentence (繁中) */
  world: string;
}

export interface Findings {
  info: PublicInfo | null;
  genres: GenreMatch[];
  /** the leading genre rule, null when no source names one */
  genre: GenreRule | null;
  audio: AudioMood;
  lyrics: LyricAnalysis;
  /** image families ranked by weight (count × how visual) */
  imagery: ImageryMatch[];
  hints: DesignHints;
}

const QUADRANT_VERB: Record<AudioMood["quadrant"], string> = {
  release: "從安靜一路爆開",
  "cold-drive": "冷冷地向前推進",
  "warm-groove": "溫暖地搖擺",
  "dark-slow": "緩慢地沉下去",
  "gentle-float": "輕輕地漂浮",
};

const EMOTION_ADJ: Record<string, string> = {
  明亮激昂: "明亮而激昂",
  溫柔明亮: "溫柔而明亮",
  痛苦掙扎: "掙扎而熾烈",
  憂傷低迴: "憂傷而低迴",
  矛盾拉扯: "充滿拉扯",
  平靜內斂: "平靜而內斂",
  情緒不明顯: "純粹由聲音構成",
};

function hueGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** [accent, highlight]: the image's hue when it differs from the genre's lead, then the genre hue farthest from both. */
function genreAccents(genre: GenreRule, imageHue: number | null): [number, number] {
  const [lead, ...rest] = genre.palette.hues;
  const accent = imageHue != null && hueGap(imageHue, lead) >= 40 ? imageHue : (rest[0] ?? lead + 150);
  const pool = rest.filter((h) => h !== accent);
  const highlight = pool.length ? pool.reduce((best, h) => (Math.min(hueGap(h, lead), hueGap(h, accent)) > Math.min(hueGap(best, lead), hueGap(best, accent)) ? h : best)) : lead + 210;
  return [accent, highlight];
}

function isWarmHue(h: number): boolean {
  const x = ((h % 360) + 360) % 360;
  return x < 70 || x >= 300;
}

function temperatureOf(imagery: readonly ImageryMatch[], genre: GenreRule | null, audio: AudioMood): DesignHints["temperature"] {
  let warm = 0;
  let cool = 0;
  for (const h of imagery.slice(0, 6)) {
    if (h.family.temperature === "warm") warm += h.weight;
    else if (h.family.temperature === "cool") cool += h.weight;
  }
  if (genre) {
    if (isWarmHue(genre.palette.hues[0])) warm += 1;
    else cool += 1;
  }
  if (audio.light >= 0.6) warm += 0.5;
  else if (audio.light < 0.4) cool += 0.5;
  if (warm >= 1.5 && warm >= cool * 1.3) return "warm";
  if (cool >= 1.5 && cool >= warm * 1.3) return "cool";
  return "neutral";
}

function sceneFamily(imagery: readonly ImageryMatch[], genre: GenreRule | null): { scenes: SceneId[]; avoid: SceneId[] } {
  // each image votes for its scenes (its most typical first); a scene keeps its strongest vote, so
  // one image's signature scene is not outvoted by a scene every image mentions in passing
  const votes = new Map<SceneId, number>();
  const top = imagery.slice(0, 4);
  const max = top[0]?.weight ?? 1;
  top.forEach((h) => h.family.scenes.forEach((s, i) => votes.set(s, Math.max(votes.get(s) ?? 0, (h.weight / max) * (1.6 - i * 0.45)))));
  const scores = new Map(votes);
  // the genre's grammar adds on top: its family leads whenever a source names the genre
  genre?.scenes.forEach((s, i) => scores.set(s, (scores.get(s) ?? 0) + 3 - i * 0.6));
  const avoid = genre?.avoid ?? [];
  const scenes = [...scores.entries()]
    .filter(([s]) => !avoid.includes(s))
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);
  return { scenes, avoid: [...avoid] };
}

/** The 世界觀 in one sentence: the lyric emotion, the two strongest images and the audio mood (the genre is told elsewhere). */
function worldSentence(imagery: readonly ImageryMatch[], lyrics: LyricAnalysis, audio: AudioMood): string {
  const adj = EMOTION_ADJ[lyrics.emotion.label] ?? "有自己溫度";
  const verb = QUADRANT_VERB[audio.quadrant];
  const names = imagery.slice(0, 2).map((h) => `「${h.family.name}」`);
  if (names.length === 2) return `一個${adj}的世界：${names[0]}與${names[1]}${verb}。`;
  if (names.length === 1) return `一個${adj}的世界：${names[0]}${verb}。`;
  return `一個${adj}的世界，由音樂本身的能量${verb}。`;
}

/** The free-research findings for a designer input (deterministic; no network). */
export function analyzeFindings(input: DesignerInput, structure?: SongStructure): Findings {
  const st = structure ?? analyzeStructure(input);
  const info = coercePublicInfo(input.publicInfo ?? null);
  const genres = matchGenres(info);
  const genre = genres[0]?.rule ?? null;
  const audio = analyzeAudioMood(input.analysis, st);
  const lines = (Array.isArray(input.lyrics?.lines) ? input.lyrics.lines : []).map((l) => ({ id: l.id, text: typeof l.text === "string" ? l.text : "", start: l.start }));
  const lyrics = analyzeLyrics(lines, input.meta?.title ?? "", st);
  const imagery = [...lyrics.imagery].sort((a, b) => b.weight - a.weight || b.count - a.count);
  const top = imagery[0];
  const strongImage = top && top.weight >= 2;
  // colour: with a known genre its colour family leads and the song's strongest image becomes the
  // accent (city pop's sunset magenta with the lyric's night blue); without one, the image leads
  const hue = genre ? genre.palette.hues[0] : top ? top.family.hues[0] : null;
  const hue2 = genre ? (strongImage ? top.family.hues[0] : genre.palette.hues[1] ?? null) : imagery[1]?.family.hues[0] ?? null;
  const accentHues = genre ? genreAccents(genre, strongImage ? top.family.hues[0] : null) : null;
  const imgSat = top ? top.family.saturation : 1;
  const saturation = Math.round(Math.max(0.3, Math.min(1.15, (genre?.palette.saturation ?? 1) * (0.5 + 0.5 * imgSat))) * 100) / 100;
  const { scenes, avoid } = sceneFamily(imagery, genre);
  // the song's own images and the genre's motifs, interleaved
  const own = imagery.slice(0, 3).map((h) => h.family.motif);
  const fromGenre = genre?.motifs.slice(0, 2) ?? [];
  const motifs = [own[0], fromGenre[0], own[1], fromGenre[1], own[2]].filter((m): m is string => !!m).filter((m, i, a) => a.indexOf(m) === i).slice(0, 5);
  const keywords = [
    ...(lyrics.emotion.label !== "情緒不明顯" ? [lyrics.emotion.label] : []),
    audio.label,
    ...imagery.slice(0, 2).map((h) => h.family.name),
    ...(genre ? [genre.label] : []),
  ]
    .filter((k, i, a) => a.indexOf(k) === i && Array.from(k).length <= 12)
    .slice(0, 6);
  const motion: MotionEnergy = genre?.motion ?? (audio.quadrant === "dark-slow" || audio.quadrant === "gentle-float" ? "soft" : "medium");
  return {
    info,
    genres,
    genre,
    audio,
    lyrics,
    imagery,
    hints: {
      hue,
      hue2,
      accentHues,
      saturation,
      scheme: genre?.palette.scheme ?? null,
      temperature: temperatureOf(imagery, genre, audio),
      scenes,
      avoidScenes: avoid,
      motifs,
      keywords,
      emblem: top?.family.emblem ?? null,
      typography: genre?.typography ?? null,
      lyricDensity: genre?.lyrics.density ?? "normal",
      verseStyle: genre?.lyrics.verse ?? null,
      chorusStyle: genre?.lyrics.chorus ?? null,
      motion,
      singalong: lyrics.singalong,
      world: worldSentence(imagery, lyrics, audio),
    },
  };
}
