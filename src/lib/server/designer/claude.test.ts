import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DesignPlanSchema, type DesignPlan } from "@/lib/schema";
import {
  clientOptions,
  createPlanProgress,
  designParams,
  FALLBACK_BETA,
  isUsablePlan,
  parsePlanJson,
  researchParams,
  runWithContinuations,
  sdkTransport,
  tidyBrief,
} from "./claude";
import { designSong, researchSong } from "./index";
import { offlineDesign } from "./offline";
import { cite, fakeTransport, fallbackBlock, message, refusalDetails, search, searchResult, sseBody, text, thinking } from "./testing/fake-claude";
import { demoInput } from "./testing/fixtures";

const input = demoInput();
const BRIEF =
  "## 樂團視覺識別\n- 招牌色是深藍與燈火橘。\n\n## 歌曲意象與情緒\n- 夜晚的城市、燈火。\n\n## 現場表演觀察\n- 副歌大合唱。\n\n## 設計方向建議\n- 以燈火為母題。\n\n## 參考來源\n- [Live](https://band.example/live)";

function recorder() {
  const logs: string[] = [];
  const deltas: string[] = [];
  const searches: string[] = [];
  return {
    logs,
    deltas,
    searches,
    cb: { onLog: (m: string) => logs.push(m), onDelta: (t: string) => deltas.push(t), onSearch: (q: string) => searches.push(q) },
  };
}

function userText(m: BetaMessageParam): string {
  return typeof m.content === "string" ? m.content : "";
}

describe("runWithContinuations", () => {
  it("resumes pause_turn by re-sending [user, assistant(content so far)] without a continue message", async () => {
    const t = fakeTransport([
      message([thinking("plan"), search("s1", "q1")], "pause_turn"),
      message([searchResult("s1", [["https://a.example", "A"]]), search("s2", "q2")], "pause_turn"),
      message([text("done")], "end_turn"),
    ]);
    const params = researchParams(input, "claude-opus-5");
    const r = await runWithContinuations(t, params, {});
    expect(t.calls).toHaveLength(3);
    expect(r.continuations).toBe(2);
    expect(r.stopReason).toBe("end_turn");
    expect(r.content.map((b) => b.type)).toEqual(["thinking", "server_tool_use", "web_search_tool_result", "server_tool_use", "text"]);
    expect(t.calls[0].messages).toHaveLength(1);
    const second = t.calls[1].messages;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(userText(second[0])).toBe(userText(t.calls[0].messages[0]));
    const third = t.calls[2].messages;
    expect(third.map((m) => m.role)).toEqual(["user", "assistant"]);
    const assistant = third[1].content;
    expect(Array.isArray(assistant) && assistant.map((b) => b.type)).toEqual(["thinking", "server_tool_use", "web_search_tool_result", "server_tool_use"]);
    // everything else in the request is unchanged
    expect({ ...t.calls[2], messages: [] }).toEqual({ ...t.calls[0], messages: [] });
  });

  it("stops after 5 continuations", async () => {
    const t = fakeTransport(Array.from({ length: 10 }, (_, i) => message([search(`s${i}`, `q${i}`)], "pause_turn")));
    const r = await runWithContinuations(t, researchParams(input, "m"), {});
    expect(t.calls).toHaveLength(6);
    expect(r.stopReason).toBe("pause_turn");
  });
});

describe("request parameters", () => {
  it("research uses web search, adaptive summarized thinking and default server-side fallbacks", () => {
    const p = researchParams(input, "claude-opus-5");
    expect(p.model).toBe("claude-opus-5");
    expect(p.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 8 }]);
    expect(p.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(p.betas).toEqual([FALLBACK_BETA]);
    expect(p.fallbacks).toBe("default");
    const prompt = userText(p.messages[0]);
    expect(prompt).toContain("示範之歌");
    expect(prompt).toContain("120 BPM");
    // only short lyric clips, never full lines
    expect(prompt).not.toContain("夜色慢慢落在城市的邊緣");
  });

  it("design uses structured outputs with high effort", () => {
    const p = designParams({ ...input, research: null }, "claude-opus-5");
    expect(p.output_config?.effort).toBe("high");
    expect(p.output_config?.format?.type).toBe("json_schema");
    expect(p.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(p.fallbacks).toBe("default");
    expect(p.tools).toBeUndefined();
    const prompt = userText(p.messages[0]);
    expect(prompt).toContain("duration：73.000");
    for (let i = 0; i < 14; i++) expect(prompt).toContain(`l${i} [`);
    expect(prompt).toContain("l4 = l9");
  });

  it("re-design includes the previous plan and the instruction", () => {
    const previous = offlineDesign(input);
    const p = designParams({ ...input, research: null, previous, instruction: "副歌更熱血一點" }, "m");
    const prompt = userText(p.messages[0]);
    expect(prompt).toContain("副歌更熱血一點");
    expect(prompt).toContain("只修改指示要求的部分");
    expect(prompt).toContain(previous.keyVisual.title);
  });
});

describe("researchSong with Claude", () => {
  it("streams the brief, reports searches and collects sources", async () => {
    const t = fakeTransport([
      message([thinking("…"), search("s1", "Livelyrics Band 演唱會"), searchResult("s1", [["https://band.example/live/", "Live"]])], "pause_turn"),
      message([text("好的，以下是簡報。\n\n"), text(BRIEF, [cite("https://band.example/live", "現場報導")])], "end_turn", { model: "claude-opus-5" }),
    ]);
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: t, configured: true, model: "claude-opus-5", now: () => new Date("2026-09-26T00:00:00Z") });
    expect(research.engine).toBe("claude");
    expect(research.model).toBe("claude-opus-5");
    expect(research.createdAt).toBe("2026-09-26T00:00:00.000Z");
    expect(research.brief.startsWith("## 樂團視覺識別")).toBe(true);
    expect(research.sources).toEqual([{ title: "現場報導", url: "https://band.example/live" }]);
    expect(r.searches).toEqual(["Livelyrics Band 演唱會"]);
    expect(r.deltas.join("")).toContain("招牌色");
    expect(r.logs.some((l) => l.includes("接續"))).toBe(true);
  });

  it("appends a source list when the brief has none", async () => {
    const t = fakeTransport([message([searchResult("s1", [["https://a.example", "A"]]), text("## 樂團視覺識別\n" + "內容".repeat(60))], "end_turn")]);
    const research = await researchSong(input, {}, { transport: t, configured: true });
    expect(research.brief).toContain("## 參考來源\n- [A](https://a.example)");
  });

  it("keeps a truncated brief with a note on max_tokens", async () => {
    const t = fakeTransport([message([text(BRIEF.slice(0, 120))], "max_tokens")]);
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: t, configured: true });
    expect(research.engine).toBe("claude");
    expect(research.brief).toContain("簡報未完成");
  });

  it("falls back to offline research on refusal, discarding the partial output", async () => {
    const t = fakeTransport([message([text("部分內容")], "refusal", { stop_details: refusalDetails("cyber") })]);
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: t, configured: true });
    expect(research.engine).toBe("offline");
    expect(research.brief).not.toContain("部分內容");
    expect(r.logs.join("\n")).toContain("婉拒");
    expect(r.deltas.join("")).toContain("---");
  });

  it("falls back on API errors and never throws", async () => {
    const t = fakeTransport([new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers())]);
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: t, configured: true });
    expect(research.engine).toBe("offline");
    expect(research.brief).toContain("429");
    expect(r.logs.join("\n")).toContain("改用離線研究");
  });

  it("reports server-side fallbacks", async () => {
    const t = fakeTransport([message([fallbackBlock("claude-opus-5", "claude-opus-4-8"), text(BRIEF)], "end_turn", { model: "claude-opus-4-8" })]);
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: t, configured: true });
    expect(research.model).toBe("claude-opus-4-8");
    expect(r.logs.join("\n")).toContain("claude-opus-4-8 接手");
  });

  it("uses the offline designer without a credential", async () => {
    const r = recorder();
    const research = await researchSong(input, r.cb, { configured: false });
    expect(research.engine).toBe("offline");
    expect(r.logs[0]).toContain("ANTHROPIC_API_KEY");
    expect(r.deltas.join("")).toContain("## 樂團視覺識別");
  });

  it("propagates cancellation", async () => {
    const ac = new AbortController();
    ac.abort(new Error("處理已取消"));
    await expect(researchSong(input, { signal: ac.signal }, { configured: true, transport: fakeTransport([]) })).rejects.toThrow("處理已取消");
    const ac2 = new AbortController();
    const t = fakeTransport([new Anthropic.APIUserAbortError()]);
    ac2.abort();
    await expect(researchSong(input, { signal: ac2.signal }, { configured: false, transport: t })).rejects.toBeTruthy();
  });

  it("survives throwing callbacks", async () => {
    const t = fakeTransport([message([text(BRIEF)], "end_turn")]);
    const boom = () => {
      throw new Error("ui");
    };
    const research = await researchSong(input, { onLog: boom, onDelta: boom, onSearch: boom }, { transport: t, configured: true });
    expect(research.engine).toBe("claude");
  });
});

function claudePlan(): DesignPlan {
  const p = offlineDesign(input);
  return { ...p, keyVisual: { ...p.keyVisual, title: "燈火之城" }, designerNotes: "Claude 的設計說明" };
}

describe("designSong with Claude", () => {
  it("parses, validates and normalizes structured output, streaming progress notes", async () => {
    const json = JSON.stringify(claudePlan());
    const t = fakeTransport([message([thinking("…"), text(json)], "end_turn")]);
    const r = recorder();
    const plan = await designSong({ ...input, research: null }, r.cb, { transport: t, configured: true });
    expect(plan.keyVisual.title).toBe("燈火之城");
    expect(plan.designerNotes).toBe("Claude 的設計說明");
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
    const progress = r.deltas.join("");
    expect(progress).toContain("主視覺「燈火之城」");
    expect(progress).toContain("副歌一");
    expect(r.logs.join("\n")).toContain("設計完成");
  });

  it("repairs a slightly invalid plan instead of discarding it", async () => {
    const raw = claudePlan() as unknown as { sections: Array<Record<string, unknown>> };
    raw.sections[1].scene = "lasers";
    raw.sections[2].end = 999;
    const t = fakeTransport([message([text(JSON.stringify(raw))], "end_turn")]);
    const r = recorder();
    const plan = await designSong({ ...input, research: null }, r.cb, { transport: t, configured: true });
    expect(plan.keyVisual.title).toBe("燈火之城");
    expect(plan.sections[plan.sections.length - 1].end).toBe(73);
    expect(r.logs.join("\n")).toContain("已自動修正");
  });

  it("falls back to the offline designer on invalid JSON, refusal or truncation", async () => {
    for (const msg of [
      message([text("{ not json")], "end_turn"),
      message([text('{"keyVisual": 1}')], "end_turn"),
      message([], "refusal", { stop_details: refusalDetails(null) }),
      message([text('{"version":1,"keyVisual":{')], "max_tokens"),
    ]) {
      const r = recorder();
      const plan = await designSong({ ...input, research: null }, r.cb, { transport: fakeTransport([msg]), configured: true });
      expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
      expect(plan.designerNotes).toContain("離線設計師");
      expect(r.logs.join("\n")).toContain("改用離線設計師");
    }
  });

  it("keeps the previous plan when Claude fails during a re-design, applying what it can", async () => {
    const previous = claudePlan();
    const t = fakeTransport([new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers())]);
    const r = recorder();
    const plan = await designSong({ ...input, research: null, previous, instruction: "副歌更熱血一點" }, r.cb, { transport: t, configured: true });
    expect(plan.keyVisual.title).toBe("燈火之城");
    expect(r.logs.join("\n")).toContain("依指示調整");
    const t2 = fakeTransport([new Error("boom")]);
    const kept = await designSong({ ...input, research: null, previous }, {}, { transport: t2, configured: true });
    expect(kept.keyVisual.title).toBe("燈火之城");
  });

  it("designs offline without a credential", async () => {
    const r = recorder();
    const plan = await designSong({ ...input, research: null }, r.cb, { configured: false });
    expect(DesignPlanSchema.safeParse(plan).success).toBe(true);
    expect(r.logs.join("\n")).toContain("離線設計完成");
    expect(r.deltas.join("")).toContain("主視覺「");
  });
});

describe("helpers", () => {
  it("tidies a chatty preamble", () => {
    expect(tidyBrief("好的！\n\n## A\n內容\n\n\n\n## B")).toBe("## A\n內容\n\n## B");
    const narration = `${"我先搜尋樂團的資料。".repeat(80)}\n\n## 樂團視覺識別\n- 內容`;
    expect(tidyBrief(narration)).toBe("## 樂團視覺識別\n- 內容");
  });

  it("parses plan JSON defensively", () => {
    expect(parsePlanJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parsePlanJson("nope")).toBeNull();
    expect(isUsablePlan({ keyVisual: {}, sections: [{ start: 0, end: 1 }] })).toBe(true);
    expect(isUsablePlan({ keyVisual: {}, sections: [] })).toBe(false);
  });

  it("emits progress from arbitrarily chunked JSON", () => {
    const json = JSON.stringify(claudePlan());
    const out: string[] = [];
    const p = createPlanProgress((m) => out.push(m));
    for (let i = 0; i < json.length; i += 7) p.push(json.slice(i, i + 7));
    const md = out.join("");
    expect(md.match(/^- /gm)).toHaveLength(6);
    expect(md).toContain("### 主視覺「燈火之城」");
    expect(md).toContain("0:24 副歌一");
  });
});

describe("real SDK transport (fake fetch)", () => {
  it("sends the beta fallback header and streams through the SDK parser, resuming pause_turn", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const responses = [
      message([thinking("plan"), search("srvtoolu_1", "Livelyrics Band 舞台")], "pause_turn"),
      message([searchResult("srvtoolu_1", [["https://band.example/live", "Live"]]), text(BRIEF, [cite("https://band.example/live", "Live")])], "end_turn"),
    ];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      requests.push({ url: String(url), headers: new Headers(init?.headers), body });
      const msg = responses[requests.length - 1];
      return new Response(sseBody(msg), { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
    };
    const client = new Anthropic({ apiKey: "test-key", baseURL: "http://claude.test", fetch: fakeFetch, maxRetries: 0 });
    const r = recorder();
    const research = await researchSong(input, r.cb, { transport: sdkTransport(client), configured: true, model: "claude-opus-5" });

    expect(requests).toHaveLength(2);
    const [first, second] = requests;
    expect(first.url).toContain("/v1/messages");
    expect(first.headers.get("anthropic-beta")).toContain(FALLBACK_BETA);
    expect(first.headers.get("x-api-key")).toBe("test-key");
    expect(first.body).toMatchObject({
      model: "claude-opus-5",
      stream: true,
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    });
    expect(first.body.betas).toBeUndefined();
    const msgs = second.body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toEqual([
      { type: "thinking", thinking: "plan", signature: "sig" },
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Livelyrics Band 舞台" } },
    ]);

    expect(r.searches).toEqual(["Livelyrics Band 舞台"]);
    expect(research.engine).toBe("claude");
    expect(research.brief).toContain("## 設計方向建議");
    expect(research.sources).toEqual([{ title: "Live", url: "https://band.example/live" }]);
  });

  it("names the workspace on every request only when ANTHROPIC_WORKSPACE_ID is set", async () => {
    expect(clientOptions({})).toEqual({});
    expect(clientOptions({ ANTHROPIC_WORKSPACE_ID: "  " })).toEqual({});
    const sent: Array<string | null> = [];
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      sent.push(new Headers(init?.headers).get("anthropic-workspace-id"));
      return new Response(sseBody(message([text("ok")], "end_turn")), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const params = { model: "claude-opus-5", max_tokens: 16, messages: [{ role: "user" as const, content: "hi" }] };
    for (const env of [{ ANTHROPIC_WORKSPACE_ID: " wrkspc_01test " }, {}]) {
      const client = new Anthropic({ ...clientOptions(env), apiKey: "test-key", baseURL: "http://claude.test", fetch: fakeFetch, maxRetries: 0 });
      await sdkTransport(client).stream(params, {});
    }
    expect(sent).toEqual(["wrkspc_01test", null]);
  });
});
