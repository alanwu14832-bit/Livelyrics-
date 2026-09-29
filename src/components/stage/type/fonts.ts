// The type layer draws on a canvas, so it needs the real font-family names behind next/font's CSS
// variables (resolved on an element inside the stage, where the variables are defined), the
// vertical centre of the CJK face's em box (the shared baseline of CJK and Latin text), and the
// font files for the characters the lyrics use.

import { FONTS, snapWeight } from "@/lib/font-meta";
import type { FontId } from "@/lib/types";

export interface TypeFamilies {
  /** CSS font-family list for CJK glyphs */
  cjk: string;
  /** for Latin runs (the Latin face first, the CJK face as fallback) */
  latin: string;
  key: string;
  /** the faces (their real weights decide the drawn weight: no faux bold) */
  cjkFont?: FontId;
  latinFont?: FontId;
}

/** The weight a role's face really draws for `wanted`. */
export function drawnWeight(families: TypeFamilies, role: "cjk" | "latin", wanted: number): number {
  const id = role === "latin" ? families.latinFont : families.cjkFont;
  return id ? snapWeight(id, wanted) : wanted;
}

function resolve(host: HTMLElement, value: string): string {
  const probe = document.createElement("span");
  probe.style.fontFamily = value;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  host.append(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || value;
}

/** The families of a type system's fonts, resolved inside `host`. */
export function resolveFamilies(host: HTMLElement, fonts: { cjk: FontId; latin: FontId }): TypeFamilies {
  const cjk = FONTS[fonts.cjk]?.cjk ? FONTS[fonts.cjk] : FONTS["noto-sans-tc"];
  const latin = FONTS[fonts.latin] && !FONTS[fonts.latin].cjk ? FONTS[fonts.latin] : FONTS["space-grotesk"];
  const base = FONTS["noto-sans-tc"];
  const cjkStack = resolve(host, `var(${cjk.cssVar}), var(${base.cssVar}), ${cjk.generic}`);
  const latinStack = resolve(host, `var(${latin.cssVar}), var(${cjk.cssVar}), ${latin.generic}`);
  return { cjk: cjkStack, latin: latinStack, key: `${cjkStack}|${latinStack}`, cjkFont: cjk.id, latinFont: latin.id };
}

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;

/** The web font faces named in a family list (next/font's "… Fallback" faces are local metric shims). */
export function webFaces(stack: string): string[] {
  return stack
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter((f) => f && !GENERIC.test(f) && !/ Fallback$/.test(f));
}

/** Load the faces for `text` at `weights` (bounded by `timeoutMs`); resolves true when everything loaded. */
export async function loadFaces(families: TypeFamilies, weights: readonly number[], text: string, timeoutMs = 8000): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts?.load) return false;
  const faces = [...new Set([...webFaces(families.cjk), ...webFaces(families.latin)])];
  const sample = text || "永";
  const loads: Promise<unknown>[] = [];
  for (const f of faces) for (const w of weights) loads.push(document.fonts.load(`${w} 64px "${f}"`, sample).catch(() => []));
  const done = await Promise.race([Promise.all(loads).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
  if (!done) return false;
  return faces.every((f) => weights.every((w) => document.fonts.check(`${w} 64px "${f}"`, sample)));
}
