// The song's key-visual thumbnail as a CSS background, from its palette (background first). The
// same recipe as the library card art (palette[0] base, palette[1] radial light, palette[2] a small
// glow), so the shared-element morph between the two reads as one object. Palette colours are
// content, not UI chrome: they are the only hex values the console draws.

import { isHexColor, withAlpha } from "@/lib/console/format";

export function artBackground(colors: readonly (string | null | undefined)[]): string {
  const hex = colors.filter((c): c is string => isHexColor(c));
  if (hex.length === 0) return "var(--fill)";
  const [base, light = base, glow = light] = hex;
  return [
    `radial-gradient(95% 95% at 80% 18%, ${withAlpha(light, 0.45)} 0%, transparent 70%)`,
    `radial-gradient(70% 70% at 18% 100%, ${withAlpha(glow, 0.55)} 0%, transparent 72%)`,
    base,
  ].join(", ");
}

/** The view-transition names shared with the library card and the process page header. */
export const projectArtName = (id: string) => `project-art-${id}`;
export const projectTitleName = (id: string) => `project-title-${id}`;
