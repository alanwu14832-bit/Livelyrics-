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

// ---------------------------------------------------------------------------
// 字體藝術 (phase 6): the song's typographic system and a composition hint per lyric line.
// Every line is a designed composition (recipe + seed), laid out deterministically by the type
// engine (src/lib/type) for any canvas. Plans without `typeSystem` keep the legacy lyric styles.
// ---------------------------------------------------------------------------

/** The song's typographic voice (字體語言). */
export const TYPE_VOICE_IDS = [
  "mv-card", // 日系 MV 字卡: extreme scale contrast, h/v mix, big negative space, snap cuts, 「」 as graphics
  "title-sequence", // 電影片頭／動態海報: type as shape, bleed, Swiss grid, rules and numbers, mask wipes
  "ink", // 書法與水墨: brush texture, writing-order reveals, vertical, kai faces, a red seal
  "glitch", // 實驗／故障感: slices, RGB split, echoes, overprint, grain, stutter on beats
] as const;
export const TypeVoiceIdSchema = z.enum(TYPE_VOICE_IDS);
export type TypeVoiceId = z.infer<typeof TypeVoiceIdSchema>;

/** Composition recipes: each lays a line out as a parameterized, seeded typographic composition. */
export const TYPE_RECIPE_IDS = [
  "giant-word", // 巨字＋小字: one word huge, the rest small hugging its edges
  "vertical-column", // 直排欄: one or two vertical columns on a grid column
  "cross", // 直橫交錯: one phrase vertical, the next horizontal, meeting at a corner
  "grid-poem", // 網格詩: characters on a strict cell grid (manuscript / Swiss grid)
  "bleed", // 出血: the key word so large it runs off the frame, the line readable beside it
  "scatter", // 散落: characters scattered along a reading path, seeded sizes and angles
  "poster", // 海報堆疊: rows stacked and justified to one width, heavy, with rules
  "window", // 鏤空窗: huge glyphs as a mask onto the scene, the frame filled around them
  "brush-write", // 書寫: a column written in reading order, optional 印章
  "echo", // 殘影: the phrase repeated as a fading trail
  "split", // 撕裂: sliced rows with offsets and RGB split, re-assembled at rest
  "whisper", // 低語: tiny and restrained, wide tracking, for quiet lines
  "title-card", // 片名卡: a centered title card between rules with a small Latin label
] as const;
export const TypeRecipeIdSchema = z.enum(TYPE_RECIPE_IDS);
export type TypeRecipeId = z.infer<typeof TypeRecipeIdSchema>;

export const TYPE_ORIENTATIONS = ["h", "v", "mixed"] as const;
export const TypeOrientationSchema = z.enum(TYPE_ORIENTATIONS);
export type TypeOrientation = z.infer<typeof TypeOrientationSchema>;

/** How the display type meets the scene (readable small text always stays solid). */
export const TYPE_COLOR_TREATMENTS = ["solid", "knockout", "overprint"] as const;
export const TypeColorTreatmentSchema = z.enum(TYPE_COLOR_TREATMENTS);
export type TypeColorTreatment = z.infer<typeof TypeColorTreatmentSchema>;

export const TYPE_ORNAMENT_IDS = [
  "rule", // hairline rules
  "number", // line / section numbers
  "section", // the section name as a small label
  "title", // the song title as a small label
  "seal", // a red seal stamp (印章)
  "bracket", // 「」 corner brackets as graphics
] as const;
export const TypeOrnamentIdSchema = z.enum(TYPE_ORNAMENT_IDS);
export type TypeOrnamentId = z.infer<typeof TypeOrnamentIdSchema>;

export const TYPE_ENTER_IDS = ["auto", "cut", "fade", "rise", "fall", "wipe", "write", "scale", "glitch", "bloom"] as const;
export const TypeEnterIdSchema = z.enum(TYPE_ENTER_IDS);
export type TypeEnterId = z.infer<typeof TypeEnterIdSchema>;

export const TYPE_EXIT_IDS = ["auto", "cut", "fade", "sink", "wipe", "dissolve", "scale", "glitch", "blur"] as const;
export const TypeExitIdSchema = z.enum(TYPE_EXIT_IDS);
export type TypeExitId = z.infer<typeof TypeExitIdSchema>;

/** The colour role of a line's main text: 主字色, 點綴色, 反白 (knocked out of an ink chip), 鏤空 (the scene through the glyphs). */
export const TYPE_COLOR_ROLES = ["ink", "accent", "invert", "window"] as const;
export const TypeColorRoleSchema = z.enum(TYPE_COLOR_ROLES);
export type TypeColorRole = z.infer<typeof TypeColorRoleSchema>;

export const TypeParamsSchema = z.object({
  scaleContrast: z.number().describe("0–1 字級對比：0 = 各字大小接近，1 = 巨字與小字的極端對比"),
  density: z.number().describe("0–1 留白與密度：0 = 大量留白，1 = 字填滿畫面"),
  verticalRatio: z.number().describe("0–1 直排比例：中文句子有多少比例用直排或直橫交錯（拉丁文字永遠橫排）"),
  gridColumns: z.number().describe("網格欄數，整數 2–12（瑞士網格常用 12，日系字卡常用 4–6）"),
  gridMargin: z.number().describe("0–1 網格邊界：0 = 貼齊安全區，1 = 很寬的邊界"),
  motionSpeed: z.number().describe("0–1 動態速度"),
  motionIntensity: z.number().describe("0–1 動態幅度"),
  texture: z.number().describe("0–1 質地：水墨＝暈染與飛白，故障＝切片與顆粒，其他＝細微顆粒"),
  ornament: z.number().describe("0–1 裝飾程度：線條、編號、段落名、歌名、印章出現的多寡"),
});
export type TypeParams = z.infer<typeof TypeParamsSchema>;

/** A composition hint for one lyric line, compact enough for an LLM to write for every line. */
export const TypeLineDraftSchema = z.object({
  lineId: z.string().describe("歌詞行 id，例如 l12"),
  recipe: TypeRecipeIdSchema,
  emphasis: z.array(z.string()).describe("這一行裡要放大或換成點綴色的字（逐字相同的片段），0–2 個"),
  orientation: TypeOrientationSchema.describe("h 橫排、v 直排、mixed 直橫交錯；拉丁文字的句子只能 h"),
  energy: z.number().describe("0–1 這一行的份量：安靜的句子約 0.2，主歌 0.4，副歌 0.7 以上，最後一次副歌最大"),
  motionWord: z.string().describe("驅動動態的意象詞，必須是這一行裡逐字相同的詞（例如 風、雨、火、心跳、浪、夜、光）；沒有就空字串"),
  seed: z.number().describe("整數 0–999：同一個 recipe 的不同構圖；重複的句子用同一個 seed"),
});
export type TypeLineDraft = z.infer<typeof TypeLineDraftSchema>;

/** What the 排版 editor changed on a line (every field optional; absent = the generated value). */
export const TypeLineEditSchema = z.object({
  recipe: TypeRecipeIdSchema.optional(),
  emphasis: z.array(z.string()).optional(),
  orientation: TypeOrientationSchema.optional(),
  motionWord: z.string().optional(),
  seed: z.number().optional(),
  /** nudge, fraction of the canvas width / height */
  dx: z.number().optional(),
  dy: z.number().optional(),
  /** size multiplier 0.5–2 */
  scale: z.number().optional(),
  /** degrees −30..30 */
  rotate: z.number().optional(),
  enter: TypeEnterIdSchema.optional(),
  exit: TypeExitIdSchema.optional(),
  color: TypeColorRoleSchema.optional(),
  /** 重點句 (phase 7): true = one of the few lines set large, false = never; absent = the song's choice */
  key: z.boolean().optional(),
});
export type TypeLineEdit = z.infer<typeof TypeLineEditSchema>;

export const TypeLineSchema = TypeLineDraftSchema.extend({
  /** 鎖定: 「重新生成全部構圖」 keeps this line (and its edit) as it is */
  locked: z.boolean().optional(),
  /** the editor's changes on top of the generated hint; null / absent = as generated */
  edit: TypeLineEditSchema.nullable().optional(),
});
export type TypeLine = z.infer<typeof TypeLineSchema>;

/** Section-level override written by the editor (null fields = follow the lines). */
export const TypeSectionSchema = z.object({
  sectionId: z.string(),
  recipe: TypeRecipeIdSchema.nullable().optional(),
  orientation: TypeOrientationSchema.nullable().optional(),
  /** size multiplier 0.6–1.6 */
  scale: z.number().nullable().optional(),
  /** motion intensity 0–1 */
  motion: z.number().nullable().optional(),
});
export type TypeSection = z.infer<typeof TypeSectionSchema>;

/** The song's 字體語言 as Claude writes it (no editor-only fields). */
export const TypeSystemDraftSchema = z.object({
  voice: TypeVoiceIdSchema,
  params: TypeParamsSchema,
  color: TypeColorTreatmentSchema.describe("solid 實色、knockout 鏤空（巨字變成看見場景的窗）、overprint 疊印（錯版的點綴色）"),
  fonts: z.object({
    cjk: FontIdSchema.describe("中文字體（必須是 CJK 字體 id）"),
    latin: FontIdSchema.describe("拉丁字體（英文歌詞、標籤與編號）"),
  }),
  weight: z.number().describe("字重 600–900（大螢幕至少 600）"),
  ornaments: z.array(TypeOrnamentIdSchema).describe("要出現的裝飾：rule 線條、number 編號、section 段落名、title 歌名、seal 印章（書法與水墨）、bracket 「」括號"),
  seal: z.string().describe("印章上的字（1–4 個中文字，通常是歌名或樂團名的一兩個字）；不用就空字串"),
  rationale: z.string().describe("為什麼是這個字體語言（繁體中文，1–2 句）"),
  lines: z
    .array(TypeLineDraftSchema)
    .describe("每一行歌詞一筆構圖（依歌詞順序）；完全相同的重複句可以只寫第一次，系統會沿用同一個構圖"),
});
export type TypeSystemDraft = z.infer<typeof TypeSystemDraftSchema>;

export const TypeSystemSchema = TypeSystemDraftSchema.extend({
  lines: z.array(TypeLineSchema),
  sections: z.array(TypeSectionSchema).optional(),
  /** bumped by 「重新生成全部構圖」 (a salt for the seeds) */
  generation: z.number().optional(),
});
export type TypeSystem = z.infer<typeof TypeSystemSchema>;

// ---------------------------------------------------------------------------
// 專屬畫面 (phase 7): one generative GLSL program per song, written for this song (Claude, or the
// offline composer), with per-section modes and the composition the typography is set into.
// The program is untrusted text: src/lib/stage/program/validate.ts checks it on the server and
// again in the browser, and the renderer wraps it in its own prelude (the uniform contract).
// ---------------------------------------------------------------------------

/** How the words meet the image in a section. */
export const TYPE_RELATIONS = [
  "plain", // the type sits in the negative space, nothing more
  "knockout", // the words cut the image: over its bright shapes they turn to the background tone
  "behind", // the words pass behind a foreground shape the program draws (gFront)
  "lit", // the image lights the words: the letters take the scene's light
] as const;
export const TypeRelationSchema = z.enum(TYPE_RELATIONS);
export type TypeRelation = z.infer<typeof TypeRelationSchema>;

/** A rectangle as fractions of the canvas (x, y from the top-left; y down). */
export const ZoneSchema = z.object({
  x: z.number().describe("0–1 left edge (fraction of the canvas width)"),
  y: z.number().describe("0–1 top edge (fraction of the canvas height, from the top)"),
  w: z.number().describe("0–1 width"),
  h: z.number().describe("0–1 height"),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const SceneProgramSectionSchema = z.object({
  sectionId: z.string().describe("the plan section id (s0, s1, …)"),
  mode: z.number().describe("integer 0–3: which state of the world this section shows (uMode)"),
  params: z.array(z.number()).describe("exactly 4 numbers 0–1 (uParams.xyzw): the section's own parameters"),
  zone: ZoneSchema.describe("where the lyrics sit in this section (the image's negative space)"),
  relation: TypeRelationSchema,
  note: z.string().describe("這一段畫面怎麼變、字放在哪裡（繁體中文，一句）"),
});
export type SceneProgramSection = z.infer<typeof SceneProgramSectionSchema>;

export const SCENE_PROGRAM_ENGINES = ["claude", "offline", "example", "manual"] as const;

export const SceneProgramSchema = z.object({
  version: z.literal(1),
  engine: z.enum(SCENE_PROGRAM_ENGINES),
  model: z.string().optional(),
  title: z.string(),
  concept: z.string(),
  /** the GLSL function body (helpers + `vec3 scene(vec2 fc)`), wrapped in the renderer's prelude */
  source: z.string(),
  sections: z.array(SceneProgramSectionSchema),
  /** song time of the key still (主視覺), seconds; null = the first chorus */
  keyMoment: z.number().nullable().optional(),
  /** false = the operator switched back to the built-in scenes (the program is kept) */
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  instruction: z.string().optional(),
  /** the offline composer's choices (form × texture × composition × motion), for the UI */
  recipe: z.string().optional(),
});
export type SceneProgram = z.infer<typeof SceneProgramSchema>;

export const DesignPlanSchema = z.object({
  version: z.literal(1),
  keyVisual: KeyVisualSchema,
  sections: z.array(SectionDesignSchema).describe("cover the whole song from 0 to duration without gaps, in time order"),
  lines: z.array(LineDesignSchema).describe("only lines that need special treatment; may be empty"),
  cues: z.array(CueNoteSchema).describe("3–12 operator cue notes in time order"),
  designerNotes: z
    .string()
    .describe("整體設計說明：敘事弧線、歌詞與動畫如何搭配、現場注意事項（繁體中文 Markdown，150–400 字）"),
  /** 字體藝術 (phase 6); absent / null on older plans (they keep the legacy lyric styles) */
  typeSystem: TypeSystemSchema.nullable().optional(),
  /** 專屬畫面 (phase 7); absent / null = the built-in scenes of each section */
  sceneProgram: SceneProgramSchema.nullable().optional(),
});
export type DesignPlan = z.infer<typeof DesignPlanSchema>;

// ---------------------------------------------------------------------------
// What automatic designers may write (Claude's structured output, the claude.ai template)
// ---------------------------------------------------------------------------

/**
 * Lyric styles an automatic designer may still choose. karaoke and subtitle stay valid for old
 * plans (and the operator's own choices) but no engine picks them any more: every line is a
 * designed composition, never a karaoke subtitle.
 */
export const AUTO_LYRIC_STYLE_IDS = LYRIC_STYLE_IDS.filter((id) => id !== "karaoke" && id !== "subtitle") as Exclude<LyricStyleId, "karaoke" | "subtitle">[];
export const AutoLyricStyleIdSchema = z.enum(AUTO_LYRIC_STYLE_IDS as [Exclude<LyricStyleId, "karaoke" | "subtitle">, ...Exclude<LyricStyleId, "karaoke" | "subtitle">[]]);

/** The DesignPlan Claude writes: the type system for every line, no karaoke / subtitle styles. */
export const DesignPlanDraftSchema = DesignPlanSchema.omit({ sceneProgram: true }).extend({
  sections: z
    .array(SectionDesignSchema.extend({ lyricStyle: AutoLyricStyleIdSchema.describe("舊版渲染器的後備樣式；有 typeSystem 時每一行都依它的構圖排版") }))
    .describe("cover the whole song from 0 to duration without gaps, in time order"),
  lines: z
    .array(LineDesignSchema.extend({ styleOverride: AutoLyricStyleIdSchema.nullable().describe("null = use section style") }))
    .describe("only lines that need special treatment; may be empty"),
  typeSystem: TypeSystemDraftSchema.describe("這首歌的字體語言與每一行歌詞的構圖（字體藝術）"),
});
