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
  strict, Tailwind v4 (design tokens in `src/app/globals.css`, see "Design system" below), `motion` v13
  (springs, `src/lib/motion.ts`), `@phosphor-icons/react` (icons).
- Read `node_modules/next/dist/docs/` before using Next APIs — this Next version differs from older
  ones (e.g. route `params` is a Promise; `PageProps<'/p/[id]'>` / `RouteContext` global helpers).
- `@anthropic-ai/sdk` (server only), `zod` v4, `music-metadata` (browser tag reading), `react-markdown`
  + `remark-gfm` (via `src/components/ui/Markdown.tsx`), `vitest` for unit tests (`src/**/*.test.ts`).
- **Do not add dependencies** (package.json is frozen during parallel work). WebGL is hand-written GLSL.
- UI language: **Traditional Chinese (繁體中文)** for all user-facing text.

## Shared contracts (already written — do not change without coordination)

| File | What |
|---|---|
| `src/lib/types.ts` | `Project`, `SongMeta`, `AudioAnalysis`, `Lyrics`/`LyricLine`, `Research`, `PipelineEvent` (incl. `attached`), `ProjectSummary` (accent, palette, error) |
| `src/lib/schema.ts` | zod `DesignPlanSchema` + closed vocabularies `SCENE_IDS`, `LYRIC_STYLE_IDS`, `LYRIC_PLACEMENTS`, `SECTION_KINDS`, `FONT_IDS` |
| `src/lib/stage/protocol.ts` | `StageState`, `StageOverrides`, `StageMessage`, `channelName()`, `StageStore`, `createStageStore()`, `stageTime()` |
| `src/lib/timeline.ts` | `lineIndexAt`, `lineSpan`, `lineProgress`, `sectionIndexAt`, `envelopeAt`, `beatPhaseAt`, `formatTime` (rounds to 1/100 s) |
| `src/lib/fonts.ts` | next/font loading (`fontVariables`); re-exports `src/lib/font-meta.ts` |
| `src/lib/font-meta.ts` | `FONTS` registry + `fontStack(cjkFont, latinFont)` without next/font, so server code and tests can import it |
| `src/lib/api-client.ts` | typed browser fetchers for every API route (routes must match exactly) |
| `src/components/ui/*` | the component kit (see "Component kit" below); `Button`, `Panel`, `Badge`, `Kbd`, `cx`, `Markdown` keep their old signatures |

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
  An attaching request first receives `{ type: "attached", steps, sameRequest }` (its own settings are
  not applied when `sameRequest` is false). `ProcessRequest.attachOnly` only watches: it attaches to the
  active (or just-finished) run and otherwise ends at once with `done` (ready) or `error` — it never
  starts a run. A failed step ends with `{ type: "error" }` only; earlier steps stay saved, so clients
  re-fetch the project after a rejection.
- Lyrics saves (PATCH `lyrics`, pipeline lyrics step) re-number ids `l0..`; `plan.lines[]` is re-pointed
  to the line with the same text (`src/lib/lyrics/remap.ts`) and dropped when that text is gone.
  PATCH `plan` is validated (`DesignPlanSchema`, ≥ 1 section), not normalized, so operator edits stay
  exactly as made; the renderer repairs anything out of range.
- All route handlers: `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`; JSON errors
  `{ error: string }` with proper status codes; validate ids (no path traversal); size limit ~200 MB.
  Route context is typed explicitly (`{ params: Promise<{ id: string }> }`).

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

## Design system

Operator UI only (home, process, lyrics editor, console, stage-lab chrome). The projection output and
`src/components/stage/**` never use it. Spec and rationale: `docs/UI-AUDIT.md` §3 (Apple website + iOS HIG).

- **Appearance.** `:root` is light (apple.com) and follows `prefers-color-scheme: dark` unless the root has
  `data-theme="light"`. `data-theme="light" | "dark" | "console"` on any element scopes a theme to that
  subtree. The console page wrapper (`src/app/p/[id]/page.tsx`) is `data-theme="console"` (always dark,
  desktop density), `/stage-lab` is `data-theme="dark"`; `html` follows a page-level scope via `:has()`.
  Every scope declares `color-scheme`.
- **Colour tokens** (CSS custom properties, utilities via `@theme inline` so nested scopes work): `--bg
  --surface --surface-2 --surface-3 --elevated`, labels `--label --label-2` (all readable secondary text)
  `--label-3 --label-4` (non-text only), fills `--fill .. --fill-4`, `--separator`, tint (systemBlue, the
  only accent) `--tint` (non-text) `--tint-fill` (button base) `--tint-text` `--tint-text-on-soft`
  `--tint-soft` `--on-tint`, semantic `--red* --orange* --yellow --green --green-switch` (red = blackout,
  on-air, recording, error, delete; orange = warning, waiting; green = connected, done, on),
  `--segment-thumb`, `--scrim`, materials `--material-thin|regular|thick` + `--blur-*`, shadows
  `--shadow-card|lift|overlay|sheet|thumb`, `--hairline` (1 px, 0.5 px on 2x), spacing `--space-*`,
  `--page-gutter --group-gap --row-min-h --row-pad-x`. Utilities: `bg-surface`, `text-label-2`,
  `bg-tint-soft`, `text-red-text` and so on. Code that needs a raw value writes `var(--token)`.
- **No aliases.** The stage-1 transitional names (`bg-panel*`, `border-line`, `text-fg`, `text-muted`,
  `text-faint`, `*-accent*`, `*-ok`, `*-warn`, `*-danger`) were removed in stage 5; use the token names.
  `--focus-ring` is re-resolved in every `[data-theme]` scope, so a nested dark scope gets the dark ring.
  `--header-gutter` (16 px) is the inset of every full-width top bar.
- **Canvas** code reads tokens from its own element, never from `document.documentElement`, and re-reads on
  appearance changes: `readTokens`, `tokenAlpha`, `subscribeAppearance` in `src/lib/ui/canvas-tokens.ts`.
- **Type.** `--font-ui` (SF / PingFang TC, then the bundled Noto Sans TC, `font-sans`), `--font-numeric`
  (time codes, `font-numeric` adds tabular-nums), `--font-code` (`font-mono`: colour codes, LRC only). The
  stage fonts (`FONTS`, `fontStack()`) are separate; the raw `--font-sans` / `--font-mono` variables keep
  the stage's pre-redesign values outside the console, because the stage overlays read them directly. Scale:
  `text-hero text-large-title text-title-1..3 text-intro text-headline text-body text-callout
  text-subheadline text-footnote text-caption text-caption-2`; console `text-c-caption text-c-footnote
  text-c-body text-c-headline text-c-title text-c-clock text-c-now`. CJK text has 0 tracking (never
  positive, never uppercase); `t-latin` applies the size-specific SF tracking to Latin / digits; `tabular`
  for any number that changes. Minimum 11 px.
- **Radius:** `rounded-xs 6 / sm 8 / md 10 / lg 12 / xl 14 / 2xl 20 / 3xl 28 / pill 980` (px).
- **Surfaces:** `material-thin|regular|thick` (solid under reduced transparency, increased contrast, or no
  backdrop-filter support; never on the console top bar, panes or dialog scrims), `border-hairline`,
  `border-t|b|l|r-hairline`, `divide-y-hairline`, `ring-hairline`, `scroll-edge`, `shadow-*`.
- **States:** `press` (scale .97 in 80 ms, springs back on release), `press-tile` (.98), `press-fade`
  (opacity .6), `focus-inset`, `row-current` (the one current-row look: 3 px tint bar, tint-soft, 600),
  `row-standby`, `row-selected`, `skeleton` (static, appears after 300 ms), `reveal-on-scroll`
  (scroll-driven, rare moments). Focus ring: global 2 px tint `:focus-visible`, offset 2, never transitioned
  (outline colour is constant on every element); listbox rings the `aria-selected` option.
- **Motion:** `--ease-out --ease-in-out --ease-drawer --ease-spring` (critically damped `linear()` spring,
  `--dur-spring` 500 ms) and `--ease-spring-snappy` (`--dur-spring-snappy` 350 ms) are Tailwind `ease-*`
  utilities; `--dur-press|release|fast|base|exit|toast|page` via `duration-(--dur-fast)`. Always name the
  curve (`ease-[ease]` for hover and colour, 150 ms); Tailwind's default timing is left as shipped because
  the projection window relies on it; never `transition-all`. Loops: only `animate-spinner` (Phosphor
  Spinner, steps(8)); `animate-caret` (streaming text) and the one-shot `animate-halo` stop under reduced
  motion. JS: `spring`, `springSnappy`, `springMomentum`, `fadeReduced`, `motionFor()`, `scrollBehavior()`,
  `staggerDelay()` and gesture physics (`projectMomentum`, `rubberband`, `rubberbandClamp`,
  `createVelocityTracker`, `shouldDismiss`) in `src/lib/motion.ts`. Keyboard-triggered changes never
  animate; the console animates DOM with CSS only. Real-CSS primitives: `dialog.ui-sheet`, `dialog.ui-alert`
  (materialize: opacity + scale + blur), `dialog.ui-instant`, `.ui-popover`, `input.ui-slider` (set `--p`).
  View transitions (React `<ViewTransition>`): classes `push` / `pop` (page wrappers, links with
  `transitionTypes={["push"]}` / `["pop"]`), `xfade-forward` / `xfade-back` (same-route content), `morph`
  (shared elements, e.g. `project-art-<id>`), `view-transition-name: app-header` anchors the header; all
  become a 150 ms cross-fade under reduced motion.
- **Component kit** (`src/components/ui/`, demo of every state in the dev-only `/ui-lab`, `?theme=` and
  `?section=` narrow it). `index.tsx` is a barrel without `"use client"`: server components can import the
  hook-free parts. Button (filled, tinted, gray, plain, quiet, destructive, destructive-filled; `href` renders
  next/link; `type` defaults to `"button"`, so submit buttons pass `type="submit"`), InsetGroup / ListRow /
  FormRow, SegmentedControl, Switch, Slider, Stepper, Alert and Sheet (native `<dialog>`), Menu and Popover
  (Popover API; `MenuItem` takes `href` + `transitionTypes`), Tooltip, Toast stack (`useToasts`), Banner,
  Tag, StatusCapsule(s), Kbd, Spinner, ProgressBar, EmptyState, Skeleton, Disclosure, TextField / TextArea /
  Select, AppHeader (page and console variants; `heading` replaces title / subtitle), HUD, IconProvider
  (wrapped once in `src/app/layout.tsx`). Icons: `@/components/ui/Icon` (Phosphor, sizes and weights built
  in); the kit itself only imports `kit-icons.tsx`. The z-index scale is `src/lib/ui/z.ts`.
- **Project page chrome.** `src/components/home/ProjectHeading.tsx` is the one thumbnail + title block after
  「‹ 作品庫」 on the design overview, the lyrics editor and the console (same x on all three, shared-element
  names `project-art-<id>` / `project-title-<id>`); `ProjectNotFound.tsx` is the one not-found body under
  each page's header. The lyrics editor's 外觀 choice is applied to `<html>` before first paint by the inline
  script in `src/app/layout.tsx` (`src/components/lyrics-editor/appearance-script.ts`).
- **Preferences:** `prefers-reduced-motion` (no scroll smoothing, no decorative offsets, spring becomes a
  150 ms fade), `prefers-reduced-transparency` (no backdrop-filter anywhere), `prefers-contrast: more`
  (opaque separators, secondary text = label, 3 px focus ring), `forced-colors` (selection has an outline).

## Development notes

- `npm run typecheck` runs `next typegen` first, so the global `PageProps` / `LayoutProps` /
  `RouteContext` helpers exist on a fresh clone.
- Isolated dev servers (`NEXT_DIST_DIR=.next-<name> npx next dev --webpack -p <port>`) are ignored by
  ESLint and git, but `next dev` appends `.next-<name>/types/**` entries to `tsconfig.json` (it checks
  for exact strings, so a glob does not stop it). Restore `tsconfig.json` from git after stopping one.
