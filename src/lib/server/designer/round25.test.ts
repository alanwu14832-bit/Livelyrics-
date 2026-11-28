// Round 25 — the picture fits the genre, and Claude checks its own render.
// N3: the genre decides which forms (palette band, surface, motion) a song may wear; the library's
// rotation only breaks ties inside that set. The scene prompt carries the genre's look, two few-shot
// examples chosen by the genre, and a short digest of the vendored shader / composition / colour skills.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { THUMB_MAX_CHARS, type RecentLook } from "@/lib/types";
import { planHash } from "@/lib/plan-hash";
import { frameThumb } from "@/lib/server/thumb";
import { stageLive } from "@/lib/console/format";
import { offeredLyricStyles } from "@/lib/console/plan-edit";
import { analyzeFindings } from "./findings";
import { freshHue, GENRE_HUE_REACH, offlineDesign } from "./offline";
import { hueFamily, lookOfPlan } from "./recent";
import { buildScenePrompt, examplesForSong, formWeights, genreFitForms, motionBias, programFromDraft, SCENE_SYSTEM } from "./scene-program";
import { critiqueAndFix, CRITIQUE_MIN_REMAINING_MS, designSceneProgram } from "./index";
import { checkLine, critiqueProgram } from "@/lib/stage/program/critique";
import { normalizeSceneProgram } from "@/lib/stage/program/model";
import { fakeTransport, message, text } from "./testing/fake-claude";
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

// ---------------------------------------------------------------------------
// Render → metrics → one critique / fix turn (mocked Claude)
// ---------------------------------------------------------------------------

/** One disc on the right whose radius is uParams.x × 0.6 (cover ≈ π r² / 1.78), lit grey (luma ≈ 0.56). */
const DISC = `vec3 scene(vec2 fc) {
  vec2 p = centered(fc) - vec2(0.35, 0.0);
  float d = sdCircle(p, uParams.x * 0.6);
  vec3 col = uBg * 0.6;
  col = mix(col, vec3(0.62, 0.55, 0.5), fill(d));
  // round 27: the grown disc settles under the words on screen
  col = mix(col, uBg * 0.6, wordsMask(fc / uRes, 0.05));
  return col;
}`;

/** A Claude draft of the disc: `verse` sets the verse (and the build's) radius parameter. */
function discDraft(plan: ReturnType<typeof offlineDesign>, verse: number, source = DISC): string {
  const choruses = plan.sections.filter((s) => s.kind === "chorus").map((s) => s.id);
  return JSON.stringify({
    title: "右邊的圓",
    concept: "一個圓。",
    rationale: "測試。",
    source,
    keyMoment: null,
    sections: plan.sections.map((s) => ({
      sectionId: s.id,
      mode: s.kind === "chorus" ? 2 : 0,
      params: [s.kind === "chorus" ? (s.id === choruses[choruses.length - 1] && choruses.length > 1 ? 0.7 : 0.667) : s.kind === "verse" || s.kind === "pre-chorus" ? verse : 0.25, 0.5, 0.5, 0.5],
      zone: { x: 0.05, y: 0.2, w: 0.32, h: 0.6 },
      relation: "plain",
      note: "圓",
    })),
  });
}

describe("render → metrics → one critique turn", () => {
  const input = { ...auditInput(AUDIT_SONGS[0]), research: null } as never;
  const plan = offlineDesign(auditInput(AUDIT_SONGS[0]));
  const deps = (t: ReturnType<typeof fakeTransport>) => ({ transport: t, configured: true, model: "m1" });

  it("the critique measures a good and a bad program in the four arc states", () => {
    const good = programFromDraft(JSON.parse(discDraft(plan, 0.3)), plan, { model: "m", now: new Date() }).program!;
    const bad = programFromDraft(JSON.parse(discDraft(plan, 0.5)), plan, { model: "m", now: new Date() }).program!;
    const g = critiqueProgram(good, plan)!;
    const b = critiqueProgram(bad, plan)!;
    expect(g.failed).toEqual([]);
    expect(g.check.passed).toBe(g.check.total);
    expect(g.check.states.map((s) => s.state)).toEqual(expect.arrayContaining(["verse", "chorus", "last-chorus"]));
    expect(b.failed.length).toBeGreaterThan(0);
    expect(b.check.checks.find((c) => c.id === "verse-quiet")!.ok).toBe(false);
    expect(g.score).toBeGreaterThan(b.score);
  });

  it("a good program triggers no fix turn", async () => {
    const t = fakeTransport([message([text(discDraft(plan, 0.3))], "end_turn")]);
    const r = await designSceneProgram(input, plan, {}, deps(t));
    expect(t.calls).toHaveLength(1);
    expect(r.engine).toBe("claude");
    expect(r.program.check).toMatchObject({ fixTurn: false, kept: "first" });
    expect(r.program.check!.passed).toBe(r.program.check!.total);
    expect(r.program.check!.summary).toMatch(/^畫面自我檢查：通過 \d+／\d+ 項.*不需修正$/);
  });

  it("a bad program triggers exactly one fix turn with the numbers; the better version is kept", async () => {
    const t = fakeTransport([message([text(discDraft(plan, 0.5))], "end_turn"), message([text(discDraft(plan, 0.3))], "end_turn")]);
    const logs: string[] = [];
    const r = await designSceneProgram(input, plan, { onLog: (m) => logs.push(m) }, deps(t));
    expect(t.calls).toHaveLength(2);
    const second = JSON.stringify(t.calls[1].messages);
    expect(second).toContain("渲染檢查");
    expect(second).toContain("主歌亮的面積");
    expect(second).toContain("sdCircle(p, uParams.x * 0.6)"); // the first program is shown to be corrected
    expect(r.program.check).toMatchObject({ fixTurn: true, kept: "fixed" });
    expect(r.program.check!.firstPassed).toBeLessThan(r.program.check!.passed);
    expect(r.program.check!.summary).toContain("Claude 修正一次");
    expect(logs.join("\n")).toMatch(/畫面自我檢查/);
  });

  it("a fix turn that is worse, refused or fails keeps the first program cleanly", async () => {
    // worse: the verse even bigger
    const worse = fakeTransport([message([text(discDraft(plan, 0.5))], "end_turn"), message([text(discDraft(plan, 0.55))], "end_turn")]);
    const r1 = await designSceneProgram(input, plan, {}, deps(worse));
    expect(worse.calls).toHaveLength(2);
    expect(r1.engine).toBe("claude");
    expect(r1.program.sections.find((s) => plan.sections.find((p) => p.id === s.sectionId)?.kind === "verse")!.params[0]).toBe(0.5);
    expect(r1.program.check).toMatchObject({ fixTurn: true, kept: "first" });
    // refused: the fixed program does not validate
    const refused = fakeTransport([message([text(discDraft(plan, 0.5))], "end_turn"), message([text(discDraft(plan, 0.3, "#define X 1\n" + DISC))], "end_turn")]);
    const r2 = await designSceneProgram(input, plan, {}, deps(refused));
    expect(r2.engine).toBe("claude");
    expect(r2.program.check).toMatchObject({ fixTurn: true, kept: "first", fixFailed: true });
    expect(r2.program.check!.summary).toContain("修正失敗，保留第一版");
    // fails: the transport errors on the second call — no offline fallback, no throw
    const broken = fakeTransport([message([text(discDraft(plan, 0.5))], "end_turn"), new Error("overloaded")]);
    const r3 = await designSceneProgram(input, plan, {}, deps(broken));
    expect(broken.calls).toHaveLength(2);
    expect(r3.engine).toBe("claude");
    expect(r3.program.check).toMatchObject({ fixTurn: true, kept: "first", fixFailed: true });
  });

  it("without enough of the step's budget left no fix turn is sent", async () => {
    const first = programFromDraft(JSON.parse(discDraft(plan, 0.5)), plan, { model: "m", now: new Date() }).program!;
    let calls = 0;
    const run = async () => {
      calls++;
      return { raw: JSON.parse(discDraft(plan, 0.3)), model: "m" };
    };
    const cbs = { onLog: () => {}, onDelta: () => {}, onThinking: () => {} } as never;
    const r = await critiqueAndFix(first, plan, { model: "m", now: new Date() }, run, CRITIQUE_MIN_REMAINING_MS - 1, cbs);
    expect(calls).toBe(0);
    expect(r.program.check).toMatchObject({ fixTurn: false, kept: "first" });
    const r2 = await critiqueAndFix(first, plan, { model: "m", now: new Date() }, run, CRITIQUE_MIN_REMAINING_MS, cbs);
    expect(calls).toBe(1);
    expect(r2.program.check!.kept).toBe("fixed");
  });

  it("the check survives normalisation and reads as one Chinese line", () => {
    const good = programFromDraft(JSON.parse(discDraft(plan, 0.3)), plan, { model: "m", now: new Date() }).program!;
    const c = critiqueProgram(good, plan)!;
    const check = { ...c.check, fixTurn: true, kept: "fixed" as const, firstPassed: 6, summary: "" };
    const line = checkLine(check)!;
    expect(line).toMatch(/^畫面自我檢查：第一版只通過 6／\d+ 項，Claude 修正一次 → 通過/);
    const n = normalizeSceneProgram({ ...good, check: { ...check, summary: line } }, { sections: plan.sections })!;
    expect(n.check?.summary).toBe(line);
    expect(normalizeSceneProgram({ ...good, check: { bogus: true } }, { sections: plan.sections })!.check).toBeUndefined();
  });
});

describe("m2 · a real picture on every library card", () => {
  it("the server renders a frame of each song's program as a small PNG at the key moment", { timeout: 60_000 }, () => {
    const ms: number[] = [];
    for (const s of auditEight()) {
      const plan = offlineDesign(s.input);
      const project = { plan, meta: s.input.meta, analysis: s.input.analysis, lyrics: s.input.lyrics } as never;
      const t0 = Date.now();
      const thumb = frameThumb(project)!;
      ms.push(Date.now() - t0);
      expect(thumb, s.key).not.toBeNull();
      expect(thumb.url.startsWith("data:image/png;base64,")).toBe(true);
      expect(thumb.url.length).toBeLessThanOrEqual(THUMB_MAX_CHARS);
      expect(thumb).toMatchObject({ plan: planHash(plan), kind: "frame" });
      // a picture, not a flat tile: the deflated PNG carries real detail
      expect(Buffer.from(thumb.url.split(",")[1], "base64").length).toBeGreaterThan(600);
      const off = { plan: { ...plan, sceneProgram: { ...plan.sceneProgram!, enabled: false } }, meta: s.input.meta, analysis: s.input.analysis, lyrics: s.input.lyrics } as never;
      expect(frameThumb(off)).toBeNull();
    }
    expect(Math.max(...ms)).toBeLessThan(5000);
  });
});

describe("m1 / m8 · console", () => {
  it("the preview poster stays until the stage draws the program (or has none, or gave up)", () => {
    const st = (backend: "webgl2" | "fallback", state?: "pending" | "ready" | "failed" | "slow" | "override") => ({ backend, program: state ? { state, title: "x" } : null });
    expect(stageLive(null, true)).toBe(false);
    expect(stageLive(st("webgl2", "pending"), true)).toBe(false);
    expect(stageLive(st("webgl2", "ready"), true)).toBe(true);
    expect(stageLive(st("webgl2", "failed"), true)).toBe(true);
    expect(stageLive(st("webgl2"), false)).toBe(true);
    expect(stageLive(st("fallback", "pending"), true)).toBe(true);
  });

  it("卡拉 OK 填色 is offered only for lyrics with real timing, never for a show look's text", () => {
    const s = auditEight().find((x) => x.key === "ballad")!;
    const plan = offlineDesign(s.input);
    const real = { lyrics: s.input.lyrics, plan };
    expect(offeredLyricStyles(real)).toContain("karaoke");
    const guessed = { lyrics: { ...s.input.lyrics, lines: s.input.lyrics.lines.map((l) => ({ ...l, estimated: true as const })) }, plan };
    expect(offeredLyricStyles(guessed)).not.toContain("karaoke");
    expect(offeredLyricStyles(guessed, { current: "karaoke" })).toContain("karaoke");
    expect(offeredLyricStyles(real, { text: true })).not.toContain("karaoke");
    // per section: a section whose lines are all real offers it even when another section is guessed
    const chorus = plan.sections.findIndex((x) => x.kind === "chorus");
    const mixed = { lyrics: { ...s.input.lyrics, lines: s.input.lyrics.lines.map((l) => (l.start != null && l.start < plan.sections[chorus].start ? { ...l, estimated: true as const } : l)) }, plan };
    expect(offeredLyricStyles(mixed, { sectionIndex: chorus })).toContain("karaoke");
    expect(offeredLyricStyles(mixed)).not.toContain("karaoke");
    for (const style of ["line-fade", "impact", "hidden"] as const) expect(offeredLyricStyles(guessed)).toContain(style);
  });
});
