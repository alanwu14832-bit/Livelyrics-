// Asset scopes: a song's plan may show its own material (Project.assets, stored in the project's
// assets/ folder) and the band's shared library (Band.assets, attached to the project as
// `bandAssets` when it is read through the API). Pure; used by the stage, the export, the console
// media picker and the designer input.
//
// Ids are unique across both lists (the server checks new ids against both); if a hand-edited file
// ever repeats one, the project's own asset wins.

import type { Asset, Project } from "./types";

export const projectAssetUrl = (projectId: string, assetId: string) => `/api/projects/${projectId}/assets/${assetId}`;
export const bandAssetUrl = (bandId: string, assetId: string) => `/api/bands/${bandId}/assets/${assetId}`;

export function isBandAsset(asset: Pick<Asset, "scope"> | null | undefined): boolean {
  return asset?.scope === "band";
}

/** Mark a band library list with scope "band" (idempotent). */
export function asBandAssets(assets: readonly Asset[] | null | undefined): Asset[] {
  return (assets ?? []).map((a) => (a.scope === "band" ? a : { ...a, scope: "band" as const }));
}

/**
 * Every asset a project's plan may use: its own first, then the band's (scope "band"), without
 * duplicate ids.
 */
export function stageAssets(project: Pick<Project, "assets" | "bandAssets"> | null | undefined): Asset[] {
  if (!project) return [];
  const own = Array.isArray(project.assets) ? project.assets.filter((a) => a && typeof a.id === "string") : [];
  const seen = new Set(own.map((a) => a.id));
  const out: Asset[] = own.map((a) => (a.scope === "band" ? { ...a, scope: "project" as const } : a));
  for (const a of asBandAssets(Array.isArray(project.bandAssets) ? project.bandAssets : [])) {
    if (!a || typeof a.id !== "string" || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** The asset an id names in the project's merged view, or undefined. */
export function resolveAsset(project: Pick<Project, "assets" | "bandAssets"> | null | undefined, assetId: string | null | undefined): Asset | undefined {
  if (!assetId) return undefined;
  return stageAssets(project).find((a) => a.id === assetId);
}

/** The URL that serves an asset's file (project folder or band library). */
export function assetFileUrl(project: Pick<Project, "id" | "bandId">, asset: Pick<Asset, "id" | "scope">): string {
  if (asset.scope === "band" && project.bandId) return bandAssetUrl(project.bandId, asset.id);
  return projectAssetUrl(project.id, asset.id);
}
