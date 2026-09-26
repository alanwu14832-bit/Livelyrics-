// Map plan.lines[].emphasis substrings onto units.

import type { TextUnit } from "./tokenize";

/** Per UTF-16 index: true when the character belongs to an emphasized substring. */
export function emphasisMask(text: string, emphasis: readonly string[] | null | undefined): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  if (!emphasis) return mask;
  for (const raw of emphasis) {
    const needle = typeof raw === "string" ? raw.trim() : "";
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      for (let i = at; i < at + needle.length; i++) mask[i] = true;
      from = at + needle.length;
    }
  }
  return mask;
}

/** Per unit: emphasized when any non-space character of the unit is covered. */
export function unitEmphasis(units: readonly TextUnit[], mask: readonly boolean[]): boolean[] {
  return units.map((u) => {
    if (u.kind === "space") return false;
    for (let i = u.from; i < u.to; i++) if (mask[i]) return true;
    return false;
  });
}
