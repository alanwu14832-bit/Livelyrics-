// A Claude call with a time budget (cloud mode): when it runs out the free research / offline designer takes over,
// like any other Claude failure; a real cancellation still cancels.

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ClaudeTransport } from "./claude";
import { ClaudeTimeoutError, designSong, generateBible, researchSong, withDeadline } from "./index";
import { demoInput } from "./testing/fixtures";

/** A Claude that never answers, and fails like the SDK when its request is aborted. */
const silent: ClaudeTransport = {
  stream: (_params, _handlers, signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()), { once: true });
    }),
};

describe("designer time budget", () => {
  it("falls back to the free research and the offline design when Claude runs out of time", async () => {
    const logs: string[] = [];
    const noNetwork = async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    };
    const research = await researchSong(demoInput(), { onLog: (m) => logs.push(m) }, { configured: true, transport: silent, timeoutMs: 60, fetch: noNetwork });
    expect(research.engine).toBe("free");
    expect(logs.some((l) => /Claude 研究失敗：Claude 超過 1 秒還沒完成/.test(l))).toBe(true);

    const plan = await designSong({ ...demoInput(), research: null }, {}, { configured: true, transport: silent, timeoutMs: 60 });
    expect(plan.sections.length).toBeGreaterThan(0);

    const bible = await generateBible({ bandName: "港口", songs: [], assets: [] }, {}, { configured: true, transport: silent, timeoutMs: 60 });
    expect(bible.source?.engine).toBe("offline");
  });

  it("still cancels when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = researchSong(demoInput(), { signal: controller.signal }, { configured: true, transport: silent, timeoutMs: 60_000 });
    setTimeout(() => controller.abort(new Error("處理已取消")), 20);
    await expect(pending).rejects.toThrow("處理已取消");
  });

  it("withDeadline gives up at the deadline with ClaudeTimeoutError", async () => {
    await expect(withDeadline(silent, Date.now() + 30, 1).stream({} as never, {})).rejects.toBeInstanceOf(ClaudeTimeoutError);
    await expect(withDeadline(silent, Date.now() - 1, 1).stream({} as never, {})).rejects.toBeInstanceOf(ClaudeTimeoutError);
  });
});
