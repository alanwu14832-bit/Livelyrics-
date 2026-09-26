import { describe, expect, it } from "vitest";
import { errorResponse, handle, HttpError, parseRange, readJson, requireProjectId } from "./http";
import { MultipartError } from "./multipart";
import { StorageError } from "./storage";

describe("parseRange", () => {
  const size = 1000;
  it("returns full for no header, other units and multiple ranges", () => {
    expect(parseRange(null, size)).toEqual({ kind: "full" });
    expect(parseRange("items=0-5", size)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-1,5-6", size)).toEqual({ kind: "full" });
  });

  it("parses closed, open and suffix ranges", () => {
    expect(parseRange("bytes=0-1", size)).toEqual({ kind: "partial", start: 0, end: 1 });
    expect(parseRange("bytes=500-", size)).toEqual({ kind: "partial", start: 500, end: 999 });
    expect(parseRange("bytes=-100", size)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseRange("bytes=-5000", size)).toEqual({ kind: "partial", start: 0, end: 999 });
    expect(parseRange("bytes=990-5000", size)).toEqual({ kind: "partial", start: 990, end: 999 });
    expect(parseRange(" bytes = 10 - 20 ", size)).toEqual({ kind: "partial", start: 10, end: 20 });
    expect(parseRange("bytes=999-999", size)).toEqual({ kind: "partial", start: 999, end: 999 });
  });

  it("rejects unsatisfiable or malformed byte ranges", () => {
    for (const h of ["bytes=1000-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=abc", "bytes=", "bytes=1-2-3", "garbage", "bytes=99999999999999999999-"]) {
      expect(parseRange(h, size)).toEqual({ kind: "unsatisfiable" });
    }
    expect(parseRange("bytes=0-1", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("errors", () => {
  it("maps known errors to statuses", async () => {
    const cases: Array<[unknown, number]> = [
      [new HttpError(418, "x"), 418],
      [new MultipartError(413, "big"), 413],
      [new StorageError("invalid_id", "bad"), 400],
      [new StorageError("not_found", "gone"), 404],
      [new StorageError("corrupt", "bad file"), 500],
    ];
    for (const [err, status] of cases) {
      const res = errorResponse(err);
      expect(res.status).toBe(status);
      expect(await res.json()).toHaveProperty("error");
    }
  });

  it("handle() turns throws into JSON errors", async () => {
    const h = handle(async () => {
      throw new HttpError(404, "找不到專案");
    });
    const res = await h(new Request("http://x/"), {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "找不到專案" });
  });

  it("requireProjectId", () => {
    expect(requireProjectId("abc123")).toBe("abc123");
    expect(() => requireProjectId("../x")).toThrow(HttpError);
    expect(() => requireProjectId(undefined)).toThrow(HttpError);
  });
});

describe("readJson", () => {
  const req = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });
  it("parses, defaults and rejects", async () => {
    expect(await readJson(req('{"a":1}'), 100)).toEqual({ a: 1 });
    expect(await readJson(req(""), 100, {})).toEqual({});
    await expect(readJson(req(""), 100)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(req("{bad"), 100)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(req("x".repeat(200)), 100)).rejects.toMatchObject({ status: 413 });
  });
});
