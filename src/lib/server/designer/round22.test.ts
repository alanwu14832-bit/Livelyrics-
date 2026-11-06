// Round 22 — nothing amateur on the wall. The audit's eight songs (the round-9 seven and the round-16
// emo song): no operator label (「04 — 主歌」, a line number 「02」) is printed on the wall.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { DesignPlan, LyricLine } from "@/lib/types";
import { composeProjectLine } from "@/lib/type/prepare";
import { approxMeasure } from "@/lib/type/text";
import { offlineDesign } from "./offline";
import { normalizePlan } from "./normalize";
import { AUDIT_SONGS, auditInput } from "./testing/audit-songs";
import { demoInput } from "./testing/fixtures";
import type { DesignerInput } from "./types";

export const EMO_LRC = [
  "[00:05.00]刀片劃過手腕 我數著血滴",
  "[00:11.00]浴室的燈太亮 我想死在今晚",
  "[00:17.00]他拿著刀 對準我的喉嚨",
  "[00:24.00]殺了我 殺了我",
  "[00:28.00]鮮血染紅這面牆",
  "[00:33.00]Cut me open, let me bleed",
  "[00:40.00]槍口對著你們每一個人",
  "[00:48.00]殺了我 殺了我",
  "[00:52.00]鮮血染紅這面牆",
  "[00:58.00]我不想再醒來",
  "[01:05.00]把藥全部吞下去",
].join("\n");

export function eightSongs(): Array<{ key: string; input: DesignerInput }> {
  const songs = AUDIT_SONGS.map((s) => ({ key: s.key, input: auditInput(s) }));
  songs.push({ key: "emo", input: { ...demoInput(), lyrics: parseLyricsText(EMO_LRC, "user") } });
  return songs;
}

const CANVAS = { width: 1920, height: 1080, safe: { top: 0.05, right: 0.05, bottom: 0.08, left: 0.05 } };
const SECTION_WORDS = /主歌|副歌|前奏|間奏|尾奏|橋段|導歌|獨奏|INTRO|VERSE|CHORUS|BRIDGE|OUTRO|SOLO|INTERLUDE|BREAKDOWN/i;

function labelsOf(plan: DesignPlan, lines: LyricLine[], duration: number, title: string): string[][] {
  return lines.map((_, i) => {
    const r = composeProjectLine({ ...plan, typeSystem: plan.typeSystem! }, lines, i, CANVAS, approxMeasure, { duration, songTitle: title });
    return r ? r.comp.pieces.filter((p) => p.role === "label").map((p) => p.glyphs.map((g) => g.ch).join("")) : [];
  });
}

describe("round 22 (N1): no operator labels on the wall", () => {
  for (const { key, input } of eightSongs()) {
    it(`${key}: no resolved line carries a section label or a line number`, () => {
      const plan = offlineDesign(input);
      expect(plan.typeSystem?.ornaments ?? []).not.toContain("section");
      const lines = input.lyrics.lines;
      const names = plan.sections.map((s) => s.label).filter(Boolean);
      labelsOf(plan, lines, input.meta.duration, input.meta.title).forEach((labels, i) => {
        for (const t of labels) {
          expect(t, `${key} #${i}`).not.toMatch(SECTION_WORDS);
          for (const n of names) expect(t.includes(n), `${key} #${i} 「${t}」`).toBe(false);
          // the only label a designed plan prints is the song title
          expect(t, `${key} #${i}`).toBe(input.meta.title.toUpperCase());
        }
      });
      // an older stored plan that still lists the section ornament prints an ordinal at most, never the name
      const old = { ...plan, typeSystem: { ...plan.typeSystem!, ornaments: [...plan.typeSystem!.ornaments, "section" as const], params: { ...plan.typeSystem!.params, ornament: 0.9 } } };
      labelsOf(old, lines, input.meta.duration, "").forEach((labels, i) => {
        for (const t of labels) expect(t, `${key} #${i}`).toMatch(/^\d{2}$/);
      });
    });
  }

  it("Claude's plan loses the section ornament in normalisation", () => {
    const input = auditInput(AUDIT_SONGS.find((s) => s.key === "punk")!);
    const plan = offlineDesign(input);
    const raw = JSON.parse(JSON.stringify(plan));
    raw.typeSystem.ornaments = ["section", "number", "rule"];
    const out = normalizePlan(raw, input);
    expect(out.typeSystem?.ornaments).not.toContain("section");
  });
});
