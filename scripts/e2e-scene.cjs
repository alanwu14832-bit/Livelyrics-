// End-to-end check of 專屬畫面 (phase 7) against a running server.
// Usage: BASE=http://localhost:3100 SHOTS=/tmp/shots node scripts/e2e-scene.cjs
//
// Creates a song through the API (the offline designer: the composer writes its scene program) and
// checks:
//   - the plan carries a scene program; the projection window and the console preview draw it
//     (data-scene-program="ready", a non-blank frame);
//   - a program the validator refuses (#extension) is refused by PATCH (400);
//   - a program that passes the validator but does not compile falls back to the section's built-in
//     scene on the output and in the preview, and the console tells the operator;
//   - LED 安全模式 still clamps a program that tries to strobe (safe mode off: > 3 flashes a second;
//     on: at most 3 and the limiter damps);
//   - the design overview: the key still renders, 「使用專屬畫面」 switches back to the built-in
//     scenes and on again (saved), 「重新產生畫面」 runs the scene step and draws another program.
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

const BASE = process.env.BASE || "http://localhost:3100";
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"];

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
    if (r.status() >= 400 && !r.url().includes("/api/projects/") ) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
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
  check("the pipeline reports the scene step", /"step":"scene"/.test(text));
  return api("GET", `/api/projects/${project.id}`);
}

/** The stage's program state inside `scope` (null when the stage has none). */
const programState = (page, scope = "") =>
  page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document;
    const el = root?.querySelector("[data-stage-backend]");
    return el ? { backend: el.getAttribute("data-stage-backend"), program: el.getAttribute("data-scene-program") } : null;
  }, scope);

async function waitProgram(page, want, timeout = 60000) {
  await page
    .waitForFunction((w) => {
      const el = document.querySelector("[data-stage-backend]");
      return el && el.getAttribute("data-scene-program") === w;
    }, want, { timeout })
    .catch(() => {});
  return programState(page);
}

/** Several colours and some light in the stage canvas (read inside frame callbacks). */
const notBlank = (page) =>
  page.evaluate(async () => {
    const el = document.querySelector("[data-stage-backend] canvas");
    if (!el) return { ok: false, why: "missing" };
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext("2d");
    let best = null;
    for (let i = 0; i < 12; i++) {
      const r = await new Promise((res) =>
        requestAnimationFrame(() => {
          ctx.drawImage(el, 0, 0, 64, 36);
          const d = ctx.getImageData(0, 0, 64, 36).data;
          const set = new Set();
          let lit = 0;
          for (let k = 0; k < d.length; k += 4) {
            set.add(`${d[k] >> 4},${d[k + 1] >> 4},${d[k + 2] >> 4}`);
            if (d[k] + d[k + 1] + d[k + 2] > 90) lit++;
          }
          res({ ok: set.size > 4 && lit > 0, colours: set.size, lit });
        }),
      );
      if (r.ok) return r;
      if (!best || r.colours > best.colours) best = r;
    }
    return best;
  });

/** Every drawing buffer is kept, so the sampler can read the WebGL canvas at any time. */
const KEEP = () => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === "webgl2" || type === "webgl") return getContext.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
    return getContext.call(this, type, attrs);
  };
};

/** Mean relative luminance of the stage every frame for `seconds`. */
const sample = (page, seconds) =>
  page.evaluate(async (secs) => {
    const el = document.querySelector("[data-stage-backend] canvas");
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 9;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const lin = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
    const out = [];
    const end = performance.now() + secs * 1000;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      ctx.drawImage(el, 0, 0, 16, 9);
      const d = ctx.getImageData(0, 0, 16, 9).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      out.push({ t: performance.now() / 1000, l: s / 144 });
    }
    return out;
  }, seconds);

/** Mirrors maxFlashesPerSecond in src/lib/stage/safety.ts (as scripts/e2e-led.cjs). */
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

/** A program that compiles nowhere (a type error), yet passes the validator. */
const BROKEN = "vec3 scene(vec2 fc) {\n  float x = vec3(1.0);\n  return uBg * x;\n}\n";
/** A program that tries to strobe the whole field four times a second. */
const STROBE = "vec3 scene(vec2 fc) {\n  return vec3(step(0.5, fract(uClock * 4.0)));\n}\n";

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultNavigationTimeout(90000);
  await context.addInitScript(KEEP);
  try {
    const song = await makeSong("專屬畫面測試");
    const id = song.id;
    const program = song.plan?.sceneProgram;
    check("the offline design carries a scene program for every section", !!program && program.sections.length === song.plan.sections.length && program.engine === "offline", program ? `${program.title} (${program.recipe})` : "none");

    // --- the projection window and the console preview draw it
    const output = await context.newPage();
    watch(output, "output");
    await output.setViewportSize({ width: 640, height: 360 });
    await output.goto(`${BASE}/p/${id}/output`, { waitUntil: "load" });
    const outState = await waitProgram(output, "ready");
    check("the projection window draws the scene program", outState?.program === "ready", JSON.stringify(outState));
    const outFrame = await notBlank(output);
    check("the projection frame is not blank", !!outFrame?.ok, JSON.stringify(outFrame));
    await shot(output, "scene-01-output");

    const consolePage = await context.newPage();
    watch(consolePage, "console");
    await consolePage.goto(`${BASE}/p/${id}`, { waitUntil: "networkidle" });
    const preState = await waitProgram(consolePage, "ready");
    check("the console preview draws the scene program", preState?.program === "ready", JSON.stringify(preState));
    await shot(consolePage, "scene-02-console");

    // --- the validator refuses a program that would reach past the contract
    const plan = song.plan;
    const refused = await fetch(`${BASE}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: { ...plan, sceneProgram: { ...program, source: `#extension GL_OES_standard_derivatives : enable\n${BROKEN}` } } }),
    });
    const refusedText = await refused.text();
    check("PATCH refuses a program the validator rejects", refused.status === 400 && /前處理/.test(refusedText), `${refused.status} ${refusedText.slice(0, 80)}`);

    // --- a program that does not compile: the built-in scenes, and the operator is told
    await api("PATCH", `/api/projects/${id}`, { plan: { ...plan, sceneProgram: { ...program, source: BROKEN, title: "壞掉的畫面" } } });
    await consolePage.reload({ waitUntil: "networkidle" });
    const brokenPreview = await waitProgram(consolePage, "failed");
    check("the console preview falls back when the program does not compile", brokenPreview?.program === "failed", JSON.stringify(brokenPreview));
    await consolePage.waitForSelector('[data-program-notice="failed"]', { timeout: 15000 }).catch(() => {});
    const notice = await consolePage.locator('[data-program-notice="failed"]').innerText().catch(() => "");
    check("the console tells the operator", notice.includes("內建場景"), notice);
    await shot(consolePage, "scene-03-console-fallback");
    const previewFrame = await consolePage.evaluate(() => document.querySelector("[data-stage-backend]")?.getAttribute("data-stage-backend"));
    check("the preview keeps rendering (the built-in scene)", previewFrame === "webgl2" || previewFrame === "webgl1", String(previewFrame));
    await output.reload({ waitUntil: "load" });
    const brokenOut = await waitProgram(output, "failed");
    const brokenFrame = await notBlank(output);
    check("the projection falls back to the built-in scene and keeps a picture", brokenOut?.program === "failed" && !!brokenFrame?.ok, `${JSON.stringify(brokenOut)} ${JSON.stringify(brokenFrame)}`);
    await shot(output, "scene-04-output-fallback");
    await consolePage.goto("about:blank");

    // --- LED 安全模式 clamps a program that tries to strobe
    const strobePlan = { ...plan, sceneProgram: { ...program, source: STROBE, title: "閃爍測試" } };
    await api("PATCH", `/api/projects/${id}`, { plan: strobePlan, output: { safety: { enabled: false } } });
    await output.reload({ waitUntil: "load" });
    await waitProgram(output, "ready");
    await output.waitForTimeout(1200);
    const off = await sample(output, 4);
    const offFps = off.length / 4;
    const offFlashes = maxFlashesPerSecond(off);
    check("without safe mode the strobing program flashes more than 3 times a second", offFlashes > 3, `${offFlashes} flashes/s at ${offFps.toFixed(1)} fps`);
    await api("PATCH", `/api/projects/${id}`, { output: { safety: { enabled: true } } });
    await output.reload({ waitUntil: "load" });
    await waitProgram(output, "ready");
    await output.waitForTimeout(2500);
    const on = await sample(output, 5);
    const onFps = on.length / 5;
    const onFlashes = maxFlashesPerSecond(on);
    const limiter = await output.evaluate(() => {
      const el = document.querySelector("[data-safety]");
      return { safety: el?.getAttribute("data-safety"), limiter: el?.getAttribute("data-limiter"), engaged: Number(el?.getAttribute("data-limiter-engaged") ?? 0) };
    });
    const peakOn = Math.max(...on.map((s) => s.l));
    const peakOff = Math.max(...off.map((s) => s.l));
    console.log(`strobe program: off ${offFlashes} flashes/s (peak ${peakOff.toFixed(3)}), on ${onFlashes} flashes/s (peak ${peakOn.toFixed(3)}) at ${onFps.toFixed(1)} fps, ${JSON.stringify(limiter)}`);
    check("with safe mode on the strobing program flashes at most 3 times a second", onFlashes <= 3 && onFps >= 10, `${onFlashes} flashes/s at ${onFps.toFixed(1)} fps`);
    check("the limiter engaged on the program's strobe", limiter.engaged > 0, JSON.stringify(limiter));
    check("the brightness cap lowers the program's peak", peakOn < peakOff - 0.1, `${peakOn.toFixed(3)} vs ${peakOff.toFixed(3)}`);
    await output.close();

    // --- the design overview: key still, switch back to the built-in scenes, regenerate
    await api("PATCH", `/api/projects/${id}`, { plan });
    const page = await context.newPage();
    watch(page, "process");
    await page.goto(`${BASE}/p/${id}/process`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="scene-panel"]', { timeout: 30000 });
    await page.locator('[data-testid="scene-panel"]').scrollIntoViewIfNeeded();
    await page.waitForSelector('[data-testid="scene-still"]', { timeout: 90000 }).catch(() => {});
    const still = await page.evaluate(async () => {
      const img = document.querySelector('[data-testid="scene-still"]');
      if (!img) return null;
      await img.decode().catch(() => {});
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 18;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return { w: img.naturalWidth, h: img.naturalHeight, colours: set.size };
    });
    check("the design overview shows the key still of the program", !!still && still.w > 0 && still.colours > 6, JSON.stringify(still));
    await shot(page, "scene-05-overview");
    const toggle = page.locator('[data-testid="scene-toggle"]');
    await toggle.click();
    await page.waitForTimeout(1500);
    const offSaved = await api("GET", `/api/projects/${id}`);
    check("「使用專屬畫面」 off is saved (the built-in scenes)", offSaved.plan?.sceneProgram?.enabled === false && offSaved.plan.sceneProgram.source === program.source);
    const offView = await context.newPage();
    await offView.setViewportSize({ width: 480, height: 270 });
    await offView.goto(`${BASE}/p/${id}/output`, { waitUntil: "load" });
    await offView.waitForTimeout(2500);
    const offProgram = await programState(offView);
    check("with the program switched off the projection draws the built-in scenes", offProgram && offProgram.program == null, JSON.stringify(offProgram));
    await offView.close();
    await page.locator('[data-testid="scene-toggle"]').click();
    await page.waitForTimeout(1500);
    const onSaved = await api("GET", `/api/projects/${id}`);
    check("and on again", onSaved.plan?.sceneProgram?.enabled === true);
    await page.locator('[data-testid="scene-regenerate"]').click();
    await page.waitForSelector("dialog[open]", { timeout: 5000 });
    await page.locator("dialog[open] textarea").fill("更安靜、留白更多");
    await shot(page, "scene-06-regenerate-sheet");
    await page.locator('[data-testid="scene-regenerate-go"]').click();
    let regenerated = null;
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(1000);
      const p = await api("GET", `/api/projects/${id}`);
      if (p.status === "ready" && p.plan?.sceneProgram && p.plan.sceneProgram.recipe !== program.recipe) {
        regenerated = p;
        break;
      }
    }
    check("「重新產生畫面」 draws another program (offline: the composer's next draw)", !!regenerated && regenerated.plan.sceneProgram.source !== program.source, regenerated ? `${program.recipe} → ${regenerated.plan.sceneProgram.recipe}` : "not regenerated");
    await page.waitForTimeout(1500);
    await shot(page, "scene-07-regenerated");
  } catch (e) {
    check("script ran to the end", false, e.stack || String(e));
  } finally {
    await browser.close();
  }
  // the deliberate compile failure is logged by the stage (expected)
  const benign = (p) => /Download the React DevTools|favicon|專屬畫面|program:|編譯失敗|compile/i.test(p);
  const real = problems.filter((p) => !benign(p));
  console.log("\n--- browser problems ---");
  for (const p of real.slice(0, 30)) console.log(p);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed, ${real.length} browser problems`);
  process.exit(passed === results.length && real.length === 0 ? 0 : 1);
})();
