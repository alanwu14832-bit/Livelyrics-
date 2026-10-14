// Round 20 (M3): the offline designer's prose is written from each song, not from a template. Two
// different songs (the audit's seven, all on the same 73 s analysis) never share a sentence in the
// concept, the section rationales, the arc or the 歌詞與動畫 notes; the mood row is one mood; the
// genre cue follows the song's first chorus; the sing-along phrases are real phrases.
import { describe, expect, it } from "vitest";
import type { DesignPlan } from "@/lib/types";
import { offlineDesign } from "./offline";
import { analyzeFindings } from "./findings";
import { AUDIT_SONGS, auditInput, auditSong } from "./testing/audit-songs";

const plans = new Map<string, DesignPlan>(AUDIT_SONGS.map((s) => [s.key, offlineDesign(auditInput(s))]));
const plan = (key: string) => plans.get(key)!;

/** The notes' paragraphs a designer writes per song (not the operational boilerplate). */
function noteBlocks(notes: string): string {
  const keep = ["## 敘事弧線", "## 歌詞與動畫"];
  return notes
    .split(/\n(?=## )/)
    .filter((b) => keep.some((k) => b.startsWith(k)))
    .join("\n");
}

/** Sentences of a song's designer prose (split on 。；, numbers-only measurements left out). */
function sentences(p: DesignPlan): Set<string> {
  const text = [p.keyVisual.concept, ...p.sections.map((s) => s.rationale), noteBlocks(p.designerNotes)].join("\n");
  return new Set(
    text
      .split(/[。；\n]/)
      .map((s) => s.replace(/^[-\s]+/, "").trim())
      // the measured tempo / arc sentence is the same for the same audio (all audit songs share one file)
      .filter((s) => Array.from(s).length >= 8 && !s.startsWith("##") && !/^約 \d+ BPM/.test(s)),
  );
}

describe("round 20 · prose written from the song", () => {
  it("two different songs share no designer sentence", () => {
    const keys = AUDIT_SONGS.map((s) => s.key);
    const shared: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const a = sentences(plan(keys[i]));
      for (let j = i + 1; j < keys.length; j++) {
        for (const s of sentences(plan(keys[j]))) if (a.has(s)) shared.push(`${keys[i]} × ${keys[j]}: ${s}`);
      }
    }
    expect(shared).toEqual([]);
  });

  it("the old template sentences are gone", () => {
    for (const p of plans.values()) {
      const all = [p.keyVisual.concept, p.designerNotes, ...p.sections.map((s) => s.rationale)].join("\n");
      expect(all).not.toContain("畫面隨能量起伏");
      expect(all).not.toMatch(/每一句歌詞都是「/);
      // the arc never claims a return to the key visual the outro does not make
      const outro = p.sections[p.sections.length - 1];
      if (outro.scene !== "motif") expect(p.designerNotes).not.toContain("回到主視覺");
    }
  });

  it("no section rationale repeats inside a song", () => {
    for (const p of plans.values()) {
      const r = p.sections.map((s) => s.rationale);
      expect(new Set(r).size).toBe(r.length);
    }
  });

  it("the palette sentence never reads 「大片的深夜洋紅，洋紅很省地用」", () => {
    for (const p of plans.values()) {
      const [bg, p1] = p.keyVisual.palette.map((c) => c.name);
      if (bg.includes(p1)) expect(p.keyVisual.concept).not.toContain(`${bg}，${p1}`);
    }
  });

  it("the 情緒 row is one mood: no images, no genre, no contradictory pair", () => {
    for (const s of AUDIT_SONGS) {
      const p = plan(s.key);
      const f = analyzeFindings(auditInput(s));
      const kw = p.keyVisual.moodKeywords;
      expect(kw.length).toBeGreaterThanOrEqual(3);
      expect(kw.length).toBeLessThanOrEqual(4);
      for (const img of f.imagery) expect(kw).not.toContain(img.family.name);
      if (f.genre) expect(kw).not.toContain(f.genre.label);
      expect(kw[0]).toBe(f.mood.label);
      const calm = ["平靜內斂", "憂傷低迴", "陰鬱緩慢", "溫柔漂浮"];
      const loud = ["明亮激昂", "爆發釋放", "冷冽推進", "溫暖律動", "痛苦掙扎"];
      expect(kw.some((k) => calm.includes(k)) && kw.some((k) => loud.includes(k))).toBe(false);
    }
    // the ballad's calm words on a track that explodes: the energy decides, and the concept agrees
    const ballad = plan("ballad");
    expect(ballad.keyVisual.moodKeywords[0]).toBe("爆發釋放");
    expect(ballad.keyVisual.concept).not.toContain("一首安靜的歌");
    expect(ballad.designerNotes).toContain("以能量為準");
  });

  it("a quiet-song concept never calls the song 明亮而激昂", () => {
    for (const p of plans.values()) if (p.keyVisual.concept.includes("一首安靜的歌")) expect(p.keyVisual.concept).not.toMatch(/明亮而激昂|爆開/);
  });

  it("the genre cue lands one bar before the song's own first chorus", () => {
    for (const s of AUDIT_SONGS) {
      const p = plan(s.key);
      const cue = p.cues.find((c) => c.title.includes("的現場"));
      const chorus = p.sections.find((x) => x.kind === "chorus");
      if (!cue || !chorus) continue;
      expect(cue.time, s.key).toBeCloseTo(Math.max(0, chorus.start - 2), 1);
      expect(cue.title).toContain(chorus.label);
    }
    // the punk song's chorus opens at 0:04, not 0:24: its cue is not at the shared 0:22
    expect(plan("punk").cues.find((c) => c.title.includes("的現場"))!.time).toBeLessThan(10);
  });

  it("sing-along phrases are real phrases: ≥ 3 CJK or ≥ 2 Latin words, no filler, never cut on a count", () => {
    for (const s of AUDIT_SONGS) {
      for (const p of analyzeFindings(auditInput(s)).hints.singalong) {
        expect(p.chant).toBe(false);
        expect(p.text).not.toMatch(/^(oh|hey|yeah|la|na)(\s+\1)*$/i);
        expect(p.text).not.toMatch(/一[句個場]$/);
        const han = (p.text.match(/\p{Script=Han}/gu) ?? []).length;
        const latin = (p.text.match(/[A-Za-zÀ-ÿ']+/g) ?? []).length;
        expect(han >= 3 || latin >= 2, `${s.key}: ${p.text}`).toBe(true);
      }
    }
    const ballad = analyzeFindings(auditInput(auditSong("ballad"))).hints.singalong.map((p) => p.text);
    expect(ballad).not.toContain("等一句");
  });
});
