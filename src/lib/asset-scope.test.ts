import { describe, expect, it } from "vitest";
import { assetFileUrl, resolveAsset, stageAssets } from "./asset-scope";
import type { Asset } from "./types";

const asset = (id: string, over: Partial<Asset> = {}): Asset => ({ id, kind: "image", name: id, mimeType: "image/png", file: `${id}.png`, width: 1, height: 1, bytes: 1, createdAt: "", ...over });

describe("asset scopes", () => {
  it("merges project and band libraries, project first, without duplicates", () => {
    const merged = stageAssets({ assets: [asset("aaaaaaaaaaaa")], bandAssets: [asset("bbbbbbbbbbbb"), asset("aaaaaaaaaaaa", { name: "dup" })] });
    expect(merged.map((a) => [a.id, a.scope ?? "project", a.name])).toEqual([
      ["aaaaaaaaaaaa", "project", "aaaaaaaaaaaa"],
      ["bbbbbbbbbbbb", "band", "bbbbbbbbbbbb"],
    ]);
    expect(stageAssets(null)).toEqual([]);
    expect(stageAssets({ assets: [] })).toEqual([]);
  });

  it("resolves ids in both scopes and builds the right file URL", () => {
    const project = { id: "p1", bandId: "b1", assets: [asset("aaaaaaaaaaaa")], bandAssets: [asset("bbbbbbbbbbbb", { scope: "band" })] };
    const band = resolveAsset(project, "bbbbbbbbbbbb")!;
    expect(band.scope).toBe("band");
    expect(assetFileUrl(project, band)).toBe("/api/bands/b1/assets/bbbbbbbbbbbb");
    expect(assetFileUrl(project, resolveAsset(project, "aaaaaaaaaaaa")!)).toBe("/api/projects/p1/assets/aaaaaaaaaaaa");
    expect(resolveAsset(project, "cccccccccccc")).toBeUndefined();
    // a band asset of a project without a band falls back to the project route (and 404s there)
    expect(assetFileUrl({ id: "p1" }, band)).toBe("/api/projects/p1/assets/bbbbbbbbbbbb");
  });
});
