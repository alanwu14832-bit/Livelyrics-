// Local file store: uploads are streamed to <dataDir>/tmp by the multipart parser, then moved next
// to their document (<project>/audio.<ext>, <project>/assets/<id>.<ext>, <band>/assets/<id>.<ext>)
// and served from disk with HTTP Range support.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { serveFile } from "../file-response";
import { HttpError } from "../http";
import { StorageError } from "./errors";
import { isNodeError, moveFile } from "./local-fs";
import type { FileStore } from "./types";

export function createLocalFileStore(): FileStore {
  return {
    mode: "local",

    async place(tempPath, destination) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await moveFile(tempPath, destination);
    },

    async remove(files) {
      for (const f of files) {
        if (f.kind === "disk") await fs.rm(f.path, { force: true }).catch(() => {});
      }
    },

    serve(req, file, opts) {
      if (file.kind !== "disk") throw new HttpError(404, opts.missing);
      return serveFile(req, { file: file.path, ...opts });
    },

    async inspect() {
      throw new HttpError(400, "本機模式不使用雲端上傳，請直接上傳檔案。");
    },

    async write(target, bytes) {
      await fs.mkdir(path.dirname(target.diskPath), { recursive: true });
      const temp = `${target.diskPath}.${randomUUID().slice(0, 8)}.part`;
      try {
        await fs.writeFile(temp, bytes);
        await fs.rename(temp, target.diskPath);
      } catch (err) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw err;
      }
      return { kind: "disk", path: target.diskPath };
    },

    async read(file, { maxBytes }) {
      if (file.kind !== "disk") throw new StorageError("not_found", "找不到檔案");
      try {
        const st = await fs.stat(file.path);
        if (st.size > maxBytes) throw new HttpError(413, "檔案太大");
        return new Uint8Array(await fs.readFile(file.path));
      } catch (err) {
        if (isNodeError(err, "ENOENT")) throw new StorageError("not_found", "找不到檔案");
        throw err;
      }
    },
  };
}
