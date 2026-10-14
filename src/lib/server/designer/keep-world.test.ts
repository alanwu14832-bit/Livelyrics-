// Round 20 (m9): 「重新研究並設計」 without an instruction keeps the song's world; 「換一個新方向」 changes it.
import { describe, expect, it } from "vitest";
import { designSong } from "./index";
import { asksNewDirection, keepsWorld } from "./keep-world";
import { offlineDesign } from "./offline";
import { AUDIT_SONGS, auditInput, auditSong } from "./testing/audit-songs";

describe("round 20 (m9) · keep the world unless asked", () => {
  it("knows when a run keeps the world", () => {
    expect(keepsWorld({ research: true, design: true, instruction: "", hasPlan: true })).toBe(true);
    expect(keepsWorld({ research: true, design: true, instruction: "副歌更熱血", hasPlan: true })).toBe(false);
    expect(keepsWorld({ research: false, design: true, instruction: "", hasPlan: true })).toBe(false);
    expect(keepsWorld({ research: true, design: true, instruction: "", hasPlan: false })).toBe(false);
    expect(asksNewDirection("換一個新方向")).toBe(true);
    expect(asksNewDirection("整個換個風格")).toBe(true);
    expect(asksNewDirection("副歌更熱血一點")).toBe(false);
  });

  it("a re-research without an instruction keeps the key visual, the 字體語言 and the program", async () => {
    // the previous plan is another song's, so a fresh design would certainly differ
    const previous = offlineDesign(auditInput(auditSong("punk")));
    const input = { ...auditInput(auditSong("ballad")), research: null };
    const fresh = offlineDesign(input);
    expect(fresh.keyVisual.title).not.toBe(previous.keyVisual.title);
    const kept = await designSong({ ...input, previous, keepWorld: true });
    expect(kept.keyVisual.title).toBe(previous.keyVisual.title);
    expect(kept.keyVisual.palette.map((p) => p.hex)).toEqual(previous.keyVisual.palette.map((p) => p.hex));
    expect(kept.typeSystem?.voice).toBe(previous.typeSystem?.voice);
    expect(kept.sceneProgram?.recipe).toBe(previous.sceneProgram?.recipe);
    // the sections follow the song (its own structure), coloured from the kept palette
    const hexes = new Set(previous.keyVisual.palette.map((p) => p.hex.toLowerCase()));
    for (const s of kept.sections) expect(hexes.has(s.colorway[1].toLowerCase()), s.colorway.join()).toBe(true);
  });

  it("「換一個新方向」 gives a new world", async () => {
    for (const s of AUDIT_SONGS.slice(0, 3)) {
      const input = { ...auditInput(s), research: null };
      const previous = offlineDesign(input);
      const next = await designSong({ ...input, previous, instruction: "換一個新方向" });
      expect(next.keyVisual.title, s.key).not.toBe(previous.keyVisual.title);
    }
  });
});
