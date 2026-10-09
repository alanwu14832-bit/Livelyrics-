// Round 13 (M10): the 單格預覽 runs one render at a time and can be cancelled; a very large
// export asks first.

import { describe, expect, it } from "vitest";
import { EXPORT_SIZE_CONFIRM_BYTES, estimateBytes, exportNeedsSizeConfirm, targetBitrate } from "@/lib/export/settings";
import { PreviewRunner } from "./preview-runner";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PreviewRunner", () => {
  it("never starts a second render while one runs", async () => {
    const runner = new PreviewRunner();
    const d = deferred<string>();
    let calls = 0;
    const first = runner.run(() => {
      calls++;
      return d.promise;
    });
    expect(runner.busy).toBe(true);
    const second = await runner.run(async () => {
      calls++;
      return "again";
    });
    expect(second).toBeNull();
    expect(calls).toBe(1);
    d.resolve("frame");
    expect(await first).toEqual({ value: "frame" });
    expect(runner.busy).toBe(false);
    expect(await runner.run(async () => "next")).toEqual({ value: "next" });
  });

  it("取消 aborts the signal and resolves null, even when the render rejects", async () => {
    const runner = new PreviewRunner();
    let seen: AbortSignal | null = null;
    const p = runner.run(
      (signal) =>
        new Promise<string>((_, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    );
    runner.cancel();
    expect(seen!.aborted).toBe(true);
    expect(await p).toBeNull();
    expect(runner.busy).toBe(false);
  });

  it("other failures still reject (the page shows 預覽失敗)", async () => {
    const runner = new PreviewRunner();
    await expect(runner.run(async () => Promise.reject(new Error("WebGL lost")))).rejects.toThrow("WebGL lost");
    expect(runner.busy).toBe(false);
  });
});

describe("export size guard", () => {
  it("asks above 2 GB only", () => {
    expect(EXPORT_SIZE_CONFIRM_BYTES).toBe(2e9);
    expect(exportNeedsSizeConfirm(2e9)).toBe(false);
    expect(exportNeedsSizeConfirm(2e9 + 1)).toBe(true);
    expect(exportNeedsSizeConfirm(NaN)).toBe(false);
  });

  it("a 73 s song does not ask; a 60-minute set at high quality does", () => {
    const bitrate = targetBitrate(1920, 1080, 30, "high", "avc");
    const song = 3 * estimateBytes(bitrate, 73, false);
    const set = 3 * estimateBytes(bitrate, 3600, false);
    expect(exportNeedsSizeConfirm(song)).toBe(false);
    expect(exportNeedsSizeConfirm(set)).toBe(true);
  });
});
