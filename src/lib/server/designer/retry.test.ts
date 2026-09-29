// Transient Claude failures (503 / 529 / an overloaded stream) are retried, then a backup model is
// tried, before a step falls back to the free research or the offline designer.

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { researchSong } from "./index";
import { backupModelName, isTransient, withRetries } from "./retry";
import { fakeTransport, message, text } from "./testing/fake-claude";
import { demoInput } from "./testing/fixtures";

const unavailable = () => new Anthropic.InternalServerError(503, { type: "error" }, "unavailable", new Headers());
const overloadedStream = () =>
  new Anthropic.APIError(undefined, { type: "error", error: { type: "overloaded_error" } }, "Overloaded", undefined, "overloaded_error");
const badRequest = () => new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers());
const noWait = { delays: [0, 0], sleep: async () => {} };
const BRIEF = "## 樂團視覺識別\n" + "內容".repeat(60);

function params(model = "claude-sonnet-5-5") {
  return { model, max_tokens: 10, messages: [{ role: "user" as const, content: "hi" }] };
}

describe("isTransient", () => {
  it("retries server errors and overloaded streams, not request errors", () => {
    expect(isTransient(unavailable())).toBe(true);
    expect(isTransient(new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers()))).toBe(true);
    expect(isTransient(overloadedStream())).toBe(true);
    expect(isTransient(badRequest())).toBe(false);
    expect(isTransient(new Anthropic.RateLimitError(429, { type: "error" }, "slow", new Headers()))).toBe(false);
    expect(isTransient(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isTransient(new Error("boom"))).toBe(false);
  });
});

describe("backupModelName", () => {
  it("defaults to Opus 5.5 and can be changed or turned off", () => {
    expect(backupModelName({})).toBe("claude-opus-5-5");
    expect(backupModelName({ LIVELYRICS_BACKUP_MODEL: " claude-sonnet-5 " })).toBe("claude-sonnet-5");
    expect(backupModelName({ LIVELYRICS_BACKUP_MODEL: "off" })).toBeNull();
  });
});

describe("withRetries", () => {
  it("waits and retries the same model", async () => {
    const t = fakeTransport([unavailable(), overloadedStream(), message([text("ok")], "end_turn")]);
    const logs: string[] = [];
    const waits: number[] = [];
    const r = withRetries(t, { backupModel: "claude-opus-5-5", onLog: (m) => logs.push(m), sleep: async (ms) => void waits.push(ms) });
    const msg = await r.stream(params(), {});
    expect(msg.stop_reason).toBe("end_turn");
    expect(t.calls.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-sonnet-5-5", "claude-sonnet-5-5"]);
    expect(waits).toEqual([3000, 8000]);
    expect(logs[0]).toContain("Claude 暫時無法使用（503），3 秒後重試（第 1 次）");
    expect(logs[1]).toContain("過載");
  });

  it("switches to the backup model, and keeps it for the rest of the step", async () => {
    const t = fakeTransport([unavailable(), unavailable(), unavailable(), message([text("a")], "pause_turn"), message([text("b")], "end_turn")]);
    const logs: string[] = [];
    const r = withRetries(t, { ...noWait, backupModel: "claude-opus-5-5", onLog: (m) => logs.push(m) });
    await r.stream(params(), {});
    await r.stream({ ...params(), messages: [...params().messages, { role: "assistant", content: "a" }] }, {});
    expect(t.calls.map((c) => c.model)).toEqual([
      "claude-sonnet-5-5",
      "claude-sonnet-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-opus-5-5",
    ]);
    expect(logs.at(-1)).toContain("改用備用模型 claude-opus-5-5");
  });

  it("never switches models on a continuation, and gives up after the backup fails", async () => {
    const cont = { ...params(), messages: [...params().messages, { role: "assistant" as const, content: "a" }] };
    const t = fakeTransport([unavailable(), unavailable(), unavailable()]);
    await expect(withRetries(t, { ...noWait, backupModel: "claude-opus-5-5" }).stream(cont, {})).rejects.toBeInstanceOf(Anthropic.InternalServerError);
    expect(t.calls).toHaveLength(3);

    const t2 = fakeTransport([unavailable(), unavailable(), unavailable(), unavailable()]);
    await expect(withRetries(t2, { ...noWait, backupModel: "claude-opus-5-5" }).stream(params(), {})).rejects.toBeInstanceOf(Anthropic.InternalServerError);
    expect(t2.calls).toHaveLength(4);
  });

  it("does not retry request errors, or a response that already started streaming", async () => {
    const t = fakeTransport([badRequest()]);
    await expect(withRetries(t, { ...noWait, backupModel: "claude-opus-5-5" }).stream(params(), {})).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(t.calls).toHaveLength(1);

    let calls = 0;
    const midStream = {
      async stream(_p: unknown, handlers: { onText?: (d: string) => void }) {
        calls++;
        handlers.onText?.("部分");
        throw overloadedStream();
      },
    };
    await expect(withRetries(midStream, { ...noWait, backupModel: "claude-opus-5-5" }).stream(params(), {})).rejects.toBeInstanceOf(Anthropic.APIError);
    expect(calls).toBe(1);
  });

  it("stops waiting when the step is cancelled", async () => {
    const controller = new AbortController();
    const t = fakeTransport([unavailable(), message([text("ok")], "end_turn")]);
    const pending = withRetries(t, { backupModel: null, delays: [60_000] }).stream(params(), {}, controller.signal);
    setTimeout(() => controller.abort(new Error("處理已取消")), 10);
    await expect(pending).rejects.toThrow("處理已取消");
    expect(t.calls).toHaveLength(1);
  });
});

describe("researchSong retries", () => {
  it("still researches with Claude when the model is briefly unavailable", async () => {
    const t = fakeTransport([unavailable(), unavailable(), unavailable(), message([text(BRIEF)], "end_turn", { model: "claude-opus-5-5" })]);
    const logs: string[] = [];
    const research = await researchSong(demoInput(), { onLog: (m) => logs.push(m) }, {
      transport: t,
      configured: true,
      model: "claude-sonnet-5-5",
      retry: { ...noWait, backupModel: "claude-opus-5-5" },
    });
    expect(research.engine).toBe("claude");
    expect(research.model).toBe("claude-opus-5-5");
    expect(logs.join("\n")).toContain("改用備用模型");
    expect(logs.join("\n")).not.toContain("改用免費研究");
  });
});
