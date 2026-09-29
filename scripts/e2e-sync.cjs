// End-to-end check of 同步與控制器 (phase 5a) against a running server. No real devices:
//   - MIDI: a fake MIDIAccess (navigator.requestMIDIAccess, installed by an init script) with one
//     input; `window.__midi` sends bytes through it, with event timestamps like a real port. The
//     console's own Web MIDI code (MidiHub, parser, mapper, clock, MTC) handles them.
//   - LTC: a WAV written here (25 fps from 01:00:10:00, the plain-JS twin of
//     src/lib/sync/testing/ltc-encoder.ts) is Chromium's fake microphone
//     (--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop).
// Usage: BASE=http://localhost:3100 SHOTS=/tmp/shots node scripts/e2e-sync.cjs
//
// Checks, in the per-song console /p/<id> and its projection window:
//   - manual by default: no sync capsule, no MIDI or microphone request;
//   - the 控制器 sheet: MIDI on, learn 一鍵黑場 (a note) and 畫面強度 (a CC), Esc cancels a learn,
//     the mapping file exports and imports; the pad blacks out (its note off does not), the fader
//     moves the intensity; ProPresenter 式 note n cues lyric line n;
//   - MIDI clock at 128 BPM: the readout shows ≈ 128, the projection's beat phase advances, and the
//     lock is lost half a second after the clock stops;
//   - MTC quarter frames: the timecode readout runs, the song follows (TRACK: its audio too) and
//     the projection shows the lyric at that time; a dropout freewheels, then falls back to manual;
//   - LTC from the fake microphone: it locks, the song is at ≈ 10 s, the projection shows that line,
//     and when the timecode ends it freewheels, then 「時間碼中斷，已切回手動」;
// and in the show console /s/<id>/live: a learned GO pad takes the next item (a double hit takes
// only one), the blackout pad works there too, and 「跟隨時間碼換歌」 takes the song whose hour the
// MTC enters.
// Playwright: a normally installed copy first (e.g. `npm i --no-save playwright`), else the cloud container's global one
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
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3100";
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");
const LRC2 = LRC.replace("[ti:示範之歌]", "[ti:第二首歌]").replace("夜色慢慢落在城市的邊緣", "第二首歌從這裡開始").replace("我們把名字寫進風裡面", "海風吹過安靜的港口");

const problems = [];
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial", ...opts });
const squash = (s) => s.replace(/\s+/g, "");
// karaoke draws every character twice (base + fill layer)
const shows = (text, want) => squash(text).includes(squash(want)) || squash(text).replace(/(.)\1/g, "$1").includes(squash(want));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function makeSong(title, lrc) {
  const form = new FormData();
  form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
  form.set("meta", JSON.stringify({ title, artist: "示範樂團", duration: 73 }));
  form.set("analysis", "null");
  const res = await fetch(`${BASE}/api/projects`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`create ${title}: ${res.status}`);
  const project = await res.json();
  const run = await fetch(`${BASE}/api/projects/${project.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: lrc }) });
  const text = await run.text();
  if (!/"type":"done"/.test(text)) throw new Error(`process ${title} did not finish: ${text.slice(-300)}`);
  return api("GET", `/api/projects/${project.id}`);
}

// ------------------------------------------------------------------ LTC (plain-JS twin of ltc-encoder.ts)

const SYNC_WORD = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

/** The 80 bits of one LTC frame (non-drop), bit 0 first. */
function ltcBits(tc, fps) {
  const bits = new Array(80).fill(0);
  const put = (from, count, v) => {
    for (let k = 0; k < count; k++) bits[from + k] = (v >> k) & 1;
  };
  put(0, 4, tc.frames % 10);
  put(8, 2, Math.floor(tc.frames / 10));
  put(16, 4, tc.seconds % 10);
  put(24, 3, Math.floor(tc.seconds / 10));
  put(32, 4, tc.minutes % 10);
  put(40, 3, Math.floor(tc.minutes / 10));
  put(48, 4, tc.hours % 10);
  put(56, 2, Math.floor(tc.hours / 10));
  for (let k = 0; k < 16; k++) bits[64 + k] = SYNC_WORD[k];
  const parity = fps === 25 ? 59 : 27;
  if (bits.filter((b) => b === 0).length % 2 === 1) bits[parity] = 1;
  return bits;
}

/** A mono 16-bit WAV: `leadIn` s of silence, `seconds` of LTC from `start`, then `tail` s of silence. */
function ltcWav({ sampleRate = 48000, fps = 25, start, seconds, leadIn = 0.3, tail = 10, amplitude = 0.4 }) {
  const bitLen = sampleRate / (80 * fps);
  const frames = Math.round(seconds * fps);
  const lead = Math.round(leadIn * sampleRate);
  const body = Math.ceil(frames * 80 * bitLen);
  const total = lead + body + Math.round(tail * sampleRate);
  const pcm = new Int16Array(total);
  const first = ((start.hours * 60 + start.minutes) * 60 + start.seconds) * fps + start.frames;
  let level = -1;
  for (let k = 0; k < frames; k++) {
    const f = first + k;
    const tc = { hours: Math.floor(f / (fps * 3600)) % 24, minutes: Math.floor(f / (fps * 60)) % 60, seconds: Math.floor(f / fps) % 60, frames: f % fps };
    const bits = ltcBits(tc, fps);
    for (let b = 0; b < 80; b++) {
      const from = lead + (k * 80 + b) * bitLen;
      const half = from + bitLen / 2;
      const to = from + bitLen;
      // biphase mark: a transition at every bit start, another in the middle of a 1
      level = -level;
      for (let n = Math.ceil(from); n < Math.ceil(bits[b] ? half : to); n++) pcm[n] = Math.round(level * amplitude * 32767);
      if (bits[b]) {
        level = -level;
        for (let n = Math.ceil(half); n < Math.ceil(to); n++) pcm[n] = Math.round(level * amplitude * 32767);
      }
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

// ------------------------------------------------------------------ fake Web MIDI (in every page)

const FAKE_MIDI = () => {
  if (window.__midi || typeof navigator === "undefined") return;
  class FakeInput extends EventTarget {
    constructor(id, name) {
      super();
      this.id = id;
      this.name = name;
      this.manufacturer = "Livelyrics e2e";
      this.type = "input";
      this.version = "1.0";
      this.state = "connected";
      this.connection = "closed";
      this.onmidimessage = null;
      this.onstatechange = null;
    }
    open() {
      this.connection = "open";
      return Promise.resolve(this);
    }
    close() {
      this.connection = "closed";
      return Promise.resolve(this);
    }
  }
  const pad = new FakeInput("e2e-pad", "e2e MIDI Pad");
  const inputs = new Map([[pad.id, pad]]);
  const access = { inputs, outputs: new Map(), sysexEnabled: false, onstatechange: null };
  const requests = [];
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value(opts) {
      requests.push({ sysex: !!(opts && opts.sysex) });
      access.sysexEnabled = !!(opts && opts.sysex);
      return Promise.resolve(access);
    },
  });
  // count microphone requests (manual mode must not make any)
  window.__gum = 0;
  const media = navigator.mediaDevices;
  if (media && media.getUserMedia) {
    const real = media.getUserMedia.bind(media);
    media.getUserMedia = (c) => {
      window.__gum++;
      return real(c);
    };
  }
  /** One MIDI event (a real port stamps each event on the performance clock). */
  const send = (bytes, stamp) => {
    const ev = new Event("midimessage");
    Object.defineProperty(ev, "data", { value: new Uint8Array(bytes) });
    if (stamp != null) Object.defineProperty(ev, "timeStamp", { value: stamp });
    pad.dispatchEvent(ev);
  };
  let clockTimer = null;
  let mtcTimer = null;
  const RATE = { 24: 0, 25: 1, 29.97: 2, 30: 3 };
  window.__midi = {
    requests,
    send,
    note: (note, velocity = 100, channel = 0) => send([0x90 | channel, note, velocity]),
    noteOff: (note, channel = 0) => send([0x80 | channel, note, 0]),
    cc: (controller, value, channel = 0) => send([0xb0 | channel, controller, value]),
    /** MIDI clock at `bpm` (Start, then 24 clocks per beat, stamped on the beat grid) */
    startClock(bpm) {
      this.stopClock();
      const period = 60000 / (bpm * 24);
      const t0 = performance.now();
      let n = 0;
      send([0xfa], t0);
      clockTimer = setInterval(() => {
        const now = performance.now();
        while (t0 + n * period <= now) {
          send([0xf8], t0 + n * period);
          n++;
        }
      }, 4);
    },
    stopClock() {
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = null;
    },
    /** A running MTC transport (non-drop): quarter frames from h:m:s:f, 8 per two frames */
    startMtc(h, m, s, f, fps = 25) {
      this.stopMtc();
      const nominal = Math.round(fps);
      const frameMs = 1000 / fps;
      const first = ((h * 60 + m) * 60 + s) * nominal + f;
      const code = RATE[fps];
      const t0 = performance.now();
      let q = 0;
      mtcTimer = setInterval(() => {
        const now = performance.now();
        while (t0 + (q * frameMs) / 4 <= now) {
          const piece = q % 8;
          const frame = first + Math.floor(q / 8) * 2;
          const ff = frame % nominal;
          const ss = Math.floor(frame / nominal) % 60;
          const mm = Math.floor(frame / (nominal * 60)) % 60;
          const hh = Math.floor(frame / (nominal * 3600)) % 24;
          const nib = [ff & 15, ff >> 4, ss & 15, ss >> 4, mm & 15, mm >> 4, hh & 15, (code << 1) | (hh >> 4)][piece];
          send([0xf1, (piece << 4) | nib], t0 + (q * frameMs) / 4);
          q++;
        }
      }, 4);
    },
    stopMtc() {
      if (mtcTimer) clearInterval(mtcTimer);
      mtcTimer = null;
    },
  };
};

// ------------------------------------------------------------------ what the projection window receives

const OUT_SPY = () => {
  const song = location.pathname.match(/^\/p\/([^/]+)\/output/);
  const show = location.pathname.match(/^\/s\/([^/]+)\/output/);
  if (!song && !show) return;
  const ch = new BroadcastChannel(song ? `livelyrics:${song[1]}` : `livelyrics:show:${show[1]}`);
  window.__states = [];
  window.__projects = [];
  ch.onmessage = (e) => {
    const d = e.data;
    if (d && d.type === "state") {
      const s = d.state;
      window.__last = s;
      window.__states.push({ at: Date.now(), beat: s.audio && s.audio.beatPhase, clock: !!(s.audio && s.audio.clock), t: s.t, playing: s.playing, line: s.lineIndex, project: s.projectId, blackout: s.overrides && s.overrides.blackout, intensity: s.overrides && s.overrides.intensity });
      if (window.__states.length > 4000) window.__states.splice(0, 2000);
    }
    if (d && d.type === "project") window.__projects.push(d.project.id);
  };
};

(async () => {
  // ------------------------------------------------------------------ data
  const song1 = await makeSong("同步之歌", LRC);
  const song2 = await makeSong("第二首歌", LRC2);
  const lines = song1.lyrics.lines;
  const band = await api("POST", "/api/bands", { name: "同步樂團" });
  await api("PATCH", `/api/projects/${song1.id}`, { bandId: band.id });
  await api("PATCH", `/api/projects/${song2.id}`, { bandId: band.id });
  let show = await api("POST", "/api/shows", { bandId: band.id, name: "同步 e2e 演出" });
  show = await api("PATCH", `/api/shows/${show.id}`, {
    items: [
      { id: "s1", kind: "song", projectId: song1.id },
      { id: "s2", kind: "song", projectId: song2.id },
    ],
  });
  check("show created with two songs", show.items.length === 2, show.id);

  // the LTC: 01:00:10:00 for 5 s at 25 fps, then silence (Chromium plays it once)
  const ltcPath = path.join(process.env.LTC_DIR || os.tmpdir(), `livelyrics-e2e-ltc-${process.pid}.wav`);
  fs.writeFileSync(ltcPath, ltcWav({ start: { hours: 1, minutes: 0, seconds: 10, frames: 0 }, seconds: 5 }));

  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${ltcPath}%noloop`,
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  context.setDefaultNavigationTimeout(90000);
  await context.addInitScript(FAKE_MIDI);
  await context.addInitScript(OUT_SPY);
  const page = await context.newPage();
  watch(page, "console");
  const midi = (fn, ...args) => page.evaluate(([f, a]) => window.__midi[f](...a), [fn, args]);
  const attr = (sel, name) => page.locator(sel).first().getAttribute(name);
  const text = (sel) => page.locator(sel).first().innerText();
  /** Poll until `pred()` is truthy (ms taken), or -1 after `timeout`. */
  const until = async (pred, timeout = 8000, step = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await pred()) return Date.now() - t0;
      await sleep(step);
    }
    return -1;
  };
  const sheet = () => page.locator("dialog[open]");
  const closeSheet = async () => {
    await sheet().getByRole("button", { name: "完成" }).click();
    await page.waitForTimeout(400);
  };
  const noticeShown = (message) => page.evaluate((m) => document.body.innerText.includes(m), message);

  try {
    // ---------------------------------------------------------- the per-song console, manual
    await page.goto(`${BASE}/p/${song1.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector('section[aria-label="時間軸"] canvas', { timeout: 90000 });
    await page.waitForTimeout(1200);
    check("manual by default: no sync capsule on the top bar", (await page.locator("[data-sync-capsule]").count()) === 0);
    await page.locator("#console-tab-sync").click();
    await page.waitForSelector("[data-sync-panel]");
    await page.waitForTimeout(400);
    const manualChecked = await page.getByRole("radio", { name: "手動", exact: true }).getAttribute("aria-checked");
    check("the 同步 tab starts on 手動", manualChecked === "true", String(manualChecked));
    const requests0 = await page.evaluate(() => window.__midi.requests.length);
    const gum0 = await page.evaluate(() => window.__gum);
    check("manual needs no MIDI or audio permission (nothing requested)", requests0 === 0 && gum0 === 0, `MIDI requests ${requests0}, microphone requests ${gum0}`);

    // ---------------------------------------------------------- the projection window
    const [output] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟投影視窗" }).first().click()]);
    watch(output, "output");
    await output.waitForURL(/\/output/);
    await output.setViewportSize({ width: 640, height: 360 });
    await output.waitForLoadState("load");
    await output.waitForTimeout(2500);
    await page.bringToFront();
    const outLast = () => output.evaluate(() => window.__last || null);
    const outText = () => output.locator("body").innerText();

    // ---------------------------------------------------------- 控制器: MIDI on, learn
    await page.locator("[data-open-controllers]").click();
    await page.waitForSelector("[data-controller-sheet]");
    await page.waitForTimeout(500);
    check("the controller sheet hides GO / standby in the per-song console", (await page.locator('[data-midi-target="go"]').count()) === 0 && (await page.locator('[data-midi-target="blackout"]').count()) === 1);
    await sheet().locator("[data-midi-switch]").click();
    const midiOn = await until(async () => (await page.locator('[data-midi-status="on"]').count()) > 0 || (await page.evaluate(() => window.__midi.requests.length)) > 0, 5000);
    const req = await page.evaluate(() => window.__midi.requests.slice());
    check("turning MIDI on asks for Web MIDI without SysEx", midiOn >= 0 && req.length >= 1 && req.every((r) => r.sysex === false), JSON.stringify(req));
    await page.locator('[data-learn="blackout"]').click();
    await page.waitForTimeout(300);
    check("學習 waits for the pad", (await attr("[data-learn-banner]", "data-learn-banner")) === "learning" && (await page.locator('[data-midi-target="blackout"][data-learning="1"]').count()) === 1);
    await shot(page, "sync-04-controller-learn");
    await midi("note", 40, 100, 0);
    await page.waitForTimeout(400);
    const bound = await page.locator('[data-midi-target="blackout"] [data-binding]').innerText().catch(() => "");
    check("hitting the pad binds 一鍵黑場 to its note and channel", /音符 E1（40）・聲道 1/.test(bound) && (await attr("[data-learn-banner]", "data-learn-banner")) === "learned", bound);
    const outAfterLearn = await outLast();
    check("the learning hit does not run the action", outAfterLearn && outAfterLearn.overrides.blackout === false, JSON.stringify(outAfterLearn && outAfterLearn.overrides));
    check("the live readout shows the last message", /音符 E1（40）按下/.test(await text("[data-midi-last]")), await text("[data-midi-last]"));
    // Esc cancels a learn, the sheet stays
    await page.locator('[data-learn="freeze"]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Esc cancels the learn and keeps the sheet open", (await page.locator("[data-controller-sheet]").count()) === 1 && (await page.locator("[data-learning]").count()) === 0);
    // a fader for 畫面強度
    await page.locator('[data-learn="intensity"]').click();
    await midi("cc", 7, 64, 0);
    await page.waitForTimeout(400);
    check("a CC binds 畫面強度", /CC 7・聲道 1/.test(await page.locator('[data-midi-target="intensity"] [data-binding]').innerText().catch(() => "")));
    // ProPresenter 式: note n → line n
    await page.locator('[data-preset="lineNotes"]').click();
    await page.waitForTimeout(300);
    check("ProPresenter 式 explains the mapping", /音符 0（C-2）→ 第 1 句/.test(await text('[data-preset-caption="lineNotes"]')), await text('[data-preset-caption="lineNotes"]'));
    // the mapping file: 匯出 JSON, then 匯入 JSON… a copy with one more binding
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-midi-export]").click()]);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    check("匯出 JSON writes the mapping file", dl.suggestedFilename() === "livelyrics-midi.json" && exported.kind === "midi-map" && exported.bindings.length === 2 && exported.lineNotes.enabled === true, JSON.stringify(exported.bindings));
    const importPath = path.join(process.env.LTC_DIR || os.tmpdir(), `livelyrics-e2e-midi-${process.pid}.json`);
    fs.writeFileSync(importPath, JSON.stringify({ ...exported, bindings: [...exported.bindings, { target: "freeze", kind: "note", channel: 0, number: 41 }] }));
    await page.locator("[data-midi-import]").setInputFiles(importPath);
    await page.waitForTimeout(500);
    const imported = await page.locator('[data-midi-target="freeze"] [data-binding]').innerText().catch(() => "");
    check("匯入 JSON… reads a mapping file", /音符 F1（41）/.test(imported) && /已匯入/.test(await text("#ctl-file-note")), `${imported} / ${await text("#ctl-file-note").catch(() => "")}`);
    fs.unlinkSync(importPath);
    await closeSheet();
    check("the mapping is remembered in this browser", await page.evaluate(() => JSON.parse(localStorage.getItem("livelyrics:midi") || "{}").map?.bindings?.length === 3));

    // ---------------------------------------------------------- the pad and the fader
    await midi("note", 40, 110, 0);
    await page.waitForTimeout(700);
    let st = await outLast();
    check("the blackout pad blacks out the projection", st && st.overrides.blackout === true, JSON.stringify(st && st.overrides.blackout));
    check("…with the console HUD", /黑場/.test(await page.locator('[role="status"]').allInnerTexts().then((t) => t.join(" "))));
    await midi("noteOff", 40, 0);
    await page.waitForTimeout(400);
    st = await outLast();
    check("its note off does nothing", st && st.overrides.blackout === true);
    await midi("note", 40, 110, 0);
    await page.waitForTimeout(600);
    st = await outLast();
    check("a second hit brings the picture back", st && st.overrides.blackout === false);
    await midi("cc", 7, 127, 0);
    await page.waitForTimeout(500);
    const hi = (await outLast())?.overrides.intensity;
    await midi("cc", 7, 0, 0);
    await page.waitForTimeout(500);
    const lo = (await outLast())?.overrides.intensity;
    await midi("cc", 7, 85, 0);
    await page.waitForTimeout(500);
    const mid = (await outLast())?.overrides.intensity;
    check("the fader moves 畫面強度 (0 → 0 %, 85 → 100 %, 127 → 150 %)", hi === 1.5 && lo === 0 && mid === 1, JSON.stringify({ hi, lo, mid }));
    // ProPresenter 式 in LIVE: note 3 cues line 3
    await page.mouse.move(5, 5);
    await page.keyboard.press("m");
    await page.waitForTimeout(400);
    await midi("note", 3, 100, 0);
    await page.waitForTimeout(900);
    st = await outLast();
    const line3 = await until(async () => shows(await outText(), lines[3].text), 5000);
    check("ProPresenter 式: note 3 cues lyric line 4 in LIVE", st && st.mode === "live" && st.lineIndex === 3 && line3 >= 0, JSON.stringify({ mode: st && st.mode, line: st && st.lineIndex }));
    await page.keyboard.press("m"); // back to TRACK
    await page.waitForTimeout(400);

    // ---------------------------------------------------------- MIDI clock at 128 BPM
    await page.getByRole("radio", { name: "MIDI clock", exact: true }).click();
    await page.waitForTimeout(300);
    check("MIDI clock waits for a signal", (await attr("[data-lock-tile]", "data-lock-tile")) === "waiting");
    await midi("startClock", 128);
    const clockLocked = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "locked", 5000);
    await page.waitForTimeout(1500);
    const bpmText = await text("[data-lock-tile] [data-sync-bpm]");
    const bpm = Number((bpmText.match(/[\d.]+/) || [])[0]);
    check("MIDI clock locks and reads ≈ 128 BPM", clockLocked >= 0 && Math.abs(bpm - 128) <= 1, bpmText);
    const capsuleClock = await text("[data-sync-capsule]");
    check("the top bar capsule shows the clock's tempo", /MIDI clock 12[78]/.test(capsuleClock), capsuleClock);
    await output.evaluate(() => {
      window.__states = [];
    });
    await page.waitForTimeout(1500);
    const beats = await output.evaluate(() => window.__states.slice());
    const phases = beats.filter((b) => b.clock).map((b) => b.beat);
    let wraps = 0;
    for (let i = 1; i < phases.length; i++) if (phases[i] < phases[i - 1] - 0.5) wraps++;
    check("the projection's beat phase advances with the clock", phases.length >= 10 && new Set(phases.map((p) => Math.round(p * 20))).size >= 6 && wraps >= 2, `${phases.length} states, ${wraps} beats in 1.5 s`);
    await shot(page, "sync-06-midi-clock");
    await midi("stopClock");
    const clockLost = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "lost", 3000);
    check("half a second without clocks: 中斷", clockLost >= 0 && clockLost < 1500, `${clockLost} ms`);
    await page.waitForTimeout(300);
    st = await outLast();
    check("the beat goes back to the audio / tap tempo", st && st.audio.clock !== true);

    // ---------------------------------------------------------- MTC chase (TRACK)
    await page.getByRole("radio", { name: "MTC", exact: true }).click();
    await page.waitForTimeout(300);
    await midi("startMtc", 1, 0, 10, 0, 25);
    const mtcLocked = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "locked", 5000);
    await page.waitForTimeout(600);
    const tc = await text("[data-lock-tile] [data-sync-tc]");
    const rate = await text("[data-lock-tile] [data-sync-rate]").catch(() => "");
    check("MTC locks: the readout runs from 01:00:10:xx at 25 fps", mtcLocked >= 0 && /^01:00:1[0-2]:\d\d$/.test(tc) && /25 fps/.test(rate), `${tc} ${rate}`);
    const songPos = await text("[data-lock-tile] [data-sync-song]");
    const secs = Number(songPos.split(":")[1]);
    check("the song follows the timecode (01:00:10:00 → 0:10)", /^0:1[0-2]/.test(songPos) && secs >= 10 && secs < 12.5, songPos);
    const played = await until(async () => {
      const s = await outLast();
      return s && s.playing && s.t >= 10 && s.t < 13;
    }, 4000);
    check("TRACK: the song plays with the timecode", played >= 0, JSON.stringify(await outLast().then((s) => s && { t: s.t, playing: s.playing })));
    const lyric = await until(async () => shows(await outText(), lines[0].text), 5000);
    check("the projection shows the lyric at that time", lyric >= 0, squash(await outText()).slice(0, 40));
    await shot(page, "sync-01-panel-locked");
    const bar = page.locator("header").first();
    await bar.screenshot({ path: path.join(SHOTS, "sync-05-topbar-capsule.png") });
    check("the capsule says MTC 鎖定", /MTC 鎖定/.test(await text("[data-sync-capsule]")), await text("[data-sync-capsule]"));
    // manual navigation waits for 回到手動
    await page.mouse.move(5, 5);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    check("a manual key is held while the timecode drives (the HUD says how to get out)", /跟隨時間碼中/.test(await page.locator('[role="status"]').allInnerTexts().then((t) => t.join(" "))));
    // a dropout: freewheel, then manual
    await midi("stopMtc");
    const fw = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "freewheel", 2000, 50);
    const fwAt = Date.now();
    check("a dropout freewheels first (自由運轉)", fw >= 0, `${fw} ms`);
    await shot(page, "sync-02-panel-freewheel");
    const lost = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "lost", 4000, 50);
    const freewheeled = Date.now() - fwAt;
    check("after the freewheel time (2 s): 中斷", lost >= 0 && freewheeled > 1500 && freewheeled < 3000, `${freewheeled} ms of freewheel`);
    await page.waitForTimeout(400);
    check("…and the console says 「時間碼中斷，已切回手動」", await noticeShown("時間碼中斷，已切回手動"));
    const atLost = await outLast();
    await page.waitForTimeout(1500);
    st = await outLast();
    check(
      "manual keeps the line on screen and the song stops (no auto-advance without the timecode)",
      st && atLost && st.playing === false && st.lineIndex === atLost.lineIndex && Math.abs(st.t - atLost.t) < 0.2,
      JSON.stringify({ playing: st && st.playing, line: st && st.lineIndex, was: atLost && atLost.lineIndex, t: st && st.t }),
    );
    await shot(page, "sync-03-panel-lost");
    // X: 回到手動
    await page.mouse.move(5, 5);
    await page.keyboard.press("x");
    await page.waitForTimeout(500);
    check("X goes back to 手動 (the capsule leaves)", (await page.getByRole("radio", { name: "手動", exact: true }).getAttribute("aria-checked")) === "true" && (await page.locator("[data-sync-capsule]").count()) === 0);

    // ---------------------------------------------------------- LTC from the (fake) microphone
    await page.getByRole("radio", { name: "LTC", exact: true }).click();
    const ltcLocked = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "locked", 8000, 50);
    // (the readouts are written on the next animation frame)
    await until(async () => /^\d\d:/.test(await text("[data-lock-tile] [data-sync-tc]")), 2000, 30);
    const ltcTc = await text("[data-lock-tile] [data-sync-tc]");
    const ltcSong = await text("[data-lock-tile] [data-sync-song]");
    const ltcRate = await text("[data-lock-tile] [data-sync-rate]").catch(() => "");
    check("LTC locks on the audio input", ltcLocked >= 0, `${ltcLocked} ms`);
    check("LTC reads 01:00:1x at 25 fps", /^01:00:1[0-4]:\d\d$/.test(ltcTc) && /25 fps/.test(ltcRate), `${ltcTc} ${ltcRate}`);
    // the chase relocates only after ~3 consistent frames (a single glitch never moves the song),
    // so the song readout can lag the TC readout for a moment: wait for it to converge
    const songSecs = (s) => Number(String(s).split(":")[1]);
    let ltcSongNow = ltcSong;
    await until(async () => {
      ltcSongNow = await text("[data-lock-tile] [data-sync-song]");
      return songSecs(ltcSongNow) >= 9.8 && songSecs(ltcSongNow) < 13;
    }, 3000, 50);
    const ltcSecs = songSecs(ltcSongNow);
    check("the song is at ≈ 10 s", ltcSecs >= 9.8 && ltcSecs < 13, `${ltcSongNow} (first read ${ltcSong})`);
    const ltcLyric = await until(async () => shows(await outText(), lines[0].text) || shows(await outText(), lines[1].text), 4000);
    const ltcOut = await outLast();
    check("the projection shows the lyric at that time", ltcLyric >= 0 && ltcOut && ltcOut.t >= 9.8 && ltcOut.t < 14.5 && (ltcOut.lineIndex === 0 || ltcOut.lineIndex === 1), JSON.stringify(ltcOut && { t: ltcOut.t, line: ltcOut.lineIndex }));
    await shot(page, "sync-07-ltc-locked");
    // the WAV's timecode ends after 5 s: freewheel, then manual
    const ltcFw = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "freewheel", 8000, 50);
    check("the LTC dropout freewheels", ltcFw >= 0);
    const ltcLost = await until(async () => (await attr("[data-lock-tile]", "data-lock-tile")) === "lost", 4000, 100);
    await page.waitForTimeout(300);
    check("…then falls back to manual with 「時間碼中斷，已切回手動」", ltcLost >= 0 && (await noticeShown("時間碼中斷，已切回手動")));
    await page.keyboard.press("x");
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check("no horizontal overflow: song console", overflow);
    await output.close().catch(() => {});

    // ---------------------------------------------------------- the show console
    await page.goto(`${BASE}/s/${show.id}/live`, { waitUntil: "networkidle" });
    await page.locator('aside[aria-label="演出清單"]').waitFor({ timeout: 90000 });
    await page.waitForTimeout(1500);
    const [showOut] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟投影視窗" }).first().click()]);
    watch(showOut, "show-output");
    await showOut.waitForURL(/\/s\/[^/]+\/output/);
    await showOut.setViewportSize({ width: 640, height: 360 });
    await showOut.waitForLoadState("load");
    await showOut.waitForTimeout(2500);
    await page.bringToFront();
    const showLast = () => showOut.evaluate(() => window.__last || null);
    const showText = () => showOut.locator("body").innerText();
    // learn GO in the show's controller sheet
    await page.locator("[data-open-sync]").click();
    await page.waitForTimeout(700);
    await shot(page, "sync-09-show-sync-sheet");
    await sheet().locator("[data-open-controllers]").click();
    await page.waitForSelector("[data-controller-sheet]");
    await page.waitForTimeout(400);
    check("the show console's controller sheet offers GO and standby", (await page.locator('[data-midi-target="go"]').count()) === 1 && (await page.locator('[data-midi-target="standby"]').count()) === 1);
    check("the blackout pad learned in the song console is here too", /音符 E1（40）/.test(await page.locator('[data-midi-target="blackout"] [data-binding]').innerText().catch(() => "")));
    await page.locator('[data-learn="go"]').click();
    await midi("note", 36, 100, 0);
    await page.waitForTimeout(400);
    check("GO learned on note 36", /音符 C1（36）/.test(await page.locator('[data-midi-target="go"] [data-binding]').innerText().catch(() => "")));
    await closeSheet();
    // a double hit (a bouncing pad: two note ons 40 ms apart, stamped when they arrive like a real
    // port does, however late the busy page gets to them) takes one item only
    await page.evaluate(() => {
      const t = performance.now();
      window.__midi.send([0x90, 36, 100], t);
      setTimeout(() => window.__midi.send([0x90, 36, 100], t + 40), 40);
    });
    await page.waitForTimeout(2000);
    const onAirRow = () => page.evaluate(() => document.querySelector('aside[aria-label="演出清單"] li [data-state="on-air"]')?.closest("li")?.dataset.itemId ?? null);
    st = await showLast();
    check("the GO pad takes the first song (a double hit only one)", (await onAirRow()) === "s1" && st && st.projectId === song1.id, JSON.stringify({ onAir: await onAirRow(), projectId: st && st.projectId }));
    await midi("note", 40, 100, 0);
    await page.waitForTimeout(700);
    st = await showLast();
    check("the blackout pad works in the show console", st && st.overrides.blackout === true);
    await midi("note", 40, 100, 0);
    await page.waitForTimeout(600);
    st = await showLast();
    check("…and brings the picture back", st && st.overrides.blackout === false);
    // 跟隨時間碼換歌: MTC in song 2's hour takes song 2
    await page.locator("#console-tab-sync").click();
    await page.waitForSelector("[data-sync-panel]");
    await page.getByRole("radio", { name: "MTC", exact: true }).click();
    await page.waitForTimeout(300);
    await page.locator("[data-follow-timecode]").click();
    await page.waitForTimeout(300);
    const mtcAt = Date.now();
    await midi("startMtc", 2, 0, 9, 0, 25);
    const took = await until(async () => (await onAirRow()) === "s2", 10000);
    check("跟隨時間碼換歌: the timecode entering 02:00:00:00 takes song 2", took >= 0, `${took} ms`);
    // song 2 plays where the timecode is (02:00:09:00 + the time since) and shows that line
    const lines2 = song2.lyrics.lines;
    let seen = null;
    const song2Line = await until(async () => {
      const s = await showLast();
      if (!s || s.projectId !== song2.id || !s.playing || s.lineIndex == null) return false;
      seen = { t: s.t, expect: 9 + (Date.now() - mtcAt) / 1000, line: s.lineIndex };
      return Math.abs(s.t - seen.expect) < 1.2 && shows(await showText(), lines2[s.lineIndex].text);
    }, 10000);
    check("song 2 follows the timecode (02:00:09:00 → 0:09) and shows that line", song2Line >= 0, JSON.stringify(seen));
    await page.waitForTimeout(500);
    await shot(page, "sync-08-show-follow");
    await midi("stopMtc");
    await page.waitForTimeout(300);
    await page.keyboard.press("x");
    await page.waitForTimeout(300);
    const tcs = await page.locator("[data-rail-tc]").allInnerTexts();
    check("the rail lists each song's start timecode while following", tcs.join(",") === "TC 01,TC 02", tcs.join(","));
    await showOut.close().catch(() => {});
  } catch (err) {
    console.log("FATAL", err);
    await shot(page, "sync-zz-fatal").catch(() => {});
    results.push({ name: "fatal", ok: false, detail: String(err) });
  }
  await browser.close();
  try {
    fs.unlinkSync(ltcPath);
  } catch {
    /* already gone */
  }
  const benign = (p) => /Download the React DevTools|favicon/.test(p);
  const real = problems.filter((p) => !benign(p));
  console.log("\n--- browser problems ---");
  for (const p of real.slice(0, 30)) console.log(p);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${real.length} browser problems`);
  process.exit(failed.length || real.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
