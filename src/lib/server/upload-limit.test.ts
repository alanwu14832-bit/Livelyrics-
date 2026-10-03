// B1 (round 10): the proxy's request-body limit must cover the upload the UI promises. Next
// buffers a proxied body only up to `proxyClientMaxBodySize` (10 MB by default) and hands the
// route a truncated multipart upload, which used to fail as 「上傳內容不完整」 for any file over 10 MB.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../../components/upload/accept";
import { MAX_AUDIO_UPLOAD_BYTES } from "../upload-policy";
import { FORM_OVERHEAD_BYTES, MAX_AUDIO_BYTES } from "./audio-files";
import { incompleteMessage } from "./multipart";

function bytesOf(size: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(size.trim());
  if (!m) throw new Error(`unreadable size: ${size}`);
  const unit = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[m[2].toLowerCase() as "b" | "kb" | "mb" | "gb"];
  return Number(m[1]) * unit;
}

describe("upload size limits agree", () => {
  it("the proxy body limit in next.config.ts covers the audio limit plus the form overhead", () => {
    const config = readFileSync(path.resolve(__dirname, "../../../next.config.ts"), "utf8");
    const m = /proxyClientMaxBodySize:\s*"([^"]+)"/.exec(config);
    expect(m, "next.config.ts sets experimental.proxyClientMaxBodySize").not.toBeNull();
    expect(bytesOf(m![1])).toBeGreaterThanOrEqual(MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES);
  });

  it("the dropzone, the cloud policy and the server promise the same audio limit", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_AUDIO_BYTES);
    expect(MAX_AUDIO_UPLOAD_BYTES).toBe(MAX_AUDIO_BYTES);
  });

  it("an incomplete upload says how much arrived, in plain Chinese", () => {
    expect(incompleteMessage(10 * 1024 * 1024, 126 * 1024 * 1024)).toContain("只收到 10.0 MB，應有 126 MB");
    expect(incompleteMessage(3 * 1024 * 1024, null)).toContain("3.0 MB");
  });
});
