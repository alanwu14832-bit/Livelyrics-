// Lyric-timing evaluation, step 2 (round 15): run the pinned Whisper model of 「AI 自動對時」 in Node
// over the decoded songs and cache the recognised words with their timestamps, so the harness
// (src/lib/lyrics/timing-eval.test.ts, the `whisper` estimators) can score the alignment in seconds.
//
//   node scripts/timing-eval/decode.cjs <dataset> <wav16k dir> --asr          # once: 16 kHz mono float WAVs
//   node scripts/timing-eval/transcribe.mjs <wav16k dir> <dataset> <out dir> \
//     [--model=accurate|fast] [--split=dev|held-out|all] [--limit=N] [--only=<text>] [--cache=<model dir>]
//
// The model id, revision, dtypes and pipeline options come from src/lib/asr/models.json — the same
// file the browser worker reads. Node runs the WASM configuration (q8 encoder and decoder) on the CPU
// (onnxruntime-node); the browser's WebGPU variant (fp16 encoder) is not measured here.
// Writes <out dir>/<stem>.json { model, revision, dtype, language, words: [{ text, start, end }], text,
// seconds, audioSeconds }. Existing outputs are kept (delete one to redo it).
// Local measurement only: never commit dataset audio, lyrics, annotations or transcripts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(REPO, "src/lib/asr/models.json"), "utf8"));

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
if (positional.length < 3) {
  console.error(
    "usage: node scripts/timing-eval/transcribe.mjs <wav16k dir> <dataset dir> <out dir> [--model=accurate|fast] [--split=dev|held-out|all] [--limit=N] [--only=<text>] [--cache=<model dir>]",
  );
  process.exit(2);
}
const [wavDir, datasetDir, outDir] = positional.map((p) => path.resolve(p));
const choice = flag("model", "accurate");
const spec = CONFIG.models[choice];
if (!spec) {
  console.error(`unknown --model=${choice} (one of ${Object.keys(CONFIG.models).join(", ")})`);
  process.exit(2);
}
const split = flag("split", "all");
const limit = Number(flag("limit", "0")) || Infinity;
const only = flag("only", "");
env.cacheDir = path.resolve(flag("cache", path.join(REPO, "scratch/asr-models")));
env.allowLocalModels = false;
fs.mkdirSync(outDir, { recursive: true });

/** FNV-1a (32 bit): the dev / held-out split of src/lib/lyrics/timing-eval.ts (evalSplit). */
function evalSplit(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0) & 1 ? "held-out" : "dev";
}

/** 16 kHz mono float32 (decode.cjs --asr) or 16-bit PCM WAV; anything not at 16 kHz is refused. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${file}: not a WAV file`);
  let pos = 12;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (rate !== CONFIG.sampleRate) throw new Error(`${file}: ${rate} Hz — decode with decode.cjs --asr (${CONFIG.sampleRate} Hz)`);
      const bytes = Math.min(size, buf.length - body);
      const frame = (bits / 8) * channels;
      const n = Math.floor(bytes / frame);
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + i * frame + c * (bits / 8);
          s += format === 3 ? buf.readFloatLE(at) : buf.readInt16LE(at) / 32768;
        }
        mono[i] = s / channels;
      }
      return mono;
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

const LANGUAGE = { english: "en", french: "fr", german: "de", spanish: "es" };
const meta = fs.readFileSync(path.join(datasetDir, "JamendoLyrics.csv"), "utf8").trim().split(/\r?\n/);
const header = meta[0].split(",");
const languageOf = new Map();
for (const row of meta.slice(1)) {
  const cells = row.split(",");
  const file = cells[header.indexOf("Filepath")];
  const lang = cells[header.indexOf("Language")].toLowerCase();
  languageOf.set(file.replace(/\.mp3$/i, ""), LANGUAGE[lang] ?? lang);
}

const stems = [...languageOf.keys()]
  .filter((s) => (split === "all" || evalSplit(s) === split) && (!only || s.includes(only)))
  .filter((s) => fs.existsSync(path.join(wavDir, `${s}.wav`)))
  .sort()
  .filter((s) => !fs.existsSync(path.join(outDir, `${s}.json`)))
  .slice(0, limit);
console.log(`${choice}: ${spec.id}@${spec.revision.slice(0, 10)} (${JSON.stringify(spec.wasm.dtype)}), ${stems.length} songs to transcribe (${split})`);
if (stems.length === 0) process.exit(0);

const t0 = performance.now();
const asr = await pipeline("automatic-speech-recognition", spec.id, { revision: spec.revision, dtype: spec.wasm.dtype, device: "cpu" });
console.log(`loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

let n = 0;
for (const stem of stems) {
  const out = path.join(outDir, `${stem}.json`);
  const audio = readWav(path.join(wavDir, `${stem}.wav`));
  const language = languageOf.get(stem) ?? null;
  const t1 = performance.now();
  const result = await asr(audio, { ...CONFIG.pipeline, language });
  const seconds = (performance.now() - t1) / 1000;
  const words = (result.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp?.[0] ?? null, end: c.timestamp?.[1] ?? null }));
  const record = { model: spec.id, revision: spec.revision, dtype: spec.wasm.dtype, language, words, text: result.text, seconds, audioSeconds: audio.length / CONFIG.sampleRate };
  fs.writeFileSync(`${out}.tmp`, JSON.stringify(record));
  fs.renameSync(`${out}.tmp`, out);
  n++;
  console.log(`${String(n).padStart(3)}/${stems.length} ${stem} [${evalSplit(stem)}, ${language}]: ${words.length} words, ${seconds.toFixed(1)} s for ${(audio.length / CONFIG.sampleRate).toFixed(0)} s of audio`);
}
console.log(`done in ${((performance.now() - t0) / 1000 / 60).toFixed(1)} min`);
