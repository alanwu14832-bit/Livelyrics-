import { describe, expect, it } from "vitest";
import { buildDirections, offlineDirectionSpecs } from "./server/designer/directions";
import { offlineDesign } from "./server/designer/offline";
import { demoInput } from "./server/designer/testing/fixtures";
import {
  applyComment,
  applySelection,
  applyStatus,
  applyUndo,
  coerceDirectionSet,
  coercePlanSnapshot,
  coercePlanSource,
  proposalSheet,
  removeComment,
  sanitizeComment,
  selectedDirection,
  specimenLine,
  styleFrameMoments,
} from "./directions";
import type { MoodImage, Project } from "./types";

const NOW = "2026-09-29T08:00:00.000Z";

function project(): Project {
  const input = demoInput();
  const req = { ...input, research: null };
  const directions = buildDirections(offlineDirectionSpecs(req), req, { engine: "offline", now: NOW });
  return {
    id: "p1",
    createdAt: NOW,
    updatedAt: NOW,
    status: "ready",
    meta: input.meta,
    audioFile: "audio.wav",
    analysis: input.analysis,
    lyrics: input.lyrics,
    research: null,
    plan: offlineDesign(input),
    assets: [],
    output: { width: 1920, height: 1080, preset: "1080p", lyricSafe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 }, safety: { enabled: true, preset: "led", brightness: 0.7, flashLimit: true, redProtect: true, soften: 0.25 } },
    directions: { engine: "offline", createdAt: NOW, directions },
  };
}

describe("select / undo", () => {
  it("採用這個方向 makes the direction's plan the project plan and keeps the old one", () => {
    const p = project();
    const before = p.plan!;
    const b = p.directions!.directions[1];
    const chosen = applySelection(p, b.id, b.plan, NOW);
    expect(chosen.letter).toBe("B");
    expect(p.plan).toBe(b.plan);
    expect(p.previousPlan).toEqual({ plan: before, at: NOW, reason: `採用方向 B「${b.name}」` });
    expect(selectedDirection(p)?.id).toBe(b.id);
    // choosing another one: only one stays selected, and 復原 goes back one step
    const c = p.directions!.directions[2];
    applySelection(p, c.id, c.plan, NOW);
    expect(p.directions!.directions.filter((d) => d.status === "selected").map((d) => d.letter)).toEqual(["C"]);
    expect(p.previousPlan!.plan).toBe(b.plan);
    expect(applyUndo(p)).toBe(true);
    expect(p.plan).toBe(b.plan);
    expect(p.previousPlan).toBeUndefined();
    expect(selectedDirection(p)).toBeUndefined();
    expect(applyUndo(p)).toBe(false);
  });

  it("records who made the plan, and 復原 brings the earlier source back", () => {
    const p = project();
    p.planSource = { engine: "manual-claude", at: "2026-09-28T00:00:00.000Z" };
    const b = p.directions!.directions[1];
    applySelection(p, b.id, b.plan, NOW);
    expect(p.planSource).toEqual({ engine: "offline", at: NOW });
    expect(p.previousPlan?.source).toEqual({ engine: "manual-claude", at: "2026-09-28T00:00:00.000Z" });
    // the snapshot's source survives storage
    expect(coercePlanSnapshot(JSON.parse(JSON.stringify(p.previousPlan)))?.source?.engine).toBe("manual-claude");
    expect(coercePlanSource({ engine: "robot", at: "" })).toBeUndefined();
    applyUndo(p);
    expect(p.planSource).toEqual({ engine: "manual-claude", at: "2026-09-28T00:00:00.000Z" });
    // a plan without a known source: undo leaves none
    applySelection(p, b.id, b.plan, NOW);
    delete p.previousPlan!.source;
    applyUndo(p);
    expect(p.planSource).toBeUndefined();
  });

  it("unknown directions throw; a project without a plan keeps no snapshot", () => {
    const p = project();
    expect(() => applySelection(p, "dffffffff", p.plan!, NOW)).toThrow(/找不到/);
    p.plan = null;
    const a = p.directions!.directions[0];
    applySelection(p, a.id, a.plan, NOW);
    expect(p.previousPlan).toBeUndefined();
  });

  it("退回 and comments", () => {
    const p = project();
    const [a, b] = p.directions!.directions;
    applyStatus(p, a.id, "rejected", NOW);
    expect(a.status).toBe("rejected");
    applySelection(p, b.id, b.plan, NOW);
    expect(() => applyStatus(p, b.id, "rejected", NOW)).toThrow(/採用中/);
    const c = applyComment(p, a.id, "  顏色再暖一點\u0007 ", NOW);
    expect(c.text).toBe("顏色再暖一點");
    expect(a.comments).toHaveLength(1);
    expect(() => applyComment(p, a.id, "   ", NOW)).toThrow(/空的/);
    expect(removeComment(p, a.id, c.id)).toBe(true);
    expect(a.comments).toHaveLength(0);
    expect(sanitizeComment("x".repeat(700))).toHaveLength(600);
  });
});

describe("stored directions", () => {
  it("round-trip through JSON and drop what no longer validates", () => {
    const p = project();
    p.directions!.directions[0].status = "selected";
    p.directions!.directions[1].status = "selected";
    const raw = JSON.parse(JSON.stringify(p.directions));
    raw.directions[2].plan = { nope: true };
    const set = coerceDirectionSet(raw)!;
    expect(set.directions.map((d) => d.letter)).toEqual(["A", "B"]);
    // at most one selected
    expect(set.directions.map((d) => d.status)).toEqual(["selected", "proposed"]);
    expect(coerceDirectionSet({ directions: [] })).toBeUndefined();
    expect(coerceDirectionSet("x")).toBeUndefined();
    expect(coercePlanSnapshot({ plan: p.plan, at: NOW, reason: "r" })?.reason).toBe("r");
    expect(coercePlanSnapshot({ plan: {} })).toBeUndefined();
  });
});

describe("style frame moments", () => {
  it("intro, first chorus with a line on screen, the bridge, the final chorus", () => {
    const p = project();
    for (const d of p.directions!.directions) {
      const m = styleFrameMoments(d.plan, p.lyrics);
      expect(m.length).toBeGreaterThanOrEqual(3);
      expect(m.length).toBeLessThanOrEqual(4);
      expect(m[0].label).toBe("前奏");
      expect(m.map((x) => x.t)).toEqual([...m.map((x) => x.t)].sort((a, b) => a - b));
      const chorus = m.find((x) => x.label === "第一次副歌")!;
      const sec = d.plan.sections[chorus.sectionIndex];
      expect(sec.kind).toBe("chorus");
      expect(chorus.t).toBeGreaterThanOrEqual(sec.start);
      expect(chorus.t).toBeLessThan(sec.end);
      // a lyric line has started by then
      expect(p.lyrics.lines.some((l) => l.start != null && l.start <= chorus.t && l.start >= sec.start)).toBe(true);
      expect(m.some((x) => x.label === "最後副歌")).toBe(true);
    }
  });

  it("works for tiny plans", () => {
    const p = project();
    const one = { ...p.plan!, sections: [{ ...p.plan!.sections[0], start: 0, end: 10 }] };
    expect(styleFrameMoments(one, null)).toEqual([{ label: "前奏", t: 5, sectionIndex: 0 }]);
  });
});

describe("the sign-off sheet", () => {
  it("shapes the directions, references and sign-off choices for one page", () => {
    const p = project();
    const board: MoodImage[] = [
      { id: "a00000000001", kind: "image", name: "海報", mimeType: "image/webp", file: "a00000000001.webp", width: 10, height: 10, bytes: 1, createdAt: NOW, note: "喜歡這個顏色", stats: { palette: ["#e8452c"], weights: [1], luma: 0.4, saturation: 0.7, warmth: 0.4 }, scope: "band" },
      { id: "a00000000002", kind: "image", name: "劇照", mimeType: "image/webp", file: "a00000000002.webp", width: 10, height: 10, bytes: 1, createdAt: NOW },
    ];
    p.directions!.directions[0].references = [{ imageId: "a00000000001", cue: "取了它的紅" }, { imageId: "gone00000000", cue: "x" }];
    p.directions!.directions[0].rationale = "很長的理由".repeat(80);
    p.directions!.directions[1].status = "selected";
    applyComment(p, p.directions!.directions[0].id, "副歌再大聲一點", NOW);
    const sheet = proposalSheet(p, { bandName: "港口", moodboard: board, fontLabel: (id) => `F:${id}`, now: new Date("2026-09-29T12:00:00") });
    expect(sheet).toMatchObject({ title: "示範之歌", band: "港口", date: "2026-09-29", engine: "offline", selectedLetter: "B", choices: ["A", "B", "C"] });
    const a = sheet.directions[0];
    expect(a.letter).toBe("A");
    expect(a.rationale.length).toBeLessThanOrEqual(220);
    expect(a.references).toEqual([{ imageId: "a00000000001", cue: "取了它的紅", index: 1 }]);
    expect(a.comments).toEqual(["副歌再大聲一點"]);
    expect(a.fonts.cjk).toMatch(/^F:/);
    expect(a.fonts.sample).toBe(specimenLine(p));
    expect(a.palette.length).toBeGreaterThanOrEqual(4);
    expect(a.moments.length).toBeGreaterThanOrEqual(3);
    expect(sheet.directions[1].statusLabel).toBe("已選定");
    expect(sheet.references).toEqual([
      { id: "a00000000001", index: 1, name: "海報", note: "喜歡這個顏色", palette: ["#e8452c"], scope: "band" },
      { id: "a00000000002", index: 2, name: "劇照", note: "", palette: [], scope: "project" },
    ]);
  });

  it("without directions: an empty sheet", () => {
    const p = project();
    delete p.directions;
    const sheet = proposalSheet(p);
    expect(sheet.directions).toEqual([]);
    expect(sheet.selectedLetter).toBeNull();
    expect(sheet.engine).toBeNull();
  });
});
