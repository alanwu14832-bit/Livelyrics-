// Mood board (參考圖, phase 4) HTTP handlers for a song (/api/projects/[id]/moodboard) and a band
// (/api/bands/[id]/moodboard). Uploads reuse the media-library handlers (magic-byte sniffing,
// browser-measured size; cloud: Blob registration under the owner's prefix) with the image-only
// rules; the colour stats the browser measured are sanitized and stored with the image.

import { isAssetId, sanitizeAssetName, sanitizeNote } from "@/lib/assets";
import { MAX_MOOD_BYTES, MAX_MOODBOARD_IMAGES, sanitizeMoodStats } from "@/lib/moodboard";
import type { Asset, Band, MoodImage, Project } from "@/lib/types";
import { isJsonRequest, receiveAssetRegistration, receiveAssetUpload, serveAsset, type ImageOnlyOptions } from "./asset-routes";
import { addBandMoodImage, bandAssetFileOf, getBand, removeBandMoodImage, takenAssetIds, updateBand } from "./band-storage";
import { HttpError, json, readJson } from "./http";
import { addMoodImage, assetFileOf, getProject, removeMoodImage, updateProject } from "./storage";
import { isCloudStorage } from "./store";

export type MoodOwner = { kind: "project"; id: string } | { kind: "band"; id: string };

const LABEL = "參考圖";

const IMAGES: ImageOnlyOptions = {
  maxBytes: MAX_MOOD_BYTES,
  extend: (asset, meta) => {
    const img: MoodImage = { ...asset, kind: "image" };
    const stats = sanitizeMoodStats(meta.stats);
    if (stats) img.stats = stats;
    return img;
  },
};

async function load(owner: MoodOwner): Promise<{ list: MoodImage[]; project?: Project; band?: Band }> {
  if (owner.kind === "project") {
    const project = await getProject(owner.id);
    if (!project) throw new HttpError(404, "找不到專案");
    return { list: project.moodboard ?? [], project };
  }
  const band = await getBand(owner.id);
  if (!band) throw new HttpError(404, "找不到樂團");
  return { list: band.moodboard ?? [], band };
}

export async function listMoodboard(owner: MoodOwner): Promise<Response> {
  const { list } = await load(owner);
  return json({ images: list });
}

/** Local: multipart `file` + `meta` { width, height, name?, note?, stats? }. Cloud: JSON registration after the Blob upload. -> 201 { image, images } */
export async function uploadMoodImage(req: Request, owner: MoodOwner): Promise<Response> {
  const { list, project, band } = await load(owner);
  // ids share the assets folder with the media library (and the band's with its songs')
  const taken = await takenAssetIds(owner.kind === "band" ? owner.id : project?.bandId);
  for (const a of [...(project?.assets ?? []), ...(project?.moodboard ?? []), ...(band?.assets ?? []), ...(band?.moodboard ?? [])]) taken.add(a.id);
  const toImages = (saved: Project | Band): Asset[] => saved.moodboard ?? [];
  const store = async (asset: Asset, tempPath: string | null): Promise<Asset[]> =>
    owner.kind === "project"
      ? toImages(await addMoodImage(owner.id, asset as MoodImage, tempPath, MAX_MOODBOARD_IMAGES))
      : toImages(await addBandMoodImage(owner.id, asset as MoodImage, tempPath, MAX_MOODBOARD_IMAGES));
  let res: Response;
  if (isCloudStorage()) {
    if (!isJsonRequest(req)) throw new HttpError(400, "雲端模式請先把檔案上傳到 Vercel Blob，再登記到這裡。");
    res = await receiveAssetRegistration(req, {
      prefix: owner.kind === "project" ? `projects/${owner.id}/` : `bands/${owner.id}/`,
      count: list.length,
      max: MAX_MOODBOARD_IMAGES,
      taken,
      label: LABEL,
      images: IMAGES,
      store: (asset) => store(asset, null),
    });
  } else {
    res = await receiveAssetUpload(req, { count: list.length, max: MAX_MOODBOARD_IMAGES, taken, label: LABEL, images: IMAGES, store });
  }
  // same body shape under the mood board's names
  const body = (await res.json()) as { asset?: Asset; assets?: Asset[]; error?: string };
  if (!res.ok) return json(body, { status: res.status });
  return json({ image: body.asset, images: body.assets }, { status: res.status });
}

function requireImageId(v: string): string {
  if (!isAssetId(v)) throw new HttpError(400, "無效的參考圖 ID");
  return v;
}

export async function serveMoodImage(req: Request, owner: MoodOwner, imageId: string, withBody: boolean): Promise<Response> {
  const { list } = await load(owner);
  const image = list.find((m) => m.id === requireImageId(imageId));
  if (!image) throw new HttpError(404, "找不到參考圖");
  const file = owner.kind === "project" ? assetFileOf(owner.id, image) : bandAssetFileOf(owner.id, image);
  return serveAsset(req, file, image, withBody);
}

/** { note?: string | null, name?: string } -> { image, images } */
export async function patchMoodImage(req: Request, owner: MoodOwner, imageId: string): Promise<Response> {
  requireImageId(imageId);
  const body = await readJson(req, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { note?, name? }");
  const patch = body as { note?: unknown; name?: unknown };
  if (patch.note !== undefined && patch.note !== null && typeof patch.note !== "string") throw new HttpError(400, "note 必須是文字");
  if (patch.name !== undefined && typeof patch.name !== "string") throw new HttpError(400, "name 必須是文字");
  const apply = (list: MoodImage[] | undefined): MoodImage => {
    const image = list?.find((m) => m.id === imageId);
    if (!image) throw new HttpError(404, "找不到參考圖");
    if (patch.note !== undefined) {
      const note = sanitizeNote(patch.note);
      if (note) image.note = note;
      else delete image.note;
    }
    if (patch.name !== undefined) image.name = sanitizeAssetName(patch.name, image.name);
    return image;
  };
  let updated: MoodImage | null = null;
  if (owner.kind === "project") {
    const saved = await updateProject(owner.id, (p) => {
      updated = { ...apply(p.moodboard) };
    });
    return json({ image: updated, images: saved.moodboard ?? [] });
  }
  const saved = await updateBand(owner.id, (b) => {
    updated = { ...apply(b.moodboard) };
  });
  return json({ image: updated ? { ...(updated as MoodImage), scope: "band" } : null, images: saved.moodboard ?? [] });
}

export async function deleteMoodImage(owner: MoodOwner, imageId: string): Promise<Response> {
  requireImageId(imageId);
  if (owner.kind === "project") {
    const saved = await removeMoodImage(owner.id, imageId);
    if (!saved) throw new HttpError(404, "找不到參考圖");
    return json({ ok: true as const, images: saved.moodboard ?? [] });
  }
  const saved = await removeBandMoodImage(owner.id, imageId);
  if (!saved) throw new HttpError(404, "找不到參考圖");
  return json({ ok: true as const, images: saved.moodboard ?? [] });
}
