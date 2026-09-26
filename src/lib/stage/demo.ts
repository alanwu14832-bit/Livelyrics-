// Built-in demo Project for the stage lab (/stage-lab) and tests. Mirrors the
// fixtures in /fixtures (73 s, 120 BPM: intro 0–8, verse 8–24, chorus 24–40,
// breakdown 40–48, chorus 48–64, outro 64–73) with a hand-written design plan and
// deterministic fake analysis envelopes.

import type { AudioAnalysis, DesignPlan, LyricLine, Project } from "../types";

export const DEMO_DURATION = 73;
const RATE = 20;
const BPM = 120;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTION_ENERGY: Array<[number, number, number]> = [
  [0, 8, 0.22],
  [8, 24, 0.45],
  [24, 40, 0.86],
  [40, 48, 0.28],
  [48, 64, 0.92],
  [64, 73, 0.34],
];

function baseEnergy(t: number): number {
  // smooth 0.6 s ramps between sections
  let v = SECTION_ENERGY[0][2];
  for (const [s, , e] of SECTION_ENERGY) {
    const k = Math.min(1, Math.max(0, (t - s + 0.3) / 0.6));
    v = v + (e - v) * k;
  }
  if (t > DEMO_DURATION - 3) v *= Math.max(0, (DEMO_DURATION - t) / 3);
  return v;
}

export function createDemoAnalysis(): AudioAnalysis {
  const rnd = mulberry32(7);
  const n = Math.ceil(DEMO_DURATION * RATE);
  const energy: number[] = [];
  const onset: number[] = [];
  const bass: number[] = [];
  const brightness: number[] = [];
  const beatPeriod = 60 / BPM;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const base = baseEnergy(t);
    const sinceBeat = t % beatPeriod;
    const beatNo = Math.floor(t / beatPeriod);
    const hit = Math.exp(-sinceBeat * 9);
    const kick = beatNo % 2 === 0 ? Math.exp(-sinceBeat * 7) : 0;
    energy.push(clamp01(base * (0.82 + 0.18 * hit) + (rnd() - 0.5) * 0.03));
    onset.push(clamp01(hit * (0.25 + base * 0.75) + rnd() * 0.05));
    bass.push(clamp01(kick * (0.3 + base * 0.7) + base * 0.15));
    brightness.push(clamp01(0.3 + base * 0.5 + (rnd() - 0.5) * 0.06));
  }
  const beats: number[] = [];
  for (let b = 0; b * beatPeriod < DEMO_DURATION; b++) beats.push(Math.round(b * beatPeriod * 1000) / 1000);
  const peaks: number[] = [];
  const buckets = 2000;
  for (let i = 0; i < buckets; i++) {
    const t = (i / buckets) * DEMO_DURATION;
    peaks.push(clamp01(baseEnergy(t) * (0.7 + 0.3 * rnd()) + 0.05));
  }
  return {
    duration: DEMO_DURATION,
    sampleRate: 44100,
    bpm: BPM,
    bpmConfidence: 0.92,
    beats,
    envelopeRate: RATE,
    energy,
    onset,
    brightness,
    bass,
    peaks,
    sections: SECTION_ENERGY.map(([start, end, e]) => ({ start, end, energy: e })),
  };
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const LINES: Array<[number, string, string?]> = [
  [8, "夜色慢慢落在城市的邊緣"],
  [12, "我們把名字寫進風裡面"],
  [16, "每一盞燈都像一個誓言"],
  [20, "等待有人把它點燃"],
  [24, "Hey 跟著我唱", "Hey, sing along with me"],
  [28, "把心跳交給這個晚上", "Give your heartbeat to this night"],
  [32, "就算世界再大再遠", "No matter how vast the world may be"],
  [36, "我們的歌會找到方向", "Our song will find its way"],
  [42, "安靜一下 聽見了嗎"],
  [48, "Hey 跟著我唱", "Hey, sing along with me"],
  [52, "把心跳交給這個晚上", "Give your heartbeat to this night"],
  [56, "就算世界再大再遠", "No matter how vast the world may be"],
  [60, "我們的歌會找到方向", "Our song will find its way"],
  [66, "直到天亮", "Until the dawn"],
];

export function createDemoLines(): LyricLine[] {
  const lines: LyricLine[] = LINES.map(([start, text, translation], i) => ({
    id: `l${i}`,
    text,
    ...(translation ? { translation } : {}),
    start,
    end: null,
  }));
  // one line with explicit word timing, to exercise the aligned-words path
  lines[0].words = [
    { text: "夜色", start: 8.0, end: 8.7 },
    { text: "慢慢", start: 8.7, end: 9.5 },
    { text: "落在", start: 9.5, end: 10.1 },
    { text: "城市的", start: 10.1, end: 10.9 },
    { text: "邊緣", start: 10.9, end: 11.7 },
  ];
  return lines;
}

const MOTIF_SVG =
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="2.5"/>' +
  '<circle cx="50" cy="50" r="38.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 4"/>' +
  '<path fill="currentColor" fill-rule="evenodd" d="M50 15 C63 31 69 43 69 55 A19 19 0 0 1 31 55 C31 43 37 31 50 15 Z M50 41 C55 48 57 53 57 57 A7 7 0 0 1 43 57 C43 53 45 48 50 41 Z"/>' +
  '<rect x="24" y="79" width="52" height="3" rx="1.5" fill="currentColor"/>' +
  '<circle cx="29" cy="30" r="2" fill="currentColor"/><circle cx="72" cy="27" r="1.6" fill="currentColor"/><circle cx="77" cy="45" r="1.2" fill="currentColor"/></svg>';

export const DEMO_PALETTE = {
  night: "#0a0b1a",
  indigo: "#3b4bb8",
  ember: "#ff7a45",
  moon: "#f6f1e7",
  gold: "#ffc857",
  ink: "#07120f",
  jade: "#2f9e83",
};

export function createDemoPlan(): DesignPlan {
  const P = DEMO_PALETTE;
  return {
    version: 1,
    keyVisual: {
      title: "把名字寫進風裡",
      concept:
        "整首歌是一座入夜的城市：一盞盞燈火像是被點亮的誓言，隨著合唱慢慢連成一片光海。主歌讓畫面像霧中的街景一樣安靜，把空間留給主唱；副歌讓光點隨鼓點爆開，邀請全場一起唱。抽離段退回水墨般的留白，最後在天亮的暖色中收尾。",
      moodKeywords: ["夜色", "溫暖", "集體", "希望", "脈動"],
      palette: [
        { hex: P.night, role: "背景", name: "深夜藍" },
        { hex: P.indigo, role: "主色", name: "城市靛" },
        { hex: P.ember, role: "點綴", name: "燈火橘" },
        { hex: P.moon, role: "歌詞", name: "月白" },
        { hex: P.gold, role: "高光", name: "誓言金" },
      ],
      motifs: ["城市燈火", "風中的字", "心跳脈動", "天亮的地平線"],
      motifSvg: MOTIF_SVG,
      typography: {
        cjkFont: "noto-sans-tc",
        latinFont: "space-grotesk",
        weight: 800,
        letterSpacing: 0.04,
        rationale: "思源黑體粗體在 LED 上最穩定，搭配幾何感的 Space Grotesk 讓「Hey」這類口號有現代感。",
      },
    },
    sections: [
      {
        id: "s0",
        kind: "intro",
        label: "前奏",
        start: 0,
        end: 8,
        energy: 0.22,
        scene: "motif",
        sceneParams: { speed: 0.25, density: 0.4, intensity: 0.62, audioReactivity: 0.35 },
        colorway: [P.night, P.indigo, P.ember],
        lyricStyle: "line-fade",
        lyricPlacement: "center",
        lyricScale: 1,
        lyricColor: P.moon,
        transitionIn: "fade",
        rationale: "以主視覺符號開場，讓觀眾先認得這首歌的「燈火」。",
      },
      {
        id: "s1",
        kind: "verse",
        label: "主歌",
        start: 8,
        end: 24,
        energy: 0.45,
        scene: "nebula",
        sceneParams: { speed: 0.3, density: 0.5, intensity: 0.62, audioReactivity: 0.3 },
        colorway: [P.night, P.indigo, P.gold],
        lyricStyle: "karaoke",
        lyricPlacement: "lower-third",
        lyricScale: 0.95,
        lyricColor: P.moon,
        transitionIn: "bloom",
        rationale: "敘事段落，霧般的星雲維持低亮度，歌詞在下三分之一穩定跟唱。",
      },
      {
        id: "s2",
        kind: "chorus",
        label: "副歌",
        start: 24,
        end: 40,
        energy: 0.86,
        scene: "particles",
        sceneParams: { speed: 0.6, density: 0.75, intensity: 0.85, audioReactivity: 0.85 },
        colorway: [P.night, P.ember, P.gold],
        lyricStyle: "word-pop",
        lyricPlacement: "center",
        lyricScale: 1.1,
        lyricColor: P.moon,
        transitionIn: "flash",
        rationale: "第一次爆點：閃白進場，光點隨大鼓脈動，歌詞逐字跳出帶動合唱。",
      },
      {
        id: "s3",
        kind: "breakdown",
        label: "間奏",
        start: 40,
        end: 48,
        energy: 0.28,
        scene: "ink",
        sceneParams: { speed: 0.2, density: 0.45, intensity: 0.55, audioReactivity: 0.2 },
        colorway: [P.ink, P.jade, P.gold],
        lyricStyle: "vertical",
        lyricPlacement: "vertical-right",
        lyricScale: 1,
        lyricColor: "#eef6f2",
        transitionIn: "fade",
        rationale: "收掉能量，水墨與直排文字製造文學感的留白。",
      },
      {
        id: "s4",
        kind: "chorus",
        label: "副歌二",
        start: 48,
        end: 64,
        energy: 0.92,
        scene: "grid",
        sceneParams: { speed: 0.7, density: 0.6, intensity: 0.9, audioReactivity: 0.8 },
        colorway: ["#0d0718", "#7b3fe4", P.ember],
        lyricStyle: "stack",
        lyricPlacement: "center",
        lyricScale: 1,
        lyricColor: P.moon,
        transitionIn: "wipe",
        rationale: "最高潮：網格向前衝，歌詞像詩一樣堆疊，讓全場看見整段副歌。",
      },
      {
        id: "s5",
        kind: "outro",
        label: "尾奏",
        start: 64,
        end: DEMO_DURATION,
        energy: 0.34,
        scene: "gradient",
        sceneParams: { speed: 0.2, density: 0.4, intensity: 0.6, audioReactivity: 0.2 },
        colorway: ["#140d0a", P.ember, P.gold],
        lyricStyle: "line-fade",
        lyricPlacement: "center",
        lyricScale: 1.25,
        lyricColor: "#fff4e6",
        transitionIn: "fade",
        rationale: "天亮的暖色漸層，最後一句放大，安靜收尾。",
      },
    ],
    lines: [
      { lineId: "l4", emphasis: ["Hey"], styleOverride: "impact", note: "口號，大字帶動全場" },
      { lineId: "l5", emphasis: ["心跳"], styleOverride: null, note: "" },
      { lineId: "l7", emphasis: ["方向"], styleOverride: null, note: "" },
      { lineId: "l9", emphasis: ["Hey"], styleOverride: "impact", note: "第二次口號" },
      { lineId: "l10", emphasis: ["心跳"], styleOverride: null, note: "" },
      { lineId: "l12", emphasis: ["方向"], styleOverride: null, note: "" },
      { lineId: "l13", emphasis: ["天亮"], styleOverride: null, note: "最後一句，放慢淡出" },
    ],
    cues: [
      { time: 7.5, title: "主歌進場", detail: "Bloom 轉場進星雲，歌詞在下三分之一出現。", kind: "transition" },
      { time: 23.8, title: "副歌爆點", detail: "閃白轉場，粒子跟著大鼓脈動；可把強度推到 1.2。", kind: "drop" },
      { time: 24, title: "合唱口號", detail: "「Hey 跟著我唱」以大字呈現，邀請觀眾一起唱。", kind: "singalong" },
      { time: 40, title: "安靜段", detail: "水墨直排；若主唱延長，改用手動 cue。", kind: "quiet" },
      { time: 47.8, title: "第二次副歌", detail: "擦除轉場進網格，歌詞改為堆疊。", kind: "transition" },
      { time: 72.5, title: "結束", detail: "最後一拍後按 B 全黑。", kind: "warning" },
    ],
    designerNotes:
      "## 敘事弧線\n從**一盞燈**（主視覺符號）開始，到副歌變成**一整片燈海**，再經過水墨般的留白，最後在天亮的暖色裡收尾。\n\n" +
      "## 歌詞與動畫\n- 主歌只在下三分之一放歌詞，畫面保持霧狀、低亮度，不和主唱搶戲。\n" +
      "- 副歌口號「Hey 跟著我唱」用超大字一次一兩個詞，帶動合唱；其餘句子逐字跳出。\n" +
      "- 抽離段改為直排，營造海報般的文學感。\n\n" +
      "## 現場注意\n樂團若延長間奏，切換到現場模式手動 cue；任何狀況都可以先按 **B** 全黑。",
  };
}

export function createDemoProject(): Project {
  const created = "2026-09-01T12:00:00.000Z";
  return {
    id: "demo",
    createdAt: created,
    updatedAt: created,
    status: "ready",
    meta: {
      title: "示範之歌",
      artist: "Livelyrics Band",
      album: "Stage Lab",
      year: 2026,
      duration: DEMO_DURATION,
      fileName: "demo-song.wav",
      mimeType: "audio/wav",
    },
    audioFile: "audio.wav",
    analysis: createDemoAnalysis(),
    lyrics: { source: "user", synced: true, lines: createDemoLines(), language: "zh-Hant" },
    research: {
      brief: "## 示範研究\n這是舞台實驗室內建的示範專案，用來預覽所有場景與歌詞樣式。",
      sources: [],
      engine: "offline",
      createdAt: created,
    },
    plan: createDemoPlan(),
  };
}

/** Colorway presets for the stage lab picker. */
export const DEMO_COLORWAYS: Array<{ id: string; label: string; colors: [string, string, string] }> = [
  { id: "plan", label: "依設計", colors: [DEMO_PALETTE.night, DEMO_PALETTE.indigo, DEMO_PALETTE.ember] },
  { id: "city", label: "城市夜色", colors: [DEMO_PALETTE.night, DEMO_PALETTE.indigo, DEMO_PALETTE.ember] },
  { id: "ember", label: "燈火", colors: ["#120806", "#ff6a3d", "#ffc857"] },
  { id: "jade", label: "青玉水墨", colors: [DEMO_PALETTE.ink, DEMO_PALETTE.jade, DEMO_PALETTE.gold] },
  { id: "neon", label: "霓虹", colors: ["#0d0718", "#7b3fe4", "#ff3d9a"] },
  { id: "ice", label: "冰川", colors: ["#050b12", "#3aa7d9", "#e8f7ff"] },
  { id: "rose", label: "玫瑰暮色", colors: ["#16070d", "#c2185b", "#ffb199"] },
  { id: "mono", label: "黑白", colors: ["#050505", "#9a9a9a", "#ffffff"] },
];
