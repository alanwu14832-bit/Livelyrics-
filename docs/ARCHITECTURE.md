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

The same app also runs on Vercel in **cloud mode** (Postgres documents, Vercel Blob files, one pipeline
step per request, optional password gate); see "Cloud mode (Vercel)" below. Local mode is the default and
unchanged.

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
  Exception agreed for phase 1b: `mediabunny` (MP4 / WebM muxing for the video export, browser only).
  Cloud mode: `@vercel/blob` (server: head / del; browser: `@vercel/blob/client` upload), `@neondatabase/serverless`
  (server, SQL over HTTP), dev only `@electric-sql/pglite` (Postgres in WASM for the tests).
- UI language: **Traditional Chinese (繁體中文)** for all user-facing text.

## Shared contracts (already written — do not change without coordination)

| File | What |
|---|---|
| `src/lib/types.ts` | `Project`, `SongMeta`, `AudioAnalysis`, `Lyrics`/`LyricLine`, `Research`, `PipelineEvent` (incl. `attached`), `ProjectSummary` (accent, palette, error) |
| `src/lib/schema.ts` | zod `DesignPlanSchema` + closed vocabularies `SCENE_IDS`, `LYRIC_STYLE_IDS`, `LYRIC_PLACEMENTS`, `SECTION_KINDS`, `FONT_IDS` |
| `src/lib/stage/protocol.ts` | `StageState`, `StageOverrides`, `StageMessage`, `channelName()`, `showChannelName()`, `StageTransition`, `LimiterReport` (phase 3), `parseStageMessage()`, `StageStore`, `createStageStore()`, `stageTime()` |
| `src/lib/stage/safety.ts` | LED 安全模式 (phase 3): settings, cap / soften maths, source-level rules, `FlashDetector`, `FlashLimiter` |
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
| `/` | HOME | upload dropzone + server status, 樂團 (band shelf), 作品庫 (project library); `?band=<id>` preselects the band of a new song |
| `/b/[id]` | HOME | 樂團: visual bible summary + 「從作品產生視覺聖經」, shows, the band's songs, the shared 樂團素材 library |
| `/b/[id]/bible` | HOME | 視覺聖經 editor (every field, live stage preview) |
| `/s/[id]` | HOME | 演出: setlist editor (songs + walk-in / interlude / standby / walk-out looks, reorder, running time, readiness, show canvas, 整場弧線); 「開始演出」 |
| `/s/[id]/live` | CONSOLE | 演出控制台: setlist rail with GO / standby, and the console of the item on air (song console or look console) |
| `/s/[id]/output` | STAGE | the show's one projection window (show channel; performs the take transitions itself) |
| `/p/[id]/process` | HOME | runs/observes the pipeline with live progress, then hands off to the console |
| `/p/[id]/lyrics` | HOME | lyrics editor: import/paste/LRCLIB pick, tap-sync, nudge, auto-distribute |
| `/p/[id]` | CONSOLE | operator console |
| `/p/[id]/output` | STAGE | projection window — animation + lyrics only |
| `/p/[id]/export` | STAGE + HOME | pre-rendered video export for media servers (`?t=` = 單格預覽 time; the console passes its playhead) |
| `/stage-lab` | STAGE | dev gallery of every scene × lyric style with a demo plan |
| `/login` | HOME | password page (only with `LIVELYRICS_PASSWORD`; `?next=` = where to go after signing in) |
| `/api/status` | SERVER | `{ claude, model, dataDir, storage: { mode, cloudConfigured, missing, onVercel }, auth }` (never touches storage) |
| `/api/auth/login` POST, `/api/auth/logout` POST | SERVER | password gate: JSON `{ password, next? }` or a plain form post → session cookie / clear it |
| `/api/blob/upload` POST | SERVER | cloud: signs one browser upload to Vercel Blob (`@vercel/blob/client` `handleUpload`, see "Cloud mode") |
| `/api/projects` GET/POST | SERVER | list summaries / create (local: multipart `audio`, `meta` JSON, `analysis` JSON; cloud: JSON `{ blob, fileName, meta, analysis, bandId? }` after the browser uploaded to Blob) |
| `/api/projects/[id]` GET/PATCH/DELETE | SERVER | project JSON / patch `{meta?, lyrics?, plan?}` / delete |
| `/api/projects/[id]/audio` GET | SERVER | stored audio with **HTTP Range** support (seeking); cloud: 307 to the blob |
| `/api/projects/[id]/assets` GET/POST | SERVER | band media list / upload (multipart `file` + `meta` JSON `{width,height,duration?,name?,kind?,note?,tags?}` measured in the browser; magic-byte sniffed PNG/JPG/WebP/GIF/MP4/MOV/WebM, SVG rejected, 500 MB) → `{asset, assets}` |
| `/api/projects/[id]/assets/[assetId]` GET/HEAD/PATCH/DELETE | SERVER | file with HTTP Range / edit `{name?,note?,tags?,kind?}` / delete (also clears plan sections that showed it) |
| `/api/projects/[id]/process` POST | SERVER | SSE stream of `PipelineEvent`, body `ProcessRequest` (cloud: one step per request with `run`, `maxDuration` 300) |
| `/api/lyrics/search` GET | SERVER | LRCLIB proxy → `{ results: LyricsSearchResult[] }` |
| `/api/bands` GET/POST | SERVER | `BandSummary[]` / create `{ name }` → `Band` |
| `/api/bands/[id]` GET/PATCH/DELETE | SERVER | band / patch `{ name?, bible? (partial, marks source manual) }` / delete (library + shows go, songs stay unassigned) |
| `/api/bands/[id]/assets` GET/POST, `/api/bands/[id]/assets/[assetId]` GET/HEAD/PATCH/DELETE | SERVER | the band library, same contract as the project library (shared handlers in `src/lib/server/asset-routes.ts`); delete also clears every band song section and show look that used it |
| `/api/bands/[id]/bible` POST | SERVER | 從作品產生視覺聖經 (Claude or offline) and save → `{ band, engine, logs }` |
| `/api/shows` GET (`?bandId=`) / POST | SERVER | `ShowSummary[]` / create `{ bandId, name, date?, venue? }` → `Show` |
| `/api/shows/[id]` GET/PATCH/DELETE | SERVER | show / patch `{ name?, date?, venue?, notes?, items?, output?, arc? }` (items only the band's songs, looks only the band's library) / delete |
| `/api/shows/[id]/arc` POST | SERVER | 整場弧線 (Claude or offline) saved on the show → `{ show, engine, logs }` |
| `/api/shows/[id]/apply-output` POST | SERVER | copy the show's canvas onto every song of its setlist → `{ updated, show }` |

Local data lives in `process.env.LIVELYRICS_DATA_DIR ?? <cwd>/data/`: `projects/<id>/{project.json,audio.<ext>,assets/<assetId>.<ext>}`,
`bands/<id>/{band.json,assets/<assetId>.<ext>}`, `shows/<id>/show.json` (all atomic writes, tolerant readers, per-key locks).
Cloud data lives in one Postgres table and a Vercel Blob store (see "Cloud mode (Vercel)"). No route sets
`maxDuration` above 300 (a higher value fails the Vercel deploy).

### Bands, the visual bible and shows (phase 2a)

A band plays a 40-minute set, and every song should live in the same band world. Types in `src/lib/types.ts`
(`Band`, `BandBible`, `BandSummary`, `Show`, `SetItem`, `SetLook`, `ShowArc`, `SongArcNote`, `SongArcDirective`);
pure helpers in `src/lib/band.ts` (vocabularies, `defaultBible`, `coerceBible` / `coerceBand`, `applyBiblePatch`) and
`src/lib/show.ts` (`coerceShow`, `applyShowPatch`, `paletteRoles`, `colorwayFor`, `defaultLook`, **`lookToPlan(look, bible)`**,
`lookToProject(item, { band, output })`, `songStatus`, `setlistTotals`, `moveItem`, `arcDirectiveFor`); storage in
`src/lib/server/band-storage.ts`.

- `Project.bandId?` (old files load without it) and `Project.bandAssets?` (the band library with `scope: "band"`,
  attached on read by `withBandAssets`, never stored). `Asset.scope?: "project" | "band"`; ids are unique across both
  scopes (new ids avoid the other scope's). `src/lib/asset-scope.ts`: `stageAssets(project)` (own first, then band),
  `resolveAsset`, `assetFileUrl(project, asset)` (band assets are served from `/api/bands/<bandId>/assets/<id>`). The
  stage (`StageEngine` / `MediaSources`), the export (`OfflineStage` / `ExactMedia`), the console media picker and the
  designer input all use the merged list.
- Visual bible: summary (繁中 Markdown), palette (4 to 8, `[]` = undecided), fonts, motifs, preferred treatments,
  scene affinity / avoid, lyric policy (`chorus-only` / `full` / `minimal` + note), dos / donts, source. When a project has
  a band, research and design prompts include it as a hard constraint (`bibleBlock` in `prompts.ts`, "stay in this world;
  deviate only with a reason in rationale"); the offline designer uses its palette (roles by lightness / contrast), fonts,
  scene affinity / avoid, lyric policy and treatments (`designer/bible-style.ts`); `normalizePlan` still validates.
  「從作品產生視覺聖經」: `designer/bible.ts` (Claude structured output `BibleDraftSchema`; offline `offlineBible` reads the
  recurring palette families, fonts, scene stage time, treatments and lyric share of the band's plans).
- Show: `items` are songs (`projectId`) and looks (`walk-in | walk-out | interlude | standby` with `{ scene, colorway, media,
  text?, durationHint? }`). A look renders through the existing StageView as a synthetic single-section plan
  (`lookToPlan` / `lookToProject`: the bible's palette and fonts, the look's text as the only lyric line, the band library as
  `bandAssets`, the show's canvas). The show console (phase 2b, below) runs a show with these helpers.
- 整場弧線: `designer/arc.ts`. `planShowArc` (Claude structured output or `offlineArc`: confident opener, build, a breather
  past the middle, the peak, the biggest looks held for the finale) gives each song a role, target energy, palette emphasis
  and note. `ProcessRequest.arc` (`SongArcDirective`) re-designs one song to follow it: Claude reads it in the design prompt,
  the offline path applies `applyArc` (intensity by energy, tunnel only for the finale, colorway emphasis from the palette).

### Live show mode (phase 2b)

The show console runs a whole set with one projection window: `/s/[id]` 「開始演出」 (readiness summary from
`readinessIssues`; an Alert lists the songs that are not ready, 「仍要開始」 goes ahead) → `/s/[id]/live`, whose
「開啟投影視窗」 / O opens `/s/[id]/output`. `/p/[id]` and `/p/[id]/output` work exactly as before.

- **Show channel.** `showChannelName(showId)` = `livelyrics:show:<id>`. Only the item on air talks on it: each
  take sends `project` with a `transition`, then that item's states; the armed item is announced with
  `preload`. Protocol additions (all optional, so older windows and consoles keep working): `transition?:
  StageTransition` (`{ kind: "fade" | "cut"; ms }`, `DEFAULT_TAKE_TRANSITION` = fade 800 ms, at most 3000) on
  `project`; `{ type: "preload"; project }`; `sender?` (the console window's id) on `project` / `state` /
  `preload` / `ping`; `StageState.sectionHeld?`. `parseStageMessage` (with `sanitizeStageState`,
  `sanitizeTransition`) checks every incoming message field by field; both projection windows use it.
- **Projection** (`src/components/stage/ProjectionOutput.tsx`, the one projection component). `/p/[id]/output`
  renders it with `channelName(id)` and a fixed `projectId` (only that project, API fallback before the
  console connects, the "not found" state: the old behaviour); `/s/[id]/output` with the show channel and no
  fixed project. A `project` with a fade (also for the same item again) dims an overlay to black over ms / 2
  (`--ease-in-out`), swaps the StageView's project under black, waits for the new project's lyric fonts
  (`warmFonts`, bounded) and three frames, then fades back in over ms / 2; states of the incoming project wait
  until it is committed, and a take during a fade retargets it. A cut swaps at once. `preload` goes to
  `ProjectWarmer` (`src/components/stage/warm.ts`): FontFaceSet loads of the characters the project can show
  with next/font's family names, band media through a `MediaSources` of its own (`crossOrigin="anonymous"`
  kept). `StageEngine.setProject` restarts its director (section transition, media, freeze, lyric state) when
  the project id changes. Both windows hold a screen wake lock (`src/lib/use-wake-lock.ts`, re-acquired on
  `visibilitychange`).
- **Controllers.** `new ConsoleController(id, { channel?, consoleId?, output?, resume? })`: `channel` defaults
  to `channelName(id)`; `null` is silent (no channel, no pings, no session writes: the armed, preloaded song,
  whose `<audio preload="auto">` loads without playing); `setChannel(channel, { transition })` puts it on air
  (project and state at once) or takes it off (`null`); `setPreload(project)`; `detach()` stops its audio.
  `output` (`OutputTarget`) is where 「開啟投影視窗」 goes (`openProjectionWindow` keeps an already open window).
  `resume: false` (a fresh take) skips the tab-session restore, so a song taken again starts clean. The link
  itself is `src/lib/console/link.ts` (`ProjectionLink`: heartbeat, output status, other-console detection):
  every controller of one console window shares its `consoleId` and stamps it as `sender`, so the short
  overlap of two controllers during a take never reads as another console, while a second show console tab
  does. `LookController` (`look-controller.ts`) is a look on air: `lookToProject(item, { band, output,
  showId })`, a clock from the take (`takenAt`) that never ends, the `durationHint` countdown, the overrides,
  no audio. `ShowLiveController` (`show-controller.ts`) owns the item controllers: before the first GO an idle
  `ProjectionLink` answers the output (「投影已連線」) and warms the first item; GO / S / a re-take reuse the
  preloaded controller (or make one), carry the blackout across (the show's master: GO under black stays
  black), detach the old item before the new one goes on air, arm the following item and preload it. GO is
  ignored for `GO_LOCK_MS` (800) after a take; S never is. 「GO 後自動播放」 plays TRACK as soon as the song can.
- **Show state** (`src/lib/console/show-live.ts`, pure): `LiveState { current, armed, takenAt }` with
  `initialLive`, `arm`, `take`, `go`, `takeStandby`, `reconcileLive`; `railItems`, `readinessIssues`,
  `arcRoleLabel`; `standbyItem` (the show's first standby look, else `defaultLook("standby", bible)` under
  `AUTO_STANDBY_ID`). `sessionStorage["livelyrics:show-live:<id>"]` keeps current, armed, take time and the
  toggles for a reload of the console tab (it comes back to the item on air without a transition; the song
  restores its overrides, position and hold / loop through `session.ts`, a look its overrides under
  `show-<showId>-<itemId>`; the output resyncs through `hello`). `localStorage["livelyrics:show-live-prefs:<id>"]`
  remembers 淡出淡入 / 直接切換 and 「GO 後自動播放」 per show.
- **UI** (`src/app/s/[id]/live/page.tsx` → `src/components/show-live/`). `ShowLiveApp` binds the controller,
  holds a wake lock and shows `SetlistRail` (the GO block naming the armed item, the take transition, the
  autoplay switch, the rows: kind swatch, title, length, readiness, arc role; on air red with its progress,
  armed with the tint ring, played rows dimmed, the arc directive of the song on air; the standby key) beside
  the console of the item on air: `SongConsole` from `ConsoleApp.tsx` (the `/p/[id]` console itself, given
  `show` slots: the G / S keys, the help group, the shared stage; no back link, a compact top bar), or
  `LookConsole` (preview, elapsed / countdown, text, next item, `ControlTab` safety controls), or `PreShow`.
  The whole show has one preview StageView (`src/components/console/SharedStage.tsx`: rendered through a
  portal into a detached host that each view's preview frame adopts), so a take never builds a WebGL context
  or compiles shaders again on the main thread the popup projection shares. `useConsoleHotkeys` is the song
  console's key handling, shared by every view.
- **Section strip** (段落列, `src/components/console/SectionStrip.tsx`, in both consoles between the preview
  and the readout). A section button jumps there (TRACK seeks to its start; LIVE cues its first line and pins
  the section, so a pickup line that starts before the section still shows it). 保持段落 (H): the controller
  publishes the held `sectionIndex` with `sectionHeld`, and every layer takes scene, colours, media and lyric
  style from that section (`lyricLookAt`, the LyricLayer stack) while the lyrics follow time and cues; the
  release returns to the section at the current time or cue. 循環段落 (R): TRACK seeks back to the section's
  start at its end (`loopSeekTarget`, 20 ms ahead in the tick, also on `ended`) and the timeline tints the
  region; LIVE `next()` after the section's last line cues its first (`loopNextLine`) and the clock parks 50 ms
  before the section's end (`LiveClock.capHold`). The same key turns it off; jumping to another section ends a
  hold or loop elsewhere. Both persist in the tab session. The 「保持中」 / 「循環」 capsules, the strip and the
  timeline tags are console chrome only.

### LED 安全模式 (phase 3)

Festival LED walls are bright enough that full-field flashes, bloom peaks, beat strobes and large
dark / bright flips blind the front rows and carry a photosensitive-seizure risk. Safe mode is **on
by default** and works on three layers: a brightness cap, source-level softening and a flash limiter.
All of it is pure logic in `src/lib/stage/safety.ts` (tests: `safety.test.ts`) plus GL passes in
`src/lib/stage/scenes/safety.ts`.

- **Settings.** `ProjectOutput.safety: OutputSafety` `{ enabled, preset, brightness, flashLimit,
  redProtect, soften }` (types in `src/lib/types.ts`). Presets `SAFETY_PRESETS`: 室內投影 100 %,
  LED 牆 70 %, 戶外強光 LED 55 %, or custom 20..100 %. `normalizeOutput` fills it (`normalizeSafety`:
  a file or wire value without it = safe mode on, LED 牆, flash limit and red protection on, soften
  25 %); `patchOutput(…, { safety })` / `patchSafety` (a preset sets the brightness, a brightness
  becomes custom, turning safe mode on turns the flash limit on). PATCH `output.safety` on projects
  (`validate.ts` `SafetyPatchSchema`) and shows (`show.ts`); `apply-output` copies it with the canvas,
  so the show page's 輸出畫面 is the venue setting. `activeSafety` / `projectSafety(project)` (cached
  per output object) give what a frame applies (`SAFETY_OFF` when disabled).
- **Brightness cap and soften (exact on every layer).** The cap is a linear-light fraction of full
  white; the renderer multiplies encoded values by `gain = brightness^(1/2.2)`. `softenChannel` is a
  shoulder on the brightest encoded values (knee `1 − 0.55 s`, top `1 − 0.25 s`). The GL safety pass
  applies soften then gain per pixel to scene + media; the lyric layer gets the same transform per
  colour (`transformHex` on text, fill, accent, glow, shadow and scrim colours in `LyricLayer`), so
  the DOM lyrics are capped exactly without a full-frame overlay, and the export (which paints the
  DOM's computed colours through `LyricPainter`) matches. The CSS fallback background, the test
  pattern and — if the safety shaders fail to compile — the scene canvas get `filter: brightness()`.
- **Source-level safety** (the director and resolve stop asking for the dangerous things):
  `resolveLook` turns `flash` and `bloom` into `fade` (`safeTransition`) and clamps audio
  reactivity to 0.5 (0.25 for a look whose background or primary is a WCAG saturated red,
  `safeReactivity`); `StageLook.safe` says so. `AudioFeatureMixer.update(…, { safe, hold })`: slower
  attacks, the beat pulse capped at 1 and rate-limited by `PulseGate` to ≤ 3 rises a second (`hold`
  forces it down while the limiter damps). The lyric layer in safe mode (`LyricFrame.safety`) swaps
  impact chunks slower (320 / 300 ms) without the beat scale or overshoot. `safetyReport(plan,
  safety, { bpm })` lists the sections these rules change (the design tab's 「LED 安全檢查」 and the
  export page), with the same rules.
- **Flash limiter.** Thresholds (`FLASH`, WCAG 2.3.1 / ITU-R BT.1702 / Harding-style): a transition is
  a change of ≥ 0.1 relative luminance where the darker state is below 0.8; a flash is a pair of
  opposing transitions; ≤ 3 flashes (6 transitions) in any 1 s. Red: `(R − G − B) × 320` changes by
  more than 20 with `R / (R + G + B) ≥ 0.8` in either state (linear RGB); every red transition counts
  as a red flash, ≤ 3 a second. Area: the frame is a luminance grid (`gridSize`: 32 cells on the long
  side, 32 × 18 for 16:9); a transition counts when cells covering ≥ 25 % of any 1/3 × 1/3 window (the
  WCAG 10° field, 341 × 256 on 1024 × 768) complete it in the same direction within 0.1 s (summed-area
  table). `FlashDetector` runs a hysteresis extreme tracker per cell (general and red). `FlashLimiter`
  keeps a model of the displayed grid (`displayed = mix(displayed, source, α)`, what the GPU does per
  pixel) and counts transitions on both the source and the displayed grid; it engages when the
  displayed count reaches 4 (2 flashes; margin for the readback lag) or the source would exceed 6, or
  2 displayed / > 3 source red transitions. Damping sets α = 1 − e^(−dt / τ) with τ = 1 s (a temporal
  low-pass: a 10 Hz full-field strobe becomes a steady grey with < 0.08 ripple), holds 0.3 s after the
  last trigger and releases over 0.6 s. A slow fade or a 1 Hz pulse is never touched (tests). The lyric
  layer's share is estimated (`LyricEstimate`: its measured text box 5 × a second, its displayed colour,
  35 % ink × visibility) and blended into the grid; it is counted but not low-passed.
- **GL pipeline** (`StageRenderer`, `RenderRequest.safety`): with safe mode on, scene + transition +
  media render into target S (black until the four safety programs are compiled; they are prewarmed
  first). `down1` S → (cols·8 × rows·8) with soften per tap, `down2` → the cols × rows grid; `lowpass`
  F = mix(F_prev, soften(S) × gain, α) into a ping-pong pair (8-bit feedback moves at least one code
  value so it always converges; a static dither under the cap); present = `blitFramebuffer` (WebGL2) or
  a copy shader (WebGL1). Readback: WebGL2 reads the tiny grid into a pixel-pack buffer with a fence and
  collects it 1–2 frames later (`takeGrids`, ring of 3, no GPU stall); WebGL1 and the export read it
  synchronously (a stall on a 32 × 18 target). `StageEngine` asks `limiter.alphaFor(dt)` before
  rendering, records α per render serial and feeds each grid to `limiter.observe` with the combined α of
  the frames since the last observed one. Off = the old path (scene straight to the screen). Cost: two
  full-frame passes (low-pass, blit) plus two tiny ones and ~0.1 ms of CPU per frame; on a laptop GPU
  well under 1 ms (not measured on real hardware here: the container has only SwiftShader, where a
  640 × 360 stage goes from 60 to ~48 fps).
- **Determinism.** The limiter is a pure function of the frame sequence (grids + frame times): the
  same frames give the same α sequence (tested). Live, α is chosen one to two frames before that
  frame's grid is known; the offline export (`OfflineStage.renderScene`) uses the zero-lag `step()`
  (render S, read the grid synchronously, choose α, `composeSafety(α)`), so its result depends only
  on song time and the frame rate. A jump pre-rolls the last `LIMITER_PREROLL_SECONDS` (1.5 s) through
  the limiter as well; a frame is therefore identical for the same range start, and independent of
  where the export started except while a damping episode spans that start.
- **Protocol** (backward compatible). The settings travel inside `project.output.safety` with every
  `project` / `preload` message; `parseStageMessage` repairs a project's output with `normalizeOutput`
  (a project without an output is left alone: the renderer's default is safe mode on). `pong` may carry
  `limiter: LimiterReport { on, damping, engaged }` (`sanitizeLimiter`), which the console link keeps
  in `OutputStatus.limiter`. The projection windows (`/p/[id]/output`, `/s/[id]/output`) apply whatever
  project they show; older consoles (no field) therefore get safe mode on.
- **Console** (`src/components/console/SafetyControls.tsx`): `SafetyTile` in the control tab's sticky
  安全控制 block (next to 黑場), `SafetySettings` below it (presets, 最高亮度, 柔化亮部, 閃爍限制, 紅閃保護,
  「已抑制閃爍 n 次」 per section), `SafetyCapsule` in the top bars of the song console, the look console
  and the show console's pre-show header (orange when off, 「已抑制閃爍」 while damping). Turning safe
  mode off always goes through `SafetyOffAlert` (the risk in Traditional Chinese); on never asks.
  `ConsoleController.updateSafety` / `LookController.updateSafety` (the show's venue setting: saved
  on the show through `onSafety`). The preview reports its engine's `StageStats.safety` to
  `src/lib/console/limiter-status.ts`; `limiterView` prefers the projection's pong report for "damping
  now". `StageReadout` names a softened transition. The export page (`ExportClient`) applies the
  project's settings by default, shows the check, asks before an unprotected export, and the cue sheet
  (first row, `type = note`) and README state the settings (`safetySummary`) and the damping count.
- **LED 模擬** (`src/components/console/LedSim.tsx`, console preview only): pitch P2.6 / P3.9 / P4.8 /
  P6 and wall width → LEDs across (`ledGrid`), zoom 1× / 2× / 4× by layout (the stage renders at the
  magnified size); an SVG filter samples the stage once per LED cell (feFlood + feTile + feComposite,
  dilated), adds a bloom (blur + screen), and a CSS radial-gradient overlay draws the dark gaps. Cells
  below 2 preview px are enlarged (the label says so). Remembered per browser (`localStorage`), never
  sent to the output.
- **Stage lab**: `?safe=0` shows the designed flash / bloom at full brightness.
- **E2E**: `scripts/e2e-led.cjs` (strobe designs: flash transitions and hard cuts at 4 flashes a second;
  the projection canvas sampled every frame; the confirm dialogs; the presets' luminance; LED 模擬 only
  in the console; the pre-show check; the export default).
- **Known limits.** Not a certified PSE test: the grid is 32 × 18 (small patterns and thin lines
  average out), the DOM lyric layer is estimated rather than measured, luminance is relative (the
  wall's nits, gamma and processor brightness are unknown to the app), and the live limiter reacts
  after a lag of 1–2 frames (the engage margin covers strobes up to the frame rate; the first
  transitions of a sudden strobe still show). A section that changes faster than its transition
  restarts the transition from the outgoing look (the limiter, not the source, then smooths it). The
  blackout and the show's take fades are operator-driven and not limited. Recommend a Harding-style
  analysis of exported video for broadcast.

### Band media and the output canvas (phase 1a)

- `Project.assets: Asset[]` (image / video / logo; size and video length measured in the browser by
  `src/lib/media-probe.ts`, validated in `src/lib/assets.ts`, sniffed in `src/lib/server/asset-files.ts`).
  `Project.output: { width, height, preset, lyricSafe }` (`src/lib/output.ts`: presets, `normalizeOutput`,
  `patchOutput`, `fitCanvas` letterbox, `safeRectPercent`, `renderSize`). Old project files load with
  `assets: []`, a 1920 × 1080 canvas with 5 % lyric margins, and `media: null` on every section.
- `SectionDesign.media: { assetId, treatment, fit, opacity, blend } | null` (required + nullable; a missing
  key preprocesses to null). Treatments: full, duotone, grain-film, blur-glow, halftone, mask-lyrics,
  slow-drift, beat-cut. `normalizePlan` drops media whose asset is not in `DesignerInput.assets`.
- Stage: `src/lib/stage/media/model.ts` (pure: beat grid, framing / Ken Burns / beat-cut crops, video
  position, cross-fade by song time) + `src/components/stage/MediaSources.ts` (image / muted video
  elements, seek when drift > 80 ms) + `src/lib/stage/scenes/media.ts` (GLSL compositor between the scene
  and the DOM lyrics). The media layer is a function of (project, song time, beat grid); cross-fades run
  only during continuous playback. mask-lyrics dims the measured lyric text area.
- The StageView keeps `output.width / output.height` as its aspect; the projection window letterboxes it
  (pixel exact when the window is the canvas size) and renders at most the canvas size; the console
  preview uses the same aspect. Lyric boxes are mapped into `lyricSafe`, and `adaptMetrics` re-fits the
  style metrics outside 1.5 to 2.05:1 (strips: longer rows, size capped by the box height; portrait:
  shorter rows, up to 4).

### Pre-rendered video export (phase 1b)

- Offline, deterministic rendering: `src/components/stage/export/OfflineStage.ts` renders song time t into
  `output.width × output.height` canvases without rAF or the wall clock. Scene: the live `StageRenderer`
  (`preserveDrawingBuffer`, `ensureReady()` compiles the plan's shaders first) fed by
  `src/lib/stage/offline.ts` (`trackStateAt`, `buildSceneClock`: the director's speed × smoothed-energy
  integral precomputed on a 20 Hz grid so frame t is the same from any range start; `offlineSceneFrame`:
  section transitions by song time; beat index from the analysis grid). Audio uniforms: the live
  `AudioFeatureMixer` over the analysis envelopes, stepped at the export frame rate. Media: the shared
  `src/lib/stage/media/draw.ts` (also used by StageEngine) with `ExactMedia` (images decoded up front, videos
  seeked to the exact frame and used after `seeked`). Lyrics: the live `LyricLayer` in a hidden host at the
  export size, stepped with now = song time, painted into a canvas by `LyricPainter` (layout boxes, computed
  transforms, opacity, blur, colours, text shadows, karaoke insets, caret; vertical-rl placement as Blink;
  `matte` = white text at its alpha, no scrim or shadows). Pure helpers: `src/lib/stage/lyrics/paint-math.ts`.
  A jump (first frame, preview, going back) replays the preceding 3 s at the frame rate first.
- Encoding: `src/lib/export/encode.ts` (WebCodecs checks, H.264 level from frame size and macroblock rate, then
  higher levels, Main, VP9 fallback; AAC else Opus; one mediabunny `Output` per clip, `StreamTarget` into a
  folder from `showDirectoryPicker`, else `BufferTarget` downloads). `src/lib/export/{frames,settings,cuesheet}.ts`
  are pure: exact rational frame rates (29.97 = 30000/1001, drop-frame timecode), bitrate presets, ranges,
  file names, the cue sheet CSV and the README. `src/components/export/ExportClient.tsx` + `runExport.ts` run it:
  every frame is rendered once and composed into each variant (完整, 背景, 歌詞層 as luma matte or VP9 alpha).
- Entry points: console top bar 「匯出」 and 控制 › 輸出畫面 open the page in a new tab at the playhead; the
  design overview header has 「匯出影片」. Dev builds expose `window.__livelyricsExport` (`debugStage`,
  `exportToOpfs`) for the render checks.

### Cloud mode (Vercel)

Vercel functions have a read-only, ephemeral filesystem (except `/tmp`), no shared memory between
requests, ~4.5 MB request bodies and at most 300 s per request (Hobby + Fluid compute). Cloud mode
keeps every contract above and changes only where things are kept and how long work is driven.

- **Mode** (`src/lib/server/store/mode.ts`, resolved from the environment on every call, never at
  import, so `next build` needs no variables): `cloud` when `BLOB_READ_WRITE_TOKEN` and a database URL
  (`DATABASE_URL`, `POSTGRES_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`) are set, or
  `LIVELYRICS_STORAGE=cloud`; `unconfigured` on Vercel (`VERCEL=1`) without them: every storage call throws
  `StorageError("unconfigured")` → 503 JSON in Chinese naming what to create, and the home page shows
  `StorageSetupNotice` (server-rendered from `resolveStorageConfig`); otherwise `local`
  (`LIVELYRICS_STORAGE=local` forces it). `isCloudStorage()` / `storageMode()` in `store/index.ts`.
- **Stores** (`src/lib/server/store/types.ts`): `DocumentStore` (projects, bands, shows by kind + id,
  atomic read-modify-write, create with a fresh id, list with a stored summary) and `FileStore` (place,
  remove, serve, inspect). `storage.ts` / `band-storage.ts` keep the domain logic (coercion of old
  documents, summaries, cascades) for both modes on top of `docs()` / `files()`.
  Local: `local-docs.ts` + `local-files.ts` (the previous behaviour, same files and locks). Cloud:
  `sql-docs.ts` on a `{ query(text, params) }` client (`neon.ts` wraps `@neondatabase/serverless`
  `neon(url).query`; tests use PGlite) with one table created on first use:
  `livelyrics_docs(kind, id, data json, summary json, version, created_at, updated_at, PRIMARY KEY (kind, id))`
  (`json`, not `jsonb`: key order and exact text are kept). Updates are optimistic: read `version`,
  `UPDATE ... WHERE version = $n`, retry the mutate on a conflict (the HTTP driver has no interactive
  transactions); `update` never recreates a deleted document. `summary` holds the library record so
  the list does not download every analysis. Files: `blob-files.ts` (Vercel Blob, a **Public** store).
- **Uploads** go browser → Blob, never through a function. `src/lib/upload-policy.ts` (shared): targets
  `audio` / `project-asset` / `band-asset`, pathnames `audio/song.<ext>`, `projects/<id>/asset.<ext>`,
  `bands/<id>/asset.<ext>` (Blob adds a random suffix), types, limits (audio 200 MB, assets 500 MB),
  multipart above 16 MB. `src/lib/cloud-upload.ts` (browser, loaded only in cloud mode) sniffs the type
  from the first bytes with the server's rules, then `upload()` with progress. `/api/blob/upload`
  (`src/lib/server/blob-upload.ts`) re-checks the `clientPayload` (target exists, pathname = prefix + type,
  declared size and sniffed type within the policy) and signs a token bound to that pathname, content
  type and size with `addRandomSuffix`. No upload-completed callback: the browser then registers the
  blob with the existing create / asset routes as JSON; the route `inspect`s it (a blob of this store,
  under the target's prefix, `head` for size and type, the first 64 bytes by a Range GET) and sniffs the
  magic bytes again; a file that fails is deleted. Deleting a project, an asset or a band deletes its
  blobs (failures are logged, never block the document change).
- **Serving**: the audio / asset GET routes answer 307 to the public blob URL (`Cache-Control: private,
  max-age=3600`; blob URLs never change). Blob's CDN answers Range (206) and sends
  `Access-Control-Allow-Origin: *` on GET / 206 / 404; OPTIONS answers 405, so only requests without a
  preflight work cross-origin (media elements, plain `fetch`). Rule: **every `<audio>` / `<video>` /
  `<img>` / `new Image()` that loads a stored file sets `crossOrigin="anonymous"`** (console audio,
  lyrics editor audio, `MediaSources`, `ExactMedia`, asset thumbnails), so WebGL textures, Web Audio and
  the export's canvas readback stay CORS-clean after the redirect. `LIVELYRICS_BLOB_DELIVERY=proxy`
  streams the blob through the function instead (forwards Range / If-Range / If-None-Match).
  Under Next's fetch an awaited `cancel()` of a response body can stay pending; `blob-files.ts` never
  awaits one.
- **Pipeline** (`pipeline.ts`): the in-memory run registry cannot work across instances, so the page
  drives the run: `src/lib/process-runner.ts` `runStepwise` sends one POST per step
  (`ProcessRequest.run = { id, steps }`, `steps` = the one step), each an SSE stream bounded by
  `maxDuration = 300`. `claimCloudRun` records `Project.pipeline` (`PipelineRecord`: run id, steps,
  current step, results, failed step, instruction, arc) atomically and refuses (409
  `PipelineBusyError`) while a fresh step of the run or another fresh run is recorded; `runCloudSteps`
  saves each step's result on the project, then the record. The request keeps running after a client
  disconnect via `after()`. Budgets: Claude gets `CLOUD_DESIGNER_BUDGET_MS` (250 s, then
  `ClaudeTimeoutError` → the offline designer finishes the step), the step stops at 285 s, a record
  untouched for `CLOUD_STALE_MS` (330 s) is stale (`withLiveStatus` reports `CLOUD_STALE_ERROR`). A
  refreshed process page (`attachOnly`) continues between steps, polls a running step
  (`GET /api/projects/<id>` every 3 s) and shows 重試 for a stale or failed one (`retryFrom` the record).
- **Band jobs** (`src/lib/server/jobs.ts`): 從作品產生視覺聖經 and 整場弧線 record `Band.bibleJob` /
  `Show.arcJob` (`JobState`) while they run (409 for a second one, `maxDuration` 300, the same Claude
  budget), clear it with the result, keep `{ status: "error" }` on failure; GET reports a job older than
  `JOB_STALE_MS` as failed. The bible editor and the show page poll while one runs
  (`src/components/band/use-job-polling.ts`).
- **Password gate** (`src/proxy.ts`, Next 16 proxy = middleware, Node runtime; `src/lib/server/auth.ts`):
  only with `LIVELYRICS_PASSWORD`. Cookie `livelyrics_session` = `v1.<issued>.<HMAC-SHA256>` with an
  HKDF-derived key (no password or secret stored, 30 days, httpOnly, SameSite=Lax, Secure on https and
  localhost, constant-time compare). Unauthenticated API → 401 JSON, pages → `/login?next=...`. Public: `/login`,
  `/api/auth/*`, `/_next/static`, `/_next/image`, `/favicon.ico`.
- **Tests**: `store/testing/pglite.ts` (the SQL store on PGlite), `store/testing/fake-blob.ts` (in-memory
  Blob API with Range and the CORS header), `store/neon.test.ts` (the real Neon driver against an emulated
  SQL-over-HTTP endpoint), `cloud-storage.test.ts`, `blob-upload.test.ts`, `pipeline-cloud.test.ts`,
  `jobs.test.ts`, `auth.test.ts`, `src/proxy.test.ts`, `src/lib/process-runner.test.ts`.

## Modules

### SERVER — `src/lib/server/**` (except `designer/`), `src/lib/lyrics/**`, `src/app/api/**`
- Storage with atomic JSON writes, list summaries (accent = plan palette[1] or [0]), delete folder.
- LRC/plain parsing & serialization, `distributeLines`, `normalizeLyrics` (ids `l0..`, `synced`).
- LRCLIB client (`https://lrclib.net/api/search`, `/api/get`), `User-Agent: Livelyrics/0.1 (+https://github.com/alanwu14832-bit/Livelyrics-)`,
  prefer synced results whose duration is within ±3 s; timeout + graceful failure.
- Pipeline `lyrics → research → design`, saving the project after each step; status
  `processing` → `ready` | `error`. Local mode: per-project **in-memory run registry** (cloud mode records
  the run on the project instead, see "Cloud mode"): a POST while a run is active
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
  `maxDuration` at most 300 (only the process, bible and arc routes set it).
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

### STAGE — `src/components/stage/**`, `src/lib/stage/**` (except protocol.ts), `src/app/p/[id]/output/**`, `src/app/s/[id]/output/**`, `src/app/stage-lab/**`
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
- Output page (`ProjectionOutput`, both windows): fullscreen black, no chrome, cursor auto-hide, F /
  double-click fullscreen, sends `hello`, answers `ping` with `pong`, applies `project`/`state`; the
  per-song window loads the project via API as a fallback so it can show the key visual idle frame before
  the console connects; the show window performs take transitions and warms `preload`s (phase 2b).

### CONSOLE — `src/app/p/[id]/page.tsx`, `src/app/s/[id]/live/**`, `src/components/console/**`, `src/components/show-live/**`, `src/lib/console/**`
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
  [ / ] offset −/+ 0.05 s, T tap tempo, O open output, M mode switch, ? help; PageDown or . / PageUp or ,
  next / previous section, H 保持段落, R 循環段落 (phase 2b). The show console adds G (GO) and S (standby);
  the per-song console ignores them. Physical key codes (`KeyH`, `Period`…), so an active IME does not
  change them; every toggle and jump ignores key repeat.
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
