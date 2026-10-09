// The worker's env.fetch: every huggingface.co request for our models is pinned, and a cached file
// never goes to the network (a run with the model downloaded works offline).

import { describe, expect, it } from "vitest";
import { pinnedFetch, pinnedUrl } from "./hub-fetch";
import { asrModel } from "./models";

const small = asrModel("accurate", "wasm");
const base = asrModel("fast", "wasm");
const PINS = { [small.id]: small.revision, [base.id]: base.revision };
const at = (rev: string, file: string, id = small.id) => `https://huggingface.co/${id}/resolve/${rev}/${file}`;

describe("pinnedUrl", () => {
  it("pins main to the model's revision and keeps the pinned URL", () => {
    expect(pinnedUrl(at("main", "tokenizer_config.json"), PINS)).toBe(at(small.revision, "tokenizer_config.json"));
    expect(pinnedUrl(at("main", "onnx/encoder_model_quantized.onnx", base.id), PINS)).toBe(at(base.revision, "onnx/encoder_model_quantized.onnx", base.id));
    expect(pinnedUrl(at(small.revision, "config.json"), PINS)).toBe(at(small.revision, "config.json"));
  });
  it("leaves everything else alone", () => {
    expect(pinnedUrl(at("main", "config.json", "someone/other-model"), PINS)).toBeNull();
    expect(pinnedUrl(at("deadbeef", "config.json"), PINS)).toBeNull();
    expect(pinnedUrl("http://localhost:3320/ort/1.0/ort-wasm-simd-threaded.asyncify.wasm", PINS)).toBeNull();
    expect(pinnedUrl("https://us.aws.cdn.hf.co/xet-bridge-us/abc", PINS)).toBeNull();
  });
});

describe("pinnedFetch", () => {
  function setup(cachedUrls: string[]) {
    const calls: string[] = [];
    const base = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("net", { status: 200 });
    }) as typeof fetch;
    const store = new Map(cachedUrls.map((u) => [u, "cached"]));
    const cache = { match: async (u: string) => (store.has(u) ? new Response(store.get(u), { headers: { "content-length": "6" } }) : undefined) };
    return { calls, f: pinnedFetch(PINS, base, async () => cache) };
  }

  it("a probe at main for a cached file is answered from the cache (no network)", async () => {
    const { calls, f } = setup([at(small.revision, "tokenizer_config.json")]);
    const r = await f(at("main", "tokenizer_config.json"), { method: "GET", headers: { Range: "bytes=0-0" }, cache: "no-store" });
    expect(await r.text()).toBe("cached");
    expect(r.headers.get("content-length")).toBe("6");
    expect(calls).toEqual([]);
  });

  it("an uncached file goes to the network at the pinned revision", async () => {
    const { calls, f } = setup([]);
    await f(at("main", "preprocessor_config.json"));
    await f(new URL(at("main", "onnx/decoder_model_merged_quantized.onnx")));
    expect(calls).toEqual([at(small.revision, "preprocessor_config.json"), at(small.revision, "onnx/decoder_model_merged_quantized.onnx")]);
  });

  it("other requests pass through untouched", async () => {
    const { calls, f } = setup([]);
    await f("http://localhost:3320/ort/x.wasm");
    await f(at("main", "config.json", "someone/other-model"));
    await f(at("main", "config.json"), { method: "HEAD" });
    expect(calls).toEqual(["http://localhost:3320/ort/x.wasm", at("main", "config.json", "someone/other-model"), at("main", "config.json")]);
  });

  it("a cache that cannot be opened only costs the shortcut", async () => {
    const calls: string[] = [];
    const f = pinnedFetch(
      PINS,
      (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response("net");
      }) as typeof fetch,
      async () => {
        throw new Error("no caches");
      },
    );
    expect(await (await f(at("main", "config.json"))).text()).toBe("net");
    expect(calls).toEqual([at(small.revision, "config.json")]);
  });
});
