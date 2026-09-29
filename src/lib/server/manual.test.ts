// 用 claude.ai 研究 through POST /api/projects/[id]/manual (local mode, a temp data dir): the prompt,
// a broken reply (422 with the fix prompt and the brief kept), a JSON-only fix that still saves the
// brief, the saved plan marked manual-claude with 復原, and pasted directions.

import { promises as fs } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directionsRoute } from "@/app/api/projects/[id]/directions/route";
import { POST as manualRoute } from "@/app/api/projects/[id]/manual/route";
import type { ManualApplyResult, ManualPromptResult } from "@/lib/api-client";
import type { Project, Research } from "@/lib/types";
import { offlineDesign } from "./designer/offline";
import { demoAnalysis, demoInput, demoLyrics } from "./designer/testing/fixtures";
import { publicInfoWith } from "./designer/testing/public-sources";
import { createProject, createUploadTempPath, getProject, updateProject } from "./storage";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  manualRoute(new Request(`http://localhost/api/projects/${id}/manual`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(id));
const directions = (id: string, body: unknown) =>
  directionsRoute(new Request(`http://localhost/api/projects/${id}/directions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(id));

const BRIEF = ["## 樂團視覺識別", "- [官方網站](https://example.com/band) 用深藍與琥珀色。", "## 歌曲意象與情緒", "- 夜色與遠方。", "## 現場表演觀察", "- 副歌大合唱。", "## 設計方向建議", "- 深藍夜色、琥珀燈光。", "## 參考來源", "- https://example.org/review"].join("\n");

let root: string;
const previous = { dir: process.env.LIVELYRICS_DATA_DIR, key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };

beforeAll(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  root = await fs.mkdtemp("/tmp/claude-0/ll-manual-");
  process.env.LIVELYRICS_DATA_DIR = root;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterAll(async () => {
  for (const [k, v] of [
    ["LIVELYRICS_DATA_DIR", previous.dir],
    ["ANTHROPIC_API_KEY", previous.key],
    ["ANTHROPIC_AUTH_TOKEN", previous.token],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(root, { recursive: true, force: true });
});

async function demoProject(): Promise<Project> {
  const tempPath = await createUploadTempPath();
  await fs.writeFile(tempPath, "RIFF....WAVEfmt ");
  const p = await createProject({
    meta: { title: "示範之歌", artist: "Livelyrics Band", duration: 73, fileName: "demo.wav", mimeType: "audio/wav" },
    analysis: demoAnalysis(),
    audio: { tempPath, ext: "wav" },
  });
  const research: Research = { brief: "# 免費研究", sources: [], engine: "free", createdAt: "2026-09-01T00:00:00.000Z", publicInfo: publicInfoWith({ genres: ["post-rock"] }) };
  return updateProject(p.id, (d) => {
    d.lyrics = demoLyrics();
    d.research = research;
    d.plan = offlineDesign({ ...demoInput(), publicInfo: research.publicInfo });
    d.planSource = { engine: "free", at: "2026-09-01T00:00:00.000Z" };
    d.status = "ready";
  });
}

function claudePlan(title: string): string {
  const plan = offlineDesign(demoInput());
  plan.keyVisual.title = title;
  plan.keyVisual.concept = "港口的夜燈一盞盞亮起。";
  return JSON.stringify(plan, null, 2);
}

describe("POST /api/projects/[id]/manual", () => {
  it("builds the prompt (full and 精簡版) with the stored free research findings", async () => {
    const p = await demoProject();
    const res = await post(p.id, { action: "prompt", target: "plan" });
    expect(res.status).toBe(200);
    const full = (await res.json()) as ManualPromptResult;
    expect(full.prompt).toContain("〈示範之歌〉");
    expect(full.prompt).toContain("後搖滾");
    expect(full.prompt).toContain("LED 安全模式：開");
    const compact = (await (await post(p.id, { action: "prompt", target: "plan", compact: true })).json()) as ManualPromptResult;
    expect(compact.compact).toBe(true);
    expect(compact.chars).toBeLessThan(full.chars);
    const dirs = (await (await post(p.id, { action: "prompt", target: "directions", instruction: "其中一個要很暗" })).json()) as ManualPromptResult;
    expect(dirs.prompt).toContain("「其中一個要很暗」");
    expect((await post(p.id, { action: "prompt", target: "movie" })).status).toBe(400);
    expect((await post(p.id, { action: "eval" })).status).toBe(400);
    expect((await post("p-does-not-exist", { action: "prompt" })).status).toBe(404);
    expect((await post("../etc", { action: "prompt" })).status).toBe(400);
  });

  it("a broken reply is 422 with the problems, the fix prompt and the brief; the JSON-only fix saves plan and brief", async () => {
    const p = await demoProject();
    const oldPlan = p.plan!;
    const broken = `${BRIEF}\n\n\`\`\`json\n${claudePlan("港口的夜燈").replace('"lines": [', '"lines": [ @@@ ')}\n\`\`\``;
    const bad = await post(p.id, { action: "apply", target: "plan", reply: broken });
    expect(bad.status).toBe(422);
    const failure = (await bad.json()) as ManualApplyResult;
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.error).toBe("JSON 格式有錯");
    expect(failure.issues[0].message).toMatch(/JSON 第 \d+ 行/);
    expect(failure.fixPrompt).toContain("```json");
    expect(failure.brief).toContain("## 設計方向建議");
    // nothing was saved
    expect((await getProject(p.id))!.plan).toEqual(oldPlan);

    // the corrected JSON from the same chat, without a brief: the kept brief comes along
    const fixed = await post(p.id, { action: "apply", target: "plan", reply: `好的，修正後：\n\`\`\`json\n${claudePlan("港口的夜燈")}\n\`\`\``, brief: failure.brief });
    expect(fixed.status).toBe(200);
    const ok = (await fixed.json()) as ManualApplyResult;
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.research).toBe(true);
    expect(ok.safety.length).toBeGreaterThan(0);
    const saved = (await getProject(p.id))!;
    expect(saved.plan!.keyVisual.title).toBe("港口的夜燈");
    expect(saved.planSource).toMatchObject({ engine: "manual-claude" });
    expect(saved.previousPlan).toMatchObject({ reason: "套用 claude.ai 的設計方案", source: { engine: "free" } });
    expect(saved.previousPlan!.plan).toEqual(oldPlan);
    expect(saved.research).toMatchObject({ engine: "manual-claude", sources: [{ title: "官方網站", url: "https://example.com/band" }, { url: "https://example.org/review" }] });
    // the public facts stay cached for the next free research
    expect(saved.research!.publicInfo?.musicbrainz?.artist?.genres[0].name).toBe("post-rock");
    expect(ok.project.plan!.keyVisual.title).toBe("港口的夜燈");

    // 復原 brings the free plan (and who made it) back
    const undo = await directions(p.id, { action: "undo" });
    expect(undo.status).toBe(200);
    const back = (await getProject(p.id))!;
    expect(back.plan).toEqual(oldPlan);
    expect(back.planSource).toMatchObject({ engine: "free" });
  });

  it("pasted directions become the project's direction set; adopting one marks the plan manual-claude", async () => {
    const p = await demoProject();
    const draft = (name: string, hexes: string[]) => ({
      name,
      pitch: `${name}的提案`,
      rationale: "引用研究。",
      references: [],
      moodKeywords: ["夜", "光", "海"],
      palette: hexes.map((hex, i) => ({ hex, role: ["背景", "主色", "點綴", "歌詞"][i], name: `色${i}` })),
      typography: { cjkFont: "noto-sans-tc", latinFont: "bebas-neue", weight: 800, letterSpacing: 0.04, rationale: "清楚" },
      motifs: ["燈", "海"],
      emblem: "wave",
      scenes: [{ kind: "chorus", scenes: ["particles"] }],
      sceneTendency: "柔和",
      lyrics: [{ kind: "chorus", style: "karaoke", placement: "center" }],
      lyricTreatment: "副歌 karaoke",
      treatments: [],
      energy: 0.6,
      motion: "soft",
    });
    const reply = `${BRIEF}\n\`\`\`json\n${JSON.stringify({ directions: [draft("港口夜色", ["#0a0f1a", "#2f6fd6", "#f2b233", "#f4f4f0"]), draft("霓虹拼貼", ["#12060c", "#e8452c", "#3ce0d0", "#fafafa"])] })}\n\`\`\``;
    const res = await post(p.id, { action: "apply", target: "directions", reply });
    expect(res.status).toBe(200);
    const saved = (await getProject(p.id))!;
    expect(saved.directions?.engine).toBe("manual-claude");
    expect(saved.directions?.directions.map((d) => d.name)).toEqual(["港口夜色", "霓虹拼貼"]);
    // the plan itself is untouched until a direction is adopted
    expect(saved.planSource).toMatchObject({ engine: "free" });
    const pick = saved.directions!.directions[1];
    expect((await directions(p.id, { action: "select", directionId: pick.id })).status).toBe(200);
    expect((await getProject(p.id))!.planSource).toMatchObject({ engine: "manual-claude" });
  });

  it("a stale 「processing」 (no live run in local mode) does not block applying, and the song becomes ready", async () => {
    const p = await demoProject();
    await updateProject(p.id, (d) => {
      d.status = "processing";
    });
    const res = await post(p.id, { action: "apply", target: "plan", reply: `\`\`\`json\n${claudePlan("港口")}\n\`\`\`` });
    expect(res.status).toBe(200);
    expect((await getProject(p.id))!.status).toBe("ready");
  });
});
