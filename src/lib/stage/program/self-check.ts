// Round 28 (N3): the offline composer checks its own picture. Claude's programs were rendered and
// measured since round 25 (critique.ts); the programs every free user gets were never measured. Here the
// same critique runs on the composer's output and — with no LLM — the composer's knobs (the form's
// scale, how strongly the verses and the choruses are driven) and a re-draw of the form's own
// parameters are walked deterministically, guided by which checks failed, until every check passes or
// the best of MAX_TRIES is kept. The result is recorded on the program (`check`) for the console line.

import type { DesignPlan, SceneProgram, SceneProgramCheck } from "../../types";
import type { ComposerTune } from "./composer";
import { checkLine, critiqueProgram, type SceneCritique } from "./critique";

/** How many renders the self-check may spend on one program (each is ≈ 0.3–0.6 s on the CPU probe). */
export const MAX_TRIES = 7;

export interface SelfTune extends Required<ComposerTune> {
  reroll: number;
}

export const NEUTRAL_TUNE: SelfTune = { scale: 1, verse: 1, chorus: 1, cap: 1, reroll: 0 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The next knob setting, from the failed checks of the last render. */
export function nextTune(t: SelfTune, c: SceneCritique, stalled: number): SelfTune {
  const ids = new Set(c.check.checks.filter((x) => !x.ok).map((x) => x.id));
  const chorus = c.check.states.find((s) => s.state === "chorus");
  let { scale, verse, chorus: ch, cap, reroll } = t;
  // proportional steps (the further a state is from its target, the bigger the move), so the walk settles
  // instead of swinging between too dim and too wide
  const verseCover = c.check.states.find((s) => s.state === "verse")?.cover ?? 0;
  if (ids.has("verse-quiet") || ids.has("chorus-over-verse")) {
    verse *= verseCover > 0.1 ? clamp(0.07 / verseCover, 0.3, 0.9) : 0.8;
    scale *= 0.96;
  }
  if (ids.has("chorus-open")) {
    const cover = Math.max(0.02, chorus?.cover ?? 0);
    const low = cover < 0.25;
    // too wide: the form is made smaller (its size is the gentle lever), the chorus' drive eased a little
    ch *= low ? clamp(0.33 / cover, 1.1, 1.7) : 0.92;
    scale *= low ? 1.04 : clamp(0.37 / cover, 0.7, 0.95);
  }
  if (ids.has("last-grows")) ch *= 0.88;
  if (ids.has("build-rises")) verse *= 1.12;
  if (ids.has("no-white")) cap = Math.max(0.8, cap - 0.06);
  if (ids.has("no-white") || ids.has("words-dark") || ids.has("words-calm")) {
    scale *= 0.94;
    ch *= 0.95;
  }
  // nothing the knobs fix (the subject's count or place), or the walk has stalled: draw the form's parameters again
  if (ids.has("one-subject") || ids.has("safe-area") || ids.has("healthy") || stalled >= 2) reroll += 1;
  return { scale: clamp(scale, 0.6, 1.4), verse: clamp(verse, 0.15, 1.25), chorus: clamp(ch, 0.6, 2.4), cap, reroll };
}

export interface SelfChecked {
  program: SceneProgram;
  /** the kept version's critique (null when the CPU evaluator cannot run the program) */
  critique: SceneCritique | null;
  /** renders spent beyond the first */
  rerolls: number;
  /** the first version's passed checks */
  firstPassed: number | null;
}

/**
 * Render `make(tune)` and walk the knobs until it passes the critique. `make` must be deterministic.
 * With a program the CPU evaluator cannot run there is nothing to measure: the first version is kept.
 */
export function selfCheck(make: (t: SelfTune) => SceneProgram, plan: Pick<DesignPlan, "sections" | "keyVisual">, maxTries = MAX_TRIES): SelfChecked {
  let tune = NEUTRAL_TUNE;
  const first = make(tune);
  const c1 = critiqueProgram(first, plan);
  if (!c1) return { program: first, critique: null, rerolls: 0, firstPassed: null };
  let best = { program: first, critique: c1, tune };
  let last = c1;
  let stalled = 0;
  let tries = 0;
  while (best.critique.failed.length && tries < maxTries - 1) {
    tune = nextTune(tune, last, stalled);
    const program = make(tune);
    const c = critiqueProgram(program, plan);
    tries++;
    if (!c) break;
    if (c.score > best.critique.score) {
      best = { program, critique: c, tune };
      stalled = 0;
    } else stalled++;
    last = c;
  }
  return { program: best.program, critique: best.critique, rerolls: tries, firstPassed: c1.check.passed };
}

/** The `check` an offline program carries (the console line says what the composer did, honestly). */
export function offlineCheck(r: SelfChecked): SceneProgramCheck | null {
  if (!r.critique) return null;
  const check: SceneProgramCheck = { ...r.critique.check, fixTurn: false, kept: r.rerolls > 0 && r.critique.check.passed > (r.firstPassed ?? 0) ? "fixed" : "first", ...(r.rerolls > 0 && r.firstPassed != null ? { firstPassed: r.firstPassed } : {}), rerolls: r.rerolls, summary: "" };
  check.summary = checkLine(check) ?? "";
  return check;
}
