import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBoundary, MultipartError, parseMultipart } from "./multipart";

let dir: string;
let counter = 0;

beforeAll(async () => {
  await fs.mkdir("/tmp/claude-0", { recursive: true });
  dir = await fs.mkdtemp("/tmp/claude-0/ll-multipart-");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const tempPath = async () => path.join(dir, `f${counter++}.part`);

function streamOf(data: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      controller.enqueue(data.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

async function encode(form: FormData): Promise<{ body: Uint8Array; contentType: string }> {
  const res = new Response(form);
  return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type")! };
}

function binaryPayload(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let x = 12345;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  // make sure CRLF and dashes appear inside the file body too
  out.set(new TextEncoder().encode("\r\n--\r\n\r\n--x"), Math.floor(size / 2));
  return out;
}

describe("parseMultipart", () => {
  it("parses fields and streams the file to disk for many chunk sizes", async () => {
    const payload = binaryPayload(70_000);
    const form = new FormData();
    form.set("audio", new Blob([payload], { type: "audio/wav" }), "告五人 - 愛人錯過.wav");
    form.set("meta", JSON.stringify({ title: "愛人錯過", artist: "告五人" }));
    form.set("analysis", "null");
    const { body, contentType } = await encode(form);

    for (const chunk of [1, 7, 64, 1000, 65536, body.length]) {
      const result = await parseMultipart(streamOf(body, chunk), contentType, { fileField: "audio", maxFileBytes: 1e6, tempPath });
      expect(result.fields.meta).toBe(JSON.stringify({ title: "愛人錯過", artist: "告五人" }));
      expect(result.fields.analysis).toBe("null");
      const file = result.file!;
      expect(file.fileName).toBe("告五人 - 愛人錯過.wav");
      expect(file.contentType).toBe("audio/wav");
      expect(file.size).toBe(payload.length);
      expect(Array.from(file.head)).toEqual(Array.from(payload.slice(0, 64)));
      const written = new Uint8Array(await fs.readFile(file.path));
      expect(Buffer.compare(Buffer.from(written), Buffer.from(payload))).toBe(0);
      await fs.rm(file.path);
    }
  });

  it("handles an empty file and a missing file", async () => {
    const form = new FormData();
    form.set("audio", new Blob([]), "empty.mp3");
    const { body, contentType } = await encode(form);
    const r = await parseMultipart(streamOf(body, 10), contentType, { fileField: "audio", maxFileBytes: 100, tempPath });
    expect(r.file!.size).toBe(0);
    await fs.rm(r.file!.path);

    const form2 = new FormData();
    form2.set("meta", "{}");
    const e2 = await encode(form2);
    const r2 = await parseMultipart(streamOf(e2.body, 3), e2.contentType, { fileField: "audio", maxFileBytes: 100, tempPath });
    expect(r2.file).toBeNull();
    expect(r2.fields.meta).toBe("{}");
  });

  it("ignores other file fields and keeps only the first audio part", async () => {
    const form = new FormData();
    form.append("cover", new Blob(["img"]), "cover.png");
    form.append("audio", new Blob(["first"]), "a.mp3");
    form.append("audio", new Blob(["second"]), "b.mp3");
    const { body, contentType } = await encode(form);
    const r = await parseMultipart(streamOf(body, 5), contentType, { fileField: "audio", maxFileBytes: 100, tempPath });
    expect(r.file!.fileName).toBe("a.mp3");
    expect(await fs.readFile(r.file!.path, "utf8")).toBe("first");
    await fs.rm(r.file!.path);
  });

  it("rejects oversized files and removes the partial temp file", async () => {
    const before = await fs.readdir(dir);
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(5000)]), "big.wav");
    const { body, contentType } = await encode(form);
    await expect(
      parseMultipart(streamOf(body, 512), contentType, { fileField: "audio", maxFileBytes: 1000, tempPath }),
    ).rejects.toMatchObject({ status: 413 });
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it("rejects oversized fields", async () => {
    const form = new FormData();
    form.set("meta", "x".repeat(2000));
    const { body, contentType } = await encode(form);
    await expect(
      parseMultipart(streamOf(body, 100), contentType, { fileField: "audio", maxFileBytes: 10, maxFieldBytes: 1000, tempPath }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects truncated bodies and cleans up", async () => {
    const before = await fs.readdir(dir);
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(3000)]), "t.wav");
    const { body, contentType } = await encode(form);
    await expect(
      parseMultipart(streamOf(body.slice(0, 2000), 256), contentType, { fileField: "audio", maxFileBytes: 1e6, tempPath }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it("propagates a client abort and cleans up", async () => {
    const before = await fs.readdir(dir);
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array(3000)]), "t.wav");
    const { body, contentType } = await encode(form);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 1500) {
          controller.error(new Error("aborted"));
          return;
        }
        controller.enqueue(body.slice(sent, sent + 500));
        sent += 500;
      },
    });
    await expect(parseMultipart(stream, contentType, { fileField: "audio", maxFileBytes: 1e6, tempPath })).rejects.toThrow("aborted");
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it("parses a hand-written body with a preamble, quoted boundary and filename*", async () => {
    const raw =
      "preamble text\r\n" +
      "--XyZ\r\n" +
      'Content-Disposition: form-data; name="audio"; filename="fallback.mp3"; filename*=UTF-8\'\'%E6%AD%8C.mp3\r\n' +
      "Content-Type: audio/mpeg\r\n\r\n" +
      "ID3data\r\n" +
      "--XyZ  \r\n" +
      'Content-Disposition: form-data; name="meta"\r\n\r\n' +
      '{"title":"a"}\r\n' +
      "--XyZ--\r\nepilogue";
    const r = await parseMultipart(streamOf(new TextEncoder().encode(raw), 4), 'multipart/form-data; boundary="XyZ"', {
      fileField: "audio",
      maxFileBytes: 100,
      tempPath,
    });
    expect(r.file!.fileName).toBe("歌.mp3");
    expect(await fs.readFile(r.file!.path, "utf8")).toBe("ID3data");
    expect(r.fields.meta).toBe('{"title":"a"}');
    await fs.rm(r.file!.path);
  });

  it("validates the content type", () => {
    expect(() => getBoundary("application/json")).toThrow(MultipartError);
    expect(() => getBoundary(null)).toThrow(MultipartError);
    expect(() => getBoundary("multipart/form-data")).toThrow(MultipartError);
    expect(getBoundary("multipart/form-data; boundary=abc")).toBe("abc");
    expect(getBoundary('multipart/form-data; charset=utf-8; boundary="a b"')).toBe("a b");
  });
});
