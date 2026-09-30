// Phase 8: the image list Claude writes after its research brief (a fenced ```visuals JSON block,
// RESEARCH_VISUALS_RULES). Split it off the brief, parse it tolerantly, and keep it out of the
// streamed brief the process page shows.

import type { VisualCandidate } from "@/lib/types";
import { coerceCandidates } from "@/lib/visuals";
import { VISUALS_FENCE } from "./prompts";

const OPEN = "```" + VISUALS_FENCE;

function parseLoose(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    const c = t.indexOf("[");
    const d = t.lastIndexOf("]");
    for (const [x, y] of [
      [a, b],
      [c, d],
    ]) {
      if (x >= 0 && y > x) {
        try {
          return JSON.parse(t.slice(x, y + 1));
        } catch {
          /* next */
        }
      }
    }
    return null;
  }
}

/**
 * The brief without the image list, and the candidates in it. A missing or broken list gives no
 * candidates (the brief is untouched); an unterminated block (the reply was cut) is dropped too.
 */
export function splitVisuals(text: string): { brief: string; candidates: VisualCandidate[] } {
  const at = text.lastIndexOf(OPEN);
  if (at < 0) return { brief: text, candidates: [] };
  const body = text.slice(at + OPEN.length);
  const end = body.indexOf("```");
  const json = end >= 0 ? body.slice(0, end) : body;
  const after = end >= 0 ? body.slice(end + 3) : "";
  const brief = `${text.slice(0, at).trimEnd()}${after.trim() ? `\n\n${after.trim()}` : ""}`;
  return { brief, candidates: coerceCandidates(parseLoose(json)) };
}

/**
 * Wrap a text-delta callback so the image list never reaches the screen: text is passed through
 * except a tail that could be the start of the fence, and everything from the fence on is held back.
 */
export function visualsStreamFilter(emit: (delta: string) => void): { push(delta: string): void; flush(): void } {
  let pending = "";
  let hidden = false;
  return {
    push(delta: string) {
      if (hidden || !delta) return;
      pending += delta;
      const at = pending.indexOf(OPEN);
      if (at >= 0) {
        const before = pending.slice(0, at);
        if (before) emit(before);
        pending = "";
        hidden = true;
        return;
      }
      // keep the longest tail that may still become the fence
      let keep = 0;
      for (let n = Math.min(OPEN.length - 1, pending.length); n > 0; n--) {
        if (OPEN.startsWith(pending.slice(-n))) {
          keep = n;
          break;
        }
      }
      const out = pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      if (out) emit(out);
    },
    flush() {
      if (!hidden && pending) emit(pending);
      pending = "";
    },
  };
}
