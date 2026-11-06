# Vendored design skills

All MIT-licensed (each folder keeps its `LICENSE`). Slim copies: rules, references and small helper
files only; large media and engine-specific code are left out. Where a skill tells you to copy assets,
install packages or use Remotion / After Effects, skip that step: Livelyrics renders live in WebGL
(`src/lib/stage/`) with its own type engine (`src/lib/type/`), and adds no new dependencies.

| Folder | Upstream (commit) | Kept | Use in Livelyrics |
|---|---|---|---|
| `taste-skill` | Leonxlnx/taste-skill (9b4bf93) | SKILL.md, references, library | home / library / upload / process / settings pages (see its `LIVELYRICS.md`) |
| `shader-art-coding` | gokayfem/shader-skills (a56e773) | SKILL.md, glsl, references, scripts, templates | scene-program GLSL (`stage/gl`, `stage/program`), Claude scene prompts |
| `kinetic-type`, `kinetic-type-director` | dricosnyman/kinetic-type-skills (52acba3) | all but `remotion/` | type recipes, key lines, per-line technique choice (`src/lib/type/`) |
| `motion-art-direction`, `animation-principles`, `shot-composition`, `color-motion`, `beat-sync-editing` | iart-ai/motion-design-skills (3c129f7) | SKILL.md, references | motion, transitions, composition, palettes, beat sync (stage + designer) |

Skills are instructions that get followed: review a SKILL.md diff before updating any of these.
