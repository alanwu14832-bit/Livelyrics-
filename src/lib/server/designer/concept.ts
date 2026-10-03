// The offline designer's words: the key-visual concept, its title, motifs and keywords. A concept is
// built from one of nine skeletons chosen by what the findings say (mood quadrant × genre family ×
// has-lyrics × energy shape × the chorus / hook) — a chant, a ballad, a story, a groove, two peaks, a
// slow build, a steady drive, an instrumental, a fragment — and every sentence slot is filled from
// the findings (imagery families, the emotion, the sing-along phrase, the public facts, the palette's
// colour names). No fixed coda; the BPM / arc sentence only when the analysis is confident. Titles
// come from imagery and emotion and are kept unique across the band's library.

import { formatTimeShort } from "@/lib/timeline";
import { artistKindLabel } from "@/lib/server/research/musicbrainz";
import type { PaletteEntry } from "./palette";
import type { Findings } from "./findings";
import { MOOD_VOCABULARY } from "./lexicon/moods";
import type { SongStructure } from "./structure";
import type { ImageryHit } from "./imagery";
import { artistWhere } from "./free-research";

export type SkeletonId = "fragment" | "instrumental" | "chant" | "ballad" | "story" | "groove" | "two-peaks" | "slow-build" | "steady";

/** Below this the audio analysis is not trusted: one minimal section, a warning instead of a plan. */
export const SHORT_SONG_SECONDS = 20;
/** The BPM / arc sentence needs a confident tempo and a song long enough to have an arc. */
export const CONFIDENT_BPM = 0.5;
export const ARC_MIN_DURATION = 60;

export interface ConceptContext {
  title: string;
  songTitle: string;
  artist: string;
  findings: Findings;
  structure: SongStructure;
  imagery: ImageryHit[];
  palette: PaletteEntry[];
  bpm: number;
  bpmConfidence: number;
  seed: number;
  hasLyrics: boolean;
}

const CHANT_GENRES = new Set(["punk", "metal", "hip-hop", "emo"]);
const STORY_GENRES = new Set(["folk", "jazz"]);
const GROOVE_GENRES = new Set(["city-pop", "rnb", "electronic", "indie-pop"]);
const CALM_EMOTIONS = new Set(["平靜內斂", "憂傷低迴"]);
const BRIGHT_EMOTIONS = new Set(["明亮激昂", "溫柔明亮"]);

const EMOTION_ADJ: Record<string, string> = {
  明亮激昂: "明亮而激昂",
  溫柔明亮: "溫柔而明亮",
  痛苦掙扎: "掙扎而熾烈",
  憂傷低迴: "憂傷而低迴",
  矛盾拉扯: "充滿拉扯",
  平靜內斂: "平靜而內斂",
};

function hookInfo(st: SongStructure): { text: string; repeats: number; units: number } | null {
  if (st.hookCluster == null) return null;
  const line = st.lines.find((l) => l.cluster === st.hookCluster);
  if (!line) return null;
  return { text: line.text, repeats: line.repeats, units: Array.from(line.text.replace(/\s+/g, "")).length };
}

/** Which skeleton a song gets: the first rule that fits, from the clearest evidence down. */
export function chooseSkeleton(c: ConceptContext): SkeletonId {
  const f = c.findings;
  const g = f.genre;
  const st = c.structure;
  if (st.duration < SHORT_SONG_SECONDS) return "fragment";
  if (!c.hasLyrics) return "instrumental";
  const hook = hookInfo(st);
  const emotion = f.lyrics.emotion.label;
  const chorusCount = st.sections.filter((s) => s.kind === "chorus").length;
  if ((g && CHANT_GENRES.has(g.id) && (hook?.repeats ?? 0) >= 3) || (hook && hook.repeats >= 4 && hook.units <= 6)) return "chant";
  const quiet = f.audio.quadrant === "dark-slow" || f.audio.quadrant === "gentle-float";
  if (quiet || (CALM_EMOTIONS.has(emotion) && (!g || g.motion === "soft" || g.id === "pop" || g.id === "rnb"))) return "ballad";
  if ((g && STORY_GENRES.has(g.id)) || f.lyrics.pov.voice === "they" || (f.lyrics.pov.voice === "i-you" && f.lyrics.lineCount >= 10)) return "story";
  if ((g && GROOVE_GENRES.has(g.id)) || f.audio.quadrant === "warm-groove" || c.imagery[0]?.imagery.family.id === "dance") return "groove";
  if (chorusCount >= 2 && BRIGHT_EMOTIONS.has(emotion) && f.audio.contrast >= 0.4) return "two-peaks";
  if (f.audio.quadrant === "release" || f.audio.shape === "rising") return "slow-build";
  return "steady";
}

/** A Latin name inside Chinese text gets a space on its Latin side(s): 「說 Livelyrics Band 是」. */
export function latinPad(name: string): string {
  const head = /^[A-Za-z0-9]/.test(name) ? ` ${name}` : name;
  return /[A-Za-z0-9.]$/.test(name) ? `${head} ` : head;
}

const quote = (s: string) => `「${s}」`;

/** What the public facts say about the artist and the genre, in one of three phrasings. */
function factSentence(c: ConceptContext, variant: number): string {
  const f = c.findings;
  const g = f.genre;
  if (!g) return "";
  const a = f.info?.musicbrainz?.artist;
  const who = latinPad(c.artist || "這個樂團");
  const kind = artistKindLabel(a?.type);
  const where = a ? artistWhere(a) : "";
  switch (variant % 3) {
    case 0:
      return `公開資料說${who}是${where}${g.label}${kind}，所以配色從${g.label}的底色出發：${g.palette.note}。`;
    case 1:
      return `${who}是${where}${g.label}${kind}（${f.genres[0]?.evidence[0] ?? "公開資料"}）：${g.why}`;
    default:
      return `曲風是${g.label}——${g.palette.note}——這是${who}這個${kind}的視覺語法，我們沿用它。`;
  }
}

/** The palette in words, in one of four phrasings; the names never collide (palette.ts). */
function paletteSentence(c: ConceptContext, skeleton: SkeletonId, variant: number): string {
  const [bg, p1, p2] = [c.palette[0]?.name, c.palette[1]?.name, c.palette[2]?.name];
  if (!bg || !p1 || !p2) return "";
  if (skeleton === "ballad") return `大片的${bg}，${p1}很省地用，${p2}只留給最亮的那一句。`;
  if (skeleton === "slow-build" || skeleton === "instrumental") return `${bg}打底，${p1}是慢慢累積的光，${p2}只在爆開的那一刻出現。`;
  if (skeleton === "chant") return `配色只有三個角色：${bg}、${p1}、${p2}，像一張影印的傳單。`;
  return variant % 2 === 0 ? `以${p1}與${p2}為主色，在${bg}的背景上發光。` : `${bg}的底、${p1}的光、${p2}的點綴，整首歌只有這三種顏色在說話。`;
}

/** 約 120 BPM、能量起伏好幾次、最高點在 0:48 — only when the tempo is confident and the song long enough. */
function arcSentence(c: ConceptContext): string {
  const f = c.findings;
  if (!(c.bpm > 0) || !(c.bpmConfidence >= CONFIDENT_BPM) || c.structure.duration < ARC_MIN_DURATION) return "";
  const peak = f.audio.peakAt != null && f.audio.contrast >= 0.2 ? `，最高點在 ${formatTimeShort(f.audio.peakAt)}` : "";
  return `約 ${c.bpm} BPM，能量${f.audio.shapeLabel}${peak}。`;
}

/** The imagery names of the song, 「夜色」「遠方」 (two at most for a sentence). */
function images(c: ConceptContext): [string | null, string | null] {
  const names = c.imagery.map((h) => h.imagery.name);
  return [names[0] ?? null, names[1] ?? null];
}

/** The phrase the crowd sings back, when the research found one that is not a bare chant. */
function singalong(c: ConceptContext): string | null {
  const p = c.findings.hints.singalong.find((x) => !x.chant) ?? c.findings.hints.singalong[0];
  return p ? p.text : null;
}

function povClause(c: ConceptContext): string {
  switch (c.findings.lyrics.pov.voice) {
    case "we":
      return "唱的是「我們」，字要大到後排也能跟著唱";
    case "i-you":
      return "像寫給一個人的信，字一句一句親密地出現";
    case "you":
      return "一直在呼喚一個「你」，畫面留一道光給那個位置";
    case "i":
      return "是內心的獨白，字安靜地出現";
    case "they":
      return "說的是別人的故事，歌詞當旁白";
    default:
      return "字跟著意象走";
  }
}

/** The opening sentence of each skeleton. */
function opening(c: ConceptContext, skeleton: SkeletonId): string {
  const f = c.findings;
  const [a, b] = images(c);
  const T = quote(c.title);
  const song = `〈${c.songTitle || "這首歌"}〉`;
  const adj = EMOTION_ADJ[f.lyrics.emotion.label];
  const peak = f.audio.peakAt != null ? formatTimeShort(f.audio.peakAt) : null;
  const vocab = MOOD_VOCABULARY[f.audio.quadrant];
  switch (skeleton) {
    case "fragment":
      return `這段音檔只有 ${Math.round(c.structure.duration)} 秒，分析不可靠：${T}只是一個安靜、單一的畫面（${a ? `${quote(a)}的` : ""}${vocab.motifs[0]}），等完整的音檔上傳後再重新設計。`;
    case "instrumental":
      return `沒有歌詞的歌，畫面就是主唱。${T}把${f.genre ? `${f.genre.label}的${f.genre.motifs[0]}` : vocab.motifs[0]}做成一道會呼吸的光：安靜的段落只剩一條線${peak ? `，${peak} 的最高點才撐滿整面牆` : "，最高點才撐滿整面牆"}。`;
    case "chant": {
      const phrase = singalong(c);
      return `這是一首要全場一起喊的歌。${T}不講故事，只有${phrase ? `一句話：${quote(phrase)}` : "口號"}——${a ? `${quote(a)}是它的質地，` : ""}字比畫面重要，每一次口號都用同一個構圖讓全場認得。`;
    }
    case "ballad":
      return `${T}是一首安靜的歌該有的畫面：${a && b ? `${quote(a)}與${quote(b)}` : a ? quote(a) : "很少的光"}留在很暗的底色裡，${povClause(c)}${adj ? `，整首歌${adj}` : ""}。`;
    case "story":
      return `${song}像在說一個故事：${povClause(c)}。${T}讓畫面當場景而不是特效——${a && b ? `${quote(a)}與${quote(b)}是道具` : a ? `${quote(a)}是道具` : "光是道具"}，歌詞是旁白。`;
    case "groove":
      return `${T}跟著拍子走：${a && b ? `${quote(a)}與${quote(b)}在律動裡閃爍` : a ? `${quote(a)}在律動裡閃爍` : "光在律動裡閃爍"}，畫面是舞池的燈，不是佈景${adj ? `；歌詞${adj}` : ""}。`;
    case "two-peaks":
      return `${T}把${song}做成兩次高潮：第一次副歌讓${a ? quote(a) : "光"}亮起來，第二次才把${b ? quote(b) : "整面牆"}整個打開${adj ? `——歌詞${adj}，畫面也要跟上` : ""}。`;
    case "slow-build":
      return `${song}從安靜開始${peak ? `，一路堆到 ${peak} 才真正爆開` : "，一路往上堆"}；${T}是爆開之前所有的忍耐：${a ? `${quote(a)}先只是一點` : "光先只是一點"}${b ? `，${quote(b)}慢慢填滿整面牆` : "，慢慢填滿整面牆"}。`;
    default:
      return `${T}把${song}做成一面穩定推進的牆：${a ? `${quote(a)}是底` : `${vocab.motifs[0]}是底`}${b ? `，${quote(b)}是節拍` : "，節拍是線條"}${adj ? `，歌詞${adj}` : ""}。`;
  }
}

/** How the verses and the choruses behave, per skeleton (never a singer for an instrumental). */
function roleSentence(c: ConceptContext, skeleton: SkeletonId): string {
  const st = c.structure;
  const chorusCount = st.sections.filter((s) => s.kind === "chorus").length;
  const phrase = singalong(c);
  switch (skeleton) {
    case "fragment":
      return "畫面不閃、不切，歌詞（如果有）小而安靜。";
    case "instrumental":
      return "安靜的段落讓畫面退後，能量高的段落讓光與節拍一起撐開；不需要留歌詞的位置。";
    case "chant":
      return `主歌退成小字，${chorusCount ? "副歌每一次都是巨字口號" : "能量最高的段落用巨字"}；主唱把麥克風交給觀眾時，${phrase ? quote(phrase) : "口號"}留在畫面上。`;
    case "ballad":
      return `主歌的字小而安靜、避開主唱；${chorusCount ? "副歌放大但不閃" : "最亮的一句放大但不閃"}，整首歌不閃白、不硬切。`;
    case "story":
      return "每一句歌詞是一張排好的構圖，像翻一本書；畫面不解釋歌詞，只給場景。";
    case "groove":
      return `主歌的字跟著拍子滑入，${chorusCount ? "副歌放大讓全場跟唱" : "最亮的段落放大讓全場跟唱"}${phrase ? `——${quote(phrase)}是大家會一起唱的那句` : ""}。`;
    case "two-peaks":
      return `主歌讓畫面退後、把空間留給主唱；${chorusCount >= 2 ? "兩次副歌用同一個構圖，第二次放大" : "副歌放大"}${phrase ? `，${quote(phrase)}是全場一起唱的那句` : ""}。`;
    case "slow-build":
      return `前半的歌詞都是小字，${chorusCount ? "最後一次副歌" : "最高點"}才讓字變成畫面的主角；爆開之前的每一秒都要忍住。`;
    default:
      return `主歌小而穩，${chorusCount ? "副歌一次比一次亮" : "能量最高的段落最亮"}${phrase ? `，${quote(phrase)}這句讓全場跟唱` : ""}。`;
  }
}

/** The key-visual concept for the plan (繁中, several sentences, no fixed coda). */
export function buildConcept(c: ConceptContext, skeleton = chooseSkeleton(c)): string {
  const variant = (c.seed >>> 5) % 3;
  const parts = [opening(c, skeleton), skeleton === "fragment" ? "" : factSentence(c, variant), paletteSentence(c, skeleton, variant), roleSentence(c, skeleton), arcSentence(c)];
  // a Latin name at the start of a sentence needs no leading space
  return parts.map((p) => p.replace(/^\s+/, "")).filter(Boolean).join("");
}

// ---------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------

const EMOTION_TITLES: Record<string, (a: string) => string[]> = {
  明亮激昂: (a) => [`燒起來的${a}`, `${a}全開`, `${a}大聲一點`],
  溫柔明亮: (a) => [`微光裡的${a}`, `${a}慢慢亮`, `給${a}的信`],
  痛苦掙扎: (a) => [`撞開${a}`, `${a}的裂縫`, `${a}碎成光`],
  憂傷低迴: (a) => [`${a}未眠`, `留不住的${a}`, `${a}還在下`],
  矛盾拉扯: (a) => [`兩種${a}`, `${a}的另一面`, `${a}之間`],
  平靜內斂: (a) => [`安靜的${a}`, `${a}的留白`, `一盞${a}`],
};

function normalizeTitle(t: string): string {
  return t.replace(/[\s（）()「」]/g, "").toLowerCase();
}

/** Title candidates from the imagery and the emotion, most fitting first (the seed rotates the start). */
export function titleCandidates(c: ConceptContext, skeleton: SkeletonId): string[] {
  const [a, b] = images(c);
  const f = c.findings;
  const out: string[] = [];
  const add = (t: string) => {
    const n = Array.from(t).length;
    if (n >= 2 && n <= 12 && !out.includes(t)) out.push(t);
  };
  const phrase = singalong(c);
  if (skeleton === "chant" && phrase && Array.from(phrase).length <= 8 && !/\s/.test(phrase)) add(phrase);
  const emotion = EMOTION_TITLES[f.lyrics.emotion.label];
  if (a && b) {
    const pair = [`${a}與${b}`, `${a}裡的${b}`, `${b}落在${a}`, `穿過${a}的${b}`, `${a}之後的${b}`, `把${b}留在${a}`];
    const start = c.seed % pair.length;
    for (let i = 0; i < pair.length; i++) add(pair[(start + i) % pair.length]);
  }
  if (a && emotion) for (const t of emotion(a)) add(t);
  if (b && emotion) for (const t of emotion(b)) add(t);
  if (a) for (const t of [`${a}的回聲`, `${a}進行式`, `點亮${a}`, `${a}之間`]) add(t);
  if (f.genre && a) add(`${f.genre.motifs[0]}與${a}`);
  for (const t of MOOD_VOCABULARY[f.audio.quadrant].titles) add(t);
  return out;
}

/** The first candidate not already used in the library; the last resort numbers the first one. */
export function makeTitle(c: ConceptContext, skeleton: SkeletonId, taken: readonly string[] = []): string {
  const used = new Set(taken.map(normalizeTitle));
  const cands = titleCandidates(c, skeleton);
  const free = cands.find((t) => !used.has(normalizeTitle(t)));
  if (free) return free;
  const base = cands[0] ?? MOOD_VOCABULARY[c.findings.audio.quadrant].titles[0];
  for (let n = 2; n < 50; n++) {
    const t = `${base}・${n}`;
    if (!used.has(normalizeTitle(t))) return t;
  }
  return base;
}

// ---------------------------------------------------------------------------
// motifs, keywords
// ---------------------------------------------------------------------------

/** The song's motifs: its imagery families and its genre (findings), then the mood lexicon; never a fixed filler. */
export function conceptMotifs(f: Findings, max = 4): string[] {
  const out = [...f.hints.motifs];
  for (const m of MOOD_VOCABULARY[f.audio.quadrant].motifs) {
    if (out.length >= Math.max(2, max)) break;
    if (!out.includes(m)) out.push(m);
  }
  return out.slice(0, max);
}

/** Mood keywords: the findings' (emotion, audio, images, genre), the mood lexicon's, the images. */
export function conceptKeywords(f: Findings, imagery: readonly ImageryHit[], max = 6): string[] {
  const out: string[] = [];
  for (const k of [...f.hints.keywords, ...MOOD_VOCABULARY[f.audio.quadrant].keywords, ...imagery.map((h) => h.imagery.name)]) {
    // 「爆發」 after 「爆發釋放」 says nothing new
    if (k && !out.some((o) => o.includes(k) || k.includes(o))) out.push(k);
  }
  return out.slice(0, max);
}
