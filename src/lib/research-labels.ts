// Display names (繁中) for who wrote a research brief, proposed directions or made a plan. Shared by
// the design overview, the console and the pipeline's step messages so every place says the same.

import type { DesignEngine, Research } from "./types";

/** The long label of the free path, as the brief and the research panel name it. */
export const FREE_RESEARCH_LABEL = "免費研究（公開資料＋歌詞與音訊分析）";

/** Long label of a brief's engine (the research panel, the step list). */
export function researchEngineLabel(r: Pick<Research, "engine" | "model">): string {
  switch (r.engine) {
    case "claude":
      return `Claude${r.model ? `（${r.model}）` : ""}`;
    case "free":
      return FREE_RESEARCH_LABEL;
    case "manual-claude":
      return "claude.ai 研究（手動貼上）";
    default:
      return "離線研究";
  }
}

/** Short label for tight places (the console top bar, tags). */
export function engineShortLabel(engine: DesignEngine | undefined): string {
  switch (engine) {
    case "claude":
      return "Claude";
    case "free":
      return "免費研究";
    case "manual-claude":
      return "claude.ai";
    default:
      return "離線";
  }
}

/** True for the briefs that came from a real web research (Claude, API or claude.ai). */
export function isClaudeResearch(r: Pick<Research, "engine"> | null | undefined): boolean {
  return r?.engine === "claude" || r?.engine === "manual-claude";
}
