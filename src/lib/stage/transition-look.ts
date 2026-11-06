// Round 22 (N6) — every section change used to be the same soft diagonal white beam. The compositor
// now takes its look from the song (motion-art-direction: one transition family per song, chosen by
// its tone; color-motion: the edge is the palette's own colour, never white):
//   - the character from the plan's `transitionCharacter` (the designer's genre call: a ballad swells,
//     punk cuts on the downbeat, synth / city pop scans, folk comes in like a slow tide, rock sweeps);
//     an older plan without one reads it from its type system;
//   - a falling-energy change is always a dissolve that dims, whatever the song;
//   - the bright accent (the edge's light, the swell's breath) only when the energy rises;
//   - the angle from the primary's hue (and alternating section to section), the edge width from the
//     section's density, the tint from the incoming section's accent toward its primary.
// Photosensitive safety is unchanged: no character adds a full-field flash, and the LED limiter runs after.

import type { DesignPlan, TransitionCharacter } from "../schema";
import { parseHex, type RGB } from "./color";

/** The characters as the compositor sees them (0 = the legacy look of the transition kind). */
export const CHARACTER_CODE = { dissolve: 1, swell: 2, cut: 3, scan: 4, tide: 5, sweep: 6 } as const;
export type CharacterName = keyof typeof CHARACTER_CODE;

export interface TransitionLook {
  character: (typeof CHARACTER_CODE)[CharacterName];
  /** the reveal direction, radians (0 = left → right, π/2 = bottom → top in GL uv) */
  angle: number;
  /** 0..1: the edge's softness / the scan's row count / the swell's blur */
  width: number;
  /** the edge / breath colour, 0..1 linear-ish sRGB floats */
  tint: RGB;
  /** incoming minus outgoing section energy, −1..1 */
  rise: number;
}

/** A change whose energy falls at least this much is a dissolve (or a dim). */
export const FALL = 0.12;

/** The song's transition character: the plan's own, else read from its type system (older plans). */
export function songCharacter(plan: Pick<DesignPlan, "transitionCharacter" | "typeSystem"> | null | undefined): TransitionCharacter {
  if (plan?.transitionCharacter) return plan.transitionCharacter;
  const ts = plan?.typeSystem;
  if (!ts) return "sweep";
  const speed = ts.params?.motionSpeed ?? 0.5;
  if (ts.voice === "glitch") return (ts.params?.motionIntensity ?? 0.5) >= 0.7 ? "cut" : "scan";
  if (ts.voice === "ink") return "tide";
  if (ts.voice === "mv-card" && speed <= 0.35) return "swell";
  return "sweep";
}

function hueOf([r, g, b]: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-4) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * The look of the change into section `to` (from the section before it, or `from`); null without a
 * plan or a section. `colorway` is the incoming section's [bg, primary, accent] (hex).
 */
export function transitionLook(plan: DesignPlan | null | undefined, to: number | null | undefined, colorway: readonly string[], from?: number | null): TransitionLook | null {
  const sections = plan?.sections ?? [];
  if (to == null || !sections[to]) return null;
  const prev = sections[from ?? to - 1] ?? null;
  const cur = sections[to];
  const rise = Math.max(-1, Math.min(1, prev ? cur.energy - prev.energy : 0));
  const name: CharacterName = rise <= -FALL ? "dissolve" : songCharacter(plan);
  const primary = parseHex(colorway[1], [0.5, 0.5, 0.5]);
  const accent = parseHex(colorway[2], primary);
  const hue = hueOf(primary);
  // a diagonal whose slope follows the hue (−40°…+40°), mirrored on every other section
  const tilt = ((hue / 360) * 80 - 40) * (Math.PI / 180);
  const mirror = to % 2 === 1 ? Math.PI : 0;
  const angle = name === "scan" ? (to % 2 ? Math.PI : 0) : name === "tide" ? Math.PI / 2 + tilt * 0.25 : tilt + mirror;
  const density = Math.max(0, Math.min(1, cur.sceneParams?.density ?? 0.5));
  // the edge is the accent leaning toward the primary — a colour of this song, kept below white
  let tint: RGB = [accent[0] * 0.7 + primary[0] * 0.3, accent[1] * 0.7 + primary[1] * 0.3, accent[2] * 0.7 + primary[2] * 0.3];
  const l = lum(tint);
  if (l > 0.75) tint = tint.map((c) => (c * 0.75) / l) as RGB;
  else if (l < 0.2 && l > 0) tint = tint.map((c) => Math.min(1, (c * 0.2) / l)) as RGB;
  return { character: CHARACTER_CODE[name], angle, width: 0.2 + 0.8 * density, tint, rise };
}
