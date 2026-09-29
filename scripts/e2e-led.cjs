// End-to-end check of LED 安全模式 (phase 3) against a running server.
// Usage: BASE=http://localhost:3110 SHOTS=/tmp/shots node scripts/e2e-led.cjs
//
// Creates a song through the API and gives it a deliberately dangerous design: 30 s of sections that
// alternate every 0.25 s between a full-white field and black, each entering with a `flash`
// transition, over a fully audio-reactive scene. Then, in the per-song console and its projection
// window, it measures the projection's composited canvas every frame (drawn into a 16 × 9 2D canvas,
// mean WCAG relative luminance) and checks:
//   - turning safe mode off asks first (the confirm dialog), and the capsule turns orange;
//   - with safe mode off the output flashes more than 3 times a second;
//   - with safe mode on (default) it flashes at most 3 times a second, and the console says
//     「已抑制閃爍」;
//   - the brightness presets lower the peak luminance (室內 100 % > LED 牆 70 % > 戶外 55 %);
//   - LED 模擬 appears on the console preview only, never in the projection window;
//   - the pre-show check lists the sections safe mode changes; the export page applies it by default.
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
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3110";
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");

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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial" });

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function makeSong(title) {
  const form = new FormData();
  form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
  form.set("meta", JSON.stringify({ title, artist: "示範樂團", duration: 73 }));
  form.set("analysis", "null");
  const res = await fetch(`${BASE}/api/projects`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`create ${title}: ${res.status}`);
  const project = await res.json();
  const run = await fetch(`${BASE}/api/projects/${project.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: LRC }) });
  const text = await run.text();
  if (!/"type":"done"/.test(text)) throw new Error(`process ${title} did not finish: ${text.slice(-300)}`);
  return api("GET", `/api/projects/${project.id}`);
}

/**
 * The flashy design: 1–16 s alternates white / black every 0.125 s (4 flashes a second), the white
 * sections entering with a `flash` transition (safe mode turns those into fades: source-level
 * safety); 16–31 s is the same strobe with hard cuts only (safe mode keeps cuts: the limiter must
 * catch it); then a steady white field and a calm outro.
 */
function flashyPlan(plan) {
  const base = plan.sections[0];
  const mk = (i, start, end, patch) => ({
    ...base,
    id: `s${i}`,
    kind: "chorus",
    start,
    end,
    energy: 1,
    lyricStyle: "hidden",
    media: null,
    rationale: "e2e",
    ...patch,
  });
  const sections = [mk(0, 0, 1, { label: "開場", scene: "gradient", colorway: ["#101018", "#303048", "#505070"], transitionIn: "fade" })];
  const STEP = 0.125;
  let i = 1;
  let cutStart = -1;
  for (let k = 0; k < 240; k++) {
    const t = 1 + k * STEP;
    const white = k % 2 === 0;
    const cutPart = t >= 16 - 1e-6;
    if (cutPart && cutStart < 0) cutStart = i;
    sections.push(
      mk(i, t, t + STEP, {
        label: `${cutPart ? "硬切" : "閃白"}${white ? "白" : "黑"} ${i}`,
        scene: white ? "gradient" : "blackout",
        colorway: white ? ["#ffffff", "#ffffff", "#ffffff"] : ["#000000", "#000000", "#000000"],
        sceneParams: { speed: 1, density: 1, intensity: 1, audioReactivity: 1 },
        transitionIn: white && !cutPart ? "flash" : "cut",
        lyricColor: white ? "#000000" : "#ffffff",
      }),
    );
    i++;
  }
  const whiteHold = i;
  sections.push(mk(i, 31, 45, { label: "白場", scene: "gradient", colorway: ["#ffffff", "#ffffff", "#ffffff"], sceneParams: { speed: 0.1, density: 0.2, intensity: 1, audioReactivity: 0 }, transitionIn: "cut", lyricColor: "#000000" }));
  sections.push(mk(i + 1, 45, 73, { label: "尾聲", scene: "nebula", colorway: base.colorway, transitionIn: "fade", lyricStyle: "line-fade" }));
  return { plan: { ...plan, sections, lines: [], cues: [] }, whiteHold, cutStart };
}

/** Mirrors maxFlashesPerSecond in src/lib/stage/safety.ts. */
function maxFlashesPerSecond(samples) {
  const events = [];
  let dir = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let ext = 0;
  const flip = (d, l, t) => {
    dir = d;
    ext = l;
    events.push(t);
  };
  for (const { t, l } of samples) {
    if (dir === 0) {
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
      if (l - lo >= 0.1 && lo < 0.8) flip(1, l, t);
      else if (hi - l >= 0.1 && l < 0.8) flip(-1, l, t);
    } else if (dir === 1) {
      if (l > ext) ext = l;
      else if (ext - l >= 0.1 && l < 0.8) flip(-1, l, t);
    } else {
      if (l < ext) ext = l;
      else if (l - ext >= 0.1 && ext < 0.8) flip(1, l, t);
    }
  }
  let best = 0;
  let j = 0;
  for (let k = 0; k < events.length; k++) {
    while (events[k] - events[j] >= 1) j++;
    best = Math.max(best, k - j + 1);
  }
  return best / 2;
}

// the sampler: every frame, the projection canvas into a 16 × 9 canvas, mean relative luminance
const SAMPLER = () => {
  if (window.__sampler || !/\/output$/.test(location.pathname)) return;
  // keep the WebGL frame readable after it was presented (only this test's projection window)
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === "webgl2" || type === "webgl") return getContext.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
    return getContext.call(this, type, attrs);
  };
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 9;
  c.dataset.sampler = "";
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  window.__samples = [];
  window.__sampling = false;
  window.__sampler = true;
  // the console's last playing state (the test re-sends it once the console has left)
  const id = location.pathname.split("/")[2];
  const listen = new BroadcastChannel(`livelyrics:${id}`);
  listen.onmessage = (e) => {
    if (e.data?.type === "state" && e.data.state?.playing) window.__lastPlaying = e.data.state;
  };
  const tick = () => {
    requestAnimationFrame(tick);
    if (!window.__sampling) return;
    const src = [...document.querySelectorAll("canvas")].find((x) => x.dataset.sampler == null && x.width > 1);
    if (!src || getComputedStyle(src).visibility === "hidden") return;
    ctx.clearRect(0, 0, 16, 9);
    ctx.drawImage(src, 0, 0, 16, 9);
    const d = ctx.getImageData(0, 0, 16, 9).data;
    let s = 0;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      s += l;
      if (l > max) max = l;
    }
    window.__samples.push({ t: performance.now() / 1000, l: s / 144, max });
  };
  requestAnimationFrame(tick);
};

async function measure(popup, seconds) {
  await popup.evaluate(() => {
    window.__samples = [];
    window.__sampling = true;
  });
  await popup.waitForTimeout(seconds * 1000);
  const samples = await popup.evaluate(() => {
    window.__sampling = false;
    return window.__samples;
  });
  const dur = samples.length > 1 ? samples.at(-1).t - samples[0].t : 0;
  return {
    samples,
    fps: dur > 0 ? (samples.length - 1) / dur : 0,
    flashes: maxFlashesPerSecond(samples),
    mean: samples.reduce((a, s) => a + s.l, 0) / Math.max(1, samples.length),
    peak: samples.reduce((a, s) => Math.max(a, s.max), 0),
  };
}

(async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  context.setDefaultNavigationTimeout(90000);
  try {
    const song = await makeSong("閃爍測試");
    check("new projects start with LED safe mode on (LED 牆 70%)", song.output?.safety?.enabled === true && song.output.safety.preset === "led" && song.output.safety.brightness === 0.7, JSON.stringify(song.output?.safety));
    const { plan, whiteHold, cutStart } = flashyPlan(song.plan);
    await api("PATCH", `/api/projects/${song.id}`, { plan });

    const page = await context.newPage();
    watch(page, "console");
    await page.goto(`${BASE}/p/${song.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector('section[aria-label="時間軸"] canvas', { timeout: 60000 });
    await page.waitForTimeout(1500);

    // top bar capsule
    const capsule = page.locator("[data-safety-capsule]");
    check("top bar shows the LED 安全 capsule", (await capsule.innerText()).includes("LED 安全 70%"), await capsule.innerText());

    // the control tab
    await page.getByRole("tab", { name: "控制" }).click();
    await page.waitForTimeout(400);
    check("control tab shows the LED 安全 tile with the safety controls", (await page.locator('[data-safety-tile="on"]').count()) === 1);
    check("control tab shows the LED 安全模式 settings", (await page.locator("[data-safety-settings]").count()) === 1);

    // the projection window, small so SwiftShader keeps a usable frame rate
    await context.addInitScript(SAMPLER);
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /開啟投影視窗/ }).click()]);
    watch(popup, "output");
    await popup.waitForURL(/\/output/);
    await popup.setViewportSize({ width: 480, height: 270 });
    await popup.waitForLoadState("load");
    await popup.evaluate(SAMPLER);
    await popup.waitForTimeout(2500);
    await page.bringToFront();
    await shot(page, "led-01-console-safety");

    // --- safe mode OFF needs a confirm
    await page.locator("[data-safety-switch]").click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor({ timeout: 5000 });
    const dialogText = await dialog.innerText();
    check("turning safe mode off asks first", dialogText.includes("關閉 LED 安全模式") && dialogText.includes("光敏性癲癇"), dialogText.replace(/\s+/g, " ").slice(0, 80));
    await page.waitForTimeout(400);
    await shot(page, "led-02-confirm-off");
    await dialog.getByRole("button", { name: "取消" }).click();
    await page.waitForTimeout(300);
    check("cancel keeps safe mode on", (await page.locator('[data-safety-tile="on"]').count()) === 1);
    await page.locator("[data-safety-switch]").click();
    await page.locator("dialog[open]").getByRole("button", { name: "仍要關閉" }).click();
    await page.waitForTimeout(800);
    check("capsule turns into the orange warning", (await capsule.getAttribute("data-safety-capsule")) === "off" && (await capsule.innerText()).includes("已關閉"), await capsule.innerText());
    const outSafetyOff = await popup.evaluate(() => document.querySelector("[data-safety]")?.getAttribute("data-safety"));

    // The console and the projection share one SwiftShader GPU process here, so both crawl at
    // ~8 fps while the console is open. The projection extrapolates a playing state on its own, so
    // each measurement starts playback in the console, then parks the console on about:blank and
    // samples the projection window alone (its limiter runs there, fed by nothing but the design).
    const openConsole = async () => {
      await page.goto(`${BASE}/p/${song.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector('section[aria-label="時間軸"] canvas', { timeout: 60000 });
      await page.waitForTimeout(1200);
      await page.getByRole("tab", { name: "控制" }).click();
      await page.waitForTimeout(300);
    };
    const playStrobeAlone = async (seconds, section = 1) => {
      await page.locator(`button[data-section-index="${section}"]`).click();
      await page.waitForTimeout(300);
      await page.keyboard.press("Space");
      await page.waitForTimeout(700);
      // the console leaves (its last message pauses the output); the test then stands in for it
      // with one "still playing" state on the same channel, and the output extrapolates from there
      await page.goto("about:blank");
      await popup.evaluate((id) => {
        const last = window.__lastPlaying;
        if (!last) return;
        const now = Date.now();
        const t = last.t + (now - last.sentAt) / 1000;
        const ch = new BroadcastChannel(`livelyrics:${id}`);
        // sectionIndex null: the output derives the section from the extrapolated time
        ch.postMessage({ type: "state", state: { ...last, t, playing: true, sentAt: now, sectionIndex: null, lineIndex: null } });
        ch.close();
      }, song.id);
      await popup.waitForTimeout(1200);
      if (process.env.DEBUG_LED) console.log("output after the console left:", await popup.evaluate(() => JSON.stringify({ last: window.__lastPlaying && { t: window.__lastPlaying.t, playing: window.__lastPlaying.playing }, attrs: document.querySelector("[data-safety]")?.dataset })));
      return measure(popup, seconds);
    };
    const outputState = () =>
      popup.evaluate(() => {
        const el = document.querySelector("[data-safety]");
        return { safety: el?.getAttribute("data-safety"), limiter: el?.getAttribute("data-limiter"), engaged: Number(el?.getAttribute("data-limiter-engaged") ?? 0) };
      });

    // play the strobe section without protection
    await page.waitForTimeout(1200); // the output setting is saved after a short pause
    const off = await playStrobeAlone(5);
    const offState = await outputState();
    console.log(`safe OFF: ${off.samples.length} samples, ${off.fps.toFixed(1)} fps, ${off.flashes} flashes/s, peak ${off.peak.toFixed(3)}`);
    check("the output window applies safe mode off", offState.safety === "off", `data-safety=${outSafetyOff} → ${offState.safety}`);
    check("sampling rate is usable (≥ 14 fps)", off.fps >= 14, `${off.fps.toFixed(1)} fps`);
    check("without safe mode the flashy design flashes more than 3 times a second", off.flashes > 3, `${off.flashes} flashes/s`);

    // --- safe mode back ON (no confirm), default LED 牆 70 %
    await openConsole();
    check("safe mode off was saved with the song", (await capsule.getAttribute("data-safety-capsule")) === "off");
    await page.locator("[data-safety-switch]").click();
    await page.waitForTimeout(800);
    check("turning safe mode on needs no confirm", (await page.locator("dialog[open]").count()) === 0 && (await page.locator('[data-safety-tile="on"]').count()) === 1);
    // with the console open: the operator sees the limiter at work (the hard-cut strobe)
    await page.locator(`button[data-section-index="${cutStart}"]`).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");
    let consoleDamping = false;
    let statusText = "";
    for (let k = 0; k < 20 && !(consoleDamping && /\d+ 次/.test(statusText)); k++) {
      await page.waitForTimeout(500);
      consoleDamping ||= (await page.locator("[data-limiter-label]").count()) > 0 || (await capsule.getAttribute("data-safety-capsule")) === "damping";
      statusText = await page.locator("[data-limiter-status]").innerText().catch(() => "");
    }
    await shot(page, "led-03-console-damping");
    await page.keyboard.press("Space");
    check("the console says 「已抑制閃爍」 while the limiter damps", consoleDamping, statusText.replace(/\s+/g, " "));
    check("the control tab counts the damping per section", /正在抑制閃爍|已抑制閃爍 \d+ 次/.test(statusText) && /\d+ 次/.test(statusText), statusText.replace(/\s+/g, " "));
    await page.waitForTimeout(1200);
    const on = await playStrobeAlone(5);
    console.log(`safe ON, flash strobe: ${on.samples.length} samples, ${on.fps.toFixed(1)} fps, ${on.flashes} flashes/s, peak ${on.peak.toFixed(3)}`);
    check("with safe mode on the flash-transition strobe flashes at most 3 times a second", on.flashes <= 3 && on.fps >= 14, `${on.flashes} flashes/s at ${on.fps.toFixed(1)} fps (off: ${off.flashes})`);
    check("the brightness cap lowers the strobe's peak", on.peak < off.peak - 0.2, `peak ${on.peak.toFixed(3)} vs ${off.peak.toFixed(3)}`);
    // the hard-cut strobe: nothing to soften at the source, the limiter has to damp it
    await openConsole();
    const before = (await outputState()).engaged;
    const cut = await playStrobeAlone(5, cutStart);
    const limiterOut = await outputState();
    console.log(`safe ON, cut strobe: ${cut.samples.length} samples, ${cut.fps.toFixed(1)} fps, ${cut.flashes} flashes/s, output ${JSON.stringify(limiterOut)} (engaged before ${before})`);
    check("with safe mode on the hard-cut strobe flashes at most 3 times a second", cut.flashes <= 3 && cut.fps >= 14, `${cut.flashes} flashes/s at ${cut.fps.toFixed(1)} fps`);
    check("the output's limiter engaged on the hard-cut strobe", limiterOut.safety === "70" && limiterOut.engaged > 0 && limiterOut.limiter === "damping", JSON.stringify(limiterOut));
    await openConsole();

    // --- brightness cap on a steady white field
    await page.locator(`button[data-section-index="${whiteHold}"]`).click();
    await page.waitForTimeout(2500);
    const levels = {};
    for (const [name, label] of [
      ["indoor", "室內投影 100%"],
      ["led", "LED 牆 70%"],
      ["outdoor", "戶外強光 LED 55%"],
    ]) {
      await page.getByRole("radio", { name: label }).click();
      await page.waitForTimeout(1500);
      levels[name] = (await measure(popup, 1.2)).mean;
    }
    console.log("white field mean luminance:", JSON.stringify(levels));
    check("the brightness presets lower the peak luminance", levels.indoor > levels.led + 0.1 && levels.led > levels.outdoor + 0.05, JSON.stringify(levels));
    check("LED 牆 70% caps a white field near 0.7 × the indoor level", Math.abs(levels.led / levels.indoor - 0.7) < 0.12, (levels.led / levels.indoor).toFixed(3));
    await page.getByRole("radio", { name: "LED 牆 70%" }).click();

    // --- LED 模擬 (console only)
    await page.locator("[data-led-sim-toggle]").click();
    await page.waitForTimeout(1200);
    check("LED 模擬 shows on the console preview", (await page.locator('[data-led-sim="on"]').count()) === 1 && (await page.locator("[data-led-grid]").count()) === 1);
    const res = await page.locator("[data-led-sim-res]").innerText().catch(() => "");
    check("LED 模擬 names the wall's LED resolution", /\d+ × \d+ 顆/.test(res), res);
    const outSim = await popup.evaluate(() => document.querySelectorAll("[data-led-sim], [data-led-grid], [data-led-sim-toggle]").length);
    check("LED 模擬 never reaches the projection window", outSim === 0, `${outSim} elements`);
    // a lyric on screen to judge legibility (the outro's line-fade)
    const lines = song.lyrics.lines;
    let hey = -1;
    lines.forEach((l, k) => {
      if (l.text.startsWith("Hey") && l.start >= 45) hey = k;
    });
    await page.locator(`[role="option"][data-line-index="${hey}"]`).click();
    await page.waitForTimeout(3000);
    await shot(page, "led-04-led-sim");
    await page.locator("[data-led-sim-toggle]").click();

    // --- pre-show check in the design tab
    await page.getByRole("tab", { name: "設計" }).click();
    await page.waitForTimeout(600);
    const checkText = await page.locator("[data-safety-check]").innerText();
    check("the pre-show check summarizes what safe mode changes", /60 段閃白或光暈轉場改為淡入/.test(checkText) && /閃白轉場改為淡入/.test(checkText), checkText.replace(/\s+/g, " ").slice(0, 90));
    // scroll only the side panel (scrollIntoView would also shift the pane under its tab bar)
    await page.locator("[data-safety-check]").evaluate((el) => {
      let p = el.parentElement;
      while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
      if (p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 8;
    });
    await page.waitForTimeout(300);
    await shot(page, "led-05-preshow-check");
    await page.locator("[data-safety-more]").click();
    const rows = await page.locator("[data-safety-row]").count();
    check("the pre-show check lists every changed section", rows >= 240, `${rows} rows`);

    // --- export page: safe by default, off only after a confirm
    const exp = await context.newPage();
    watch(exp, "export");
    await exp.goto(`${BASE}/p/${song.id}/export`, { waitUntil: "networkidle" });
    await exp.waitForSelector("#export-safe", { timeout: 60000 });
    check("the export applies LED safe mode by default", (await exp.locator("#export-safe").getAttribute("aria-checked")) === "true");
    await exp.locator("#export-safe").click();
    await exp.locator("dialog[open]").waitFor({ timeout: 5000 });
    const expDialog = await exp.locator("dialog[open]").innerText();
    check("exporting without the limiter asks first", expDialog.includes("匯出沒有 LED 安全保護的影片"), expDialog.replace(/\s+/g, " ").slice(0, 60));
    await exp.waitForTimeout(400);
    await shot(exp, "led-06-export-confirm");
    await exp.locator("dialog[open]").getByRole("button", { name: "取消" }).click();
    await exp.waitForTimeout(300);
    check("cancel keeps the export safe", (await exp.locator("#export-safe").getAttribute("aria-checked")) === "true");
    // the offline renderer runs the same limiter (zero lag, deterministic): a frame inside the
    // hard-cut strobe comes out as the damped grey, and the same frame renders identically twice
    const previewAt = async (time) => {
      await exp.locator("#preview-time").fill(time);
      await exp.getByRole("button", { name: "單格預覽" }).click();
      await exp.waitForSelector('button[aria-busy="true"]', { timeout: 5000 }).catch(() => {});
      await exp.waitForFunction(() => document.querySelector("img[data-export-preview]") && !document.querySelector('button[aria-busy="true"]'), null, { timeout: 120000 });
      await exp.waitForTimeout(500);
      return exp.evaluate(async () => {
        const img = document.querySelector("img[data-export-preview]");
        await img.decode();
        const c = document.createElement("canvas");
        c.width = 32;
        c.height = 18;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 32, 18);
        const d = ctx.getImageData(0, 0, 32, 18).data;
        const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        return { src: img.src, l: sum / (d.length / 4) };
      });
    };
    const first = await previewAt("0:20.00");
    const again = await previewAt("0:20.00");
    console.log(`export preview at 20 s: mean luminance ${first.l.toFixed(3)}`);
    check("the export's limiter damps the hard-cut strobe (a grey frame, not black or white)", first.l > 0.02 && first.l < 0.45, first.l.toFixed(3));
    check("the export renders the same limited frame again (deterministic)", first.src === again.src, `${first.src.length} / ${again.src.length} bytes`);
    await exp.locator("#export-safe").evaluate((el) => {
      const group = el.closest("section") ?? el;
      window.scrollBy(0, group.getBoundingClientRect().top - 72);
    });
    await exp.waitForTimeout(300);
    await shot(exp, "led-07-export-check");
  } catch (e) {
    check("script ran to the end", false, e.stack || String(e));
  } finally {
    await browser.close();
  }
  const benign = (p) => /Download the React DevTools|favicon/.test(p);
  const real = problems.filter((p) => !benign(p));
  console.log("\n--- browser problems ---");
  for (const p of real.slice(0, 30)) console.log(p);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed, ${real.length} browser problems`);
  process.exit(passed === results.length && real.length === 0 ? 0 : 1);
})();
