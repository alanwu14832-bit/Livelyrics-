# Livelyrics — Architecture & Module Contracts

Livelyrics is a **local web app** a band's visual operator runs on their own laptop:

1. **Upload** an audio file → the browser analyses it (tempo, beats, energy, sections, waveform).
2. The server **researches** the song & band with Claude (web search) acting as the band's
   dedicated stage-visual designer, then **designs** a `DesignPlan`: key visual (主視覺), palette,
   motif, typography, per-section scene + lyric presentation, cue notes. Without an API key the
   research is **免費研究** (MusicBrainz + Wikipedia + a local lyric / audio analysis) and the offline
   designer follows its findings; **用 claude.ai 研究** hands the whole job to the user's own
   claude.ai chat by copy and paste (see "免費研究與手動 Claude 模式" below).
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
| `src/lib/types.ts` | `Project`, `SongMeta`, `AudioAnalysis`, `Lyrics`/`LyricLine`, `Research`, `PipelineEvent` (incl. `attached`), `ProjectSummary` (accent, palette, error), phase 4 `MoodImage` / `DesignDirection` / `DirectionSet`, phase 4b `DesignEngine` (`claude` / `offline` / `free` / `manual-claude`), `PublicInfo`, `PlanSource`, phase 5a `SongTimecode` (`Project.timecode`, song `SetItem.timecode`) |
| `src/lib/schema.ts` | zod `DesignPlanSchema` + closed vocabularies `SCENE_IDS`, `LYRIC_STYLE_IDS`, `LYRIC_PLACEMENTS`, `SECTION_KINDS`, `FONT_IDS`; phase 7 `SceneProgramSchema` (`DesignPlan.sceneProgram`), `TYPE_RELATIONS`, `ZoneSchema` |
| `src/lib/stage/program/contract.ts` | phase 7: the scene program uniform contract (`PROGRAM_UNIFORMS`, the prelude / epilogue, `PROGRAM_CONTRACT_DOC`); `validate.ts` the program validator |
| `src/lib/stage/protocol.ts` | `StageState`, `StageOverrides`, `StageMessage`, `channelName()`, `showChannelName()`, `StageTransition`, `LimiterReport` (phase 3), `LiveAudioFeatures.clock` (phase 5a), `parseStageMessage()`, `StageStore`, `createStageStore()`, `stageTime()` |
| `src/lib/stage/safety.ts` | LED 安全模式 (phase 3): settings, cap / soften maths, source-level rules, `FlashDetector`, `FlashLimiter` |
| `src/lib/moodboard.ts`, `src/lib/directions.ts` | phase 4: mood board limits, colour extraction, coercion, summary; directions coercion, select / undo / comment transforms, style-frame moments, the sign-off sheet data |
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
| `/p/[id]/proposal` | HOME | 一頁提案 (phase 4): the band sign-off sheet of the design directions, A4 landscape print layout, 「列印／存成 PDF」 |
| `/p/[id]/type` | HOME | 排版 (phase 6): the song's 字體語言 and every line's composition, desktop and phone (edits live on the projection) |
| `/stage-lab` | STAGE | dev gallery of every scene × lyric style with a demo plan (`?voice=&aspect=&project=`: 字體藝術 in a voice on a canvas; `?program=`: 專屬畫面) |
| `/login` | HOME | password page (only with `LIVELYRICS_PASSWORD`; `?next=` = where to go after signing in) |
| `/api/status` | SERVER | `{ claude, model, dataDir, storage: { mode, cloudConfigured, missing, onVercel }, auth }` (never touches storage) |
| `/api/auth/login` POST, `/api/auth/logout` POST | SERVER | password gate: JSON `{ password, next? }` or a plain form post → session cookie / clear it |
| `/api/blob/upload` POST | SERVER | cloud: signs one browser upload to Vercel Blob (`@vercel/blob/client` `handleUpload`, see "Cloud mode") |
| `/api/projects` GET/POST | SERVER | list summaries / create (local: multipart `audio`, `meta` JSON, `analysis` JSON; cloud: JSON `{ blob, fileName, meta, analysis, bandId? }` after the browser uploaded to Blob) |
| `/api/projects/[id]` GET/PATCH/DELETE | SERVER | project JSON / patch `{meta?, lyrics?, plan?}` / delete |
| `/api/projects/[id]/audio` GET | SERVER | stored audio with **HTTP Range** support (seeking); cloud: 307 to the blob |
| `/api/projects/[id]/assets` GET/POST | SERVER | band media list / upload (multipart `file` + `meta` JSON `{width,height,duration?,name?,kind?,note?,tags?}` measured in the browser; magic-byte sniffed PNG/JPG/WebP/GIF/MP4/MOV/WebM, SVG rejected, 500 MB) → `{asset, assets}` |
| `/api/projects/[id]/assets/[assetId]` GET/HEAD/PATCH/DELETE | SERVER | file with HTTP Range / edit `{name?,note?,tags?,kind?}` / delete (also clears plan sections that showed it) |
| `/api/projects/[id]/process` POST | SERVER | SSE stream of `PipelineEvent`, body `ProcessRequest` (steps lyrics / research / design / scene; cloud: one step per request with `run`, `maxDuration` 300) |
| `/api/projects/[id]/moodboard` GET/POST, `/api/projects/[id]/moodboard/[imageId]` GET/HEAD/PATCH/DELETE | SERVER | 參考圖 (phase 4): `{ images }` / upload (the media-library contract, images only, ≤ 12, 8 MB, `meta.stats` = the colours measured in the browser) → `{ image, images }` / file / `{ note?, name? }` / delete |
| `/api/bands/[id]/moodboard` GET/POST, `/api/bands/[id]/moodboard/[imageId]` GET/HEAD/PATCH/DELETE | SERVER | the band's mood board, same contract (applies to all its songs) |
| `/api/projects/[id]/directions` POST | SERVER | 設計方向 (phase 4) `{ action: generate \| revise \| select \| undo \| status \| comment \| uncomment \| clear, … }` → `{ project, engine?, logs? }` (`maxDuration` 300; cloud: `directionsJob`, 409 while one runs) |
| `/api/projects/[id]/manual` POST | SERVER | 用 claude.ai 研究 (phase 4b) `{ action: "prompt", target: plan \| directions, compact?, instruction? }` → `ManualPromptResult`; `{ action: "apply", target, reply, brief? }` → `{ ok: true, project, notes, safety, research }` or 422 `{ ok: false, error, issues, fixPrompt, brief? }` (no LLM call, no `maxDuration`) |
| `/api/lyrics/search` GET | SERVER | LRCLIB proxy → `{ results: LyricsSearchResult[] }` |
| `/api/bands` GET/POST | SERVER | `BandSummary[]` / create `{ name }` → `Band` |
| `/api/bands/[id]` GET/PATCH/DELETE | SERVER | band / patch `{ name?, bible? (partial, marks source manual) }` / delete (library + shows go, songs stay unassigned) |
| `/api/bands/[id]/assets` GET/POST, `/api/bands/[id]/assets/[assetId]` GET/HEAD/PATCH/DELETE | SERVER | the band library, same contract as the project library (shared handlers in `src/lib/server/asset-routes.ts`); delete also clears every band song section and show look that used it |
| `/api/bands/[id]/bible` POST | SERVER | 從作品產生視覺聖經 (Claude or offline) and save → `{ band, engine, logs }` |
| `/api/shows` GET (`?bandId=`) / POST | SERVER | `ShowSummary[]` / create `{ bandId, name, date?, venue? }` → `Show` |
| `/api/shows/[id]` GET/PATCH/DELETE | SERVER | show / patch `{ name?, date?, venue?, notes?, items?, output?, arc? }` (items only the band's songs, looks only the band's library) / delete |
| `/api/shows/[id]/arc` POST | SERVER | 整場弧線 (Claude or offline) saved on the show → `{ show, engine, logs }` |
| `/api/shows/[id]/apply-output` POST | SERVER | copy the show's canvas onto every song of its setlist → `{ updated, show }` |

Local data lives in `process.env.LIVELYRICS_DATA_DIR ?? <cwd>/data/`: `projects/<id>/{project.json,audio.<ext>,assets/<assetId>.<ext>}` (mood board images too),
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

### 設計方向提案與樂團確認 (phase 4)

A designer pitches before producing: 2–3 clearly different directions, each with style frames,
the band picks one or comments, then production starts. Directions are opt-in; the single-plan
pipeline and 「重新設計」 are unchanged. Types in `src/lib/types.ts` (`MoodImage`, `MoodStats`,
`DesignDirection`, `DirectionSet`, `DirectionComment`, `DirectionReference`, `PlanSnapshot`).

- **Mood board (參考圖).** `Project.moodboard?: MoodImage[]` and `Band.moodboard?: MoodImage[]` (a
  sibling list, never `assets`, so nothing on stage, in the export or in the media picker can show
  them); `Project.bandMoodboard?` is the band's list attached on read by `withBandAssets` (scope
  "band", never stored). `MoodImage` is an `Asset` (kind image) plus `stats?: MoodStats` (`palette`,
  `weights`, `luma`, `saturation`, `warmth`) and the operator's `note`. Files sit next to the assets
  (`<project>/assets/<id>.<ext>`, `bands/<id>/assets/…`, cloud: the same Blob prefixes, so the upload
  token route is unchanged); ids are unique across assets and mood boards (`takenAssetIds` covers
  both). Limits: 12 per scope, 8 MB, PNG / JPG / WebP / GIF (`src/lib/moodboard.ts`). Upload: the
  routes reuse `receiveAssetUpload` / `receiveAssetRegistration` with `images` (image-only rules and
  an `extend` hook for the stats). The browser (`src/lib/moodboard-client.ts`) decodes each image,
  downscales it to ≤ 1024 px on the long edge, re-encodes WebP (JPEG where WebP encoding is missing),
  and measures a 96 px copy with `extractMoodStats` (5-bit binning, deterministic farthest-point
  k-means with k = 5, merge closer than 28, drop < 3 %). Deleting an image drops the direction
  references to it; deleting a project / band removes the files. UI:
  `src/components/moodboard/MoodBoard.tsx` (design overview, band page; the band's images read-only
  on a song, numbered first).
- **The designer sees them.** `DesignerInput.moodboard` (band first, then the song's:
  `mergedMoodboard`) and `DesignerInput.moodboardImages` (`VisionImage { id, mediaType, data }`):
  the server reads the files through `FileStore.read` (new: local disk / Blob GET, size-capped) in
  `loadVisionImages` (≤ 3.5 MB each, ≤ 18 MB in all, other types skipped and logged), so the images
  never pass through a function request body. Claude: `userContent` puts `visionContent` first — per
  image a text block 「圖 n（樂團參考／這首歌的參考）：「note」」 then a base64 `image` block — and the
  prompt text last; `moodboardBlock` lists the notes and measured colours and asks to extract
  palette, texture, composition and typography cues and to cite 「圖 n」 in the rationale. Both the
  design step of the pipeline (when Claude is configured) and the directions call use it. Offline:
  `moodSummary` merges the images' palettes (a note about colour counts double; `vivid` = the most
  saturated colour with real weight); `moodPalette` makes a stage palette from it (vivid = primary,
  kept exactly when bright enough; a clearly different accent; the darkest hue as a 6 % background;
  a ≥ 4.5:1 lyric colour) and `moodScenes` biases scene choice by tone. `offlineDesign` uses them
  after the bible palette.
- **Directions** (`src/lib/server/designer/directions.ts`). A compact `DirectionSpec` (name, pitch,
  rationale, references, palette, typography, emblem, scene families and lyric style / placement
  per section kind, treatments, energy, motion soft / punchy) is expanded by `expandDirection` into a
  full plan on the song's real structure: the offline plan's timing, media, lines and cues, then the
  direction's scenes (choruses climb the family, neighbours differ), colourways from `paletteRoles`,
  lyric styles (vertical only for CJK; the bible's lyric policy), soft transitions for soft looks,
  scaled intensity / speed / reactivity; `normalizePlan` last. Claude: `proposeDirections` makes one
  structured-output call (`DirectionDraftSchema` via `jsonOutputFormat`, effort medium, 16 k tokens,
  adaptive thinking, `fallbacks: "default"`, the mood board images before the prompt) under the
  budget (`CLOUD_DESIGNER_BUDGET_MS` in both modes); `normalizeDirectionDrafts` checks everything
  against the vocabularies (CJK / Latin fonts, scenes minus the bible's avoided ones, image numbers →
  ids), repairs palettes (darkest first, a lyric colour; outside the bible's hues → the bible
  palette), forces the bible fonts, drops duplicates and tops up with offline specs to ≥ 2. Any
  failure or timeout → the offline directions. Offline: `offlineDirectionSpecs` — film (cool, or warm
  after a warm mood board; desaturated; nebula / rain / waves / bokeh; line-fade, karaoke choruses,
  vertical bridge; serif), collage (saturated complementary from the mood board's vivid hue; shards /
  grid / tunnel; word-pop and impact; heavy sans), minimal (black and white with one accent, the
  vivid colour; gradient / ink / motif; subtitle, stack, vertical; wide tracking). With a bible all
  three use its palette (a different role leads) and fonts, never its avoided scenes. Stored as
  `Project.directions: DirectionSet { engine, model?, createdAt, directions }`; each
  `DesignDirection { id, letter A–C, name, pitch, rationale, references, sceneTendency,
  lyricTreatment, plan, status proposed | selected | rejected, comments, engine, … }`.
- **Actions** (`src/lib/server/directions.ts`, pure transforms in `src/lib/directions.ts`):
  generate (replaces the set; the plan is untouched), revise (the redesign-with-instruction path:
  `designSong` with `previous` = the direction's plan and the note as the instruction — Claude, or
  the offline `applyInstruction`; the note becomes a `revision` comment; a selected direction goes
  back to 提案中), select (`normalizePlan` against the current song, then `applySelection`: the plan is
  replaced, the old one kept in `Project.previousPlan: PlanSnapshot`, one direction 已選定), undo
  (`applyUndo`), status (退回 / 重新提案; the selected one cannot be rejected), comment / uncomment,
  clear. Cloud: generate and revise record `Project.directionsJob` (`JobState`, 409 while fresh, a
  stale one reads as failed via `withLiveProjectJob`), finish under `after()`; the page polls.
- **Style frames** (`src/components/directions/style-frames.ts`). `styleFrameMoments(plan, lyrics)`
  picks 3–4 moments (intro, the first chorus 60 % into its second line, the bridge or the quietest
  section after the first chorus, the final chorus; filled up by energy). The browser renders them
  with `OfflineStage` (the export renderer: real shaders, media, lyric layer and next/font faces;
  the project's LED 安全模式 applied) on a copy of the project with the direction's plan at 960 px on
  the long edge (the output canvas' aspect), 12 fps pre-roll, composited to JPEG object URLs. They
  are cached client-side only: an in-memory LRU (12 directions) keyed by the plan, lyrics, canvas and
  safety, shared across client navigations (design overview → 一頁提案), renders queued one at a time
  (one WebGL context). Nothing is uploaded, so local and cloud mode behave the same; a reload renders
  again (a few seconds a direction).
- **UI.** `src/components/directions/DirectionsPanel.tsx` on the design overview: before any
  direction a compact block (mood board, an optional brief, 「提出設計方向」); afterwards 「方向比較」 spans
  the page above the step list: cards side by side (letter, name, status tag, the frame carousel —
  opens on the first chorus, ← / →, thumbnails, 「放大檢視」 sheet — palette chips, a typography
  specimen on the direction's background, the rationale, cited mood board images, scene and lyric
  tendencies, comments, 「採用這個方向」 / 「修改」 (sheet with a note) / 「退回」), 「復原」 and 「一頁提案」. The
  header gets 「設計方向」 (anchor) or 「一頁提案」.
- **一頁提案** (`/p/[id]/proposal`, `src/components/proposal/ProposalClient.tsx`, data from
  `proposalSheet`): one A4 landscape paper laid out in millimetres (297 × 210, 10 mm padding, always
  light), so the screen preview is the page; `@page proposal { size: A4 landscape; margin: 0 }` and
  `.proposal-paper { page: proposal; print-color-adjust: exact }` in `globals.css`, `.print-hide` for
  the chrome. Columns per direction (hero frame, the other frames, palette with hex, specimen, pitch,
  clipped rationale, tendencies, references), then the mood board strip and the sign-off box
  (選擇方向 A／B／C with the selected one ticked, 意見, 簽名／日期). 「列印／存成 PDF」 = `window.print()`,
  enabled once the frames are ready. Not built: 下載 PNG (rasterising the DOM needs a dependency) and
  a public band share link (the cloud password gate covers every page; a safe link needs an HMAC-
  signed, expiring, read-only token scoped to one project: future work).
- **E2E**: `scripts/e2e-directions.cjs` (generated PNG mood board, note, the band board, offline
  directions reflecting the mood board, non-blank style frames, select → console, undo, the proposal
  in print emulation and `page.pdf` = one A4 landscape page, revise, reject).

### 免費研究與手動 Claude 模式 (phase 4b)

For bands that do not pay for API tokens. Without `ANTHROPIC_API_KEY` the research step is **免費研究**
(the default; also after a Claude failure, and for a run with `ProcessRequest.free`, the
「這次用免費研究」 switch of 重新設計 when a key is set). **用 claude.ai 研究** is a copy-and-paste round
trip through the user's own claude.ai account. With a key the Claude API path keeps priority; both
remain available.

- **Public sources** (`src/lib/server/research/`). `http.ts`: `getJson` never throws (繁中 errors),
  `User-Agent: Livelyrics/0.1 (contact: https://github.com/alanwu14832-bit/Livelyrics-)`, 6 s per
  request, the platform `fetch` (so `NODE_USE_ENV_PROXY` applies), `RateGate` (MusicBrainz ≥ 1.1 s
  apart, shared per process), `sourceConfig`: `LIVELYRICS_FREE_SOURCES=off` disables the lookups,
  `LIVELYRICS_MUSICBRAINZ_URL` / `LIVELYRICS_WIKIPEDIA_URL` (with `{lang}`) point them elsewhere (the
  e2e stub). `musicbrainz.ts`: `/ws/2/recording?query=` (title + artist credit, Lucene-escaped) →
  the best studio take whose credit / sort name / alias matches (names compared with `nameKey`:
  NFKC, lowercase, simplified → traditional via `src/lib/zh-variants.ts`) → `/artist/<id>?inc=
  genres+tags+url-rels` (type, country, area, begin year, disambiguation, genres, tags, ≤ 6 useful
  links); else an artist search. `wikipedia.ts`: REST `/w/rest.php/v1/search/page` + `/api/rest_v1/
  page/summary` on zh (`Accept-Language: zh-TW`) then en; the artist page must look musical, a song
  page must name the artist; 429 stops that language. `public-info.ts`: `lookupPublicInfo` runs both
  in parallel inside a 15 s budget (far inside the cloud step's 300 s) and returns `PublicInfo`
  (`status` per source: ok / none / failed / skipped, `notes`); it is cached as
  `Project.research.publicInfo` and reused while fresh (same names, no failed source, < 30 days).
- **Local analysis** (deterministic, `designer/`). `lexicon/imagery.ts` (54 image families: words,
  scene family, hues, saturation, light, temperature, motion, emblem, a 繁中 colour phrase, how visual
  the family is; stop words such as 上海 / 花錢), `lexicon/sentiment.ts` (≈ 270 zh / en words with
  valence and arousal, negators, intensifiers, chants), `lexicon/genres.ts` (20 genre rules: MusicBrainz
  tags and 繁中 keywords → palette tendency, scene family and avoided scenes, lyric density and verse /
  chorus styles, motion energy, typography, motifs, the live habit and a one-line why).
  `lyric-analysis.ts`: forward-maximum-matching tokenizer over the lexicons (code-point offsets,
  simplified lyrics matched through the traditional map), imagery (the title counts double), emotion
  (negation, intensifiers, chants, `!`, the hook weighted 40 %; labels 明亮激昂 / 溫柔明亮 / 痛苦掙扎 /
  憂傷低迴 / 矛盾拉扯 / 平靜內斂), point of view (我們 / 我–你 / 你 / 我 / 他), sing-along phrases (repeated
  token-bounded grams or chants, always shorter than their line). `audio-mood.ts`: BPM, energy,
  section contrast, brightness, bass, onset → 爆發釋放 / 冷冽推進 / 溫暖律動 / 陰鬱緩慢 / 溫柔漂浮, the energy
  shape and the peak. `genre.ts`: tag / Wikipedia matches, general words ("rock", 搖滾) weighted down.
  `findings.ts`: `analyzeFindings` → `Findings` + `DesignHints` (hue, accent hues with the genre
  leading and the strongest image as the accent, saturation, scheme, temperature, scene family minus
  the genre's avoided scenes, motifs, typography, lyric density and styles, motion, sing-along, a
  世界觀 sentence).
- **Synthesis.** `free-research.ts`: `freeResearch` streams 「查詢 MusicBrainz…」「讀取維基百科…」「分析歌詞
  意象…」 (and `onSearch` per source) and returns a `Research` (`engine: "free"`, the five research
  headings, sources = the MusicBrainz / Wikipedia pages and official links, `publicInfo`), labelled
  「免費研究（公開資料＋歌詞與音訊分析）」 (`src/lib/research-labels.ts`). Every source may fail: the brief then
  says so and stands on the lyrics and the audio. `DesignerInput.publicInfo` carries the facts into
  the design step and the directions: `offlineDesign` takes palette, scheme, saturation, fonts, scene
  family, lyric styles, transitions (soft genres never flash), motifs, the concept sentence, the
  「免費研究的發現」 notes, the sing-along emphasis and cues from the findings (the bible and the mood
  board still come first); `offlineDirectionSpecs` keeps film / collage / minimal but takes each
  direction's colours, scenes, motifs and wording from the song, and the genre's native axis takes
  the genre's colours and lyric habit (folk → a warm earth-toned film, punk → the collage).
- **用 claude.ai 研究** (`designer/manual.ts`, `designer/manual-reply.ts`, `src/lib/server/manual.ts`,
  `src/components/manual/ManualClaudeSheet.tsx`). `buildManualPrompt` (plan or directions; 精簡版
  abbreviates the lyrics, the findings and the catalogue and asks for shorter answers): the task
  (research on the web first, the brief with the five headings, then exactly one ```json block), the
  song, the lyrics marked by section 【a1 主歌一 0:08–0:24｜能量 0.43】 with line ids, the audio summary
  and energy curve, the free findings, the bible, the mood board (the user attaches the images; notes
  and measured colours listed), the band's material, the canvas, the lyric safe area and LED 安全模式,
  `DESIGN_SYSTEM` / `DIRECTIONS_SYSTEM` (the API's own rules), a field reference generated from the
  structured-output schema (`designPlanJsonSchema()` / `jsonOutputFormat(DirectionDraftSchema)`) and
  a JSON template on the song's real section timings (valid against the zod schemas; （…） marks what
  to write). `readManualReply` (never evaluates; ≤ 200 KB UTF-8): the best ```json / ~~~ fence or a
  bare balanced object; `JSON.parse`, else `repairJson` (smart / single quotes as delimiters, stray
  quotes inside strings, trailing commas, comments, fullwidth punctuation, unquoted keys, raw line
  breaks, True / False / None, missing commas) and parse again; truncation vs unbalanced brackets;
  errors with line, column and a snippet. Plans: `DesignPlanSchema` issues in 繁中 (auto-repaired and
  listed when the plan is usable), refused when unusable, a directions JSON, ≥ 3 template
  placeholders left, ≤ 2 sections for a song of ≥ 5, or > 15 schema problems; then
  `normalizePlanWithReport` (repairs as notes) and `safetyReport` (what LED 安全模式 changes).
  Directions: ≥ 2 distinct usable drafts via `normalizeDirectionDrafts` (no offline top-up) →
  `buildDirections(engine "manual-claude")`. The brief is the text before the JSON (a JSON-first reply:
  after it), tidied like Claude's, sources from its links (http(s) only, claude.ai skipped); a failed
  reply returns it so a JSON-only fix still saves it. `fixPrompt` lists the problems for the same
  chat. Applying saves `plan` (old one in `previousPlan` with its `source`, for 復原), `planSource
  { engine: "manual-claude" }` and `research { engine: "manual-claude", publicInfo kept }`, or the
  direction set.
- **Who made the plan.** `Project.planSource` (`PlanSource`): the pipeline's design step (Claude with
  its model, else `free` / `offline`), 用 claude.ai 研究, or 採用這個方向 (the direction's engine);
  `PlanSnapshot.source` brings it back on 復原. The console top bar shows it (`designStatusLabel`).
- **UI.** Home: 「免費研究模式」 (status button, line, connect sheet explaining the free mode, the
  claude.ai option, then the API key steps). Design overview: a 「用 claude.ai 研究」 card under 重新設計,
  the free-mode placeholders while the stream runs, the research panel / console tab labels and
  footnotes per engine; 設計方向: 「用 claude.ai 提案」. The sheet: 完整版／精簡版, 「複製提示詞」, 「打開 claude.ai」
  (https://claude.ai/new), the mood board images to attach (each opens in a tab), the paste area with
  a byte counter, 「套用」, the error list with 「複製修正提示詞」, the success notes, 「進入控制台」 and 「復原」.
- **Tests** never reach the network: `src/test-setup.ts` makes `fetch` to MusicBrainz / Wikipedia /
  Wikidata throw; the lookups take a fake `fetch` serving the real responses saved in
  `fixtures/research/` (`designer/testing/public-sources.ts`). `research/research.test.ts`,
  `designer/analysis.test.ts`, `designer/free-research.test.ts`, `designer/manual.test.ts`,
  `server/manual.test.ts`; E2E `scripts/e2e-free-research.cjs` (a local stub serving the fixtures,
  then unreachable sources; the manual round trip with a good reply in prose and a broken one).

### 同步與控制器 (phase 5a)

MIDI controllers, the MIDI beat clock and timecode chase (MTC, LTC) for the per-song console (`/p/[id]`) and
the show console (`/s/[id]/live`). Everything is opt-in: the default source is 手動, and neither MIDI nor
audio permission is asked for until the operator picks a source or turns MIDI on, so manual operation and
every existing path are unchanged. The projection windows never see any of it except the beat phase.

- **Pure cores** (no DOM, all unit-tested). `src/lib/midi/parser.ts`: `MidiParser.feed(bytes, emit)` — running
  status, realtime bytes (F8 FA FB FC FF; FE active sensing dropped) anywhere, also inside SysEx, note on with
  velocity 0 = note off, CC, program change, pitch bend, pressure, SPP (F2), MTC quarter frames (F1), song
  select, SysEx (bounded, `MAX_SYSEX_BYTES`); `describeMidi` for the readouts (`noteName`: middle C = C3).
  `src/lib/midi/clock.ts`: `MidiClock` — 24 ppqn; a least-squares line through (tick number, time) of the last
  4 beats; every tick is judged against the line (not the previous tick), so bunched / late ticks and coarse
  timestamps are jitter; three ticks one period off = a lost or doubled tick (counted back in or out), three
  drifting further = a tempo change (the line restarts); BPM display with 0.2 BPM hysteresis; Start / Stop /
  Continue / SPP give the beat phase (`aligned` once a Start or SPP was seen); lock = a tick in the last
  `CLOCK_LOCK_TIMEOUT_MS` (500). `src/lib/midi/mtc.ts`: `MtcAssembler` — eight consecutive quarter frames make a
  timecode (24 / 25 / 29.97 DF / 30; a piece out of order or more than `MTC_MAX_PIECE_GAP_MS` after the last
  starts over), the direction from the piece order (a turn restarts the run); the position at the completing
  piece is the label + 1.75 frames forward (+0 backwards), i.e. the two-frame MTC latency is compensated; full-frame SysEx `F0 7F <dev> 01 01 hh mm ss ff
  F7` locates. `src/lib/sync/timecode.ts`: rates, DF frame counting, `formatTc` / `parseTc` (full-width
  separators, `HH`, `HH:MM`…), `TimecodeStringSchema` (zod), `DEFAULT_START_TC` 01:00:00:00.
  `src/lib/sync/ltc.ts`: `LtcDecoder(sampleRate).process(samples)` — DC blocker, peak envelope with a release
  and 30 % hysteresis (any level), interpolated zero crossings, biphase-mark bit timing with an adaptive
  period (bootstrap, then α = 0.08 tracking: ±1 % speed and more), sync word 0x3FFD forward / 0xBFFC
  backwards, 24 / 25 / 30 fps from the frame length, the DF flag (29.97), user bits ignored, the bit clock
  forgotten after 1 s of silence. `src/lib/sync/chase.ts`: `TimecodeChase` — the playback rig's position as
  a phase-locked estimate (pull 0.3 per frame, tolerance max(80 ms, 2 frames)); a jump relocates only after
  `confirmFrames` (3) consistent frames more than that away, so one stray frame never moves the song; no
  frame for `gapMs` → 自由運轉 (the clock runs on) for `freewheelMs` (default 2 s, settable 0.5–10 s) → 中斷
  (the position freezes where the freewheel ended); a locate (MTC full frame) is 已定位 / stopped. Mapping:
  `startSeconds`, `songTimeAt(position, start, rate)` (song time = timecode − the song's start),
  `setlistSlots(items)` (a song's own `timecode`, else its position among the songs: song n at n:00:00:00,
  none past 23 h), `slotStart`, `slotAt(position, slots, rate)` (from a start until the next start or one
  hour later).
- **Mapping** (`src/lib/midi/mapping.ts`). `MidiMapper.handle(msg, at)` → `{ commands, learned? }`; targets:
  every hotkey action (`BUTTON_TARGETS`, incl. `go` / `standby`, `testPattern`, `scene1…9`, `manual`) and
  the faders `intensity`, `lyricScale`, `ledCap` (`VALUE_TARGETS`). Bindings are a note or a CC with a
  channel (or any channel). Safety: note off never fires; a CC used as a button fires rising through 64 and
  re-arms below 40; buttons ignore repeats within 60 ms, GO / standby within 150 ms (tap never); explicit
  bindings win over the presets; learning a trigger moves it away from the action that had it
  (`replaced`). Presets: ProPresenter 式 `lineNotes { enabled, channel, offset }` (note n → lyric line
  n + offset, 0-based) and 段落音符 `sectionNotes { enabled, channel, base }` (note base + k → section k).
  `conflicts`, `conflictText`, `triggerLabel`, `exportMidiMap` / `importMidiMap` (JSON with `kind:
  "midi-map"`, Chinese errors). `src/lib/midi/actions.ts` turns commands into `ConsoleAction`s
  (`HotkeyAction` plus `testPattern`, `cueLine`, `jumpSection`, `control`); `src/lib/midi/controls.ts`:
  `intensityFromControl` (0–150 %), `lyricScaleFromControl` (×0.5–2), `LedCapFader` (最高亮度 between 20 %
  and the ceiling the safety settings had when the fader took over — the preset's brightness — so a
  controller can dim the wall, never make it brighter; nothing when safe mode is off; forgotten when the
  operator changes the safety settings).
- **Browser side.** `src/lib/midi/access.ts` `MidiHub`: `navigator.requestMIDIAccess({ sysex })` (SysEx only
  when MTC 定位 is on; denied SysEx retries without it), hot-plug through `onstatechange`, one input or all,
  `port.open()`, event timestamps moved onto `Date.now()`. `MIDI_UNSUPPORTED` 「這個瀏覽器不支援 MIDI（Safari／
  iPhone 不支援），請改用 Chrome 或 Edge」; the MIDI sources are disabled there, LTC still works.
  `src/lib/sync/ltc-input.ts` `LtcInput`: `getUserMedia({ audio: { deviceId, echoCancellation: false,
  noiseSuppression: false, autoGainControl: false, channelCount: 2 } })` into the shared AudioContext and the
  AudioWorklet `public/worklets/ltc-decoder.js` (processor `livelyrics-ltc`, decoders on the first two
  channels; the active one switches after 0.5 s of silence; frames and a 10 Hz level come back with their
  sample positions). `ContextClock` maps sample positions to `Date.now()` from the least-delayed message of
  the last 5 s minus the capture latency (`track.getSettings().latency`, default 10 ms), and each frame's
  position gets its one frame of decode latency back (`framePosition`). The worklet is generated from the TS
  core: `node scripts/build-worklets.mjs` (`--check` fails when it is stale; a unit test runs the generated
  file in `node:vm` and decodes with it), so `ltc.ts` stays the one implementation.
- **SyncEngine** (`src/lib/sync/engine.ts`, framework-agnostic, `subscribe` / `getSnapshot`). One per console
  window: the per-song console's controller makes its own (settings from its `ConsoleSettings.sync`), the
  show makes one for the whole show and hands it to every song it takes (`ConsoleControllerOptions.sync`,
  plus `timecodeStart` from `slotStart`). It owns the hub, a parser per port, the mapper, the clock, the MTC
  assembler, the chase and the LTC input. `SyncSnapshot { settings, lock, rate, midi, map, learning,
  learned, ltc }`, `LockState` off / waiting / locked / stopped / freewheel / lost (a 100 ms poll). Live
  readings for the frame loops, never through React: `timecode(now)` (the chased position and its label:
  MTC / LTC sources only) and `beat(now)` (`ClockStatus`). Quarter frames and SysEx only count with MTC as the
  source; clocks always (the readout shows any clock's tempo). `onCommand` delivers mapped commands to the
  view on screen; `handle(msg, at)` is the entry every port uses (and the tests). `SyncSettings { source:
  manual | clock | mtc | ltc, ltcDeviceId, freewheelSeconds }` (`src/lib/sync/settings.ts`): per project in
  `ConsoleSettings.sync` (`livelyrics:console:<id>`), per show in `ShowLivePrefs.sync`
  (`livelyrics:show-live-prefs:<id>`, with `followTimecode`). `MidiPrefs { enabled, input, sysex, map }` in
  `localStorage["livelyrics:midi"]` (`src/lib/midi/prefs.ts`, best effort): one mapping per computer, shared
  by every song and show, moved between computers as the exported JSON.
- **Console clock** (the controller's one clock model, extended — no second clock). While the source is MTC
  or LTC and the chase is locked, stopped at a locate or freewheeling, the controller *follows*: `songTime` =
  the timecode's song time (`songTimeAt` with the song's start: the setlist's slot in the show, else
  `Project.timecode.start`, else 01:00:00:00; TRACK adds the lyric offset), clamped to the song. TRACK: the
  monitor audio chases it (seek when it drifts more than 80 ms, 300 ms grace after a seek; play / pause with
  the timecode's motion; a blocked autoplay posts one notice and the timecode keeps driving). LIVE: the
  timecode is the time; with timed lyrics it cues the lines, with untimed lyrics the operator still cues them
  by hand. Manual transport, seek, sections, loop and line cues answer 「正在跟隨時間碼…請先按 X 回到手動」
  (a notice, and the HUD 「跟隨時間碼中」) instead of fighting the timecode; hold (H) still works; a loop
  is switched off when following starts. Lost → 「時間碼中斷，已切回手動」: LIVE keeps the line on screen and
  holds at the next line's start, TRACK pauses where it is (no auto-advance without the timecode); the same
  source locking again → 「時間碼恢復，已重新鎖定」. `backToManual()` (X) sets the source to 手動. A silent
  (preloaded) show song never follows: its audio would play unseen. MIDI clock (節拍模式): a locked, running
  clock is the beat phase in both modes (even TRACK paused), before the microphone and tap tempo; the state
  says so with `LiveAudioFeatures.clock: true` (`sanitizeStageState` keeps only `true`), and the stage's
  TRACK features take the clock's phase instead of the analysis grid (`src/lib/stage/features.ts`).
- **Timecode per song and setlist.** `Project.timecode?: { start: "HH:MM:SS:FF" }` (absent = 01:00:00:00):
  PATCH `/api/projects/[id]` `{ timecode: { start } | null }` (`parseTimecodePatch`, zod, stored with ":";
  `coerceProject` repairs it), set in the 同步 tab's 起點時間碼 (`setTimecodeStart`). A song setlist item's
  `timecode?: string` (absent = its position among the songs; `coerceSetItems` validates it), set on the show
  page (the row's ⋯ → 「設定時間碼…」, `src/components/show/TimecodeSheet.tsx`: 依歌單順序 or a custom start,
  a warning when two songs start at the same timecode; the row shows a custom start as a tag). 「跟隨時間碼換歌」
  (the rail's switch, `ShowLiveController.setFollowTimecode`): every 100 ms, a locked, running, forward
  timecode that enters a song's range whose song is not on air takes it with the show's take transition;
  edge-triggered (a song the operator left is not taken back until the timecode enters another song or
  stops), looks stay GO / manual. While it is on, the rail shows each song's start (`TC 01`).
- **UI** (`src/components/console/sync/`, console chrome only). `SyncPanel.tsx`: 同步來源 (手動 / Clock /
  MTC / LTC with captions; MIDI sources disabled without Web MIDI), the lock tile (`SyncStatus.tsx`
  `LockTile`: green 鎖定 / 已定位, yellow 自由運轉 with the seconds, red 中斷, grey 等待訊號; the timecode
  HH:MM:SS:FF with its rate, song position and offset, or the clock's BPM with a beat dot; readouts written
  per frame through refs), the source's settings (MTC 定位 (SysEx); the LTC input, its level and the channel
  it decodes; 起點時間碼 — read-only 「在演出頁設定」 in the show; 自由運轉 seconds), 回到手動 with its key,
  and the MIDI section (on / off, input, activity light, the mapping summary, 「控制器…」). It heads the song
  console's 同步 tab (whose tab carries the lock colour as a dot); the show's look and pre-show views open it
  as the 「同步與控制器」 sheet (`SyncSheet.tsx`). `ControllerSheet.tsx` (控制器): the live last-message
  readout and learn banner (學習中 / 已對應 …, what it replaced), MIDI on / input, the two presets with channel
  and offset / base and what they map, every target by group with its key, its binding or 未對應, conflicts,
  學習 / 取消 / 清除 (GO and standby only in the show console), JSON 匯出 / 匯入, 全部清除; Esc cancels a
  learn before it closes the sheet, B still blacks out. `SyncCapsule` on the top bar (song, look and
  pre-show views, never the output): 「MTC 鎖定」, 「LTC 自由運轉」, 「時間碼中斷」, 「MIDI clock 128 BPM」;
  nothing while manual. MIDI commands reach whichever view is on screen (`useMidiCommands`), through the
  same dispatch as its keys and the same HUD (faders answer 「畫面強度 85%」…), also while a sheet is open;
  before a show song has loaded only GO / standby do.
- **Tests.** Unit: parser (running status, interleaved realtime, SysEx), mapping (learn, conflicts, presets,
  CC hysteresis, debounce, files), clock (jitter, bunching, quantized timestamps, tempo changes, lost /
  doubled ticks, phase), MTC (every rate, direction, dropped pieces, locate), LTC (24 / 25 / 30 and 29.97 DF
  at 44.1 and 48 kHz with noise, level changes, ±1 % speed, dropouts, user bits, reverse, block sizes; the
  generated worklet in `node:vm`), chase (relocate, glitch rejection, freewheel → lost, setlist slots),
  engine, the console controller with MTC / clock (follow, freewheel → manual, relock, LIVE, start
  timecode, silent show songs), the show's 跟隨時間碼換歌, schema and storage fields. End to end:
  `scripts/e2e-sync.cjs` (a fake MIDIAccess from an init script whose `window.__midi` sends stamped
  messages through the real code; an LTC WAV as Chromium's fake microphone).
- **Limits.** No real MIDI device, LTC hardware or Safari was tested. 29.97 fps non-drop LTC reads as 30
  (the frame length cannot tell them apart; DF is flagged); the LTC position carries the capture latency the
  browser reports (default 10 ms when it reports none); MTC direction is taken from the piece order and the
  reverse position assumes the mirror of the forward latency.

### 字體藝術 (phase 6)

Every sung line appears, and every line is a designed typographic composition, never a karaoke
subtitle. A plan with `typeSystem` renders its lyrics through the type engine; a plan without one
(every plan made before this phase) keeps the DOM lyric styles exactly as before, and so does a
plan whose operator forces a lyric style in the console (`typeModeActive`).

- **Data** (`src/lib/schema.ts`, re-exported in `types.ts`). `DesignPlan.typeSystem` (nullable,
  optional): `voice` (`mv-card` 日系 MV 字卡, `title-sequence` 電影片頭／動態海報, `ink` 書法與水墨,
  `glitch` 實驗／故障感), `params` (0–1: `scaleContrast`, `density`, `verticalRatio`, `gridMargin`,
  `motionSpeed`, `motionIntensity`, `texture`, `ornament`; `gridColumns` 2–12), `color` (`solid` /
  `knockout` / `overprint`), `fonts { cjk, latin }` (the font catalogue; the CJK one must be CJK),
  `weight` 600–900, `ornaments` (rule, number, section, title, seal, bracket), `seal` (1–4
  characters), `rationale`, and `lines`: one `TypeLine` per sung line — `recipe`, `emphasis` (exact
  substrings), `orientation` h / v / mixed, `energy`, `motionWord` (an exact word of the line), `seed`
  — plus the editor's fields: `locked`, `edit` (`TypeLineEdit`: recipe, emphasis, orientation,
  motionWord, seed, `dx` / `dy` fractions of the canvas, `scale` 0.5–2, `rotate` ±30°, `enter`, `exit`,
  `color` ink / accent / invert / window; no colour = 自動, what the song's colour treatment gives
  the line). `typeSystem.sections` (the editor's per-section recipe /
  orientation / scale / motion overrides) and `generation` (the salt of 「重新生成全部構圖」).
  `DesignPlanDraftSchema` is what an automatic designer writes: the same plan with the type system
  required, no editor fields, and `AUTO_LYRIC_STYLE_IDS` (no `karaoke`, no `subtitle`) for the legacy
  section and line styles. `karaoke` and `subtitle` stay valid ids for old plans and the operator.
- **Engine** (`src/lib/type/`, pure, deterministic, tested in Node). `vocab.ts` (the voices: their
  recipe palettes with weights, default parameters, colour treatment, fonts and the faces that speak
  them, weight, ornaments, entrance / exit, beat snap, motion and speed scale; the 13 recipes; the 繁中
  labels), `motion-words.ts` (風 drifts, 雨 falls, 火 flickers, 心跳 pulses on the beat, 海 / 浪 wave,
  夜 rises from the dark, 光 blooms, 碎 shatters, 奔跑 rushes, 轉 spins; stop compounds such as 開心),
  `text.ts` (the line as units with 禁則 atoms, vertical forms: brackets, dashes and Latin rotated,
  1–2 digit numbers upright; the row breaker balances rows, avoids orphans, never opens a row with a
  soft mark or a particle (的了著…), breaks at the word timing's words or, without it, never inside a
  small lexicon of lyric words (城市, 方向, 交給…) and willingly before 這 / 那 / 每; the featured
  word of a display recipe: an emphasis run, the motion word, else the best pair of the line (a
  lexicon word, a phrase-final noun) or one strong character when every pair leans on a function
  word (跟著我「唱」)), `frame.ts` (the canvas in output pixels: the lyric safe area minus a bottom
  band (10 % of the height, at most 20 % of the safe height), the column grid, the minimum readable
  size = `STYLE_METRICS.subtitle.size` % of the short side, ≥ 22 px; the size reference is the
  height of a 16:9 canvas of the width, leaning towards the width on a tall canvas so 9:16 type is
  set for its width, not for a letterbox), `set.ts` (rows and columns of glyph boxes), `recipes.ts`
  (the recipes; a tall canvas stands a composition around its optical centre), `compose.ts`
  (`composeLine`: sizes from scale contrast, density and energy, the last chorus ×1.08;
  `effectiveOrientation`: on a tall canvas an automatic orientation stands a display word up (巨字 a
  column beside horizontal small text, 出血 and 鏤空窗 vertical; an orientation set in the editor
  stays); an ultra-wide canvas (> 2.4 : 1, a 32:9 LED wall) composes each line in a 16:9-and-a-bit
  view that slides to the side its seed leans to (a bled word's view on the edge it bleeds from); the
  colour roles: 反白 cuts the display text out of blocks of the ink colour, 鏤空 makes it a window
  that fills the frame, 自動 under the knockout treatment opens the display word of strong lines
  (energy ≥ 0.6) with the frame only partly filled (0.52–0.84, the stage stays half seen); the
  ornaments: numbers, the section label and a rule once per section, the song title on the first and
  last line, 「」 hung outside an MV card's block (the block steps in from the frame edge to make
  room), the seal at the end of the text;
  `placeTranslation`: the translation never sits on the composition (a seal, an echo trail, the small
  text): the recipe's place when free, else under the block, beside its foot, under everything, over
  it, re-set in two balanced rows for the measure, then the block moves up, then it shrinks (never
  below the minimum); the editor's scale, rotation and nudge (fractions of the whole canvas) applied
  after the layout and fitted back into the canvas; entrance / exit timing), `animate.ts`
  (per-glyph and per-piece frames: entrances, exits, the motion word's motion, the glitch stutter on
  beats — at most 3 a second with LED 安全模式 on, a shake while the line holds (the entrance and
  the exit may tear it apart), a torn row of 撕裂 keeps its tear — and the type-pass uniforms),
  `resolve.ts` (`resolveLine`: the line's hint, a repeat's first occurrence (base and edit) unless it
  was edited itself, the section override, the editor's edit, the last chorus's escalation;
  `autoHint` for lines added after the design), `sequence.ts` (`sequenceTypeLines`: one coherent
  system, consecutive lines vary (recipe, side of the frame), repeats reuse the first composition,
  verses calm, choruses loud, the bridge brings recipes the song has not used, quiet lines whisper;
  the band's lyric policy as typographic intensity: chorus-only keeps the verses small, minimal lets
  only the hook be big), `normalize.ts` (`normalizeTypeSystem`: clamps, enums, fonts in the right
  script, exact-substring emphasis and motion words, unknown ids and recipes dropped, the missing
  hints drawn by the sequencer, editor fields kept when asked), `prepare.ts` (`composeProjectLine`),
  `edit.ts` (the editor's operations and its undo history).
- **Rendering.** `src/components/stage/type/TypePainter.ts` rasterizes glyphs once into a sprite
  cache (per face, weight snapped to the faces' real weights, size step and plate) and composites the
  compositions of the moment into one canvas: red = the ink plate, green = the accent plate, blue = the
  spot plate (a knockout window or the seal), alpha = the plates plus a soft legibility halo. `TypeLayer`
  decides what is on screen (the current line entering or holding, up to three leaving: a brief
  overlap), caches compositions by layout key, clocks the entrance from the line start (snapped to
  the beat grid for MV cards and glitch; live-cued lines from the cue) and exits on wall time, skips
  repainting a static frame, and hands a `TypeDraw` to the renderer. `src/lib/stage/scenes/type.ts` is
  the type pass: scene (+ media) and the plates → ink wobble, glitch slices, RGB split, ink bleed (blur
  and a noisy threshold), dry-brush 飛白, characters eaten by bright scene areas, grain, the halo,
  glow, knockout (the frame filled, the scene seen through the glyphs; where the picture is as dark
  as the fill the ink colour comes through the letters so they keep their contrast), the halo
  stronger over a bright picture, overprint (a misregistered
  screened accent plate). In `StageRenderer` it runs after the media pass and before the LED safety
  pass, so the brightness cap, the soften shoulder and the flash limiter measure the type too
  (`renderTypeLayer` renders it alone over transparent for the export's lyric layer). Without WebGL the
  painter draws real colours into a DOM canvas (the safety cap as a CSS filter). The current line's
  text is also in a visually hidden element (`[data-type-layer]`, with `data-recipe` / `data-voice`).
  One path everywhere: the projection, the console preview, the stage lab, the style frames, the
  proposal and the export (`OfflineStage` runs `TypeLayer` on song time; the full frame is chain 0 of
  the safety pass, the background variant a second picture on chain 1, the lyric layer the type pass
  alone; `drawFull` composes the full variant).
- **Designers.** Claude: `DESIGN_SYSTEM` rule 3 (every line a composition, the voices, the recipes,
  emphasis, motion words, repeats may be left out) and `typeCatalogBlock()`; the prompt names how many
  distinct lines to compose (`typeReminder`); the structured output is `designPlanJsonSchema()` from
  `DesignPlanDraftSchema` (request shape unchanged: adaptive thinking with `drop_block`, the betas,
  effort high, `DESIGN_MAX_TOKENS`). Free / offline: `designer/type-design.ts` (`chooseVoice`: the
  genre rule's `type` (punk / metal / math rock / electronic / psychedelic → glitch, folk / ambient →
  ink, city pop / indie pop / post-punk / hip hop / jazz → title-sequence, post-rock / shoegaze /
  dream pop → MV cards with big whitespace, indie / alt rock / emo / pop / R&B → MV cards), else the
  audio mood and the lyric emotion; `lineEmphasis` (chant, sing-along phrase, imagery), `lineMotion`,
  `designTypeSystem` (the bible's fonts are kept whatever the voice)). No automatic designer picks
  karaoke or subtitle; no section with sung lines is hidden (the genre rules and the lyric policy
  make verses quiet instead). Directions: every direction speaks another voice (`directionVoices`:
  the song's own voice on the look that suits it; `distinctVoices` for Claude's), `DirectionDraftSchema
  .typeVoice`, and each plan carries its type system. The claude.ai prompt: the same rules and schema,
  a `typeSystem` in the template, the compact catalogue in 精簡版; the reply checks the type system
  apart (its problems are repaired and listed, never a refusal). `normalizePlan` (`typeSystem:
  "fill"`, the default for design outputs) repairs and completes the type system, or designs one by
  the rules when the engine wrote none, and replaces karaoke / subtitle; `"keep"` (the show arc, an
  offline instruction, the previous plan) leaves an old plan old. Lyric edits re-point the hints
  (`remapPlanLines`).
- **排版 editor** (`/p/[id]/type`, `src/components/type-editor/`), linked from the design overview's
  header, the console's top bar (a new tab) and its design tab. Song: the voice (a switch redraws the
  unlocked lines in the new voice), every parameter, fonts, weight, colour treatment, ornaments and
  seal, 「重新生成全部構圖」; section: recipe / orientation / size / motion overrides; line: recipe
  thumbnails (the real engine in colour mode), 「換一個構圖」 (the next seed of a fixed sequence),
  emphasis by tapping characters (adjacent ones join into a word), orientation, motion word, entrance
  and exit, position by dragging the preview (fine pointers) or the arrow pad, size and rotation,
  colour role, 鎖定, 「重設為生成的」. The preview is `<StageView>` at the output aspect, paused at the line
  settled or playing from it, with an A/B against the generated version (no edits, no overrides).
  Every change is an undo step (drags and slider moves merge), posted on the song's channel as a
  `plan` message (a console adopts the type system and re-broadcasts, a per-song output without a
  console shows it) and saved through `PATCH /api/projects/[id] { plan }` after 700 ms (last write
  wins, like the console); a console's `project` messages come in when nothing here is unsaved. A
  legacy plan offers 「建立字體語言」 in each voice. Phone: the preview sticks under the header, 44 px
  targets, 「這一句／段落／整首」 tabs and a line sheet.
- **Stage lab**: `?voice=<voice>&aspect=16:9|32:9|9:16&project=<id>&gen=<n>` shows a song in a voice
  on a canvas (screenshots).
- **Tests**: `src/lib/type/type.test.ts` (determinism, every recipe on 16:9 / 32:9 / 9:16 inside the
  readable area at or above the minimum size, reading order, vertical forms, 禁則, orphans, Latin never
  vertical), `src/lib/type/sequence.test.ts` (sequencing, the editor's operations, old plans),
  `designer/type-design.test.ts` (every engine without karaoke / subtitle, the voice choice,
  normalizePlan on the new fields, the output schema accepting a full plan, the manual reply), plus
  protocol, remap and console adoption tests; E2E `scripts/e2e-type.cjs`.

### 專屬畫面與字的構圖 (phase 7)

Every song gets its own generative scene program — one GLSL fragment program written for that song
(by Claude, or by the offline composer) — and its typography is composed *with* the image: the words
sit in the image's negative space and meet it (cut out of it, behind a foreground shape, lit by it).
Plans without a program (every plan before this phase, and any plan whose operator switched it off)
render exactly as before: the built-in scene of each section and the whole readable area for type.

- **Data** (`src/lib/schema.ts`, re-exported in `types.ts`). `DesignPlan.sceneProgram` (nullable,
  optional): `SceneProgram { version 1, engine claude | offline | example | manual, model?, title,
  concept, source, sections, keyMoment?, enabled, createdAt?, instruction?, recipe? }`. `source` is a
  GLSL function body (helpers + `vec3 scene(vec2 fc)`). `sections[]` = `{ sectionId, mode 0–3, params
  [4 × 0–1], zone { x, y, w, h } (fractions, y down), relation plain | knockout | behind | lit, note }`.
  `enabled: false` = 「改用內建場景」 (the program is kept). The 排版 editor's per-section override
  `TypeSection.zone / .relation` (in the type system, so it rides the editor's undo, save and channel)
  wins over the program's; `TypeLineEdit.key` marks / unmarks a 重點句. `DesignPlanDraftSchema` (the
  design call's output) does not contain the program: it has its own step.
- **Model** (`src/lib/stage/program/model.ts`, pure, server and browser): `normalizeSceneProgram`
  (validator first; unknown sections dropped, missing ones filled from `KIND_DEFAULTS` by kind —
  verse sparse, chorus open, bridge mode 3 —, values clamped, zones ≥ 30 % × 24 % inside the frame),
  `activeProgram`, `programSection` / `planSection` (the section's state, a section the program does
  not know takes its kind's defaults, so a re-designed plan keeps working), `canvasZone` (zones are
  written for a landscape frame; on a tall canvas a left zone becomes the upper band and a right zone
  the lower band, so the words alternate top / bottom across the song and the program's focal form
  takes the other half), `sectionComposition` (what the type engine reads), `programCode` (validated
  code + a cache key), `keyMomentOf` (the key still: the program's moment, else 60 % into the first
  chorus), `programModeKey`.
- **Uniform contract** (`src/lib/stage/program/contract.ts`): the renderer wraps the body between its
  own prelude — version / precision header, every uniform below, a helper library, the type-mask and
  emblem samplers only behind helper functions, `#line 1` so logs point at the program's lines — and
  epilogue (`main()`: the operator's master intensity, dither, clamp; alpha = 1 − `gFront`, the
  foreground mask the type pass reads). `PROGRAM_UNIFORMS` lists the names; the same text is given to
  Claude verbatim (`PROGRAM_CONTRACT_DOC`):

```text
你寫的是一段 GLSL 函式本體（GLSL ES 1.00 與 3.00 的共同子集），必須定義：

  vec3 scene(vec2 fc)   // fc = gl_FragCoord.xy（像素，左下為原點），回傳 0–1 的顯示色（sRGB）

可以另外寫輔助函式與 const 常數。系統會在前面加上版本、精度、下列所有 uniform 與輔助函式，在後面加上 main()（總亮度、抖色、限制在 0–1），之後畫面還會經過素材層、歌詞排版層與 LED 安全模式（亮度上限、柔化、閃爍限制器、紅閃保護），所以你不需要、也不能自己處理安全。

uniform（全部由系統提供，不能自己宣告）：
  vec2  uRes              畫布像素（寬, 高）
  float uTime             場景時鐘（秒，依段落速度與能量累積，凍結時停止）
  float uClock            牆上時鐘（秒，給顆粒用）
  float uSongTime         歌曲時間（秒）
  float uSongProgress     整首歌進度 0–1
  float uSeed             這首歌固定的種子 0–1000
  float uBeat             拍內相位 0–1（拍點時歸零）
  float uBeatN            拍數計數（每拍 +1）
  float uBar              小節內相位 0–1（四拍一小節）
  float uTempo            每秒幾拍（BPM / 60；未知時 2.0）
  float uPulse            拍點衝擊 0–1（已經過 LED 安全的速率限制）
  float uEnergy           分析出的此刻能量 0–1
  float uLevel, uBass, uOnset   即時音訊：音量、低頻、起音 0–1
  float uIntensity        段落強度 × 操作員總強度（0–1.5，供參考；總強度會在 main() 再乘一次 uMaster）
  float uMaster           操作員總強度（0–1.5）
  float uReact            音樂反應程度 0–1（安全模式會壓低）
  float uSection          目前段落索引（0, 1, 2…）
  float uSectionKind      段落種類：0 intro 1 verse 2 pre-chorus 3 chorus 4 bridge 5 solo 6 breakdown 7 outro 8 interlude
  float uSectionEnergy    段落能量 0–1
  float uSectionProgress  段落內進度 0–1
  float uMode             這一段的模式（整數 0–3，由你在 sections 裡指定）
  vec4  uParams           這一段的四個參數 0–1（由你在 sections 裡指定）
  vec3  uBg, uPri, uAcc   這一段的配色：背景、主色、點綴
  vec3  uInk              這一段的歌詞色
  vec3  uPal0, uPal1, uPal2, uPal3, uPal4, uPal5   整首歌的色票（uPal0 最深；不足六色時重複）
  vec4  uZone             這一段的文字區（uv：x0, y0, x1, y1，y 向上，0–1）
  float uRelation         字與畫面的關係：0 plain 1 knockout 2 behind 3 lit
  vec4  uTypeBox          目前歌詞實際的範圍（uv：x0, y0, x1, y1；沒有歌詞時全為 0）
  float uTypeAmt          歌詞可見程度 0–1
  sampler2D uType, uMotif 歌詞字形與主視覺符號的貼圖：只能透過下面的 typeMask／typeGlow／motifMask 讀

輔助（已定義，直接用，不能重新定義）：
  PI, TAU; sat(x); rot(a) → mat2; hash11(p), hash12(p), hash22(p); vnoise(p); fbm(p)（5 階）; fbm3(p)（3 階）
  centered(fc) → 以短邊為 1、中心為原點的座標; aspect() → 寬/高; luma(c); ramp(t) → uBg→uPri→uAcc
  palette(t) → 沿 uPal0…uPal5 的漸層; px() → 一個像素在 centered 座標裡的大小（抗鋸齒）
  fill(d) / stroke(d, w) → 由距離場得到覆蓋率; sdCircle(p, r), sdBox(p, b), sdSegment(p, a, b)
  grain(fc, amount) → 顆粒; kick() → uPulse × uReact; isSection(k) → 目前段落種類是否為 k（1 或 0）
  zoneMask(uv, soft) → 文字區的柔和遮罩 0–1; zoneCenter() → 文字區中心（uv）
  typeMask(uv) → 此刻歌詞字形的覆蓋率 0–1（字的形狀）; typeGlow(uv, r) → 字形周圍 r（uv）內的柔光 0–1
  motifMask(uv, bias) → 主視覺符號（白底透明）的覆蓋率

全域變數：
  float gFront            前景遮擋 0–1：你在 scene() 裡把它設成前景形狀的覆蓋率，
                          關係是 behind 的段落，字會從這個形狀後面經過（其他關係不影響）

規則（驗證器會拒絕違反的程式）：
  - 不能有 # 開頭的任何前處理指令（#extension、#define、#version…）
  - 不能宣告 uniform / attribute / varying / in / out / precision / sampler，不能用 texture 系列函式（只能用上面的輔助）
  - 不能定義 main，不能用 gl_ 開頭的名稱、discard、while、do、switch
  - 只能用 for 迴圈，而且必須是 for (int i = 常數; i < 常數; i++) 的形式，每個迴圈最多 48 次、巢狀相乘最多 256 次
  - 不能用 ES 3.00 才有的函式（round、trunc、tanh、sinh、cosh、inverse、transpose、determinant、isnan、isinf…）、uint、位元運算或 %
  - 整段程式不超過 16000 字元（不含註解），註解以外只能有 ASCII
  - 每個畫素的成本要合理：避免在迴圈裡再疊 fbm，5 階 fbm 一個畫面最多用六、七次
```

- **Validator** (`src/lib/stage/program/validate.ts`, run on the server before a program is stored —
  `normalizePlan`, PATCH `/api/projects/[id]` (400 in 繁中), the scene step — and again in the browser
  before it is compiled, because a program also arrives over the BroadcastChannel): source ≤ 24 000
  characters, code ≤ 16 000 after comments are stripped (comments are removed before compiling; GLSL
  ES 1.00 allows only ASCII), no `#` at all, no backslashes, a tokenizer with an allowed operator set
  (no bit operations, no `%`), forbidden identifiers (uniform / attribute / varying / precision
  qualifiers / sampler types / every texture function / `main` / `discard` / `while` / `do` /
  `switch` / ES 3.00-only builtins such as round, tanh, inverse, isnan / uint / derivatives /
  reserved words), reserved prefixes (`gl_`, `webgl_`, `__`, `ll_`), `in` / `out` only inside
  parameter lists, no redefinition of a prelude name, exactly one `vec3 scene(vec2 …)`, balanced
  braces, and loops only as `for (int i = A; i < B; i++ | i += k)` with integer literals: at most
  48 iterations each, 3 levels, 256 nested iterations. What it cannot know (a type error, a slow
  program) the renderer handles.
- **Rendering** (`src/lib/stage/gl/renderer.ts`, `src/lib/stage/program/runtime.ts`). `SceneDraw.program`
  (`ProgramDraw`: the validated code and this frame's contract values) is drawn instead of the
  section's built-in scene once compiled (`prewarmProgram` puts it first in the compile queue; while
  it compiles, or when it failed, the built-in scene is drawn). This frame's type plates are uploaded
  before the scene when a program reads them (`typeMask` / `typeGlow`); otherwise an empty 1 × 1
  texture is bound. The director carries the outgoing slot's last program values through a section
  transition; the offline frame (`offlineSceneFrame`) transitions when the program's mode changes too.
  The media pass and the transition compositor pass the foreground alpha through. `programFrame`
  builds the values from the project, the look and the clock (section index / kind / energy /
  progress, bar phase, tempo, palette ×6, the section colourway and lyric colour, the zone in GL uv,
  the lyric's measured box); an operator scene override (1–9) or a blackout scene shows the built-in
  scene. Everywhere the stage renders: the projection, the console preview, the stage lab, the style
  frames and 一頁提案 (directions carry programs), the key still and the video export (`OfflineStage`:
  `ensureReady(…, program)`, a warning when it does not compile, the background variant gets no type
  mask).
- **Fallback and budget** (`StageEngine`). A program that fails to link is switched off on that stage
  (the section's built-in scene; `console.warn`); a program still over `PROGRAM_SLOW_DT` (1/18 s) per
  frame for `PROGRAM_SLOW_SECONDS` (5 s) after the adaptive resolution has reached its floor gets a
  probe: the built-in scene draws for `PROGRAM_PROBE_MS` (2.5 s); only when that is clearly faster
  (< 0.5 × the program's frame time; logged with console.info, the preview shows the notice) is the program switched off, otherwise the machine itself is
  slow, the program comes back and no probe runs for 30 s. `StageStats.program` (`pending | ready | failed | slow | override`, the title, the
  compiler's log) and `data-scene-program` on the stage root report it; the console preview shows
  「專屬畫面無法編譯／太耗效能，已改用內建場景」 (`[data-program-notice]`). The export and the key still
  report `OfflineStage.program`.
- **LED 安全模式: no bypass.** A program only produces the scene layer: its output goes through the
  media pass, the type pass and then the same safety chain as every built-in scene (soften, the
  brightness cap, the flash limiter's measured grid and low-pass, red protection); the audio
  uniforms it receives are the safe ones (`uPulse` rate-limited, `uReact` clamped). `e2e-scene`
  measures a program that strobes the whole field 4 × a second: > 3 flashes / s with safe mode off,
  ≤ 3 and the limiter engaged with it on.
- **Type composed with the scene** (`src/lib/type/`). `LineContext.zone` (from `sectionComposition`)
  narrows the readable area to the zone (`makeFrame(canvas, params, zone)`: the grid, margins and the
  recipes' sides / bands then live inside it; the size reference stays the canvas', so a small zone
  means smaller type, not a new scale; the ultra-wide view is not used with a zone); `fitInto` keeps
  readable text inside it. The type pass (`scenes/type.ts`, `uRelation`): knockout = over the image's
  bright shapes the letters take the background tone (over the dark they keep the lyric colour, so they
  always read) and the halo backs off; behind = the program's `gFront` hides the words where the
  foreground covers them; lit = the letters take the hue and light of the image behind them, with a
  little glow; plain = as before. The program can react to the words through `typeMask` /
  `typeGlow` / `uTypeBox`.
- **Restraint.** `key-lines.ts`: a small budget of 重點句 per song (≈ one in ten distinct lines, 1–3),
  chosen for meaning — the line that names the song, the chorus hook (repeated in the choruses, the
  first line of the first chorus), then very strong lines —; `ResolvedHint.key`. Every other line is
  small-to-medium: the body size is 5.2–7.8 % of the size reference (was 6.8–11 %), the display word
  of 巨字＋小字 at most 1.6–2.3 × the body, poster / 撕裂 / grid sizes capped at 1.7 × the body; 出血 and
  鏤空窗 (large only) become 巨字＋小字 unless the editor chose them. Key lines keep the full display
  scale. Lines keep the grid, the sequencer's alternation of sides and recipes, and the reading order.
- **Pipeline** (`src/lib/server/pipeline.ts`): the steps are `lyrics → research → design → scene`
  (`ProcessStepId`, `ALL_STEPS`, the process page's steps). The scene step has its own request in cloud
  mode (its own 300 s, the Claude budget `CLOUD_DESIGNER_BUDGET_MS`), so the design step stays inside
  its budget. With Claude it calls `designSceneProgram`; without Claude a run that designed skips it
  (the design step already composed one), and a run of only this step (「重新產生畫面」) draws the
  composer's next composition (`recipe` ends in `#<salt>`). Every designed plan carries a program:
  `ensureSceneProgram` (design step, claude.ai apply) keeps the plan's own Claude / claude.ai program,
  else the previous plan's (it adapts to new sections by kind), else composes one; the operator's
  switch-off is kept.
- **Claude** (`src/lib/server/designer/scene-program.ts`, `designSceneProgram` in `index.ts`): one
  `claudeStructured` call (`SceneProgramDraftSchema` via `jsonOutputFormat`, effort high, 32 k tokens,
  adaptive thinking with `drop_block`, `fallbacks: "default"`, continuations, the deadline) with
  `SCENE_SYSTEM` (a designed image, not effects: composition before effect, one focal form, clear
  negative space, restraint on an LED wall, a reason rooted in this song and band, one world evolving
  with `uMode` / `uParams`, type and image composed together, the tall canvas, palette uniforms only,
  cost) and `buildScenePrompt` (song, research brief, the plan's key visual, palette, sections with
  times / energy / colourways, lyrics by section, the energy curve, the bible, mood board notes, the
  arc, the contract verbatim, one complete example with its section states plus the other examples'
  concepts, the current program when an instruction edits it, the instruction). A program the
  validator refuses gets one repair turn with the errors; then (or on any failure / timeout) the
  offline composer.
- **Offline composer** (`src/lib/stage/program/composer.ts`). A layered generative composer: form ×
  texture × composition × motion. Forms are hand-written GLSL modules with their own parameter spaces
  — `horizon` (a disc over a horizon: size, banding, a city line, a reflection), `pillars` (1–3 back-lit
  slabs in fog, the foreground for "behind"), `orbits` (tilted rings, a planet, moons), `strata`
  (receding ridges, roughness, a low sun, a mirror in the bridge), `bars` (printed diagonal bars that
  jump on the beat by position only), `brush` (a dry-brush circle or sweep drawn across the section),
  `ribbons` (silk bands), `threads` (falling light threads with ripples, a clear window for the words);
  textures `film` / `halftone` / `paper` / `scan` (by the type voice); motions `drift` / `breathe` /
  `rise` / `orbit` / `sweep`; the composition puts the form at least a fifth of the frame away from the
  words, on the other side (or half, on a tall canvas), and alternates the words' side when the song
  turns a page (verse after chorus, pre-chorus, bridge). The form comes from the 免費研究 findings
  (`sceneForms`: the genre's forms, then the lyric imagery's scene family, then the audio mood), the
  rest from the song's seed; the chorus takes the form's relation (horizon / orbits / ribbons lit,
  pillars behind, bars / brush knockout). Why this and not templates with colour swaps: the old
  problem was "the same effect in another colour"; here the structure of the picture (what stands
  where, what surface, how it moves, how the words meet it) changes with the song, while each module
  is still hand-designed and safe. Directions get one per direction (`directionSceneProgram`: forms
  from the direction's scene families, seeded by its letter), so the three style-frame sets show three
  worlds.
- **Examples** (`src/lib/stage/program/examples/`): five hand-written programs of the quality the
  prompt asks for — 夜航 (city pop: a setting sun, a city line, its reflection; the bridge an eclipse),
  潮間帶 (folk: a tidal flat under a low moon; the chorus floods it; the bridge a mirror), 碑 (post-rock:
  a slab in fog, light leaking, rays; the words pass behind it; the bridge splits it), 圓相 (ink ballad:
  a dry-brush circle drawn across each section; the chorus closes it around the words and cuts them
  out), 訊號 (post-punk / electronic: printed bars that jump on the beat; the chorus runs them through
  the words). `instantiateExample` lays one onto a plan by section kind. They are the prompt's
  few-shot example, test fixtures and the visual check (`/stage-lab?program=<id>`).
- **UI.** Design overview (`src/components/process/SceneProgramPanel.tsx` in `KeyVisualSummary`):
  「專屬畫面「title」」 with who wrote it, the concept, the **key still** (`key-still.ts`: `OfflineStage` at
  `keyMomentOf`, the output aspect at 960 px, queued with the style frames, cached), what each section
  does, 「使用專屬畫面」 (PATCH `plan.sceneProgram.enabled`), 「重新產生畫面…」 (a sheet with an optional
  繁中 instruction and suggestions → the process page runs `steps: ["scene"]`), and when this computer
  cannot compile it the log with 「請 Claude 修正」. The process page's step list has 專屬畫面; 重新設計
  runs design + scene. 排版 editor: the section panel's 「和畫面一起構圖」 (the text zone presets 左 / 右 /
  中 / 橫幅, its height, the relation, 「回到畫面設計的構圖」). Console: the preview's notice (the only
  console change besides a label map and two dedupe comparisons). Stage lab: `?program=plan | off |
  <example id> | composer:<form>[:<salt>]`.
- **Tests**: `src/lib/stage/program/program.test.ts` (validator: preprocessor, interface, texture,
  main, loops, WebGL1 subset, ASCII, sizes; the contract and prelude; the examples; normalization,
  zones, the key moment, `programFrame`), `designer/scene-program.test.ts` (every form × voice × seed
  validates, determinism, salt, zones alternate; five contrasting fixtures `testing/songs.ts` get ≥ 4
  forms and 5 different programs; the Claude step: the output schema, the prompt with the contract,
  a kept program, one repair turn, the offline fallback), `src/lib/type/zone.test.ts` (every recipe
  inside the zone on 16:9 and in the band on 9:16, restraint, the key-line budget, the editor's key
  mark, the example's zones across the demo song). E2E `scripts/e2e-scene.cjs`.
- **Known limits.** GLSL type errors are only found by compiling in a browser (the server has no GL);
  the console notice reflects the preview's own compile (the projection window reports its state on its
  stage root, not over the channel). The frame-time watchdog is a heuristic on the page's frame
  interval (it cannot separate the program's cost from the rest of the frame) and only acts at the
  adaptive-resolution floor. Programs have no access to the band's media textures. The composer's
  forms are eight hand-written families: songs of the same genre and imagery share a form (their
  seed still changes the parameters, texture, motion and composition).

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
- Pipeline `lyrics → research → design → scene` (phase 7: the song's scene program), saving the project after each step; status
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
  `maxDuration` at most 300 (only the process, bible, arc and directions routes set it).
  Route context is typed explicitly (`{ params: Promise<{ id: string }> }`).

### DESIGNER — `src/lib/server/designer/**`
- `researchSong`: Claude (`LIVELYRICS_MODEL` default `claude-sonnet-5-5`), server tool `web_search_20260209`,
  adaptive thinking, streaming, `pause_turn` continuation (≤ 5), refusal handling, server-side
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Writes a Traditional-Chinese Markdown
  brief as the band's stage-visual designer: band identity & visual history (album art, MVs, logos,
  colors, past stage shows), song meaning/imagery, mood/energy arc, reference live moments; returns
  sources. Must not reproduce full copyrighted lyrics in the brief.
- Every Claude request (research, design, structured jobs) uses `adaptiveThinking()` in `claude.ts`:
  adaptive thinking with summaries plus `block_binding.prefix_mismatch_behavior: "drop_block"`
  (beta `thinking-binding-controls-2026-08-01`). Sonnet 5.5 binds thinking blocks to the conversation
  prefix and, on accounts created from 2026-08-31, rejects a replayed block whose prefix changed; a
  `pause_turn` continuation that isn't byte-identical therefore drops that block instead of failing.
- One shared SDK client (`clientOptions()` in `claude.ts`): the SDK reads `ANTHROPIC_API_KEY` /
  `ANTHROPIC_AUTH_TOKEN`; when `ANTHROPIC_WORKSPACE_ID` is set every request also sends the
  `anthropic-workspace-id` header, which an identity-linked key that isn't bound to one workspace needs
  (without it the API answers 400; `describeError` turns that and the invalid / unknown workspace
  errors into a Traditional-Chinese hint).
- `designSong`: a second Claude call with structured outputs (`DesignPlanSchema`) using the research,
  lyrics (with line ids + times), audio analysis summary (bpm, energy curve, section guesses), the
  closed scene/lyric-style vocabularies with descriptions, typography rules and the principles above;
  supports `instruction` + `previous` for re-design. Always passes the result through `normalizePlan`.
- Offline designer (no credential or Claude failure): deterministic heuristic plan from analysis +
  lyric repetition (chorus detection) and the 免費研究 findings (genre grammar, imagery, emotion, audio
  mood, sing-along), palette from them (else mood & a stable hash), generated geometric motif SVG.
  Without a credential `researchSong` is 免費研究 (`free-research.ts`, see phase 4b), also after a Claude
  failure.
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

### STAGE — `src/components/stage/**`, `src/lib/stage/**` (except protocol.ts; `src/lib/stage/program/**` = 專屬畫面), `src/lib/type/**` (字體藝術), `src/app/p/[id]/output/**`, `src/app/s/[id]/output/**`, `src/app/stage-lab/**`
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
  研究 brief & sources / 控制 overrides / 同步 sync source, lock and MIDI (phase 5a), offset, BPM, tap, mic).
- Hotkeys (shown in a `?` overlay): Space play/pause (live: next line), →/↓ next line, ←/↑ previous line,
  Enter cue selected, B blackout, L lyrics on/off, F freeze, 1–9 scene override, 0 follow plan,
  [ / ] offset −/+ 0.05 s, T tap tempo, O open output, M mode switch, ? help; PageDown or . / PageUp or ,
  next / previous section, H 保持段落, R 循環段落 (phase 2b), X 回到手動 (phase 5a: stop following the
  timecode / MIDI clock; also in the show's look and pre-show views). The show console adds G (GO) and S
  (standby); the per-song console ignores them. Physical key codes (`KeyH`, `Period`, `KeyX`…), so an active
  IME does not change them; every toggle and jump ignores key repeat. MIDI controllers run the same actions
  (`src/lib/midi/actions.ts` → the view's dispatch, with the HUD); see 同步與控制器 (phase 5a).
- Re-design dialog: free-text instruction → `api.process(id, {steps:["design"], instruction})` with
  streamed progress; then broadcast the new project.

### HOME — `src/app/page.tsx`, `src/app/p/[id]/process/**`, `src/app/p/[id]/lyrics/**`, `src/app/p/[id]/type/**`, `src/components/{home,upload,process,lyrics-editor,type-editor}/**`
- Home: brand header, server status (Claude connected vs 免費研究模式 + the claude.ai option + how to
  set `ANTHROPIC_API_KEY` in `.env.local`), dropzone → metadata + analysis progress → editable song info
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
