// Round 20 (m7): the key still never lands in a line's first moments (the 3 s clip's still caught the
// first line mid-exit and the second mid-entrance, both cut by their wipes).
import { describe, expect, it } from "vitest";
import type { DesignPlan } from "@/lib/types";
import { KEY_SETTLE_SECONDS, keyMomentOf } from "./model";

const plan = (sections: Array<[string, number, number]>) => ({ sections: sections.map(([kind, start, end], i) => ({ id: `s${i}`, kind, start, end, energy: 0.5 })) }) as unknown as DesignPlan;

describe("keyMomentOf · a settled line", () => {
  it("moves past a line that has only just started", () => {
    const lines = [
      { text: "只有三秒", start: 0.2, end: null },
      { text: "就結束了", start: 1.6, end: null },
    ];
    const t = keyMomentOf(plan([["verse", 0, 3]]), 3, lines);
    expect(t).toBeGreaterThanOrEqual(1.6 + KEY_SETTLE_SECONDS - 1e-9);
    expect(t).toBeLessThan(3);
  });

  it("keeps a moment well inside a line", () => {
    const lines = [
      { text: "a", start: 20, end: null },
      { text: "b", start: 30, end: null },
    ];
    expect(keyMomentOf(plan([["verse", 0, 24], ["chorus", 24, 40]]), 40, lines)).toBeCloseTo(24 + 16 * 0.6);
  });
});
