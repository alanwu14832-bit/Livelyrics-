// 研究找到的素材 (phase 8): storage of the images the research collected. Files sit next to the
// project's assets and mood board (<project>/assets/<id>.<ext>; cloud: a public blob under
// projects/<id>/), ids unique across assets, mood board and this list (and the band's), so the
// project's asset route can serve an item that is on stage exactly like an uploaded asset.
//
// A refresh (re-running research) merges by content hash and image URL: what is there keeps its
// id, file and the operator's choice, new items are appended, removed items stay out (their hash
// and URL are remembered in `collectedDismissed`). Removing an item removes both uses: the file,
// the entry, and every plan section that showed it.

import { applyAuthorization, AUTHORIZATION_NOTE, dismissKeys, MAX_COLLECTED, MAX_DISMISSED, mergeCollection } from "@/lib/visuals";
import type { CollectedVisual, MaterialAuthorization, MoodStats, Project } from "@/lib/types";
import { getBand, takenAssetIds, updateBand } from "./band-storage";
import { assetFileOf, assetPath, getProject, newAssetId, updateProject } from "./storage";
import { files, type StoredFile } from "./store";
import { StorageError } from "./store/errors";

/** One downloaded image before it is stored (no id or file yet). */
export interface IncomingVisual {
  item: Omit<CollectedVisual, "id" | "file" | "blob">;
  bytes: Uint8Array;
  ext: string;
}

export function collectedFileOf(projectId: string, item: CollectedVisual): StoredFile {
  return assetFileOf(projectId, item);
}

/** Clear every plan section that shows `assetId` (the item is gone or no longer on stage). */
function clearMedia(p: Project, assetId: string): void {
  if (!p.plan?.sections.some((s) => s.media?.assetId === assetId)) return;
  p.plan = { ...p.plan, sections: p.plan.sections.map((s) => (s.media?.assetId === assetId ? { ...s, media: null } : s)) };
}

/**
 * Store downloaded images and merge them into the project's collection. Duplicates (same hash or
 * image URL as a stored or removed item) are not written. Returns the saved project and what was
 * added.
 */
export async function storeCollected(projectId: string, incoming: readonly IncomingVisual[]): Promise<{ project: Project; added: CollectedVisual[] }> {
  const project = await getProject(projectId);
  if (!project) throw new StorageError("not_found", "找不到專案");
  const current = project.collected ?? [];
  const dismissed = new Set(project.collectedDismissed ?? []);
  const known = (x: IncomingVisual["item"]) =>
    dismissed.has(x.hash) || dismissed.has(x.provenance.imageUrl) || current.some((c) => c.hash === x.hash || c.provenance.imageUrl === x.provenance.imageUrl);
  const fresh = incoming.filter((x) => !known(x.item)).slice(0, Math.max(0, MAX_COLLECTED - current.length));
  const refresh = incoming.filter((x) => known(x.item));

  const taken = await takenAssetIds(project.bandId);
  for (const a of [...project.assets, ...(project.moodboard ?? []), ...current]) taken.add(a.id);
  const written: CollectedVisual[] = [];
  for (const x of fresh) {
    let id = newAssetId();
    while (taken.has(id)) id = newAssetId();
    taken.add(id);
    const file = `${id}.${x.ext}`;
    try {
      const stored = await files().write({ diskPath: assetPath(projectId, { id, file }), blobPathname: `projects/${projectId}/collected.${x.ext}` }, x.bytes, x.item.mimeType);
      const item: CollectedVisual = { ...x.item, id, file } as CollectedVisual;
      if (stored.kind === "blob") item.blob = stored.blob;
      written.push(item);
    } catch (err) {
      console.error("[livelyrics] storing a collected image failed:", err instanceof Error ? err.message : err);
    }
  }
  // provenance / palette of known items may improve on a refresh (no file is written for them)
  const refreshItems = refresh.map((x) => ({ ...x.item, id: "", file: "" }) as CollectedVisual);
  let added: CollectedVisual[] = [];
  let orphans: CollectedVisual[] = [];
  const saved = await updateProject(projectId, (p) => {
    const merged = mergeCollection(p.collected ?? [], [...written, ...refreshItems], p.collectedDismissed ?? []);
    // a refresh-only entry (no file of its own) never becomes an item
    p.collected = merged.list.filter((c) => c.id);
    added = merged.added.filter((c) => c.id);
    orphans = merged.duplicates.filter((d) => d.file);
  });
  // a concurrent write may have added the same image first: drop the extra file
  if (orphans.length) await files().remove(orphans.map((o) => collectedFileOf(projectId, o))).catch(() => {});
  return { project: saved, added };
}

/** 可以上台 / 只當參考 (the operator's choice; 只當參考 also clears the sections that showed it). */
export async function setCollectedUse(projectId: string, itemId: string, use: "stage" | "reference"): Promise<Project | null> {
  let found = false;
  const saved = await updateProject(projectId, (p) => {
    const item = p.collected?.find((c) => c.id === itemId);
    if (!item) return;
    found = true;
    item.use = use;
    item.useSetBy = "user";
    if (use === "reference") clearMedia(p, itemId);
  });
  return found ? saved : null;
}

/** Colours measured in the browser (images the server cannot decode, e.g. WebP). */
export async function setCollectedStats(projectId: string, itemId: string, stats: MoodStats): Promise<Project | null> {
  let found = false;
  const saved = await updateProject(projectId, (p) => {
    const item = p.collected?.find((c) => c.id === itemId);
    if (!item) return;
    found = true;
    item.stats = stats;
  });
  return found ? saved : null;
}

/** 移除: the file, the entry, the sections that showed it; a refresh does not bring it back. */
export async function removeCollected(projectId: string, itemId: string): Promise<Project | null> {
  let removed: CollectedVisual | null = null;
  const saved = await updateProject(projectId, (p) => {
    const item = p.collected?.find((c) => c.id === itemId);
    if (!item) return;
    removed = item;
    p.collected = (p.collected ?? []).filter((c) => c.id !== itemId);
    p.collectedDismissed = [...(p.collectedDismissed ?? []), ...dismissKeys(item)].filter((k, i, a) => a.indexOf(k) === i).slice(-MAX_DISMISSED);
    clearMedia(p, itemId);
  });
  const item = removed as CollectedVisual | null;
  if (!item) return null;
  await files().remove([collectedFileOf(projectId, item)]).catch(() => {});
  return saved;
}

/** The authorization that applies to a project: its band's, else its own. */
export async function authorizationFor(project: Pick<Project, "bandId" | "materialAuthorization">): Promise<MaterialAuthorization | null> {
  if (project.bandId) {
    const band = await getBand(project.bandId).catch(() => null);
    if (band) return band.materialAuthorization ?? null;
  }
  return project.materialAuthorization ?? null;
}

/**
 * The one-time acknowledgement: stored on the band (every song of it) or on a band-less song. Items
 * still on their automatic default (只當參考 because nobody had confirmed yet) go on stage.
 */
export async function acknowledgeAuthorization(projectId: string, note?: string): Promise<{ project: Project; authorization: MaterialAuthorization }> {
  const project = await getProject(projectId);
  if (!project) throw new StorageError("not_found", "找不到專案");
  const authorization: MaterialAuthorization = { at: new Date().toISOString(), note: note?.trim().slice(0, 300) || AUTHORIZATION_NOTE };
  const band = project.bandId ? await getBand(project.bandId).catch(() => null) : null;
  if (band) {
    await updateBand(band.id, (b) => {
      b.materialAuthorization = b.materialAuthorization ?? authorization;
    });
  }
  const saved = await updateProject(projectId, (p) => {
    if (!band) p.materialAuthorization = p.materialAuthorization ?? authorization;
    if (p.collected?.length) p.collected = applyAuthorization(p.collected);
  });
  return { project: saved, authorization: (band ? authorization : saved.materialAuthorization) ?? authorization };
}
