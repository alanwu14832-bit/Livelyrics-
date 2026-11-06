# taste-skill in Livelyrics (slim copy)

Vendored from https://github.com/Leonxlnx/taste-skill (MIT, see `LICENSE`) at commit
9b4bf937a1f69348126959c15d2f99a73e65699b, skill version 2.5.0. Only `SKILL.md`, `references/` and
`library/` are kept; the 40 MB `assets/` (photos, starter pages, effects) and `scripts/` (the browser
checker that needs those assets) are left out. Where `SKILL.md` says to copy `<skill>/assets` or run
its scripts, skip that step and apply the rules and references by hand.

Scope here: the skill targets marketing / company pages. Use it for Livelyrics' public-facing pages
(home and library, upload, process page, settings sheet, any future landing page). Do not apply it to
the operator console, the lyric and type editors or the projection output: those follow
`frontend-design` / `frontend-ui-engineering` and the stage-visual rules in `docs/ARCHITECTURE.md`.
Its house rules about photographs, addresses and page kinds do not override Livelyrics' own
conventions (Traditional Chinese copy, existing design tokens in `globals.css`, no new dependencies).
