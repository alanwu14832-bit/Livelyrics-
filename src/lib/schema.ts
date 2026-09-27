// The DesignPlan is the contract between the AI "stage visual designer" and the
// stage renderer. Claude fills it via structured outputs (zodOutputFormat), the
// offline designer fills it heuristically, and the renderer / console consume it.
//
// Structured-output friendly rules: every field is required (use nullable instead
// of optional), numeric ranges live in .describe() text, and enums are closed.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Closed vocabularies the renderer implements
// ---------------------------------------------------------------------------

export const SCENE_IDS = [
  "nebula", // flowing fbm clouds / smoke of color
  "particles", // drifting particle field / starfield that pulses with beats
  "waves", // layered sine ribbons / oscilloscope lines
  "grid", // retro perspective grid with horizon glow (synthwave)
  "tunnel", // radial tunnel of rings rushing toward the viewer
  "rain", // vertical light streaks / rain / falling lines
  "bokeh", // soft out-of-focus light orbs
  "shards", // voronoi cells / stained glass / broken glass
  "ink", // high-contrast domain-warped ink flow
  "motif", // the key-visual SVG motif, tiled / orbiting / pulsing
  "gradient", // calm minimal gradient field, lets lyrics lead
  "blackout", // pure black (intentional darkness)
] as const;
export const SceneIdSchema = z.enum(SCENE_IDS);
export type SceneId = z.infer<typeof SceneIdSchema>;

export const LYRIC_STYLE_IDS = [
  "karaoke", // full line visible, fill sweeps word by word
  "line-fade", // whole line fades/blur-in, fades out
  "word-pop", // words appear one by one with a scale pop
  "typewriter", // characters appear sequentially
  "stack", // lines stack and drift upward like a poem, older lines dim
  "vertical", // vertical CJK columns (writing-mode: vertical-rl)
  "impact", // huge bold words filling the screen, few at a time (hooks, chants)
  "subtitle", // small, calm lower-third subtitle; visuals lead
  "hidden", // no lyrics shown
] as const;
export const LyricStyleIdSchema = z.enum(LYRIC_STYLE_IDS);
export type LyricStyleId = z.infer<typeof LyricStyleIdSchema>;

export const LYRIC_PLACEMENTS = [
  "center",
  "lower-third",
  "upper-third",
  "left",
  "right",
  "vertical-right",
  "vertical-left",
] as const;
export const LyricPlacementSchema = z.enum(LYRIC_PLACEMENTS);
export type LyricPlacement = z.infer<typeof LyricPlacementSchema>;

export const SECTION_KINDS = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "bridge",
  "solo",
  "breakdown",
  "outro",
  "interlude",
] as const;
export const SectionKindSchema = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof SectionKindSchema>;

/** Fonts bundled via next/font (see src/lib/fonts.ts). */
export const FONT_IDS = [
  "noto-sans-tc", // 思源黑體 — neutral, highly legible
  "noto-serif-tc", // 思源宋體 — literary, elegant
  "lxgw-wenkai-tc", // 霞鶩文楷 — warm handwritten kai
  "huninn", // 粉圓 — rounded, friendly
  "chiron-hei-hk", // 昭源黑體 — modern bold sans
  "iansui", // 芫荽 — playful hand-lettered
  "cactus-classical-serif", // 仙人掌明體 — classical old-style serif
  "bebas-neue", // latin condensed display caps
  "anton", // latin heavy condensed
  "space-grotesk", // latin geometric grotesk
  "playfair-display", // latin high-contrast serif
] as const;
export const FontIdSchema = z.enum(FONT_IDS);
export type FontId = z.infer<typeof FontIdSchema>;

/** How band material (album art, photos, MV clips, logo) is treated on screen. */
export const MEDIA_TREATMENTS = [
  "full", // the material as is (fit / opacity / blend still apply)
  "duotone", // luminance mapped onto the section colorway (background -> primary)
  "grain-film", // desaturated, palette-tinted, heavy film grain, gate weave, flicker
  "blur-glow", // soft out-of-focus glow, highlights bloom (dreamy, lets lyrics lead)
  "halftone", // printed halftone dots in the colorway (poster / zine look)
  "mask-lyrics", // full-bleed, knocked back to the background tone where lyrics sit while a line shows
  "slow-drift", // Ken Burns: slow zoom and pan across the section
  "beat-cut", // jumps to a new crop / clip offset on every beat, punch on the downbeat
] as const;
export const MediaTreatmentSchema = z.enum(MEDIA_TREATMENTS);
export type MediaTreatment = z.infer<typeof MediaTreatmentSchema>;

export const MEDIA_FITS = ["cover", "contain"] as const;
export const MEDIA_BLENDS = ["normal", "screen", "multiply", "overlay"] as const;

export const SectionMediaSchema = z.object({
  assetId: z.string().describe("id of one of the provided band assets (exact)"),
  treatment: MediaTreatmentSchema,
  fit: z.enum(MEDIA_FITS).describe("cover = fill the screen (crop), contain = whole image visible"),
  opacity: z.number().describe("0–1 layer opacity over the scene"),
  blend: z.enum(MEDIA_BLENDS).describe("how the material mixes with the scene underneath"),
});
export type SectionMedia = z.infer<typeof SectionMediaSchema>;

/** `media` is new: plans saved before it existed have no key, which means "no media". */
const SectionMediaField = z
  .preprocess((v) => (v === undefined ? null : v), SectionMediaSchema.nullable())
  .describe("band material shown between the scene and the lyrics in this section; null = scene only");

const hex = z
  .string()
  .describe("CSS hex color like #1a2b3c (6 digits, lowercase)");

// ---------------------------------------------------------------------------
// Plan pieces
// ---------------------------------------------------------------------------

export const KeyVisualSchema = z.object({
  title: z.string().describe("主視覺概念名稱（繁體中文，4–12 字）"),
  concept: z
    .string()
    .describe("主視覺概念敘述：這首歌在舞台上是一個什麼樣的世界、為什麼（繁體中文，3–6 句）"),
  moodKeywords: z.array(z.string()).describe("3–6 個情緒/質感關鍵字（繁體中文）"),
  palette: z
    .array(
      z.object({
        hex,
        role: z.string().describe("色彩角色，例如：背景、主色、點綴、歌詞、高光"),
        name: z.string().describe("顏色的詩意名稱（繁體中文）"),
      }),
    )
    .describe("4–6 colors. First = deepest background tone, include one high-contrast color for lyrics."),
  motifs: z
    .array(z.string())
    .describe("2–5 visual motifs drawn from band identity / album art / lyric imagery (繁體中文短語)"),
  motifSvg: z
    .string()
    .describe(
      "One self-contained SVG (viewBox=\"0 0 100 100\") of a simple emblem/motif for this song: only <svg>, <g>, <path>, <circle>, <rect>, <polygon>, <polyline>, <line>, <ellipse>; use fill/stroke=\"currentColor\"; no text, no scripts, no external refs, under 2500 characters.",
    ),
  typography: z.object({
    cjkFont: FontIdSchema.describe("Font for Chinese/Japanese lyric text (a CJK-capable id)"),
    latinFont: FontIdSchema.describe("Font for Latin text"),
    weight: z.number().describe("CSS font-weight 300–900; big screens need 600+"),
    letterSpacing: z.number().describe("em, typically -0.02 to 0.2"),
    rationale: z.string().describe("為什麼選這組字體（繁體中文，1–2 句）"),
  }),
});
export type KeyVisual = z.infer<typeof KeyVisualSchema>;

export const SectionDesignSchema = z.object({
  id: z.string().describe("s0, s1, ... in time order"),
  kind: SectionKindSchema,
  label: z.string().describe("顯示用段落名，例如「主歌一」「副歌」「間奏」"),
  start: z.number().describe("seconds"),
  end: z.number().describe("seconds"),
  energy: z.number().describe("0–1 perceived energy of this section"),
  scene: SceneIdSchema,
  sceneParams: z.object({
    speed: z.number().describe("0–1 motion speed"),
    density: z.number().describe("0–1 amount of elements"),
    intensity: z.number().describe("0–1 overall brightness/contrast"),
    audioReactivity: z.number().describe("0–1 how strongly the scene pulses with the music"),
  }),
  colorway: z.array(hex).describe("exactly 3 hex colors from the palette: [background, primary, accent]"),
  lyricStyle: LyricStyleIdSchema,
  lyricPlacement: LyricPlacementSchema,
  lyricScale: z.number().describe("0.6–1.8 relative lyric size (1 = default readable size)"),
  lyricColor: hex.describe("lyric text color, must contrast ≥ 4.5:1 with colorway[0]"),
  transitionIn: z.enum(["cut", "fade", "flash", "wipe", "bloom"]),
  media: SectionMediaField,
  rationale: z.string().describe("設計理由：為什麼這段用這個場景與歌詞呈現（繁體中文，1–3 句）"),
});
export type SectionDesign = z.infer<typeof SectionDesignSchema>;

export const LineDesignSchema = z.object({
  lineId: z.string().describe("id of the lyric line, e.g. l12"),
  emphasis: z.array(z.string()).describe("words/characters in this line to emphasize (exact substrings)"),
  styleOverride: LyricStyleIdSchema.nullable().describe("null = use section style"),
  note: z.string().describe("簡短說明（繁體中文），可為空字串"),
});
export type LineDesign = z.infer<typeof LineDesignSchema>;

export const CueNoteSchema = z.object({
  time: z.number().describe("seconds"),
  title: z.string().describe("操作提示標題（繁體中文，短）"),
  detail: z.string().describe("給現場視覺操作員的提示（繁體中文，1–2 句）"),
  kind: z.enum(["drop", "singalong", "quiet", "transition", "highlight", "warning"]),
});
export type CueNote = z.infer<typeof CueNoteSchema>;

export const DesignPlanSchema = z.object({
  version: z.literal(1),
  keyVisual: KeyVisualSchema,
  sections: z.array(SectionDesignSchema).describe("cover the whole song from 0 to duration without gaps, in time order"),
  lines: z.array(LineDesignSchema).describe("only lines that need special treatment; may be empty"),
  cues: z.array(CueNoteSchema).describe("3–12 operator cue notes in time order"),
  designerNotes: z
    .string()
    .describe("整體設計說明：敘事弧線、歌詞與動畫如何搭配、現場注意事項（繁體中文 Markdown，150–400 字）"),
});
export type DesignPlan = z.infer<typeof DesignPlanSchema>;
