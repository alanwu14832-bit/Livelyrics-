// Lyric-timing evaluation, step 1: decode a folder of MP3s into 16-bit PCM WAV files at 22 050 Hz
// with headless Chromium's Web Audio (the same decodeAudioData at the analysis rate the upload uses),
// so Node can read the samples without an MP3 decoder. Stereo files stay stereo (the vocal pass needs
// the side signal); a mono file stays mono.
//
//   node scripts/timing-eval/decode.cjs <dataset dir (with mp3/) or a folder of .mp3> <cache dir> [--force] [--only=<text>]
//
// --asr (round 15) writes what the lyric editor's 「AI 自動對時」 hands the speech recogniser instead:
// decodeAudioData at 16 kHz, the channels averaged to mono (decodeForAsr in src/lib/asr/audio.ts),
// as 32-bit float WAV files — the input of scripts/timing-eval/transcribe.mjs.
//
// Local measurement only: the decoded audio is written to the cache dir (keep it out of the repo,
// e.g. scratch/round14/wav). See "Lyric timing evaluation" in docs/ARCHITECTURE.md.
const { chromium } = (() => {
  for (const id of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      return require(id);
    } catch {
      /* try the next location */
    }
  }
  throw new Error("找不到 Playwright：請先執行 npm i --no-save playwright 與 npx playwright install chromium");
})();
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const RATE = 22050;
/** the speech recogniser's input rate (src/lib/asr/models.json sampleRate) */
const ASR_RATE = 16000;

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const force = args.includes("--force");
const asr = args.includes("--asr");
const only = (args.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length);
if (positional.length < 2) {
  console.error("usage: node scripts/timing-eval/decode.cjs <dataset dir or mp3 folder> <cache dir> [--asr] [--force] [--only=<text>]");
  process.exit(2);
}
const source = path.resolve(positional[0]);
const mp3Dir = fs.existsSync(path.join(source, "mp3")) ? path.join(source, "mp3") : source;
const cacheDir = path.resolve(positional[1]);
fs.mkdirSync(cacheDir, { recursive: true });

const files = fs
  .readdirSync(mp3Dir)
  .filter((f) => /\.mp3$/i.test(f) && (!only || f.includes(only)))
  .sort();
if (files.length === 0) {
  console.error(`no .mp3 files in ${mp3Dir}`);
  process.exit(2);
}

const wavName = (mp3) => mp3.replace(/\.mp3$/i, ".wav");

// The page fetches the MP3 from this server and posts the WAV back (same origin, no CORS).
const PAGE = `<!doctype html><meta charset="utf-8"><title>decode</title><script>
async function decodeOne(name, rate) {
  const res = await fetch("/mp3/" + encodeURIComponent(name));
  if (!res.ok) throw new Error("fetch " + res.status);
  const data = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(data);
  const channels = Math.min(2, buf.numberOfChannels);
  const n = buf.length;
  const out = new ArrayBuffer(44 + n * channels * 2);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * channels * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * channels * 2, true);
  const pcm = new Int16Array(out, 44);
  for (let c = 0; c < channels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const s = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i];
      pcm[i * channels + c] = Math.round(s * 32767);
    }
  }
  const put = await fetch("/wav/" + encodeURIComponent(name), { method: "POST", body: out });
  if (!put.ok) throw new Error("upload " + put.status);
  return { seconds: buf.duration, channels: buf.numberOfChannels, sourceRate: buf.sampleRate };
}
// decodeForAsr (src/lib/asr/audio.ts): decode at 16 kHz, average the channels; 32-bit float mono WAV
async function decodeAsr(name, rate) {
  const res = await fetch("/mp3/" + encodeURIComponent(name));
  if (!res.ok) throw new Error("fetch " + res.status);
  const data = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(data);
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += x[i];
  }
  if (buf.numberOfChannels > 1) for (let i = 0; i < n; i++) mono[i] /= buf.numberOfChannels;
  const out = new ArrayBuffer(44 + n * 4);
  const v = new DataView(out);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 32, true);
  str(36, "data"); v.setUint32(40, n * 4, true);
  new Float32Array(out, 44).set(mono);
  const put = await fetch("/wav/" + encodeURIComponent(name), { method: "POST", body: out });
  if (!put.ok) throw new Error("upload " + put.status);
  return { seconds: buf.duration, channels: buf.numberOfChannels, sourceRate: buf.sampleRate };
}
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  const m = /^\/(mp3|wav)\/(.+)$/.exec(url.pathname);
  const name = m ? decodeURIComponent(m[2]) : "";
  if (!m || name.includes("/") || name.includes("\\") || !files.includes(name)) {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "GET" && m[1] === "mp3") {
    res.writeHead(200, { "content-type": "audio/mpeg" });
    fs.createReadStream(path.join(mp3Dir, name)).pipe(res);
    return;
  }
  if (req.method === "POST" && m[1] === "wav") {
    const target = path.join(cacheDir, wavName(name));
    const tmp = `${target}.${process.pid}.tmp`;
    const out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on("finish", () => {
      fs.renameSync(tmp, target);
      res.writeHead(204).end();
    });
    out.on("error", () => res.writeHead(500).end());
    return;
  }
  res.writeHead(405).end();
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  await page.goto(`${base}/`);
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  try {
    for (const f of files) {
      const target = path.join(cacheDir, wavName(f));
      if (!force && fs.existsSync(target) && fs.statSync(target).size > 44) {
        done++;
        continue;
      }
      try {
        const info = asr
          ? await page.evaluate(([name, rate]) => window.decodeAsr(name, rate), [f, ASR_RATE])
          : await page.evaluate(([name, rate]) => window.decodeOne(name, rate), [f, RATE]);
        done++;
        console.log(`${String(done).padStart(3)}/${files.length} ${f}  ${info.seconds.toFixed(1)} s, ${info.channels} ch`);
      } catch (err) {
        failed++;
        console.log(`FAIL ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${done} decoded or cached, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s → ${cacheDir}`);
  process.exit(failed ? 1 : 0);
})();
