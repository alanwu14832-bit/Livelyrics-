import { promises as fs } from "node:fs";
import { coerceBlobRef } from "@/lib/assets";
import { isJsonRequest } from "@/lib/server/asset-routes";
import { FORM_OVERHEAD_BYTES, MAX_AUDIO_BYTES, resolveAudioType, sanitizeFileName } from "@/lib/server/audio-files";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { parseMultipart } from "@/lib/server/multipart";
import { withLiveStatus } from "@/lib/server/pipeline";
import { isValidBandId } from "@/lib/band";
import { getBand, withBandAssets } from "@/lib/server/band-storage";
import { createProject, createUploadTempPath, listProjects } from "@/lib/server/storage";
import { files, isCloudStorage } from "@/lib/server/store";
import { parseAnalysis, parseCreateMeta, sanitizeAnalysis } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** the cloud registration carries the analysis (JSON) but not the audio */
const MAX_REGISTRATION_BYTES = 8 * 1024 * 1024;

export const GET = handle(async () => {
  const projects = await listProjects();
  return json(projects.map((p) => withLiveStatus(p)));
});

async function requestedBand(raw: unknown): Promise<string | undefined> {
  const requested = typeof raw === "string" ? raw.trim() : "";
  if (!requested) return undefined;
  if (!isValidBandId(requested) || !(await getBand(requested))) throw new HttpError(400, "找不到指定的樂團");
  return requested;
}

/**
 * Cloud: JSON `{ blob: { url, pathname }, fileName, meta, analysis, bandId? }` after the browser
 * uploaded the audio to Vercel Blob. The first bytes of the blob decide the type; a file that is
 * not audio (or anything else that fails) is deleted again.
 */
async function registerCloudAudio(req: Request): Promise<Response> {
  const body = await readJson(req, MAX_REGISTRATION_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { blob, fileName, meta, analysis }");
  const b = body as Record<string, unknown>;
  const blob = coerceBlobRef(b.blob);
  if (!blob) throw new HttpError(400, "缺少上傳的音檔（blob）");
  const store = files();
  const info = await store.inspect(blob, { prefix: "audio/" });
  try {
    if (info.size === 0) throw new HttpError(400, "音檔是空的");
    if (info.size > MAX_AUDIO_BYTES) throw new HttpError(413, `音檔太大（上限 ${MAX_AUDIO_BYTES / 1024 / 1024} MB）`);
    const fileName = sanitizeFileName(typeof b.fileName === "string" ? b.fileName : "");
    const type = resolveAudioType(fileName, info.contentType, info.head);
    if (!type.ok) throw new HttpError(415, type.error);
    const analysis = sanitizeAnalysis(b.analysis);
    const meta = parseCreateMeta(JSON.stringify(b.meta ?? {}), { fileName, mimeType: type.mimeType }, analysis);
    const bandId = await requestedBand(b.bandId);
    const project = await createProject({ meta, analysis, bandId, audio: { blob: info.blob, ext: type.ext } });
    return json(await withBandAssets(project), { status: 201 });
  } catch (err) {
    await store.remove([{ kind: "blob", blob: info.blob }]);
    throw err;
  }
}

export const POST = handle(async (req: Request) => {
  if (isCloudStorage()) {
    if (!isJsonRequest(req)) throw new HttpError(400, "雲端模式請先把音檔上傳到 Vercel Blob，再登記到這裡。");
    return registerCloudAudio(req);
  }
  if (isJsonRequest(req)) throw new HttpError(400, "本機模式請直接上傳音檔（multipart）。");

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES) {
    throw new HttpError(413, `音檔太大（上限 ${MAX_AUDIO_BYTES / 1024 / 1024} MB）`);
  }

  const { fields, file } = await parseMultipart(req.body, req.headers.get("content-type"), {
    fileField: "audio",
    maxFileBytes: MAX_AUDIO_BYTES,
    tempPath: createUploadTempPath,
    declaredBytes: Number.isFinite(declared) ? declared : null,
  });
  if (!file) throw new HttpError(400, "缺少音檔（欄位 audio）");

  try {
    if (file.size === 0) throw new HttpError(400, "音檔是空的");
    const fileName = sanitizeFileName(file.fileName);
    const type = resolveAudioType(fileName, file.contentType, file.head);
    if (!type.ok) throw new HttpError(415, type.error);

    const analysis = parseAnalysis(fields.analysis);
    const meta = parseCreateMeta(fields.meta, { fileName, mimeType: type.mimeType }, analysis);
    const bandId = await requestedBand(fields.bandId);
    const project = await createProject({ meta, analysis, bandId, audio: { tempPath: file.path, ext: type.ext } });
    return json(await withBandAssets(project), { status: 201 });
  } finally {
    // moved into the project on success; otherwise drop the upload
    await fs.rm(file.path, { force: true }).catch(() => {});
  }
});
