# Livelyrics — Architecture & Module Contracts

Livelyrics is a **local web app** a band's visual operator runs on their own laptop:

1. **Upload** an audio file → the browser analyses it (tempo, beats, energy, sections, waveform).
2. The server **researches** the song & band with Claude (web search) acting as the band's
   dedicated stage-visual designer, then **designs** a `DesignPlan`: key visual (主視覺), palette,
   motif, typography, per-section scene + lyric presentation, cue notes.
3. The **operator console** (`/p/[id]`) shows everything (lyrics, timeline, design rationale, research,
   cue notes, controls, live preview) and lets the operator play/seek/jump lyrics/override.
4. The **projection output** (`/p/[id]/output`, a second browser window on the projector) shows
   **only animation + lyrics**, driven by the console over a `BroadcastChannel`.

Research basis: `reports/音樂祭大螢幕歌詞與視覺設計.md` (industry practice). Key principles that must
show up in the product:

- 視覺是配角、托起樂團：visuals support the band; lyrics are shown **selectively and styled as part of
  the artwork**, not as a karaoke subtitle for the whole song. Each section decides the screen's role
  (imagery / lyrics / light).
- A show "world" (世界觀) first: key visual → palette & motifs → per-section imagery from lyrics.
- Readability on big screens: bold weights (600+), contrast ≥ 4.5:1, ≤ 2 lines, ~16 CJK chars/line,
  avoid clutter; keep lyrics out of the singer's IMAG zone; safe area ~90%.
- Sync is layered: timecode-like track playback **+ always a manual fallback** (live cueing), a one-key
  blackout, and nothing that can crash the output. Real-time AI is not used during the show; all
  generation happens before the show, playback is deterministic.

## Tech

- Next.js 16 App Router (webpack: `npm run dev` / `npm run build` use `--webpack`), React 19, TypeScript
  strict, Tailwind v4 (tokens in `src/app/globals.css`: `bg-bg bg-panel bg-panel-2 bg-panel-3 border-line
  text-fg text-muted text-faint text-accent bg-accent text-accent-2 text-ok text-warn text-danger`).
- Read `node_modules/next/dist/docs/` before using Next APIs — this Next version differs from older
  ones (e.g. route `params` is a Promise; `PageProps<'/p/[id]'>` / `RouteContext` global helpers).
- `@anthropic-ai/sdk` (server only), `zod` v4, `music-metadata` (browser tag reading), `react-markdown`
  + `remark-gfm` (via `src/components/ui/Markdown.tsx`), `vitest` for unit tests (`src/**/*.test.ts`).
- **Do not add dependencies** (package.json is frozen during parallel work). WebGL is hand-written GLSL.
- UI language: **Traditional Chinese (繁體中文)** for all user-facing text.

## Shared contracts (already written — do not change without coordination)

| File | What |
|---|---|
| `src/lib/types.ts` | `Project`, `SongMeta`, `AudioAnalysis`, `Lyrics`/`LyricLine`, `Research`, `PipelineEvent` |
| `src/lib/schema.ts` | zod `DesignPlanSchema` + closed vocabularies `SCENE_IDS`, `LYRIC_STYLE_IDS`, `LYRIC_PLACEMENTS`, `SECTION_KINDS`, `FONT_IDS` |
| `src/lib/stage/protocol.ts` | `StageState`, `StageOverrides`, `StageMessage`, `channelName()`, `StageStore`, `createStageStore()`, `stageTime()` |
| `src/lib/timeline.ts` | `lineIndexAt`, `lineSpan`, `lineProgress`, `sectionIndexAt`, `envelopeAt`, `beatPhaseAt`, `formatTime` |
| `src/lib/fonts.ts` | next/font loading, `FONTS` registry, `fontStack(cjkFont, latinFont)` |
| `src/lib/api-client.ts` | typed browser fetchers for every API route (routes must match exactly) |
| `src/components/ui/*` | `Button`, `Panel`, `Badge`, `Kbd`, `cx`, `Markdown` |

Cross-module stubs (owner replaces the implementation, **keeps the exported signatures**):
`src/lib/audio/{analyze,metadata,live}.ts` (AUDIO), `src/components/stage/StageView.tsx` (STAGE),
`src/lib/lyrics/lrc.ts` (SERVER), `src/lib/server/designer/index.ts` (DESIGNER).

## Routes

| Route | Owner | Purpose |
|---|---|---|
| `/` | HOME | project library + upload dropzone + server status |
| `/p/[id]/process` | HOME | runs/observes the pipeline with live progress, then hands off to the console |
| `/p/[id]/lyrics` | HOME | lyrics editor: import/paste/LRCLIB pick, tap-sync, nudge, auto-distribute |
| `/p/[id]` | CONSOLE | operator console |
| `/p/[id]/output` | STAGE | projection window — animation + lyrics only |
| `/stage-lab` | STAGE | dev gallery of every scene × lyric style with a demo plan |
| `/api/status` | SERVER | `{ claude, model, dataDir }` |
| `/api/projects` GET/POST | SERVER | list summaries / create (multipart `audio`, `meta` JSON, `analysis` JSON) |
| `/api/projects/[id]` GET/PATCH/DELETE | SERVER | project JSON / patch `{meta?, lyrics?, plan?}` / delete |
| `/api/projects/[id]/audio` GET | SERVER | stored audio with **HTTP Range** support (seeking) |
| `/api/projects/[id]/process` POST | SERVER | SSE stream of `PipelineEvent`, body `ProcessRequest` |
| `/api/lyrics/search` GET | SERVER | LRCLIB proxy → `{ results: LyricsSearchResult[] }` |

Data lives in `process.env.LIVELYRICS_DATA_DIR ?? <cwd>/data/projects/<id>/{project.json,audio.<ext>}`.

## Modules

### SERVER — `src/lib/server/**` (except `designer/`), `src/lib/lyrics/**`, `src/app/api/**`
- Storage with atomic JSON writes, list summaries (accent = plan palette[1] or [0]), delete folder.
- LRC/plain parsing & serialization, `distributeLines`, `normalizeLyrics` (ids `l0..`, `synced`).
- LRCLIB client (`https://lrclib.net/api/search`, `/api/get`), `User-Agent: Livelyrics/0.1 (+https://github.com/alanwu14832-bit/Livelyrics-)`,
  prefer synced results whose duration is within ±3 s; timeout + graceful failure.
- Pipeline `lyrics → research → design`, saving the project after each step; status
  `processing` → `ready` | `error`. Per-project **in-memory run registry**: a POST while a run is active
  attaches to it (replays past events, then streams live) — survives page refresh / React StrictMode.
  A run keeps going if the client disconnects. Steps: lyrics uses `lyricsText` if given, else keeps
  existing synced lyrics, else LRCLIB, else plain → `distributeLines`; research/design call DESIGNER.
- All route handlers: `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`; JSON errors
  `{ error: string }` with proper status codes; validate ids (no path traversal); size limit ~200 MB.

### DESIGNER — `src/lib/server/designer/**`
- `researchSong`: Claude (`LIVELYRICS_MODEL` default `claude-opus-5`), server tool `web_search_20260209`,
  adaptive thinking, streaming, `pause_turn` continuation (≤ 5), refusal handling, server-side
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Writes a Traditional-Chinese Markdown
  brief as the band's stage-visual designer: band identity & visual history (album art, MVs, logos,
  colors, past stage shows), song meaning/imagery, mood/energy arc, reference live moments; returns
  sources. Must not reproduce full copyrighted lyrics in the brief.
- `designSong`: a second Claude call with structured outputs (`DesignPlanSchema`) using the research,
  lyrics (with line ids + times), audio analysis summary (bpm, energy curve, section guesses), the
  closed scene/lyric-style vocabularies with descriptions, typography rules and the principles above;
  supports `instruction` + `previous` for re-design. Always passes the result through `normalizePlan`.
- Offline designer (no credential or Claude failure): deterministic heuristic plan from analysis +
  lyric repetition (chorus detection), palette from mood & a stable hash, generated geometric motif SVG.
- `normalizePlan`: clamp numbers, sort & cover `0..duration` with no gaps, colorway length 3, valid
  hex, WCAG contrast fix for `lyricColor`, CJK font must be CJK, drop unknown `lineId`s, sanitize
  `motifSvg` with a strict allowlist (fallback emblem).
- Only the SDK may call Anthropic. Never log API keys.

### AUDIO — `src/lib/audio/**`
- `analyzeSamples(mono, sampleRate)` pure & deterministic: STFT (own FFT), RMS energy, spectral-flux
  onset, centroid brightness, bass band, tempo (autocorrelation of onset envelope, 70–180 BPM with
  octave-error handling), beat tracking (DP), novelty segmentation (min section ~8 s), waveform peaks
  (~2000 buckets), envelopes at `envelopeRate` 20 Hz normalized 0..1.
- `analyzeFile(file, onProgress)`: decode with Web Audio, downmix, run in a Web Worker
  (`new Worker(new URL("./analyze.worker.ts", import.meta.url))`), fall back to main thread.
- `readAudioMetadata(file)` via `music-metadata` `parseBlob`, fallback to file-name parsing.
- `live.ts`: `createMediaElementAnalyser(el)` (cached per element; must not break normal playback
  — connect analyser → destination), `createMicAnalyser()`, tap tempo; features 0..1.
- Unit tests with synthetic signals (click track tempo, loud/quiet section boundaries).

### STAGE — `src/components/stage/**`, `src/lib/stage/**` (except protocol.ts), `src/app/p/[id]/output/**`, `src/app/stage-lab/**`
- `<StageView project store showGuides renderScale />`: WebGL scene layer + DOM lyric layer +
  blackout/transition overlay + optional test pattern & safe-area guides. Reads `store.get()` in a
  rAF loop (no React re-render per frame). Extrapolates time with `stageTime()`.
- One GLSL fragment shader per `SceneId` sharing uniforms (time, resolution, 3 colorway colors,
  speed, density, intensity, reactivity, live level/bass/onset, beat phase, analysis energy at t,
  motif texture). Section changes transition per `transitionIn` (cut/fade/flash/wipe/bloom).
  Overrides: scene, freeze, intensity, blackout (smooth ~0.4 s fade). Handles context loss, resize,
  devicePixelRatio, never throws into React.
- Lyric layer implements every `LyricStyleId` & `LyricPlacement`, plan typography via `fontStack`,
  emphasis words, translations, CJK line breaking (~16 chars, punctuation rules), fit-to-safe-area,
  legibility shadow/outline, word timing synthesized when `line.words` is absent, live-cued lines use
  `lineStartedAt`. Per-line `styleOverride` from `plan.lines`.
- Output page: fullscreen black, no chrome, cursor auto-hide, F / double-click fullscreen, sends
  `hello`, answers `ping` with `pong`, applies `project`/`state`; loads the project via API as a
  fallback so it can show the key visual idle frame before the console connects.

### CONSOLE — `src/app/p/[id]/page.tsx`, `src/components/console/**`, `src/lib/console/**`
- Controller: owns the `<audio>` (src `api.audioUrl(id)`), modes **track** (time = audio time + offset)
  and **live** (operator cues lines; virtual time jumps to the cued line's start and runs until the next
  line's start; optional mic analyser + tap tempo), computes line/section, publishes `StageState`
  (30 Hz while playing, immediately on change), heartbeat, output-connection status, sends `project`
  on `hello` and after edits. Offset persisted per project in localStorage.
- Layout (dense, dark, keyboard-first): top bar (title/artist, mode switch, transport, time, output
  status + open-output button, redesign), left lyrics list (section-colored, current/next highlight,
  click = jump/cue), center live preview (`StageView`, aspect of the output window) + big
  current/next line, bottom timeline (waveform, section blocks, lyric ticks, cue markers, playhead,
  click/drag seek), right tabbed panel (設計 key visual & section rationale & quick per-section edits /
  研究 brief & sources / 控制 overrides / 同步 offset, BPM, tap, mic).
- Hotkeys (shown in a `?` overlay): Space play/pause (live: next line), →/↓ next line, ←/↑ previous line,
  Enter cue selected, B blackout, L lyrics on/off, F freeze, 1–9 scene override, 0 follow plan,
  [ / ] offset −/+ 0.05 s, T tap tempo, O open output, M mode switch, ? help.
- Re-design dialog: free-text instruction → `api.process(id, {steps:["design"], instruction})` with
  streamed progress; then broadcast the new project.

### HOME — `src/app/page.tsx`, `src/app/p/[id]/process/**`, `src/app/p/[id]/lyrics/**`, `src/components/{home,upload,process,lyrics-editor}/**`
- Home: brand header, server status (Claude connected vs offline designer + how to set
  `ANTHROPIC_API_KEY` in `.env.local`), dropzone → metadata + analysis progress → editable song info
  + lyrics option (auto / paste) → create → `/p/[id]/process`. Library cards with accent, status,
  open / re-process / delete.
- Process page: step timeline, streamed research (Markdown), search chips, logs, error + retry, and a
  final key-visual summary (palette, concept, motif) with "進入控制台" / "編輯歌詞".
- Lyrics editor: table of lines (time, text, translation), paste / import LRC / LRCLIB picker,
  tap-sync mode (play, Space marks the current line start and advances), ±0.1 s nudge, auto-distribute,
  export LRC, save → `api.updateProject`, offer to re-run design.
