// Round 23 (N7): the chorus is never the smallest type on the wall. The round-21 audit found folk's
// last chorus at ≈ 30 px under a 150 px verse word and the long-lines 4× hook at ≈ 45 px, identical
// all four times. Every chorus line has a size floor (CHORUS_FLOOR of the short side, the last chorus
// LAST_CHORUS_FLOOR), verse lines keep under it, a long line becomes a poster instead of shrinking,
// and a lyric that comes back grows or changes treatment. Dark lines stay quiet.

import { describe, expect, it } from "vitest";
import { offlineDesign } from "@/lib/server/designer/offline";
import { AUDIT_SONGS, auditInput } from "@/lib/server/designer/testing/audit-songs";
import type { DesignPlan, LyricLine, TypeSystem } from "../types";
import { makeFrame } from "./frame";
import { CHORUS_FLOOR } from "./key-lines";
import type { CanvasSpec, Composition } from "./model";
import { composeProjectLine } from "./prepare";
import { resolveLine } from "./resolve";
import { textKey } from "./sequence";
import { approxMeasure } from "./text";

const SAFE = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 };
const C169: CanvasSpec = { width: 1920, height: 1080, safe: SAFE };
const C916: CanvasSpec = { width: 1080, height: 1920, safe: SAFE };

const largest = (c: Composition) => {
  let m = 0;
  for (const p of c.pieces) if (p.readable) for (const g of p.glyphs) m = Math.max(m, g.size);
  return m;
};

interface Row {
  kind: string | null;
  text: string;
  size: number;
  dark: boolean;
  chant: boolean;
  floor: number;
  repeat: number;
  /** which main pieces carry the accent (the treatment a repeat changes) */
  accent: string;
}

function rows(key: string, canvas: CanvasSpec): Row[] {
  const song = AUDIT_SONGS.find((s) => s.key === key)!;
  const input = auditInput(song);
  const plan = offlineDesign(input) as DesignPlan & { typeSystem: TypeSystem };
  const lines = input.lyrics?.lines ?? [];
  const out: Row[] = [];
  lines.forEach((_, i) => {
    const r = composeProjectLine(plan, lines, i, canvas, approxMeasure, { duration: 73, songTitle: song.title });
    if (!r) return;
    out.push({
      kind: r.res.ctx.sectionKind,
      text: lines[i].text,
      // the type engine's size reference (the short side on 16:9; 0.8 × the width on a tall frame)
      size: largest(r.comp) / makeFrame(canvas, { gridColumns: 12, gridMargin: 0.06 }).ref,
      dark: !!r.comp.dark,
      chant: !!r.res.hint.chant,
      floor: r.res.hint.floor ?? 0,
      repeat: r.res.hint.repeat ?? 0,
      accent: r.comp.pieces
        .filter((p) => p.role === "main")
        .map((p) => (p.plate === "accent" ? "a" : "i"))
        .join(""),
    });
  });
  return out;
}

const KEYS = AUDIT_SONGS.map((s) => s.key);

describe("the chorus is never the smallest type (round 23)", () => {
  for (const canvas of [C169, C916]) {
    it(`every song, ${canvas.width}×${canvas.height}: each chorus line reaches its floor and is at least every verse line's size`, () => {
      const problems: string[] = [];
      for (const key of KEYS) {
        const rs = rows(key, canvas);
        const chorusTexts = new Set(rs.filter((r) => r.kind === "chorus").map((r) => textKey(r.text)));
        const chorus = rs.filter((r) => r.kind === "chorus" && !r.dark);
        // verse lines proper: not the crowd's line, not a chorus lyric sung inside a verse
        const verse = rs.filter((r) => r.kind === "verse" && !r.chant && !chorusTexts.has(textKey(r.text)));
        // a long line on a 9:16 band is held by the band's height (it reaches ≥ 90 % of the floor)
        for (const c of chorus) if (c.size < c.floor * (canvas.width < canvas.height && [...c.text].length > 14 ? 0.9 : 0.97)) problems.push(`${key}@${canvas.width}: chorus 「${c.text}」 ${(c.size * 100).toFixed(1)}% < floor ${c.floor * 100}%`);
        const vmax = Math.max(0, ...verse.map((v) => v.size));
        for (const c of chorus) if (c.size < vmax - 0.002) problems.push(`${key}@${canvas.width}: chorus 「${c.text}」 ${(c.size * 100).toFixed(1)}% < verse ${(vmax * 100).toFixed(1)}%`);
        for (const v of verse) if (v.size > CHORUS_FLOOR + 0.002) problems.push(`${key}@${canvas.width}: verse 「${v.text}」 ${(v.size * 100).toFixed(1)}% over the ceiling`);
      }
      expect(problems).toEqual([]);
    });
  }

  it("a chorus lyric that comes back grows or changes treatment — at any length (the long-lines 4× hook)", () => {
    for (const key of KEYS) {
      const rs = rows(key, C169).filter((r) => r.kind === "chorus" && !r.dark);
      const byText = new Map<string, Row[]>();
      for (const r of rs) byText.set(textKey(r.text), [...(byText.get(textKey(r.text)) ?? []), r]);
      for (const [text, occ] of byText) {
        // the second, third and fourth time
        for (let i = 1; i < Math.min(4, occ.length); i++) {
          const prev = occ[i - 1];
          const cur = occ[i];
          // (a repeat in another chorus stands in that chorus's zone: a few percent either way)
          expect(cur.size, `${key} 「${text}」 #${i + 1}`).toBeGreaterThanOrEqual(prev.size * 0.97);
          const changed = cur.size > prev.size * 1.02 || cur.accent !== prev.accent;
          expect(changed, `${key} 「${text}」 #${i + 1}: ${prev.size} → ${cur.size}`).toBe(true);
        }
      }
    }
    const hook = rows("longlines", C169).filter((r) => r.kind === "chorus");
    expect(hook.length).toBe(4);
    expect(hook[3].size).toBeGreaterThan(hook[0].size * 1.15);
    expect(hook[0].size).toBeGreaterThanOrEqual(CHORUS_FLOOR * 0.97);
  });

  it("a dark chorus line stays quiet: no floor, no growth", () => {
    const song = AUDIT_SONGS.find((s) => s.key === "demo")!;
    const input = auditInput(song);
    const plan = offlineDesign(input) as DesignPlan & { typeSystem: TypeSystem };
    const lines: LyricLine[] = (input.lyrics?.lines ?? []).map((l) => (l.text === "我們的歌會找到方向" ? { ...l, text: "鮮血染紅了這面牆" } : l));
    const i = lines.findIndex((l) => l.text === "鮮血染紅了這面牆");
    expect(i).toBeGreaterThan(-1);
    const r = resolveLine(plan, lines, i, { duration: 73 })!;
    expect(r.ctx.sectionKind).toBe("chorus");
    expect(r.hint.floor).toBeUndefined();
    expect(r.hint.repeat).toBeUndefined();
  });
});
