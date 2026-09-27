import { describe, expect, it } from "vitest";
import { defaultBible } from "./band";
import { DesignPlanSchema } from "./schema";
import { applyShowPatch, coerceShow, colorwayFor, defaultLook, formatRunningTime, lookToPlan, lookToProject, moveItem, paletteRoles, setlistTotals, songItems, songStatus } from "./show";
import type { BandBible, ProjectSummary, SetItem, SetLook } from "./types";

const bible: BandBible = {
  ...defaultBible(),
  palette: [
    { hex: "#0b0a14", role: "背景", name: "夜" },
    { hex: "#3a4cc9", role: "主色", name: "藍" },
    { hex: "#e0467c", role: "點綴", name: "玫瑰" },
    { hex: "#f4f1e8", role: "歌詞", name: "月光" },
    { hex: "#ffc857", role: "高光", name: "燈" },
  ],
  fonts: { cjkFont: "noto-serif-tc", latinFont: "playfair-display", weight: 800 },
  motifs: ["霧中的燈塔", "潮汐"],
  sceneAffinity: ["ink", "nebula"],
  sceneAvoid: ["motif"],
};

const summary = (over: Partial<ProjectSummary>): ProjectSummary => ({ id: "p", title: "t", artist: "", duration: 200, status: "ready", updatedAt: "", hasPlan: true, lyricLines: 10, ...over });

describe("lookToPlan", () => {
  it("builds a valid one-section plan in the band's world", () => {
    const look: SetLook = { scene: "nebula", colorway: ["#0b0a14", "#3a4cc9", "#e0467c"], media: null, text: "夜行樂團", durationHint: 300 };
    const plan = lookToPlan(look, bible, { kind: "walk-in", title: "進場" });
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.sections).toHaveLength(1);
    const s = plan.sections[0];
    expect([s.start, s.end, s.scene]).toEqual([0, 300, "nebula"]);
    expect(s.lyricStyle).toBe("line-fade");
    expect(plan.keyVisual.typography.cjkFont).toBe("noto-serif-tc");
    expect(plan.keyVisual.palette.map((c) => c.hex)).toContain("#ffc857");
    expect(plan.keyVisual.motifSvg.startsWith("<svg")).toBe(true);
    // no text: lyrics hidden; no bible: palette from the colorway
    const bare = lookToPlan({ ...look, text: undefined }, null);
    expect(bare.sections[0].lyricStyle).toBe("hidden");
    expect(bare.keyVisual.palette.map((c) => c.hex)).toEqual(look.colorway);
  });

  it("gives StageView a synthetic project with the text as the only line and the band library", () => {
    const item: SetItem = { id: "w1", kind: "walk-in", title: "進場", look: { scene: "ink", colorway: ["#000000", "#3a4cc9", "#e0467c"], media: { assetId: "abcdefabcdef", treatment: "full", fit: "contain", opacity: 0.8, blend: "screen" }, text: "夜行" } };
    const band = { id: "b1", name: "夜行", bible, assets: [{ id: "abcdefabcdef", kind: "logo" as const, name: "logo", mimeType: "image/png", file: "abcdefabcdef.png", width: 1, height: 1, bytes: 1, createdAt: "" }] };
    const p = lookToProject(item as Extract<SetItem, { kind: "walk-in" }>, { band, output: { width: 3840, height: 1080, preset: "custom", lyricSafe: { top: 0, right: 0, bottom: 0, left: 0 } } });
    expect(p.lyrics.lines).toEqual([{ id: "l0", text: "夜行", start: 0, end: 600 }]);
    expect(p.bandId).toBe("b1");
    expect(p.bandAssets?.[0].scope).toBe("band");
    expect(p.output.width).toBe(3840);
    expect(p.plan?.sections[0].media?.assetId).toBe("abcdefabcdef");
    expect(p.plan?.sections[0].lyricPlacement).toBe("lower-third");
  });

  it("defaults a look to preferred scenes and never an avoided one", () => {
    expect(defaultLook("walk-in", bible, "夜行").scene).not.toBe("motif");
    expect(defaultLook("interlude", bible).scene).toBe("nebula");
    expect(defaultLook("walk-in", bible, "夜行").text).toBe("夜行");
    const withLogo = defaultLook("walk-in", bible, "夜行", [{ id: "abcdefabcdef", kind: "logo", name: "l", mimeType: "image/png", file: "abcdefabcdef.png", width: 1, height: 1, bytes: 1, createdAt: "" }]);
    expect(withLogo.media?.assetId).toBe("abcdefabcdef");
  });
});

describe("palette roles", () => {
  it("sorts colours into stage roles", () => {
    const r = paletteRoles(bible.palette.map((c) => c.hex));
    expect(r.bg).toBe("#0b0a14");
    expect(r.lyric).toBe("#f4f1e8");
    const cw = colorwayFor(bible.palette.map((c) => c.hex), "highlight");
    expect(cw).toHaveLength(3);
    for (const c of cw) expect(bible.palette.map((p) => p.hex)).toContain(c);
  });
});

describe("setlist", () => {
  it("reports song readiness", () => {
    expect(songStatus(summary({}))).toBe("ready");
    expect(songStatus(summary({ hasPlan: false }))).toBe("needs-design");
    expect(songStatus(summary({ status: "new" }))).toBe("needs-design");
    expect(songStatus(summary({ lyricLines: 0 }))).toBe("missing-lyrics");
    expect(songStatus(summary({ status: "processing" }))).toBe("processing");
    expect(songStatus(summary({ status: "error" }))).toBe("error");
    expect(songStatus(undefined)).toBe("missing");
  });

  it("totals the running time", () => {
    const items: SetItem[] = [
      { id: "a", kind: "walk-in", title: "進場", look: { scene: "nebula", colorway: ["#000000", "#111111", "#222222"], media: null, durationHint: 300 } },
      { id: "b", kind: "song", projectId: "p1" },
      { id: "c", kind: "song", projectId: "p2" },
      { id: "d", kind: "standby", title: "待機", look: { scene: "gradient", colorway: ["#000000", "#111111", "#222222"], media: null } },
      { id: "e", kind: "song", projectId: "gone" },
    ];
    const songs = new Map([
      ["p1", summary({ duration: 200 })],
      ["p2", summary({ duration: 250.4, lyricLines: 0 })],
    ]);
    const t = setlistTotals(items, songs);
    expect(t).toEqual({ total: 750.4, music: 450.4, songs: 3, unknown: 1, ready: 1 });
    expect(formatRunningTime(t.total)).toBe("12 分");
    expect(formatRunningTime(3900)).toBe("1 小時 5 分");
    expect(formatRunningTime(200)).toBe("3 分 20 秒");
    expect(songItems(items).map((s) => [s.projectId, s.position])).toEqual([["p1", 0], ["p2", 1], ["gone", 2]]);
  });

  it("moves items (keyboard reorder)", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a"], 3, 0)).toEqual(["a"]);
  });
});

describe("show file and edits", () => {
  it("coerces a hand-edited show", () => {
    const s = coerceShow(
      { bandId: "b1", name: "", date: "2026/10/01", items: [{ kind: "song", projectId: "../x" }, { kind: "song", projectId: "p1" }, { kind: "walk-in", look: { scene: "nope", colorway: ["#fff"] } }, { kind: "party" }], arc: { songs: [{ itemId: "zzz" }] } },
      "s1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(s.name).toBe("未命名演出");
    expect(s.date).toBeUndefined();
    expect(s.items.map((i) => i.kind)).toEqual(["song", "walk-in"]);
    const look = s.items[1].kind === "walk-in" ? s.items[1].look : null;
    expect(look?.scene).toBe("gradient");
    expect(look?.colorway).toEqual(["#ffffff", "#ffffff", "#ffffff"]);
    expect(s.output.width).toBe(1920);
    expect(s.arc?.songs).toEqual([]);
  });

  it("only accepts the band's songs and library in edits", () => {
    const show = coerceShow({ bandId: "b1", name: "巡演" }, "s1", "");
    const ctx = { projectIds: new Set(["p1"]), assetIds: new Set(["abcdefabcdef"]) };
    const ok = applyShowPatch(show, { items: [{ id: "x1", kind: "song", projectId: "p1" }, { id: "x2", kind: "interlude", title: "MC", look: { scene: "ink", colorway: ["#000000", "#111111", "#222222"], media: { assetId: "ffffffffffff", treatment: "full" } } }], date: "2026-10-01" }, ctx);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.show.date).toBe("2026-10-01");
      // media from outside the band library is dropped
      expect(ok.show.items[1].kind !== "song" && ok.show.items[1].look.media).toBeNull();
    }
    expect(applyShowPatch(show, { items: [{ kind: "song", projectId: "other" }] }, ctx).ok).toBe(false);
    expect(applyShowPatch(show, { name: "  " }, ctx).ok).toBe(false);
    expect(applyShowPatch(show, { date: "tomorrow" }, ctx).ok).toBe(false);
  });
});

describe("arc directives", () => {
  it("builds the re-design directive from the arc note and the current order", async () => {
    const { arcDirectiveFor } = await import("./show");
    const show = coerceShow(
      {
        bandId: "b1",
        name: "巡演",
        items: [
          { id: "w", kind: "walk-in", title: "進場", look: {} },
          { id: "a", kind: "song", projectId: "p1" },
          { id: "b", kind: "song", projectId: "p2" },
        ],
        arc: { engine: "offline", songs: [{ itemId: "b", role: "finale", energy: 1, emphasis: "highlight", note: "壓軸" }] },
      },
      "s1",
      "",
    );
    expect(arcDirectiveFor(show, "b")).toEqual({ showName: "巡演", position: 1, total: 2, role: "finale", energy: 1, emphasis: "highlight", note: "壓軸" });
    expect(arcDirectiveFor(show, "a")).toBeNull();
  });
});
