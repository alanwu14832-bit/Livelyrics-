@AGENTS.md

# Livelyrics

Local web app: upload a song → Claude researches it as the band's stage-visual designer and designs a
key visual + lyric/animation plan → operator console drives a projection window (animation + lyrics only).

- Architecture, module ownership and contracts: `docs/ARCHITECTURE.md` (read it first).
- Shared contracts: `src/lib/types.ts`, `src/lib/schema.ts`, `src/lib/stage/protocol.ts`, `src/lib/timeline.ts`,
  `src/lib/fonts.ts`, `src/lib/api-client.ts`.
- Commands: `npm run dev` (webpack), `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`.
  In the cloud container prefix network-using commands with `NODE_USE_ENV_PROXY=1` (next/font downloads).
- User-facing text is Traditional Chinese. No new dependencies without discussion.

## Design skills

Vendored in `.claude/skills/` (sources and scope: `.claude/skills/SOURCES.md`). Load the matching ones
before the work, and tell UI / visual subagents to do the same:
- public pages (home, library, upload, process, settings): `taste-skill` (read its `LIVELYRICS.md`);
- console, editors: `frontend-design` / `frontend-ui-engineering`;
- stage visuals and scene GLSL: `shader-art-coding`, `motion-art-direction`, `shot-composition`, `color-motion`;
- lyric typography and motion: `kinetic-type`, `kinetic-type-director`, `animation-principles`, `beat-sync-editing`.
