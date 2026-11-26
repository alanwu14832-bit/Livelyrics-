// Round 24 — say what the wall shows. The audit's eight songs: the operator's copy (rationale, cues,
// notes, console names) comes from the scene program that actually draws the wall; every scene key
// changes the wall; titles are the song's own words, the concept one clear sentence; section names
// read as Chinese; the vendored kinetic-type / motion-direction skills choose each line's technique.

import { describe, expect, it } from "vitest";
import { parseLyricsText } from "@/lib/lyrics/lrc";
import { sceneBank } from "@/lib/console/plan-edit";
import { briefForPanel } from "@/lib/research-labels";
import { readableLabels } from "@/lib/section-names";
import { TYPE_RECIPE_IDS } from "@/lib/schema";
import { initialStageState } from "@/lib/stage/protocol";
import { resolveLook } from "@/lib/stage/resolve";
import { programFrame } from "@/lib/stage/program/runtime";
import { sectionWall } from "@/lib/stage/program/wall";
import { SCENE_LABELS } from "@/lib/stage/scenes/labels";
import { LINE_MEANINGS, lineMeaning } from "@/lib/type/technique";
import { RECIPES } from "@/lib/type/vocab";
import type { DesignPlan, Project, SectionDesign } from "@/lib/types";
import { TEMPLATE_TITLE_PATTERNS } from "./concept";
import { offlineDesign } from "./offline";
import { DESIGN_SYSTEM, typeCatalogBlock } from "./prompts";
import { AUDIT_SONGS, auditInput } from "./testing/audit-songs";
import { demoMeta } from "./testing/fixtures";
import { hasDarkWord } from "@/lib/type/sensitive";

const EMO_LRC = [
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
import type { DesignerInput } from "./types";

function eight(): Array<{ key: string; input: DesignerInput }> {
  const songs = AUDIT_SONGS.map((s) => ({ key: s.key, input: auditInput(s) }));
  const base = auditInput(AUDIT_SONGS[0]);
  songs.push({ key: "emo", input: { ...base, meta: demoMeta({ title: "浴室的燈", artist: "灰燼日記" }), lyrics: parseLyricsText(EMO_LRC, "user"), publicInfo: undefined } });
  return songs;
}

const songs = eight().map((s) => ({ ...s, plan: offlineDesign(s.input) }));
const BUILT_IN = Object.values(SCENE_LABELS);

describe("N9 · titles are the song's own words, the concept one clear sentence", () => {
  it("the eight songs get eight distinct titles and none is a template", () => {
    const titles = songs.map((s) => s.plan.keyVisual.title);
    expect(new Set(titles).size).toBe(8);
    for (const t of titles) {
      expect(Array.from(t).length).toBeLessThanOrEqual(12);
      for (const re of TEMPLATE_TITLE_PATTERNS) expect(t, `${t} ~ ${re}`).not.toMatch(re);
    }
    // a song that sings plain words is titled by one of its phrases (not its own song title)
    for (const s of songs) {
      if (s.key === "instrumental" || s.key === "emo") continue;
      const sung = s.input.lyrics.lines.map((l) => l.text).join("\n");
      expect(sung, s.key).toContain(s.plan.keyVisual.title);
      expect(s.plan.keyVisual.title).not.toBe(s.input.meta?.title);
    }
  });

  it("the concept leads with one sentence: the title, the thing on the wall, how the chorus opens it — no adjective salad", () => {
    for (const s of songs) {
      const c = s.plan.keyVisual.concept;
      const lead = c.split("。")[0];
      expect(lead.startsWith(`「${s.plan.keyVisual.title}」：牆上只有`), `${s.key}: ${lead}`).toBe(true);
      expect(lead).toContain(s.plan.sceneProgram!.title);
      expect(c).not.toMatch(/明亮而激昂|溫柔而明亮|掙扎而熾烈|憂傷而低迴|平靜而內斂|充滿拉扯/);
    }
  });
});

describe("N4 · the copy says what the wall shows", () => {
  it("rationale, cues and notes name the program's form, never a built-in scene the wall does not show", () => {
    for (const s of songs) {
      const p = s.plan;
      expect(p.sceneProgram, s.key).toBeTruthy();
      const text = [...p.sections.map((x) => x.rationale), ...p.cues.map((c) => c.detail), p.designerNotes].join("\n");
      for (const label of BUILT_IN) expect(text, `${s.key}: 「${label}」`).not.toContain(`「${label}」`);
      expect(p.sections.every((x) => x.rationale.includes(p.sceneProgram!.title)), s.key).toBe(true);
    }
  });

  it("the console names each section by the program's form and its role there", () => {
    const p = songs.find((s) => s.key === "demo")!.plan;
    const names = p.sections.map((_, i) => sectionWall(p, i));
    expect(names.every((w) => w.program && w.name.startsWith(p.sceneProgram!.title))).toBe(true);
    const chorus = p.sections.findIndex((s) => s.kind === "chorus");
    expect(names[chorus].name).toContain("打開");
    expect(names[chorus].note).toContain("越出畫面");
    // no program: the built-in scene
    const plain: DesignPlan = { ...p, sceneProgram: undefined };
    expect(sectionWall(plain, chorus)).toEqual({ name: SCENE_LABELS[p.sections[chorus].scene], note: "", program: false });
  });

  it("every scene key changes the wall: keys 1–9 replace the program with that built-in scene, even the section's own", () => {
    const p = songs.find((s) => s.key === "demo")!.plan;
    const project = { id: "r24", meta: { title: "示範之歌", artist: "", duration: 73 }, plan: p, analysis: null, lyrics: { source: "none", synced: false, lines: [] } } as unknown as Project;
    const bank = sceneBank(p);
    expect(bank.length).toBe(9);
    p.sections.forEach((section, si) => {
      const t = section.start + 0.5;
      const state = { ...initialStageState(project.id), t, sectionIndex: si };
      const free = resolveLook(project, state, t);
      expect(programFrame({ project, look: free, t, beat: 0, beatIndex: 0, master: 1, typeBox: null, typeAmt: 0 })).not.toBeNull();
      bank.forEach((scene, k) => {
        const look = resolveLook(project, { ...state, overrides: { ...state.overrides, scene } }, t);
        expect(look.scene, `key ${k + 1}`).toBe(scene);
        expect(look.lookKey).not.toBe(free.lookKey);
        expect(programFrame({ project, look, t, beat: 0, beatIndex: 0, master: 1, typeBox: null, typeAmt: 0 }), `section ${si} key ${k + 1} (${scene})`).toBeNull();
      });
    });
  });
});

describe("m6 · section names", () => {
  it("a raw label reads as its Chinese kind, numbered", () => {
    const s = (kind: SectionDesign["kind"], label: string) => ({ kind, label });
    expect(readableLabels([s("verse", "Verse 1"), s("chorus", "chorus"), s("verse", ""), s("chorus", "副歌二"), s("outro", "Outro")]).map((x) => x.label)).toEqual(["主歌一", "副歌一", "主歌二", "副歌二", "尾奏"]);
  });

  it("a line or two after the last chorus is the 尾奏, not another 主歌", () => {
    for (const key of ["demo", "punk", "citypop", "folk"]) {
      const p = songs.find((s) => s.key === key)!.plan;
      const last = p.sections[p.sections.length - 1];
      expect(last.kind, key).toBe("outro");
      expect(last.label).toBe("尾奏");
    }
    for (const s of songs) for (const x of s.plan.sections) expect(x.label).toMatch(/\p{Script=Han}/u);
  });
});

describe("m9 · copy said once", () => {
  it("the standing advice is on the first chorus cue only", () => {
    for (const s of songs) {
      const n = s.plan.cues.filter((c) => c.detail.includes("主唱把麥克風交給觀眾")).length;
      expect(n, s.key).toBeLessThanOrEqual(1);
      expect(s.plan.cues.filter((c) => c.detail.includes("改用手動 cue")).length, s.key).toBeLessThanOrEqual(1);
    }
  });

  it("the research panel does not repeat the free research's disclaimer or its source list", () => {
    const brief = "> **免費研究**：資料來自 MusicBrainz。\n\n## 樂團視覺識別\n- 甲\n\n## 參考來源\n- [MusicBrainz](https://musicbrainz.org/x)";
    const shown = briefForPanel(brief, { footnote: true, sourcesListed: true });
    expect(shown).not.toContain("MusicBrainz");
    expect(shown).toContain("## 樂團視覺識別");
    expect(briefForPanel(brief, { footnote: false, sourcesListed: false })).toBe(brief);
  });
});

describe("kinetic-type · the technique by what the line does", () => {
  it("reads the line's meaning", () => {
    expect(lineMeaning("拆掉這面牆")?.id).toBe("break");
    expect(lineMeaning("Hey Hey Hey")?.id).toBe("shout");
    expect(lineMeaning("他們說安靜 他們說聽話")?.id).toBe("list");
    expect(lineMeaning("把你的名字 一字一字放回心裡來")?.id).toBe("write");
    expect(lineMeaning("就算世界再大再遠")?.id).toBe("vast");
    expect(lineMeaning("安靜一下 聽見了嗎")?.id).toBe("intimate");
    expect(lineMeaning("等一句 再見")?.id).toBe("vanish");
    // a lamp that never goes out does not vanish; a Latin phrase is not a list
    expect(lineMeaning("追逐一盞永遠不會熄滅的燈")?.id).not.toBe("vanish");
    expect(lineMeaning("Luces de la ciudad")).toBeNull();
    expect(lineMeaning("夜色慢慢落在城市的邊緣")).toBeNull();
  });

  it("maps every meaning onto recipes the engine renders, and the offline designer follows it", () => {
    for (const m of Object.values(LINE_MEANINGS)) for (const r of m.recipes) expect(TYPE_RECIPE_IDS).toContain(r);
    const punk = songs.find((s) => s.key === "punk")!;
    const lines = punk.input.lyrics.lines;
    const sys = punk.plan.typeSystem!;
    const wall = lines.findIndex((l) => l.text === "拆掉這面牆");
    expect(["split", "poster", "echo"]).toContain(sys.lines.find((x) => x.lineId === lines[wall].id)!.recipe);
    // the chorus releases: a meaning never puts a chorus line in a calm recipe
    for (const s of songs) {
      const p = s.plan;
      for (const hint of p.typeSystem?.lines ?? []) {
        const l = s.input.lyrics.lines.find((x) => x.id === hint.lineId)!;
        const sec = p.sections.find((x) => l.start != null && l.start >= x.start && l.start < x.end);
        if (sec?.kind === "chorus" && !hasDarkWord(l.text) && lineMeaning(l.text)) expect(RECIPES[hint.recipe].energy[1], `${s.key} ${l.text} ${hint.recipe}`).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it("the design prompt carries the digest: meaning → recipe, one motion language, restraint and release", () => {
    expect(typeCatalogBlock()).toContain("依字義選構圖");
    for (const m of Object.values(LINE_MEANINGS)) expect(typeCatalogBlock()).toContain(`${m.label}（${m.cue}）→ ${m.recipes.join("、")}`);
    expect(DESIGN_SYSTEM).toContain("一首歌一套動態語言");
    expect(DESIGN_SYSTEM).toContain("副歌前一兩小節先收一點");
    expect(DESIGN_SYSTEM).toContain("不用「X與Y」");
  });
});
