// 專屬畫面 (phase 7): the song's own generative scene program.
//
// Claude path: one structured-output call (claudeStructured: the same transport, continuations,
// server-side fallbacks, adaptive thinking and deadline as the song designer) asks the band's
// stage-visual designer for a designed image — composition, focal point, negative space, restraint,
// texture, a reason rooted in this song — written as a GLSL function body against the fixed uniform
// contract (PROGRAM_CONTRACT_DOC, verbatim), plus a state per section (mode, parameters, the text
// zone and how the words meet the image). The program is validated (validateProgram); a refused
// program gets one repair turn with the validator's errors, then the offline composer takes over.
// Offline path (no key, a free run, any failure or timeout): the layered composer
// (src/lib/stage/program/composer.ts) with forms chosen from the 免費研究 findings.

import { z } from "zod";
import { formatTimeShort } from "@/lib/timeline";
import { TYPE_RELATIONS, type TransitionCharacter } from "@/lib/schema";
import { PROGRAM_CONTRACT_DOC } from "@/lib/stage/program/contract";
import { composeSceneProgram, FORM_IDS, FORM_LABELS, MOTION_LABELS, TEXTURE_IDS, TEXTURE_LABELS, type ComposerPair, type FormId, type MotionId, type TextureId } from "@/lib/stage/program/composer";
import { EXAMPLE_PROGRAMS, type ExampleProgram } from "@/lib/stage/program/examples";
import { normalizeSceneProgram } from "@/lib/stage/program/model";
import { probePlanProgram, type ProbeResult } from "@/lib/stage/program/probe";
import { NEUTRAL_TUNE, offlineCheck, selfCheck, type SelfTune } from "@/lib/stage/program/self-check";
import { selfCheckConfig } from "@/lib/stage/program/self-check-config";
import { validateProgram } from "@/lib/stage/program/validate";
import type { DesignPlan, SceneId, SceneProgram } from "@/lib/types";
import { hasDarkWord } from "@/lib/type/sensitive";
import { hashString } from "./svg";
import { analyzeFindings, type Findings } from "./findings";
import { recentFactor, recentUses, RECENT_USE_FACTORS, RECENT_WINDOW, type RecentLook } from "./recent";
import { bibleBlock, energyCurveBlock, SENSITIVE_LYRICS_RULE, songBlock, trimBrief } from "./prompts";
import { collectedBlock, leadPalette, leadTemperature } from "./collected";
import { analyzeStructure } from "./structure";
import type { DesignerInput, DesignRequest } from "./types";

// ---------------------------------------------------------------------------
// offline: the composer, with forms from the findings
// ---------------------------------------------------------------------------

const FORMS_BY_SCENE: Record<SceneId, FormId[]> = {
  waves: ["horizon", "strata"],
  rain: ["threads", "strata"],
  nebula: ["orbits", "ribbons"],
  particles: ["orbits", "pillars"],
  bokeh: ["ribbons", "horizon"],
  grid: ["horizon", "bars"],
  tunnel: ["orbits", "bars"],
  shards: ["bars", "pillars"],
  ink: ["brush", "strata"],
  motif: ["pillars", "orbits"],
  gradient: ["strata", "ribbons"],
  blackout: ["pillars", "strata"],
};


/**
 * Round 12: the form table as weights. The genre family sets the base (every form keeps a small
 * weight, so a song is never locked to one shape; the ones that look worse than the genre's own
 * stay low rather than forbidden), the imagery families add theirs (雨 → threads, 河／路 →
 * ribbons, 牆 → pillars / strata, 光 → orbits / horizon, 手寫 → brush, 城市 → bars…), the energy
 * shape bends it, and an instrumental leans to shapes that hold a frame without words.
 */
const FORM_WEIGHTS_BY_GENRE: Record<string, Partial<Record<FormId, number>>> = {
  "post-rock": { pillars: 3.2, strata: 2, horizon: 1.2, orbits: 1, threads: 0.8, ribbons: 0.5, bars: 0.4, brush: 0.3 },
  shoegaze: { ribbons: 3, threads: 2, orbits: 1.2, horizon: 1, strata: 0.8, brush: 0.5, pillars: 0.4, bars: 0.2 },
  "dream-pop": { ribbons: 3, horizon: 2, orbits: 1.5, threads: 1, strata: 0.6, brush: 0.5, pillars: 0.3, bars: 0.15 },
  "city-pop": { horizon: 3, ribbons: 2, bars: 1.5, orbits: 1.2, threads: 0.6, pillars: 0.5, strata: 0.5, brush: 0.2 },
  "indie-rock": { bars: 2.2, horizon: 1.6, pillars: 1.4, threads: 1.2, orbits: 1.2, strata: 1, ribbons: 0.8, brush: 0.6 },
  "indie-pop": { ribbons: 2.5, horizon: 2, orbits: 1.5, threads: 1, bars: 0.8, strata: 0.6, brush: 0.6, pillars: 0.3 },
  folk: { strata: 3.2, brush: 2.2, horizon: 1.5, threads: 0.9, ribbons: 0.8, orbits: 0.6, pillars: 0.5, bars: 0.25 },
  metal: { pillars: 3, bars: 2.2, threads: 1, strata: 0.8, orbits: 0.5, horizon: 0.4, brush: 0.15, ribbons: 0.15 },
  // round 18: a shout song is printed and torn — slashed bars, one hard brush stroke — not a monument
  punk: { bars: 3.2, brush: 2.8, threads: 1.2, pillars: 0.35, orbits: 0.5, strata: 0.4, horizon: 0.35, ribbons: 0.2 },
  "post-punk": { bars: 2.5, brush: 1.8, pillars: 1.6, threads: 1.2, orbits: 1, strata: 0.6, horizon: 0.5, ribbons: 0.3 },
  electronic: { orbits: 2.5, bars: 2, threads: 1.2, ribbons: 1, horizon: 0.9, pillars: 0.8, strata: 0.4, brush: 0.2 },
  "hip-hop": { bars: 2.5, pillars: 2, orbits: 1, threads: 0.8, horizon: 0.6, ribbons: 0.5, brush: 0.5, strata: 0.4 },
  rnb: { ribbons: 2.5, orbits: 2, horizon: 1.5, threads: 0.8, brush: 0.6, pillars: 0.5, strata: 0.4, bars: 0.4 },
  jazz: { ribbons: 2.5, horizon: 1.8, brush: 1.5, orbits: 1.2, strata: 0.6, threads: 0.5, pillars: 0.5, bars: 0.4 },
  "math-rock": { bars: 2.5, orbits: 2.2, threads: 1, pillars: 0.8, ribbons: 0.6, strata: 0.4, horizon: 0.4, brush: 0.3 },
  emo: { threads: 2.5, pillars: 1.8, bars: 1.2, horizon: 1, orbits: 0.8, ribbons: 0.6, strata: 0.5, brush: 0.4 },
  psychedelic: { orbits: 3, ribbons: 2.2, brush: 1, horizon: 1, threads: 0.6, strata: 0.6, bars: 0.5, pillars: 0.4 },
  "alt-rock": { pillars: 2.4, bars: 2, horizon: 1.2, threads: 1, orbits: 0.9, strata: 0.8, ribbons: 0.5, brush: 0.4 },
  ambient: { strata: 2.5, orbits: 2, horizon: 1.5, ribbons: 1.2, threads: 0.8, brush: 0.6, pillars: 0.6, bars: 0.1 },
  pop: { horizon: 2.5, ribbons: 2, orbits: 1.4, threads: 0.9, bars: 0.8, strata: 0.7, brush: 0.5, pillars: 0.5 },
};

/** Round 18: a ballad (抒情／情歌) is a wide, slow picture — a sun over the horizon, layered ridges. */
const BALLAD_FORMS: Partial<Record<FormId, number>> = { horizon: 3.2, strata: 2.8, ribbons: 1.2, threads: 0.4, orbits: 0.6, brush: 0.6, pillars: 0.3, bars: 0.15 };
const BALLAD_RE = /ballad|抒情|情歌|慢歌/i;

const SHOUT_RE = /hardcore|screamo|grindcore|shout|吶喊|嘶吼/i;
/** What a hardcore / shouted song adds to the brush (a punk song prints bars; a shout song tears one stroke). */
export const SHOUT_BRUSH = 2.5;

/** The genre evidence calls the song hardcore / screamed (post-hardcore, screamo, 嘶吼…). */
export function isShout(findings: Findings): boolean {
  return findings.genres.some((g) => g.evidence.some((e) => SHOUT_RE.test(e)));
}

/** The song's genre evidence calls it a ballad (a pop or R&B song tagged ballad / 抒情). */
export function isBallad(findings: Findings): boolean {
  return findings.genres.some((g) => g.evidence.some((e) => BALLAD_RE.test(e)));
}

/** Round 22 (N6): each genre's way of changing sections (motion-art-direction: one transition family per song). */
const CHARACTER_FOR_GENRE: Record<string, TransitionCharacter> = {
  punk: "cut",
  "post-punk": "cut",
  metal: "cut",
  emo: "cut",
  "hip-hop": "cut",
  "math-rock": "cut",
  "city-pop": "scan",
  electronic: "scan",
  "indie-pop": "scan",
  folk: "tide",
  ambient: "tide",
  "post-rock": "tide",
  shoegaze: "swell",
  "dream-pop": "swell",
  rnb: "swell",
  jazz: "swell",
  psychedelic: "swell",
  "indie-rock": "sweep",
  "alt-rock": "sweep",
  pop: "sweep",
};

/** The song's transition character: a ballad swells, a shouted song cuts, else its genre's (sweep without one). */
export function transitionCharacterOf(findings: Findings): TransitionCharacter {
  if (isShout(findings)) return "cut";
  if (isBallad(findings)) return "swell";
  const g = findings.genre?.id;
  if (g && CHARACTER_FOR_GENRE[g]) return CHARACTER_FOR_GENRE[g];
  return findings.hints.motion === "soft" ? "swell" : findings.hints.motion === "punchy" ? "cut" : "sweep";
}

/** Forms an imagery family calls for (most typical first) when the lexicon entry names none. */
const FORMS_BY_IMAGERY: Record<string, FormId[]> = {
  rain: ["threads", "strata"],
  tears: ["threads", "horizon"],
  snow: ["threads", "strata"],
  storm: ["threads", "pillars"],
  fire: ["threads", "pillars"],
  sea: ["horizon", "ribbons"],
  river: ["ribbons", "strata"],
  wind: ["ribbons", "threads"],
  road: ["ribbons", "horizon"],
  harbor: ["horizon", "ribbons"],
  wings: ["ribbons", "orbits"],
  freedom: ["ribbons", "orbits"],
  dream: ["ribbons", "orbits"],
  smoke: ["ribbons", "strata"],
  breath: ["ribbons", "brush"],
  wall: ["pillars", "strata"],
  door: ["pillars", "horizon"],
  window: ["horizon", "pillars"],
  home: ["strata", "horizon"],
  light: ["orbits", "horizon"],
  moon: ["horizon", "orbits"],
  dawn: ["horizon", "strata"],
  dusk: ["horizon", "strata"],
  summer: ["horizon", "orbits"],
  heaven: ["orbits", "horizon"],
  stars: ["orbits", "threads"],
  universe: ["orbits", "horizon"],
  night: ["orbits", "horizon"],
  writing: ["brush", "strata"],
  memory: ["brush", "strata"],
  autumn: ["brush", "threads"],
  flower: ["brush", "orbits"],
  spring: ["brush", "ribbons"],
  city: ["bars", "pillars"],
  neon: ["bars", "orbits"],
  train: ["bars", "ribbons"],
  signal: ["bars", "orbits"],
  screen: ["bars", "pillars"],
  dance: ["orbits", "bars"],
  metal: ["bars", "pillars"],
  glass: ["bars", "pillars"],
  forest: ["strata", "pillars"],
  desert: ["strata", "horizon"],
  world: ["strata", "horizon"],
  wither: ["threads", "brush"],
  chains: ["bars", "pillars"],
  candle: ["orbits", "ribbons"],
  war: ["pillars", "bars"],
  heart: ["orbits", "brush"],
  voice: ["orbits", "ribbons"],
  eyes: ["orbits", "horizon"],
  embrace: ["brush", "ribbons"],
  lonely: ["pillars", "horizon"],
  youth: ["bars", "threads"],
  dark: ["pillars", "strata"],
  ash: ["threads", "strata"],
  mirror: ["pillars", "horizon"],
};

/** What the strongest image adds to its first and second form (the genre family sets 2–3.2 for its own). */
export const IMAGERY_LEAD = 3.0;
export const IMAGERY_SECOND = 1.5;

export interface FormWeightOptions {
  /** the song has lyrics (false: an instrumental) */
  lyrics?: boolean;
  /**
   * the library's most recent forms (most recent first): a form the last RECENT_WINDOW songs wore
   * weighs RECENT_USE_FACTORS by its count, the very latest RECENT_LATEST_FACTOR more
   */
  recentForms?: readonly string[];
}

/** The latest song's form weighs this much more on top of its count (never the same picture twice in a row). */
export const RECENT_LATEST_FACTOR = 0.6;
/** Round 18: how much an image adds to a form the genre itself barely wears (the genre's weight below 1, square-rooted, floored here). */
export const IMAGERY_GENRE_FLOOR = 0.4;

/**
 * Round 25 (N3): the genre's own weights over the forms — the genre family (or the ballad table), what a
 * shouted song adds to the brush, what an instrumental needs — before any image, energy or rotation.
 * Null without a genre.
 */
export function genreFormWeights(findings: Findings, opts: Pick<FormWeightOptions, "lyrics"> = {}): Record<FormId, number> | null {
  const genre = findings.genre ? (isBallad(findings) ? BALLAD_FORMS : FORM_WEIGHTS_BY_GENRE[findings.genre.id]) : null;
  if (!genre) return null;
  const g = Object.fromEntries(FORM_IDS.map((f) => [f, genre[f] ?? 0.3])) as Record<FormId, number>;
  if (isShout(findings)) g.brush += SHOUT_BRUSH;
  if (opts.lyrics === false) {
    g.ribbons += 1.4;
    g.strata += 1.2;
    g.horizon += 0.9;
    g.threads += 0.9;
    g.pillars *= 0.3;
    g.bars *= 0.5;
  }
  return g;
}

/** A form fits the genre when the genre weighs it at least this share of its favourite. */
export const GENRE_FIT_SHARE = 0.5;
/** A form outside the genre's set weighs at most this share of the least fitting form in it (never chosen first). */
export const OFF_GENRE_SHARE = 0.5;
/** Round 25: inside the genre's set the library's rotation only breaks near ties (0, 1, 2+ uses; the latest once more). */
export const GENRE_RECENT_FACTORS = [1, 0.55, 0.3] as const;
export const GENRE_RECENT_LATEST = 0.6;
/** Round 25: while the library rotates a genre's own surfaces, a surface the genre does not print on weighs this much less. */
export const OFF_GENRE_SURFACE = 0.1;

/**
 * Round 25 (N3): the forms that fit the song's genre (its favourite and every form it weighs at least
 * GENRE_FIT_SHARE of that; at least two), best first. Without a genre every form fits.
 */
export function genreFitForms(findings: Findings, opts: Pick<FormWeightOptions, "lyrics"> = {}): FormId[] {
  const g = genreFormWeights(findings, opts);
  if (!g) return [...FORM_IDS];
  const ranked = [...FORM_IDS].sort((a, b) => g[b] - g[a] || FORM_IDS.indexOf(a) - FORM_IDS.indexOf(b));
  const top = g[ranked[0]];
  return ranked.filter((f, i) => i < 2 || g[f] >= top * GENRE_FIT_SHARE);
}

/**
 * Weights over the forms for a song (exported for the tests and the stage lab). Round 25 (N3): the
 * genre decides which forms may lead — images, the energy shape and the library's rotation reorder
 * the forms inside the genre's set, a form outside it stays below every form in it.
 */
export function formWeights(findings: Findings, opts: FormWeightOptions = {}): Record<FormId, number> {
  const w = Object.fromEntries(FORM_IDS.map((f) => [f, 1])) as Record<FormId, number>;
  const genre = genreFormWeights(findings, { lyrics: opts.lyrics });
  if (genre) for (const f of FORM_IDS) w[f] = genre[f];
  // an image pulls less towards a form the genre itself rarely wears (a wall in a punk song is torn
  // print, not a monument; rain in a ballad is a sky, not threads)
  const fit = (f: FormId) => (genre ? Math.max(IMAGERY_GENRE_FLOOR, Math.min(1, Math.sqrt(genre[f]))) : 1);
  // the imagery families, by their share of the strongest
  const top = findings.imagery.slice(0, 4);
  const max = top[0]?.weight || 1;
  for (const h of top) {
    const share = Math.min(1, h.weight / max);
    const forms = (h.family.forms?.filter((f): f is FormId => (FORM_IDS as readonly string[]).includes(f)) ?? []).concat(FORMS_BY_IMAGERY[h.family.id] ?? []);
    if (forms[0]) w[forms[0]] += IMAGERY_LEAD * share * fit(forms[0]);
    if (forms[1]) w[forms[1]] += IMAGERY_SECOND * share * fit(forms[1]);
  }
  // the energy shape
  const a = findings.audio;
  if (a.arousal > 0.62) {
    w.bars += 0.8;
    w.pillars += 0.6;
    w.threads += 0.4;
  }
  if (a.light > 0.55) {
    w.horizon += 0.8;
    w.ribbons += 0.5;
    w.orbits += 0.4;
  }
  if (a.quadrant === "dark-slow" || a.quadrant === "gentle-float") {
    w.strata += 0.6;
    w.brush += 0.5;
    w.orbits += 0.4;
  }
  if (a.quadrant === "release") {
    w.pillars += 0.5;
    w.horizon += 0.3;
  }
  // an instrumental without a genre still leans to shapes that build up over a long song (round 23)
  if (!genre && opts.lyrics === false) {
    w.ribbons += 1.4;
    w.strata += 1.2;
    w.horizon += 0.9;
    w.threads += 0.9;
    w.pillars *= 0.3;
    w.bars *= 0.5;
  }
  // round 18: what the library's last songs wore, by count; round 25: with a genre only a near tie
  // inside the genre's set (one use 0.55, two 0.3), without one as before (a nudge, nearly a ban)
  const factors: readonly number[] = genre ? GENRE_RECENT_FACTORS : RECENT_USE_FACTORS;
  const recent = (opts.recentForms ?? []).slice(0, RECENT_WINDOW).filter((f): f is FormId => (FORM_IDS as readonly string[]).includes(f));
  for (const f of new Set(recent)) w[f] *= factors[Math.min(2, recent.filter((x) => x === f).length)];
  if (recent[0]) w[recent[0]] *= genre ? GENRE_RECENT_LATEST : RECENT_LATEST_FACTOR;
  // the genre's set leads: a form outside it stays under every form in it
  if (genre) {
    const inSet = genreFitForms(findings, { lyrics: opts.lyrics });
    const floor = Math.min(...inSet.map((f) => w[f]));
    for (const f of FORM_IDS) if (!inSet.includes(f)) w[f] = Math.min(w[f], floor * OFF_GENRE_SHARE);
  }
  for (const f of FORM_IDS) w[f] = Math.round(Math.max(0.02, w[f]) * 1000) / 1000;
  return w;
}

/** Forms that suit the song, best first (the weights' order; what the directions and the stage lab list). */
export function sceneForms(findings: Findings, opts: FormWeightOptions = {}): FormId[] {
  const w = formWeights(findings, opts);
  return [...FORM_IDS].sort((a, b) => w[b] - w[a] || FORM_IDS.indexOf(a) - FORM_IDS.indexOf(b));
}

const SURFACE_BY_GENRE: Record<string, Partial<Record<TextureId, number>>> = {
  punk: { halftone: 2.2, scan: 1.2, paper: 0.5 },
  "post-punk": { halftone: 1.6, scan: 1.6 },
  "hip-hop": { halftone: 1.8 },
  metal: { halftone: 1.4, scan: 1.2, paper: 0.4 },
  electronic: { scan: 2.4, halftone: 1.2, paper: 0.3 },
  "math-rock": { scan: 1.6, halftone: 1.2 },
  "city-pop": { scan: 1.8, halftone: 1.2 },
  folk: { paper: 2.4, film: 1.2, scan: 0.3, halftone: 0.4 },
  jazz: { paper: 1.6, film: 1.3 },
  ambient: { paper: 1.5, film: 1.3, halftone: 0.4 },
  "dream-pop": { film: 1.4, paper: 1.2, halftone: 0.5 },
  shoegaze: { film: 1.5, scan: 1.1 },
  pop: { film: 1.3 },
};
const SURFACE_BY_IMAGERY: Record<string, Partial<Record<TextureId, number>>> = {
  writing: { paper: 2 },
  memory: { paper: 1.6, film: 1.3 },
  neon: { scan: 1.8 },
  signal: { scan: 2 },
  screen: { scan: 2 },
  city: { scan: 1.3, halftone: 1.2 },
  rain: { scan: 1.3 },
  wall: { halftone: 1.5, paper: 1.2 },
  dark: { film: 1.3 },
};

/**
 * Texture weights the song suggests (the composer multiplies the voice's surfaces by these); round 18:
 * a surface the library's last songs were printed on weighs RECENT_USE_FACTORS by its count.
 */
export function surfaceWeights(findings: Findings, looks?: readonly RecentLook[]): Partial<Record<TextureId, number>> {
  const w: Partial<Record<TextureId, number>> = Object.fromEntries(TEXTURE_IDS.map((t) => [t, 1]));
  const g = findings.genre ? SURFACE_BY_GENRE[findings.genre.id] : null;
  if (g) for (const [t, k] of Object.entries(g) as Array<[TextureId, number]>) w[t] = (w[t] ?? 1) * k;
  const top = findings.imagery.slice(0, 2);
  const max = top[0]?.weight || 1;
  for (const h of top) {
    const sw = SURFACE_BY_IMAGERY[h.family.id];
    if (!sw) continue;
    const share = Math.min(1, h.weight / max);
    for (const [t, k] of Object.entries(sw) as Array<[TextureId, number]>) w[t] = (w[t] ?? 1) * (1 + (k - 1) * share);
  }
  // (the composer draws the texture at random by weight, so a surface worn twice is left out
  // altogether while another one is still fresh)
  if (looks?.length) {
    const worn = (t: TextureId) => recentUses(looks, "texture", t) >= 2;
    // round 25 (N3): a genre's own surfaces (halftone for punk, paper for folk) stay its own — the
    // rotation moves between them (one worn twice gives way to another of them that is fresh) and
    // never hands the song a surface the genre does not print on
    const own = g ? TEXTURE_IDS.filter((t) => (g[t] ?? 1) >= 1.2) : [];
    if (own.length) {
      const ownFresh = own.some((t) => !worn(t));
      for (const t of TEXTURE_IDS) {
        if (own.includes(t)) w[t] = ownFresh && worn(t) ? (w[t] ?? 1) * 0.05 : (w[t] ?? 1) * GENRE_RECENT_FACTORS[Math.min(2, recentUses(looks, "texture", t))];
        else w[t] = (w[t] ?? 1) * OFF_GENRE_SURFACE * recentFactor(looks, "texture", t);
      }
    } else {
      const fresh = TEXTURE_IDS.some((t) => !worn(t));
      for (const t of TEXTURE_IDS) w[t] = fresh && worn(t) ? 0 : (w[t] ?? 1) * recentFactor(looks, "texture", t);
    }
  }
  return w;
}

const MOTION_BY_IMAGERY: Record<string, Partial<Record<MotionId, number>>> = {
  flow: { drift: 1.5, sweep: 1.2 },
  fall: { drift: 1.4, rise: 0.6 },
  rise: { rise: 1.8 },
  pulse: { breathe: 1.8 },
  spin: { orbit: 1.8 },
  rush: { sweep: 1.8 },
  burst: { sweep: 1.4, breathe: 1.2 },
  flicker: { breathe: 1.2 },
  still: { breathe: 1.3, drift: 0.8 },
  drift: { drift: 1.3 },
};

/** Round 25 (N3): how each genre moves (a punk song cuts across, folk drifts and breathes, post-rock rises). */
const MOTION_BY_GENRE: Record<string, Partial<Record<MotionId, number>>> = {
  punk: { sweep: 2, drift: 0.6, breathe: 0.5 },
  "post-punk": { sweep: 1.7, drift: 0.8 },
  metal: { sweep: 1.6, rise: 1.3, breathe: 0.6 },
  emo: { sweep: 1.5, drift: 1.1, breathe: 0.7 },
  "hip-hop": { sweep: 1.4, breathe: 1.2 },
  "math-rock": { sweep: 1.4, orbit: 1.4 },
  electronic: { orbit: 1.6, sweep: 1.4, breathe: 0.8 },
  "city-pop": { sweep: 1.4, drift: 1.3, rise: 0.7 },
  "indie-rock": { sweep: 1.3, rise: 1.1 },
  "alt-rock": { sweep: 1.3, rise: 1.2 },
  "indie-pop": { drift: 1.3, sweep: 1.1 },
  pop: { drift: 1.2, rise: 1.2 },
  folk: { drift: 1.5, breathe: 1.4, sweep: 0.5 },
  ambient: { breathe: 1.5, drift: 1.4, sweep: 0.4 },
  "post-rock": { rise: 1.6, drift: 1.2, sweep: 0.6 },
  shoegaze: { drift: 1.5, breathe: 1.2, sweep: 0.6 },
  "dream-pop": { drift: 1.5, breathe: 1.2, sweep: 0.6 },
  rnb: { breathe: 1.4, drift: 1.3, sweep: 0.6 },
  jazz: { drift: 1.4, breathe: 1.2, sweep: 0.7 },
  psychedelic: { orbit: 1.6, drift: 1.3 },
};
const BALLAD_MOTION: Partial<Record<MotionId, number>> = { breathe: 1.5, drift: 1.4, sweep: 0.4 };

/**
 * Motion weights for the song: the genre's way of moving (round 25), bent by what the strongest image
 * does (rain falls, a river flows, a planet orbits).
 */
export function motionBias(findings: Findings): Partial<Record<MotionId, number>> {
  const out: Partial<Record<MotionId, number>> = { ...((findings.genre && (isBallad(findings) ? BALLAD_MOTION : MOTION_BY_GENRE[findings.genre.id])) || {}) };
  if (isShout(findings)) out.sweep = Math.max(out.sweep ?? 1, 1.8);
  const top = findings.imagery[0];
  for (const [m, k] of Object.entries((top && MOTION_BY_IMAGERY[top.family.motion]) || {}) as Array<[MotionId, number]>) out[m] = Math.round((out[m] ?? 1) * k * 1000) / 1000;
  return out;
}

/**
 * Round 27 (m1): the genre's own way of moving leads (punk sweeps, folk drifts, post-rock rises) —
 * the composer's weighted draw let a punk brush drift. Null without a genre (the imagery decides).
 */
export function genreMotion(findings: Findings): MotionId | null {
  const table = findings.genre && (isBallad(findings) ? BALLAD_MOTION : MOTION_BY_GENRE[findings.genre.id]);
  const w: Partial<Record<MotionId, number>> = { ...(table || {}) };
  if (isShout(findings)) w.sweep = Math.max(w.sweep ?? 1, 1.8);
  const top = (Object.entries(w) as Array<[MotionId, number]>).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

/** Round 27 (N1): a dark song — at least two lyric lines hold a dark word (blood, death, ending one's life). */
export function isDarkSong(req: Pick<DesignerInput, "lyrics">): boolean {
  return (req.lyrics?.lines ?? []).filter((l) => typeof l?.text === "string" && hasDarkWord(l.text)).length >= 2;
}

/** The form + texture pairs the band's other songs wear (most recent first), from their program recipes. */
export function bandPairs(req: DesignerInput): ComposerPair[] {
  const out: ComposerPair[] = [];
  for (const s of req.bandSongs ?? []) {
    const m = /^([a-z]+)\/([a-z]+)\//.exec(s.recipe ?? "");
    if (m && (FORM_IDS as readonly string[]).includes(m[1]) && (TEXTURE_IDS as readonly string[]).includes(m[2])) out.push({ form: m[1] as FormId, texture: m[2] as TextureId });
  }
  return out;
}

/** The song's seed: the project id when known (two songs with one title and artist still differ), else title | artist. */
export function songSeed(req: Pick<DesignerInput, "meta" | "songId">): number {
  const base = hashString(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}`);
  return req.songId ? (base ^ hashString(req.songId)) >>> 0 : base;
}

/** Round 28: the self-checked programs of this process, by what they were composed from (the CPU render is the cost). */
const CHECKED = new Map<string, SceneProgram>();

/**
 * The offline composer's program for a request (salt: 「重新產生畫面」 without Claude draws another).
 * Round 28 (N3): unless `check` is false (default: on in production, off in the unit tests) the program is rendered on the CPU and measured by the same
 * critique Claude's programs get (stage/program/self-check.ts); the composer's knobs are walked
 * deterministically until it passes, and the result is recorded as `program.check` (the console line).
 */
export function offlineSceneProgram(req: DesignerInput, plan: DesignPlan, salt = 0, findings?: Findings, opts: { check?: boolean } = {}): SceneProgram {
  const f = findings ?? analyzeFindings(req);
  const lyrics = (req.lyrics?.lines ?? []).some((l) => typeof l?.text === "string" && l.text.trim());
  const wopts: FormWeightOptions = { lyrics, recentForms: req.recentForms };
  const input = {
    seed: songSeed(req),
    forms: sceneForms(f, wopts),
    weights: formWeights(f, wopts),
    fit: genreFitForms(f, wopts),
    avoid: bandPairs(req),
    surface: surfaceWeights(f, req.recentLooks),
    motionBias: motionBias(f),
    motionLead: genreMotion(f),
    dark: isDarkSong(req),
    lyrics,
    sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })),
    voice: plan.typeSystem?.voice ?? null,
    // phase 8: the band's real cover sets the temperature of the picture when it has one
    temperature: leadTemperature(req.collected) ?? f.hints.temperature,
    arousal: f.audio.arousal,
    title: req.meta?.title,
    salt,
  };
  const make = (t: SelfTune): SceneProgram => {
    const program = composeSceneProgram({ ...input, tune: t, reroll: t.reroll });
    const tagged = { ...program, recipe: `${program.recipe ?? ""}#${salt}` };
    return normalizeSceneProgram(tagged, { sections: plan.sections }) ?? tagged;
  };
  if (!(opts.check ?? selfCheckConfig.enabled)) return make(NEUTRAL_TUNE);
  const key = JSON.stringify([input, plan.keyVisual.palette.map((p) => p.hex), plan.sections.map((s) => s.kind + s.energy)]);
  const hit = CHECKED.get(key);
  if (hit) return hit;
  const checked = selfCheck(make, plan);
  const check = offlineCheck(checked);
  const program = check ? { ...checked.program, check } : checked.program;
  if (CHECKED.size >= 48) CHECKED.delete(CHECKED.keys().next().value as string);
  CHECKED.set(key, program);
  return program;
}

/**
 * A design direction's own program (phase 4 directions × phase 7): forms from the direction's scene
 * families, seeded by its letter, so the three directions' style frames show three different worlds.
 */
export function directionSceneProgram(req: DesignerInput, plan: DesignPlan, scenes: readonly SceneId[], letter: string): SceneProgram {
  const forms: FormId[] = [];
  for (const s of scenes) for (const f of FORMS_BY_SCENE[s] ?? []) if (!forms.includes(f)) forms.push(f);
  const f = analyzeFindings(req);
  for (const x of sceneForms(f)) if (!forms.includes(x)) forms.push(x);
  const program = composeSceneProgram({
    seed: hashString(`${req.meta?.title ?? ""}|${req.meta?.artist ?? ""}|${letter}`),
    forms,
    sections: plan.sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy })),
    voice: plan.typeSystem?.voice ?? null,
    arousal: f.audio.arousal,
    title: req.meta?.title,
  });
  return normalizeSceneProgram({ ...program, recipe: `${program.recipe}#0` }, { sections: plan.sections }) ?? program;
}

/** The composer's salt of an offline program (「重新產生畫面」 without Claude draws salt + 1). */
export function composerSalt(program: SceneProgram | null | undefined): number {
  const m = /#(\d+)$/.exec(program?.recipe ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * Every designed plan carries a program: its own (Claude's or claude.ai's), the previous plan's
 * Claude / claude.ai program carried over (it adapts to new sections by kind), else the offline
 * composer's. The operator's choice to switch it off is kept.
 */
export function ensureSceneProgram(req: DesignerInput & { previous?: DesignPlan | null }, plan: DesignPlan, repairs: string[] = []): DesignPlan {
  const own = plan.sceneProgram;
  const prev = req.previous?.sceneProgram ?? null;
  let program: SceneProgram | null = null;
  // a written program (Claude's, claude.ai's, a pasted one) must also pass the luminance probe
  const written = (p: SceneProgram | null | undefined): SceneProgram | null => {
    if (!p || !(p.engine === "claude" || p.engine === "manual")) return null;
    const n = normalizeSceneProgram(p, { sections: plan.sections, repairs });
    if (!n) return null;
    const probe = probePlanProgram(n, plan);
    if (probe.ok) return n;
    repairs.push(`專屬畫面「${n.title}」太亮，改用離線作曲器：${probe.errors.slice(0, 2).join("；")}`);
    return null;
  };
  program = written(own) ?? written(prev);
  if (!program && own) program = normalizeSceneProgram(own, { sections: plan.sections });
  if (!program) program = offlineSceneProgram(req, plan, composerSalt(prev));
  if (prev && prev.enabled === false) program = { ...program, enabled: false };
  return { ...plan, sceneProgram: program };
}

// ---------------------------------------------------------------------------
// Claude: the prompt and the structured output
// ---------------------------------------------------------------------------

export const SceneProgramDraftSchema = z.object({
  title: z.string().describe("這個畫面的名字（繁體中文，2–8 字）"),
  concept: z.string().describe("畫面概念：一到兩句，這首歌在舞台上是什麼樣的一個畫面、為什麼（繁體中文）"),
  rationale: z.string().describe("設計理由：構圖、焦點、留白、質地與節制，從這首歌與這個樂團來（繁體中文，2–4 句）"),
  source: z.string().describe("GLSL 函式本體：輔助函式加上 vec3 scene(vec2 fc)，依照 uniform 合約，只用 ASCII（註解可以中文）"),
  keyMoment: z.number().nullable().describe("主視覺靜止畫面的歌曲時間（秒），挑最能代表這首歌的一刻（通常是第一次副歌裡）；null = 系統挑"),
  sections: z
    .array(
      z.object({
        sectionId: z.string().describe("段落 id（s0, s1, …，必須是方案裡的段落）"),
        mode: z.number().describe("整數 0–3：這段的世界狀態（uMode）"),
        params: z.array(z.number()).describe("四個 0–1 的數字（uParams.xyzw）"),
        zone: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("文字區：畫面上的留白，歌詞排在這裡（0–1 的比例，x、y 是左上角，y 向下）"),
        relation: z.enum(TYPE_RELATIONS).describe("字與畫面的關係：plain 放在留白裡、knockout 字切開畫面的亮形、behind 字從前景形狀後面經過（程式要設定 gFront）、lit 畫面的光照亮字"),
        note: z.string().describe("這一段的畫面與字（繁體中文，一句）"),
      }),
    )
    .describe("每一個段落一筆，依時間順序"),
});
export type SceneProgramDraft = z.infer<typeof SceneProgramDraftSchema>;

export const SCENE_SYSTEM = `你是這個樂團的專職舞台視覺總監，也是會寫 GLSL 的動態設計師。這一次你要為一首歌寫它自己的「專屬畫面」：一支片段著色器程式，在音樂祭／演唱會的 LED 大螢幕上跑整首歌，歌詞由字體引擎排在你指定的留白裡，和畫面構成一張完整的海報。

你要設計的是一張「被設計過的畫面」，不是特效展示：
1. 構圖先於效果：一個主角形狀（焦點），明確的留白（文字區），前景／中景／背景的層次；寧可少，不要滿。好的畫面在靜止的一格裡也成立。
2. 節制：大部分時間畫面是安靜的，副歌才打開；亮部只佔畫面的一小部分（LED 牆很亮，全畫面高亮會刺眼）；避免全畫面閃爍、快速明暗交替與大面積純紅（LED 安全模式也會限制它們）。音樂反應用在位置、形狀、層次，而不是亮度的閃動。
3. 從這首歌來：主角形狀、質地、動態都要能說出為什麼——來自歌詞的意象、樂團的視覺聖經、參考圖、研究簡報、曲風與音訊的能量。不要做一個換顏色就能套到任何一首歌的背景。
4. 一個世界、隨歌曲演變：用 uMode 與 uParams 讓同一個世界沿著歌曲的弧線變化——主歌稀疏、副歌打開、橋段換一個規則（例如形狀裂開、倒過來、靜止、反轉）、尾奏收回。
5. 字與畫面一起構圖：為每一段指定文字區（畫面的留白），主角形狀放在文字區的另一側或圍著它；用 uZone 在程式裡避開或框住文字區；需要時用 typeMask／typeGlow 讓畫面回應字（字後面的光、被字切開的形狀）。關係選一種：plain、knockout、behind（程式要把前景形狀的覆蓋率寫進 gFront）、lit。
6. 直式畫面（aspect() < 0.8）也要成立：系統會把左右的文字區改成上下的帶狀區（左→上、右→下），你的主角形狀放在 uZone 的另一半。
7. 顏色只用 uniform 提供的配色（uBg、uPri、uAcc、uInk、uPal0…uPal5），不要寫死色相，這樣樂團的色盤與 LED 安全的調整才會生效。主角每一段都是同一色相（uPri），換段只換 uAcc；亮處用同色滿值 c / max(c.r, max(c.g, c.b))，不要 mix 到白。
8. 效能：這支程式每一格、每個像素都要跑，大螢幕是 1920×1080 以上。保持簡單：幾個距離場、兩三層雜訊就夠了。
9. ${SENSITIVE_LYRICS_RULE}
10. 著色器的寫法與送出前檢查：
   - 形狀用 2D 距離場：sdCircle／sdBox／sdSegment 加 fill／stroke（px() 抗鋸齒），min 聯集、max 交集；重複用 floor 取格子 id、hash 決定每格的差異。
   - 質地：vnoise／fbm3 做霧與紙紋；domain warp（先用 fbm 推動座標再取一次）做流動。
   - WebGL1／2 都要跑：迴圈上限是常數；除數用 max(x, 1e-4)，pow／sqrt 的底先 max(0.0)，atan 避開 (0,0)，normalize 避開零向量——不能有 NaN。
   - 亮度有界：用 mix 疊色、少用一路相加；最亮處仍是 uPri／uAcc 的同色滿值，不會變白（不要 mix 到 vec3(1.0)）。
11. 構圖與光的比例：
   - 一個主角，靠三分線、站在文字區的另一側；其他形狀用大小與對比讓位。
   - 安全區：主角與亮部離畫面邊緣 5% 以上（直式上 12%、下 18%）。
   - 亮的面積（亮度 > 0.2）：主歌 < 10%，副歌 25–45%，副歌至少是主歌兩倍，最後一次副歌最大；用形狀變大、層數變多打開，不是整個畫面調亮。
   - 字後面要暗而安靜：副歌的主角長大越過字的位置時，用 col = mix(col, uBg, wordsMask(uv, 0.05)) 把它在字周圍羽化淡出；字的方塊裡亮部 ≤ 6%，不要有細條紋、圓環或邊緣穿過字。
   - 顏色在感知空間裡走：同色相改明度與彩度，換段走鄰近色相、不經過灰；暗部帶一點主色。

用繁體中文寫 title、concept、rationale 與每段的 note；程式碼只用 ASCII（註解可以中文）。`;

function sectionsBlock(plan: DesignPlan): string {
  return plan.sections
    .map((s) => `- ${s.id} ${s.kind}（${s.label}）${formatTimeShort(s.start)}–${formatTimeShort(s.end)}｜能量 ${s.energy.toFixed(2)}｜配色 ${s.colorway.join(" ")}｜歌詞色 ${s.lyricColor}${s.rationale ? `｜${s.rationale.slice(0, 80)}` : ""}`)
    .join("\n");
}

function lyricsBySection(req: DesignRequest, plan: DesignPlan): string {
  const lines = (req.lyrics?.lines ?? []).filter((l) => l.text?.trim());
  if (!lines.length) return "（這首歌沒有歌詞：文字區仍要留，操作員可能會打上歌名或口號）";
  const out: string[] = [];
  let chars = 0;
  for (const s of plan.sections) {
    const own = lines.filter((l) => l.start != null && l.start >= s.start - 0.05 && l.start < s.end);
    if (!own.length) continue;
    const text = own.slice(0, 4).map((l) => l.text.trim()).join("／");
    out.push(`- ${s.id}：${text}${own.length > 4 ? "…" : ""}`);
    chars += text.length;
    if (chars > 1400) break;
  }
  return out.join("\n") || lines.slice(0, 8).map((l) => `- ${l.text}`).join("\n");
}

/**
 * Round 25 (N3): the two hand-written examples closest to a genre (most typical first). The few-shot
 * examples follow the song's genre instead of always showing the post-rock monolith.
 */
const EXAMPLES_BY_GENRE: Record<string, [string, string]> = {
  punk: ["signal", "monolith"],
  "post-punk": ["signal", "night-drive"],
  "hip-hop": ["signal", "night-drive"],
  "math-rock": ["signal", "monolith"],
  electronic: ["signal", "night-drive"],
  metal: ["monolith", "signal"],
  emo: ["monolith", "signal"],
  "alt-rock": ["monolith", "signal"],
  "indie-rock": ["signal", "night-drive"],
  "post-rock": ["monolith", "tidal-flat"],
  ambient: ["tidal-flat", "monolith"],
  shoegaze: ["tidal-flat", "night-drive"],
  "dream-pop": ["night-drive", "tidal-flat"],
  "city-pop": ["night-drive", "signal"],
  "indie-pop": ["night-drive", "enso"],
  pop: ["night-drive", "enso"],
  rnb: ["night-drive", "enso"],
  jazz: ["enso", "night-drive"],
  psychedelic: ["night-drive", "tidal-flat"],
  folk: ["tidal-flat", "enso"],
};
const BALLAD_EXAMPLES: [string, string] = ["enso", "tidal-flat"];

/** The few-shot examples for a song's genre (a ballad gets the brush circle and the tidal flat; no genre: rotated by the seed). */
export function examplesForSong(findings: Findings, seed = 0): ExampleProgram[] {
  const ids = findings.genre ? (isBallad(findings) ? BALLAD_EXAMPLES : EXAMPLES_BY_GENRE[findings.genre.id]) : null;
  const pick = ids ?? [EXAMPLE_PROGRAMS[seed % EXAMPLE_PROGRAMS.length].id, EXAMPLE_PROGRAMS[(seed + 2) % EXAMPLE_PROGRAMS.length].id];
  return pick.map((id) => EXAMPLE_PROGRAMS.find((e) => e.id === id)).filter((e): e is ExampleProgram => !!e);
}

/** An example's source without its comment-only and blank lines (the few-shot stays short). */
function shortSource(src: string): string {
  return src
    .split("\n")
    .filter((l) => l.trim() && !/^\s*\/\//.test(l))
    .join("\n");
}

/** Two short examples (source and section states) chosen by the song's genre, as few-shot guidance. */
function exampleBlock(findings: Findings, seed: number): string {
  const out: string[] = ["以下是兩個品質參考，依這首歌的曲風挑的（不要照抄，這首歌要有它自己的畫面）："];
  for (const ex of examplesForSong(findings, seed)) {
    const states = (["verse", "chorus", "bridge"] as const)
      .map((k) => [k, ex.byKind[k]] as const)
      .filter((e): e is [typeof e[0], NonNullable<typeof e[1]>] => !!e[1])
      .map(([kind, st]) => `  - ${kind}：mode ${st.mode}，params [${st.params.join(", ")}]，zone ${JSON.stringify(st.zone)}，${st.relation}（${st.note}）`)
      .join("\n");
    out.push("", `「${ex.title}」（${ex.brief}）：${ex.concept}`, "```glsl", shortSource(ex.source.trim()), "```", "段落狀態：", states);
  }
  return out.join("\n");
}

/** Round 25 (N3): the genre's look, which the song's picture keeps (forms, surface, motion, transitions). */
function genreLookBlock(findings: Findings, lyrics: boolean): string {
  if (!findings.genre) return "";
  const fit = genreFitForms(findings, { lyrics }).slice(0, 4);
  const surfaces = Object.entries(SURFACE_BY_GENRE[findings.genre.id] ?? {})
    .filter(([, k]) => (k ?? 0) >= 1.2)
    .map(([t]) => TEXTURE_LABELS[t as TextureId]);
  const motion = Object.entries(motionBias(findings))
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 2)
    .map(([m]) => MOTION_LABELS[m as MotionId]);
  const label = isBallad(findings) ? `${findings.genre.label}（抒情）` : findings.genre.label;
  return [
    `- 曲風：${label}。這首歌的畫面要先看得出曲風，其次才是和樂團其他歌不同。`,
    `- 適合的主角形狀：${fit.map((f) => FORM_LABELS[f]).join("、")}（其中一種或它的變體）`,
    surfaces.length ? `- 質地：${surfaces.join("、")}` : "",
    motion.length ? `- 動態：${motion.join("、")}；換段方式：${TRANSITION_WORDS[transitionCharacterOf(findings)]}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
const TRANSITION_WORDS: Record<TransitionCharacter, string> = { swell: "慢慢漲起", cut: "硬切", scan: "掃描", tide: "像潮水推進", sweep: "掃過" };

export function buildScenePrompt(req: DesignRequest, plan: DesignPlan, opts: { errors?: string[]; previous?: SceneProgram | null; critique?: string } = {}): string {
  const st = analyzeStructure(req);
  const duration = st.duration;
  const kv = plan.keyVisual;
  const parts = [
    "# 歌曲",
    songBlock(req, duration),
    "",
    "# 研究簡報",
    trimBrief(req.research),
    "",
    "# 已經定好的設計方案（畫面要屬於這個世界）",
    `- 主視覺：「${kv.title}」— ${kv.concept.slice(0, 300)}`,
    `- 情緒：${kv.moodKeywords.join("、")}`,
    `- 色票（依序是 uPal0…）：${kv.palette.map((p) => `${p.hex} ${p.name}（${p.role}）`).join("、")}`,
    `- 母題：${kv.motifs.join("、")}`,
    plan.typeSystem ? `- 字體語言：${plan.typeSystem.voice}（${plan.typeSystem.rationale?.slice(0, 100) ?? ""}）` : "",
    "",
    "# 段落（每一段寫一筆 sections）",
    sectionsBlock(plan),
    "",
    "# 各段的歌詞（節錄）",
    lyricsBySection(req, plan),
    "",
    "# 能量曲線（每 2 秒）",
    energyCurveBlock(req, st),
  ];
  const bible = bibleBlock(req.bible, req.bandName);
  if (bible) parts.push("", "# 樂團視覺聖經（硬性限制：留在這個世界裡）", bible);
  const mood = (req.moodboard ?? []).filter((m) => m.note?.trim() || m.stats?.palette?.length);
  if (mood.length) parts.push("", "# 參考圖（說明與量到的顏色）", ...mood.slice(0, 10).map((m, i) => `- 圖 ${i + 1}：${m.note?.trim() || "（沒有說明）"}${m.stats?.palette?.length ? `｜${m.stats.palette.slice(0, 4).join(" ")}` : ""}`));
  const found = collectedBlock(req.collected, req.collectedImages, { media: false });
  if (found) {
    const lead = leadPalette(req.collected);
    parts.push(
      "",
      "# 研究找到的素材（這首歌真正的封面、MV、主視覺）",
      found,
      "- 專屬畫面要看得出和這些素材是同一個世界：形狀、構圖、光線與材質從它們取（例如封面的大色塊與留白、MV 的光線方向、主視覺的幾何），顏色一律用色票 uniform（uPal0…uPal5、uBg／uPri／uAcc），程式不能讀這些圖片。",
      ...(lead ? [`- ${lead.item.provenance.kind === "cover" ? "封面" : "主視覺"}量到的配色（依份量）：${lead.palette.slice(0, 6).join("、")}；方案的色票已經依它調整，畫面的明暗比例也參考它。`] : []),
    );
  }
  if (req.arc) parts.push("", "# 整場弧線", `- 第 ${req.arc.position + 1}／${req.arc.total} 首，角色 ${req.arc.role}，目標能量 ${req.arc.energy.toFixed(2)}：${req.arc.note}`);
  const findings = analyzeFindings(req);
  const lyrics = (req.lyrics?.lines ?? []).some((l) => typeof l?.text === "string" && l.text.trim());
  const look = genreLookBlock(findings, lyrics);
  if (look) parts.push("", "# 曲風的畫面語言（優先於和其他歌不同）", look);
  parts.push("", "# uniform 合約（逐字）", PROGRAM_CONTRACT_DOC, "", "# 參考", exampleBlock(findings, songSeed(req)));
  if (opts.previous) parts.push("", "# 目前的專屬畫面（要修改它，不是從頭再做，除非指示要求）", `「${opts.previous.title}」：${opts.previous.concept}`, "```glsl", opts.previous.source.slice(0, 9000), "```");
  const instruction = req.instruction?.trim();
  if (instruction) parts.push("", "# 這次的指示（最優先）", instruction);
  if (opts.errors?.length) parts.push("", "# 上一次的程式沒有通過檢查，請修正這些問題後整個重寫", ...opts.errors.map((e) => `- ${e}`));
  // round 25: the render self-check of the program above — one corrected version, same world
  if (opts.critique) parts.push("", "# 渲染檢查（修正上面這支程式：保留它的世界與主角，依數字調整形狀大小、層數與亮度，輸出完整的 source 與 sections）", opts.critique);
  parts.push("", "請輸出 JSON：title、concept、rationale、source、keyMoment、sections（每個段落一筆）。");
  return parts.filter((p) => p !== "").join("\n");
}

/** Claude's draft → a stored program (null when the code is refused). */
export function programFromDraft(raw: unknown, plan: DesignPlan, meta: { model: string; instruction?: string; now: Date }, repairs: string[] = []): { program: SceneProgram | null; errors: string[] } {
  const draft = raw && typeof raw === "object" ? (raw as Partial<SceneProgramDraft>) : {};
  const checked = validateProgram(draft.source);
  if (!checked.ok) return { program: null, errors: checked.errors };
  const program = normalizeSceneProgram(
    {
      version: 1,
      engine: "claude",
      model: meta.model,
      title: draft.title,
      concept: [draft.concept, draft.rationale].filter((s) => typeof s === "string" && s.trim()).join(" "),
      source: draft.source,
      sections: draft.sections,
      keyMoment: draft.keyMoment,
      enabled: true,
      createdAt: meta.now.toISOString(),
      ...(meta.instruction ? { instruction: meta.instruction } : {}),
    },
    { sections: plan.sections, repairs },
  );
  if (!program) return { program: null, errors: ["程式沒有通過檢查"] };
  // the luminance probe: a program that whites out the wall is sent back like any other failure
  const probe: ProbeResult = probePlanProgram(program, plan);
  if (!probe.ok) return { program: null, errors: probe.errors };
  for (const w of probe.warnings) repairs.push(w);
  return { program, errors: [] };
}
