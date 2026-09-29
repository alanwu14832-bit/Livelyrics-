#!/usr/bin/env node
// Create a demo project through the running Livelyrics app's API.
//
//   node scripts/seed-demo.mjs [--base http://localhost:3000] [--audio fixtures/demo-song.wav]
//                              [--lrc fixtures/demo-lyrics.lrc] [--title 示範之歌] [--artist "Livelyrics Band"]
//                              [--duration <seconds>] [--no-lyrics]
//
// Node 22+, no dependencies (global fetch / FormData / Blob).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaults = {
  base: "http://localhost:3000",
  audio: path.join(root, "fixtures/demo-song.wav"),
  lrc: path.join(root, "fixtures/demo-lyrics.lrc"),
  title: "示範之歌",
  artist: "Livelyrics Band",
  duration: "",
  "no-lyrics": false,
};

const MIME = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

function usage(code = 0) {
  console.log(`用法：node scripts/seed-demo.mjs [選項]

  --base <url>        App 位址（預設 ${defaults.base}）
  --audio <path>      音檔（預設 fixtures/demo-song.wav）
  --lrc <path>        歌詞 LRC / 純文字（預設 fixtures/demo-lyrics.lrc）
  --no-lyrics         不附歌詞，讓伺服器自己去 LRCLIB 找
  --title <text>      歌名（預設 ${defaults.title}）
  --artist <text>     藝人（預設 ${defaults.artist}）
  --duration <sec>    歌曲長度（WAV 會自動讀取）
  -h, --help          顯示說明`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") usage(0);
    if (arg === "--no-lyrics") {
      opts["no-lyrics"] = true;
      continue;
    }
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m || !(m[1] in defaults)) {
      console.error(`未知的參數：${arg}`);
      usage(1);
    }
    const value = m[2] ?? argv[++i];
    if (value === undefined) {
      console.error(`參數 --${m[1]} 需要一個值`);
      usage(1);
    }
    opts[m[1]] = value;
  }
  opts.base = opts.base.replace(/\/+$/, "");
  return opts;
}

/** Duration of a PCM WAV file from its RIFF header, or 0. */
function wavDuration(buf) {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return 0;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && offset + 16 <= buf.length) byteRate = buf.readUInt32LE(offset + 16);
    if (id === "data") return byteRate > 0 ? Math.min(size, buf.length - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return `${res.status} ${body.error}`;
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}`;
}

function describeEvent(e) {
  switch (e.type) {
    case "step": {
      const mark = { start: "▶", done: "✓", skipped: "–", error: "✗" }[e.status] ?? "·";
      return `${mark} [${e.step}] ${e.status}${e.message ? `：${e.message}` : ""}`;
    }
    case "log":
      return `  [${e.step}] ${e.message}`;
    case "search":
      return `  搜尋：${e.query}`;
    case "done":
      return `✓ 完成：狀態 ${e.project.status}${e.project.plan ? `，主視覺「${e.project.plan.keyVisual.title}」` : ""}`;
    case "error":
      return `✗ 錯誤：${e.message}`;
    case "attached":
      return `  已接上進行中的處理（${e.steps.join(" → ")}）${e.sameRequest ? "" : "，這次的設定不會套用"}`;
    default:
      return JSON.stringify(e);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const audioPath = path.resolve(opts.audio);
  const audio = await readFile(audioPath).catch((err) => {
    throw new Error(`讀不到音檔 ${audioPath}：${err.message}`);
  });
  const ext = path.extname(audioPath).slice(1).toLowerCase();
  let lyricsText;
  if (!opts["no-lyrics"] && opts.lrc) {
    const lrcPath = path.resolve(opts.lrc);
    lyricsText = await readFile(lrcPath, "utf8").catch((err) => {
      throw new Error(`讀不到歌詞 ${lrcPath}：${err.message}`);
    });
  }
  const duration = Number(opts.duration) > 0 ? Number(opts.duration) : ext === "wav" ? wavDuration(audio) : 0;

  // 1) create the project
  const form = new FormData();
  form.set("audio", new Blob([audio], { type: MIME[ext] ?? "application/octet-stream" }), path.basename(audioPath));
  form.set("meta", JSON.stringify({ title: opts.title, artist: opts.artist, duration: Math.round(duration * 1000) / 1000 }));
  form.set("analysis", "null");

  let res;
  try {
    res = await fetch(`${opts.base}/api/projects`, { method: "POST", body: form });
  } catch (err) {
    throw new Error(`無法連線到 ${opts.base}（${err.cause?.message ?? err.message}）。請先執行 npm run dev，或用 --base 指定位址。`);
  }
  if (!res.ok) throw new Error(`建立專案失敗：${await errorMessage(res)}`);
  const project = await res.json();
  console.log(`已建立專案 ${project.id}：${project.meta.title} — ${project.meta.artist}（${project.meta.duration.toFixed(1)} 秒）`);

  // 2) run the pipeline and print the streamed events
  const body = lyricsText ? { lyricsText } : {};
  res = await fetch(`${opts.base}/api/projects/${project.id}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`處理失敗：${await errorMessage(res)}`);

  const decoder = new TextDecoder();
  let buffer = "";
  let inDelta = false;
  let failed = false;
  let finished = false;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      const event = JSON.parse(data);
      if (event.type === "delta") {
        process.stdout.write(event.text);
        inDelta = true;
        continue;
      }
      if (inDelta) {
        process.stdout.write("\n");
        inDelta = false;
      }
      console.log(describeEvent(event));
      if (event.type === "error") failed = true;
      if (event.type === "done" || event.type === "error") finished = true;
    }
  }
  if (!finished) {
    failed = true;
    console.log("✗ 串流在完成前中斷了（處理可能仍在伺服器上進行）");
  }

  console.log(`\n控制台：${opts.base}/p/${project.id}`);
  console.log(`投影輸出：${opts.base}/p/${project.id}/output`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
