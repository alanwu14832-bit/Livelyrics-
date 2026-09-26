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
