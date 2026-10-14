// Round 18: what the library's last songs wear — the program's form and texture, the type voice and
// font pair, the palette's hue family — so the offline designer does not hand the next song the same
// picture recoloured. A look is read from a plan (the storage summary keeps one per project); the
// designer weighs each choice down by how often the last songs used it (a nudge for one use, nearly
// a ban for two), never below what the song itself calls for when nothing else fits.

import type { DesignPlan, RecentLook } from "@/lib/types";
import { hexToHsl } from "./color";

export type { RecentLook };

/** How many of the library's most recent other songs count. */
export const RECENT_WINDOW = 7;
/** The weight of a choice the last songs used 0, 1, 2+ times. */
export const RECENT_USE_FACTORS = [1, 0.45, 0.04] as const;

/** Hue families of a palette's primary (six 60° sectors, red centred on 0°) or `neutral` when it is grey. */
export const PALETTE_FAMILIES = ["red", "amber", "green", "cyan", "blue", "violet", "neutral"] as const;
export type PaletteFamily = (typeof PALETTE_FAMILIES)[number];
/** The centre hue of each chromatic family (degrees). */
export const FAMILY_HUE: Record<Exclude<PaletteFamily, "neutral">, number> = { red: 0, amber: 52, green: 105, cyan: 165, blue: 225, violet: 285 };

export function hueFamily(h: number): Exclude<PaletteFamily, "neutral"> {
  const x = (((h % 360) + 360) % 360 + 30) % 360;
  if (x < 60) return "red";
  if (x < 105) return "amber";
  if (x < 165) return "green";
  if (x < 225) return "cyan";
  if (x < 285) return "blue";
  if (x < 345) return "violet";
  return "red";
}

export function paletteFamily(hex: string | undefined | null): PaletteFamily {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return "neutral";
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.12 || l < 0.06 || l > 0.94) return "neutral";
  return hueFamily(h);
}

/** The look a plan wears (what the next song should not repeat). */
export function lookOfPlan(plan: Pick<DesignPlan, "sceneProgram" | "typeSystem" | "keyVisual" | "sections"> | null | undefined): RecentLook {
  const out: RecentLook = {};
  const recipe = plan?.sceneProgram?.recipe;
  if (typeof recipe === "string") {
    const [form, texture] = recipe.split("#")[0].split("/");
    if (form) out.form = form;
    if (texture) out.texture = texture;
  }
  const ts = plan?.typeSystem;
  if (ts?.voice) out.voice = ts.voice;
  if (ts?.fonts?.cjk && ts.fonts.latin) out.fonts = `${ts.fonts.cjk}+${ts.fonts.latin}`;
  const primary = plan?.keyVisual?.palette?.[1]?.hex;
  if (primary) out.palette = paletteFamily(primary);
  const climax = [...(plan?.sections ?? [])].reverse().find((s) => s?.kind === "chorus")?.scene;
  if (climax) out.climax = climax;
  return out;
}

/** How often the last RECENT_WINDOW looks used `value` for `key`. */
export function recentUses(looks: readonly RecentLook[] | undefined, key: keyof RecentLook, value: string): number {
  return (looks ?? []).slice(0, RECENT_WINDOW).filter((l) => l?.[key] === value).length;
}

/** The recency weight of a choice (1 when unused). */
export function recentFactor(looks: readonly RecentLook[] | undefined, key: keyof RecentLook, value: string): number {
  return RECENT_USE_FACTORS[Math.min(2, recentUses(looks, key, value))];
}
