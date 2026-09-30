// A short, stable fingerprint of a design plan (FNV-1a over its JSON). The library thumbnail
// (Project.thumb) records the plan it was rendered from, so a changed plan shows the drawn artwork
// again until the design overview renders and saves a fresh still.

import type { DesignPlan } from "@/lib/types";

export function planHash(plan: DesignPlan | null | undefined): string {
  if (!plan) return "";
  const text = JSON.stringify(plan);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
