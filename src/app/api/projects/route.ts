import { promises as fs } from "node:fs";
import { MAX_AUDIO_BYTES, resolveAudioType, sanitizeFileName } from "@/lib/server/audio-files";
import { handle, HttpError, json } from "@/lib/server/http";
import { parseMultipart } from "@/lib/server/multipart";
import { withLiveStatus } from "@/lib/server/pipeline";
import { createProject, createUploadTempPath, listProjects } from "@/lib/server/storage";
import { parseAnalysis, parseCreateMeta } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** room for the meta / analysis fields and multipart framing on top of the audio */
const FORM_OVERHEAD_BYTES = 64 * 1024 * 1024;

export const GET = handle(async () => {
  const projects = await listProjects();
  return json(projects.map(withLiveStatus));
});

export const POST = handle(async (req: Request) => {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES) {
    throw new HttpError(413, `音檔太大（上限 ${MAX_AUDIO_BYTES / 1024 / 1024} MB）`);
  }

  const { fields, file } = await parseMultipart(req.body, req.headers.get("content-type"), {
    fileField: "audio",
    maxFileBytes: MAX_AUDIO_BYTES,
    tempPath: createUploadTempPath,
  });
  if (!file) throw new HttpError(400, "缺少音檔（欄位 audio）");

  try {
    if (file.size === 0) throw new HttpError(400, "音檔是空的");
    const fileName = sanitizeFileName(file.fileName);
    const type = resolveAudioType(fileName, file.contentType, file.head);
    if (!type.ok) throw new HttpError(415, type.error);

    const analysis = parseAnalysis(fields.analysis);
    const meta = parseCreateMeta(fields.meta, { fileName, mimeType: type.mimeType }, analysis);
    const project = await createProject({ meta, analysis, audio: { tempPath: file.path, ext: type.ext } });
    return json(project, { status: 201 });
  } finally {
    // moved into the project on success; otherwise drop the upload
    await fs.rm(file.path, { force: true }).catch(() => {});
  }
});
