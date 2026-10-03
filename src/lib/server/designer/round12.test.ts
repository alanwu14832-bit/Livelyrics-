// Round 12 — variety and the instrumental: the form is a weighted draw over genre family ×
// imagery families × energy shape, seeded by the song, so the seven audit songs no longer share
// three programs; textures and motions vary; consecutive songs of one band never wear the same
// form + texture; the built-in chorus scenes rotate per song and the outro is not always the motif;
// an instrumental's program breathes on its own and passes the luminance probe; a written program
// that whites out the wall is sent back for repair or replaced by the composer.

import { describe, expect, it } from "vitest";
import { chooseComposition, composeSceneProgram, FORM_IDS, TEXTURE_IDS, type FormId, type TextureId } from "@/lib/stage/program/composer";
import { EXAMPLE_PROGRAMS } from "@/lib/stage/program/examples";
import { probePlanProgram } from "@/lib/stage/program/probe";
import type { SceneId, SceneProgram } from "@/lib/types";
import { analyzeFindings } from "./findings";
import { chooseClimax, offlineContext, offlineDesign } from "./offline";
import { bandPairs, ensureSceneProgram, formWeights, motionBias, offlineSceneProgram, programFromDraft, sceneForms, songSeed, surfaceWeights } from "./scene-program";
import { AUDIT_SONGS, auditInput, auditSong } from "./testing/audit-songs";

const plans = new Map(AUDIT_SONGS.map((s) => [s.key, offlineDesign(auditInput(s))] as const));
const plan = (key: string) => plans.get(key)!;
const recipeOf = (key: string) => plan(key).sceneProgram!.recipe!.split("#")[0].split("/") as [FormId, TextureId, string];
const lastChorus = (key: string) => [...plan(key).sections].reverse().find((s) => s.kind === "chorus")!;

describe("M4 · the form is a weighted draw seeded by the song", () => {
  it("the seven audit songs get at least five forms, none more than twice, and vary texture and motion", () => {
    const forms = AUDIT_SONGS.map((s) => recipeOf(s.key)[0]);
    const counts = new Map<string, number>();
    for (const f of forms) counts.set(f, (counts.get(f) ?? 0) + 1);
    expect(new Set(forms).size, forms.join(",")).toBeGreaterThanOrEqual(5);
    expect(Math.max(...counts.values()), forms.join(",")).toBeLessThanOrEqual(2);
    expect(new Set(AUDIT_SONGS.map((s) => recipeOf(s.key)[1])).size).toBeGreaterThanOrEqual(3);
    expect(new Set(AUDIT_SONGS.map((s) => recipeOf(s.key)[2])).size).toBeGreaterThanOrEqual(3);
  });

  it("weights come from the genre family, the imagery families and the energy shape", () => {
    const punk = formWeights(analyzeFindings(auditInput(auditSong("punk"))));
    // 牆 (14 hits) and the punk family: pillars and bars lead, ribbons stay low
    expect(punk.pillars).toBeGreaterThan(punk.ribbons * 4);
    expect(punk.bars).toBeGreaterThan(punk.brush * 4);
    const ballad = formWeights(analyzeFindings(auditInput(auditSong("ballad"))));
    // 雨 gives the threads a real chance in a pop ballad
    expect(ballad.threads).toBeGreaterThan(1.5);
    const folk = formWeights(analyzeFindings(auditInput(auditSong("folk"))));
    expect(sceneForms(analyzeFindings(auditInput(auditSong("folk"))))[0]).toBe("strata");
    expect(folk.brush).toBeGreaterThan(folk.bars);
    // every form keeps a weight: nothing is forbidden, only rarer
    for (const f of FORM_IDS) expect(punk[f]).toBeGreaterThan(0);
    // an instrumental leans to shapes that hold a frame without words
    const inst = analyzeFindings(auditInput(auditSong("instrumental")));
    expect(formWeights(inst, { lyrics: false }).pillars).toBeGreaterThan(formWeights(inst, { lyrics: true }).pillars);
    expect(formWeights(inst, { lyrics: false }).bars).toBeLessThan(formWeights(inst, { lyrics: true }).bars);
  });

  it("the texture follows the genre's surface and the imagery, the motion the strongest image", () => {
    const punk = surfaceWeights(analyzeFindings(auditInput(auditSong("punk"))));
    expect(punk.halftone!).toBeGreaterThan(punk.film!);
    const folk = surfaceWeights(analyzeFindings(auditInput(auditSong("folk"))));
    expect(folk.paper!).toBeGreaterThan(folk.scan! * 3);
    const city = surfaceWeights(analyzeFindings(auditInput(auditSong("citypop"))));
    expect(city.scan!).toBeGreaterThan(1);
    expect(motionBias(analyzeFindings(auditInput(auditSong("longlines")))).sweep).toBeGreaterThan(1);
  });

  it("the seed mixes the project id in, and two songs of one genre on one audio differ", () => {
    const meta = { title: "同名", artist: "同團", duration: 73, fileName: "a.wav" } as never;
    expect(songSeed({ meta, songId: "p1" })).not.toBe(songSeed({ meta, songId: "p2" }));
    expect(songSeed({ meta })).toBe(songSeed({ meta }));
    const findings = analyzeFindings(auditInput(auditSong("demo")));
    const weights = formWeights(findings);
    const forms = new Set<string>();
    for (let seed = 1; seed <= 24; seed++) forms.add(chooseComposition({ seed: seed * 2654435761, forms: sceneForms(findings), weights, sections: [] }).form);
    expect(forms.size).toBeGreaterThanOrEqual(4);
    // the demo and the long-lines song are both indie rock on the same audio and wear different programs
    expect(recipeOf("demo")[0]).not.toBe(recipeOf("longlines")[0]);
  });

  it("a salt walks the weighted order: 「重新產生畫面」 never lands on the same form twice in a row", () => {
    const findings = analyzeFindings(auditInput(auditSong("demo")));
    const weights = formWeights(findings);
    const a = chooseComposition({ seed: 777, forms: sceneForms(findings), weights, sections: [] });
    const b = chooseComposition({ seed: 777, forms: sceneForms(findings), weights, sections: [], salt: 1 });
    const c = chooseComposition({ seed: 777, forms: sceneForms(findings), weights, sections: [], salt: 2 });
    expect(a.form).not.toBe(b.form);
    expect(b.form).not.toBe(c.form);
  });

  it("consecutive songs of one band never share form + texture", () => {
    const findings = analyzeFindings(auditInput(auditSong("demo")));
    const weights = formWeights(findings);
    const base = { seed: 4321, forms: sceneForms(findings), weights, sections: [], voice: "mv-card" as const };
    const first = chooseComposition(base);
    // the previous song wears exactly this pair: the texture changes
    const next = chooseComposition({ ...base, avoid: [{ form: first.form, texture: first.texture }] });
    expect(next.form).toBe(first.form);
    expect(next.texture).not.toBe(first.texture);
    // the previous songs wore the form with every texture but one: the form changes
    const worn = TEXTURE_IDS.filter((t) => t !== first.texture).map((texture) => ({ form: first.form, texture }));
    const other = chooseComposition({ ...base, avoid: [{ form: first.form, texture: first.texture }, ...worn] });
    expect(other.form).not.toBe(first.form);
    // through the designer: the band's previous recipe arrives as bandSongs
    const req = { ...auditInput(auditSong("demo")), bandSongs: [{ id: "x", recipe: `${first.form}/${first.texture}/drift#0` }] };
    expect(bandPairs(req)).toEqual([{ form: first.form, texture: first.texture }]);
    const p = offlineSceneProgram(req, plan("demo"));
    const [f, t] = p.recipe!.split("#")[0].split("/");
    expect(`${f}/${t}`).not.toBe(`${first.form}/${first.texture}`);
  });
});

describe("M4 · chorus-scene rotation and the outro", () => {
  it("the last chorus climaxes on different scenes across the seven songs, 隧道 in at most two", () => {
    const climaxes = AUDIT_SONGS.map((s) => lastChorus(s.key).scene);
    const counts = new Map<SceneId, number>();
    for (const sc of climaxes) counts.set(sc, (counts.get(sc) ?? 0) + 1);
    expect(Math.max(...counts.values()), climaxes.join(",")).toBeLessThanOrEqual(2);
    expect(counts.get("tunnel") ?? 0).toBeLessThanOrEqual(2);
    // the choruses still climb: a loud last chorus is the song's climax scene, never a smaller rung
    const rank: Partial<Record<SceneId, number>> = { particles: 1, waves: 1.5, grid: 2, shards: 3, tunnel: 4 };
    for (const s of AUDIT_SONGS) {
      const choruses = plan(s.key).sections.filter((x) => x.kind === "chorus");
      const last = choruses[choruses.length - 1];
      if (choruses.length < 2 || last.energy < 0.65) continue;
      for (const c of choruses) expect(rank[c.scene] ?? 2, `${s.key}: ${c.scene} above ${last.scene}`).toBeLessThanOrEqual(rank[last.scene] ?? 2);
    }
  });

  it("a calm song never climaxes on a tunnel or on shards; three choruses leave room to climb", () => {
    const ballad = offlineContext(auditInput(auditSong("ballad")));
    for (let seed = 0; seed < 50; seed++) {
      const sc = chooseClimax(["particles", "grid", "shards", "tunnel"], ballad.findings, seed * 97, null, true, 2);
      expect(["particles", "grid", "waves"]).toContain(sc);
      const big = chooseClimax(["particles", "grid", "shards", "tunnel"], ballad.findings, seed * 97, null, false, 3);
      expect(["grid", "shards", "tunnel"]).toContain(big);
    }
  });

  it("the band's previous climax is never repeated by the next song", () => {
    const punk = offlineContext(auditInput(auditSong("punk")));
    const own = chooseClimax(["particles", "grid", "shards", "tunnel"], punk.findings, punk.seed, null, false, 3);
    const next = chooseClimax(["particles", "grid", "shards", "tunnel"], punk.findings, punk.seed, own, false, 3);
    expect(next).not.toBe(own);
    const planned = offlineDesign({ ...auditInput(auditSong("punk")), bandSongs: [{ id: "prev", chorusScene: lastChorus("punk").scene }] });
    expect([...planned.sections].reverse().find((s) => s.kind === "chorus")!.scene).not.toBe(lastChorus("punk").scene);
  });

  it("the outro is not the motif in every song: a return to the opening, the climax dying down, or the motif when the brief calls for it", () => {
    const outros = AUDIT_SONGS.map((s) => plan(s.key).sections[plan(s.key).sections.length - 1]);
    expect(outros.every((o) => o.kind === "outro")).toBe(true);
    const scenes = outros.map((o) => o.scene);
    expect(new Set(scenes).size).toBeGreaterThanOrEqual(3);
    expect(scenes.filter((sc) => sc === "motif").length).toBeLessThanOrEqual(3);
    for (const s of AUDIT_SONGS) {
      const sections = plan(s.key).sections;
      const outro = sections[sections.length - 1];
      const ok = outro.scene === "motif" || outro.scene === sections[0].scene || outro.scene === lastChorus(s.key).scene || ["gradient", "bokeh", "ink", "nebula", "waves", "particles"].includes(outro.scene);
      expect(ok, `${s.key}: ${outro.scene}`).toBe(true);
      expect(outro.scene).not.toBe(sections[sections.length - 2].scene);
      if (outro.scene !== "motif") expect(outro.rationale).toContain("慢慢暗下去");
    }
  });
});

describe("M3 · the instrumental", () => {
  it("gets a program that breathes on its own and passes the probe in every section", () => {
    const p = plan("instrumental");
    const program = p.sceneProgram!;
    expect(program.source).toContain("quiet(");
    expect(program.source).toContain("uSongTime / 8.0");
    expect(program.concept).toContain("沒有歌詞");
    const probe = probePlanProgram(program, p);
    expect(probe.ok, probe.errors.join(";")).toBe(true);
    for (const s of probe.samples) {
      expect(s.lit, s.sectionId).toBeLessThanOrEqual(0.35);
      expect(s.mean, `${s.sectionId} is not a black screen`).toBeGreaterThan(0.03);
    }
    // a sung song's program has no instrumental layer
    expect(plan("demo").sceneProgram!.source).not.toContain("quiet(");
  });

  it("the pillars form tints its rays with the palette, never white", () => {
    const sections = [
      { id: "s0", kind: "verse" as const, energy: 0.4 },
      { id: "s1", kind: "chorus" as const, energy: 0.9 },
    ];
    const p = composeSceneProgram({ seed: 99, forms: ["pillars"], sections, lyrics: false });
    expect(p.source).toContain("vec3 lc = mix(uAcc, uPri, 0.2);");
    expect(p.source).not.toMatch(/lc = mix\(uAcc, vec3\(1\.0\)/);
  });
});

describe("the luminance probe in the designer", () => {
  const sections = plan("instrumental").sections;
  const draft = (source: string) => ({
    title: "白牆",
    concept: "整面白。",
    rationale: "測試。",
    source,
    keyMoment: null,
    sections: sections.map((s) => ({ sectionId: s.id, mode: s.kind === "chorus" ? 2 : 0, params: [0.5, 0.5, 0.5, 0.5], zone: { x: 0.08, y: 0.14, w: 0.4, h: 0.5 }, relation: "plain", note: "測試" })),
  });

  it("programFromDraft sends a white-out back with the numbers; a dark program passes", () => {
    const bad = programFromDraft(draft("vec3 scene(vec2 fc) { return mix(vec3(0.9), uAcc, 0.1); }"), plan("instrumental"), { model: "m", now: new Date() });
    expect(bad.program).toBeNull();
    expect(bad.errors[0]).toMatch(/亮部佔畫面/);
    const good = programFromDraft(draft(EXAMPLE_PROGRAMS.find((e) => e.id === "monolith")!.source), plan("instrumental"), { model: "m", now: new Date() });
    expect(good.program?.engine).toBe("claude");
  });

  it("ensureSceneProgram replaces a written program that whites out the wall with the composer's, and says so", () => {
    const p = plan("instrumental");
    const white: SceneProgram = { ...p.sceneProgram!, engine: "claude", title: "白牆", source: "vec3 scene(vec2 fc) { return vec3(0.95); }" };
    const repairs: string[] = [];
    const out = ensureSceneProgram({ ...auditInput(auditSong("instrumental")), previous: { ...p, sceneProgram: white } }, { ...p, sceneProgram: null }, repairs);
    expect(out.sceneProgram?.engine).toBe("offline");
    expect(repairs.join()).toMatch(/太亮/);
    // a dark written program is kept
    const dark: SceneProgram = { ...white, source: EXAMPLE_PROGRAMS[2].source };
    const kept = ensureSceneProgram({ ...auditInput(auditSong("instrumental")), previous: { ...p, sceneProgram: dark } }, { ...p, sceneProgram: null });
    expect(kept.sceneProgram?.engine).toBe("claude");
  });
});
