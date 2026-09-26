// Plan typography -> CSS values for the lyric layer. Kept apart from resolve.ts
// because fonts.ts imports next/font (not loadable in plain unit tests).

import { fontStack } from "../font-meta";
import type { DesignPlan } from "../types";
import { clampWeight } from "./lyrics/layout";
import { clamp } from "./resolve";

export interface StageTypography {
  family: string;
  weight: number;
  letterSpacing: number;
  /** stable key; changes when the lyric DOM must be rebuilt */
  key: string;
}

export function resolveTypography(plan: DesignPlan | null): StageTypography {
  const ty = plan?.keyVisual?.typography;
  const family = fontStack(ty?.cjkFont ?? "noto-sans-tc", ty?.latinFont ?? "space-grotesk");
  const weight = clampWeight(ty?.weight ?? 700);
  const letterSpacing = clamp(ty?.letterSpacing ?? 0.02, -0.08, 0.3, 0.02);
  return { family, weight, letterSpacing, key: `${family}|${weight}|${letterSpacing}` };
}
