// Round 25 — the picture fits the genre, and Claude checks its own render.
// N3: the genre decides which forms (palette band, surface, motion) a song may wear; the library's
// rotation only breaks ties inside that set. The scene prompt carries the genre's look, two few-shot
// examples chosen by the genre, and a short digest of the vendored shader / composition / colour skills.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { RecentLook } from "@/lib/types";
import { analyzeFindings } from "./findings";
import { freshHue, GENRE_HUE_REACH, offlineDesign } from "./offline";
import { hueFamily, lookOfPlan } from "./recent";
import { buildScenePrompt, examplesForSong, formWeights, genreFitForms, motionBias, SCENE_SYSTEM } from "./scene-program";
import { AUDIT_SONGS, auditInput, auditPublicInfo } from "./testing/audit-songs";
import { demoMeta } from "./testing/fixtures";
import type { DesignerInput } from "./types";

const EMO_LRC = ["[00:05.00]刀片劃過手腕 我數著血滴", "[00:11.00]浴室的燈太亮 我想死在今晚", "[00:17.00]他拿著刀 對準我的喉嚨", "[00:24.00]殺了我 殺了我", "[00:28.00]鮮血染紅這面牆", "[00:33.00]Cut me open, let me bleed", "[00:40.00]槍口對著你們每一個人", "[00:48.00]殺了我 殺了我", "[00:52.00]鮮血染紅這面牆", "[00:58.00]我不想再醒來", "[01:05.00]把藥全部吞下去"].join("\n");

/** The round-21 audit's eight songs (the seven audit songs and the emo song, with its MusicBrainz tags). */
export function auditEight(): Array<{ key: string; input: DesignerInput }> {
  const songs = AUDIT_SONGS.map((s) => ({ key: s.key, input: auditInput(s) }));
  const emo = { key: "emo", title: "浴室的燈", artist: "灰燼日記", tags: ["emo", "screamo", "post-hardcore"], type: "Group" as const, lines: [] };
  songs.push({ key: "emo", input: { ...auditInput(AUDIT_SONGS[0]), meta: demoMeta({ title: emo.title, artist: emo.artist }), lyrics: parseLyricsText(EMO_LRC, "user"), publicInfo: auditPublicInfo(emo) } });
  return songs;
}

/** What each audit song's genre may wear (written out by hand, independent of the weight tables). */
const GENRE_SET: Record<string, string[]> = {
  demo: ["bars", "horizon", "pillars", "threads", "orbits"],
  longlines: ["bars", "horizon", "pillars", "threads", "orbits"],
  ballad: ["horizon", "strata"],
  punk: ["bars", "brush"],
  citypop: ["horizon", "ribbons", "bars"],
  folk: ["strata", "brush"],
  instrumental: ["strata", "horizon", "ribbons", "threads"],
  emo: ["threads", "pillars", "brush"],
};

const lyricsOf = (input: DesignerInput) => input.lyrics.lines.some((l) => l.text.trim());

/** Design songs in order in one library, each seeing the forms and looks before it (as the pipeline passes them). */
function library(songs: Array<{ key: string; input: DesignerInput }>) {
  const forms: string[] = [];
  const looks: RecentLook[] = [];
  return songs.map((s) => {
    const plan = offlineDesign({ ...s.input, songId: `proj-${s.key}`, recentForms: [...forms], recentLooks: [...looks] });
    const look = lookOfPlan(plan);
    forms.unshift(look.form!);
    looks.unshift(look);
    return { key: s.key, plan, look };
  });
}

describe("N3 · genre fit beats rotation", () => {
  const eight = auditEight();

  it("each of the eight songs wears a form from its genre's set, in library order and reversed", () => {
    for (const order of [eight, [...eight].reverse()]) {
      for (const r of library(order)) {
        expect(GENRE_SET[r.key], `${r.key}: ${r.look.form}`).toContain(r.look.form);
        const s = eight.find((x) => x.key === r.key)!;
        expect(genreFitForms(analyzeFindings(s.input), { lyrics: lyricsOf(s.input) })).toContain(r.look.form);
      }
    }
  });

  it("two songs of different genres collapse onto one form only when it fits both", () => {
    const rows = library(eight);
    for (const a of rows)
      for (const b of rows) {
        if (a.key >= b.key || a.look.form !== b.look.form) continue;
        expect(GENRE_SET[a.key]).toContain(a.look.form);
        expect(GENRE_SET[b.key]).toContain(b.look.form);
      }
    // and the library still varies: at least five forms over eight songs
    expect(new Set(rows.map((r) => r.look.form)).size).toBeGreaterThanOrEqual(5);
  });

  it("the library's rotation reorders inside the set and never lifts a form from outside it", () => {
    const folk = eight.find((s) => s.key === "folk")!.input;
    const f = analyzeFindings(folk);
    // folk worn as strata twice: the brush takes over, the river's ribbons (outside folk) never do
    const w = formWeights(f, { lyrics: true, recentForms: ["strata", "strata", "brush"] });
    expect(w.ribbons).toBeLessThan(Math.min(w.strata, w.brush));
    const punk = analyzeFindings(eight.find((s) => s.key === "punk")!.input);
    const wp = formWeights(punk, { lyrics: true, recentForms: ["brush", "bars", "brush", "bars"] });
    for (const x of ["horizon", "ribbons", "orbits", "strata", "pillars", "threads"] as const) expect(wp[x], x).toBeLessThan(Math.min(wp.bars, wp.brush));
  });

  it("the genre's motion and hue survive the rotation", () => {
    const punk = analyzeFindings(eight.find((s) => s.key === "punk")!.input);
    expect(motionBias(punk).sweep).toBeGreaterThan(1.5);
    const folk = analyzeFindings(eight.find((s) => s.key === "folk")!.input);
    expect((motionBias(folk).drift ?? 1) * (motionBias(folk).breathe ?? 1)).toBeGreaterThan(motionBias(folk).sweep ?? 1);
    // a hue family worn twice moves at most GENRE_HUE_REACH for a genre song (else to any family)
    const worn: RecentLook[] = [{ palette: "red" }, { palette: "red" }];
    const moved = freshHue(5, worn, GENRE_HUE_REACH);
    expect(Math.min(Math.abs(moved - 5), 360 - Math.abs(moved - 5))).toBeLessThanOrEqual(GENRE_HUE_REACH);
    expect(hueFamily(moved)).not.toBe("red");
  });
});

describe("N3 · the scene prompt: genre look, genre few-shot examples, the skills digest", () => {
  const eight = auditEight();

  it("the few-shot examples follow the genre (no longer always the monolith)", () => {
    const first = (key: string) => examplesForSong(analyzeFindings(eight.find((s) => s.key === key)!.input)).map((e) => e.id);
    expect(first("punk")).toEqual(["signal", "monolith"]);
    expect(first("folk")[0]).toBe("tidal-flat");
    expect(first("citypop")[0]).toBe("night-drive");
    expect(first("ballad")[0]).toBe("enso");
    expect(first("instrumental")[0]).toBe("monolith");
    for (const s of eight) expect(first(s.key)).toHaveLength(2);
  });

  it("the prompt names the genre's forms and shows two examples; the system carries the digest", () => {
    const s = eight.find((x) => x.key === "punk")!;
    const prompt = buildScenePrompt({ ...s.input, research: "" } as never, offlineDesign(s.input));
    expect(prompt).toContain("# 曲風的畫面語言");
    expect(prompt).toMatch(/適合的主角形狀：一筆墨、印刷的斜線/);
    expect(prompt).toContain("「訊號」");
    expect((prompt.match(/```glsl/g) ?? []).length).toBe(2);
    for (const k of ["max(x, 1e-4)", "NaN", "迴圈上限是常數", "主歌 < 10%", "副歌 25–45%", "安全區", "不會變白", "鄰近色相"]) expect(SCENE_SYSTEM).toContain(k);
  });
});
