// 研究找到的素材 (phase 8): download the band's real material a research pointed at — the Cover Art
// Archive front of the song's album and the candidate list Claude wrote (the API research, or a
// claude.ai reply pasted into 用 claude.ai 研究) — and merge it into the project's collection.
// Shared by the pipeline's research step and the manual apply. Bounded by `budgetMs`; a failure is
// logged, never thrown (the research or the apply it belongs to is not affected).

import type { Project, VisualCandidate } from "@/lib/types";
import { collectedSummary, MAX_COLLECTED } from "@/lib/visuals";
import { authorizationFor, storeCollected } from "./collected-storage";
import { collectVisuals, VISUALS_BUDGET_MS, visualsConfig } from "./research/visuals";

export interface CollectForProjectOptions {
  candidates: readonly VisualCandidate[];
  /** the song's release group when the research knows it (its cover is fetched from the Cover Art Archive) */
  releaseGroup: { id: string; title: string } | null;
  signal: AbortSignal;
  /** at most VISUALS_BUDGET_MS */
  budgetMs?: number;
  log: (message: string) => void;
}

export interface CollectForProjectResult {
  /** 「找到專輯封面、2 張 MV 畫面」 or "" when nothing new was stored */
  line: string;
  /** the project after storing (null when nothing changed) */
  project: Project | null;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Collect what `candidates` and the release group point at into `project`'s 研究找到的素材. */
export async function collectForProject(project: Project, opts: CollectForProjectOptions): Promise<CollectForProjectResult> {
  const { log, signal } = opts;
  const none: CollectForProjectResult = { line: "", project: null };
  if (!visualsConfig().enabled) return none;
  try {
    const current = project.collected ?? [];
    const room = MAX_COLLECTED - current.length;
    const rg = opts.releaseGroup;
    const candidates = opts.candidates;
    if (!rg && !candidates.length) return none;
    if (room <= 0) {
      log(`研究找到的素材已經有 ${current.length} 張（上限 ${MAX_COLLECTED}），這次不再下載新的。`);
      return none;
    }
    const budgetMs = Math.min(VISUALS_BUDGET_MS, opts.budgetMs ?? VISUALS_BUDGET_MS);
    if (budgetMs < 3000) {
      log("這個步驟剩下的時間不夠，這次不收集視覺素材（重新研究時會再試）。");
      return none;
    }
    log(`收集樂團的視覺素材：${[rg ? `《${rg.title}》的封面（Cover Art Archive）` : "", candidates.length ? `Claude 列出的 ${candidates.length} 個素材` : ""].filter(Boolean).join("、")}…`);
    const authorization = await authorizationFor(project);
    const skip = {
      urls: new Set([...current.map((c) => c.provenance.imageUrl), ...(project.collectedDismissed ?? [])]),
      hashes: new Set([...current.map((c) => c.hash), ...(project.collectedDismissed ?? [])]),
    };
    const got = await collectVisuals({ meta: project.meta, releaseGroup: rg, candidates: [...candidates], authorization, skip, room }, { signal, budgetMs, onLog: log });
    for (const note of got.notes.slice(0, 4)) log(note);
    if (!got.downloads.length) {
      log(got.tried ? "沒有下載到可用的視覺素材。" : "沒有新的視覺素材。");
      return none;
    }
    const { added, project: stored } = await storeCollected(project.id, got.downloads);
    const line = collectedSummary(added);
    if (!line) return { line: "", project: stored };
    log(`${line}${authorization ? "（樂團已授權，可以上台）" : "（尚未確認樂團授權：先只當參考）"}`);
    return { line, project: stored };
  } catch (err) {
    if (signal.aborted) throw err;
    log(`收集視覺素材失敗：${describe(err)}（研究結果不受影響）`);
    return none;
  }
}
