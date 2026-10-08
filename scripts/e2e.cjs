// End-to-end smoke test of the whole Livelyrics flow on an isolated dev server.
// Usage: start a dev server (e.g. on :3110), then `BASE=http://localhost:3110 SHOTS=/tmp/shots node scripts/e2e.cjs`.
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
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");

const problems = [];
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      const text = m.text();
      // SwiftShader's own performance note (GPU stall due to ReadPixels) is the test GPU's, not the app's
      if (/GL Driver Message/.test(text)) return;
      problems.push(`[${label}] console.${m.type()}: ${text}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    // aborted media range requests / SSE closes are normal
    if (!/ERR_ABORTED/.test(f)) problems.push(`[${label}] requestfailed: ${r.url()} ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}
// UI-AUDIT §4: no page, in any state, scrolls sideways (the new-project card neither).
const noOverflow = (page, selector) =>
  page.evaluate((sel) => {
    const d = document.documentElement;
    const el = sel ? document.querySelector(sel) : null;
    return { ok: d.scrollWidth <= d.clientWidth && (!el || el.scrollWidth <= el.clientWidth), page: `${d.scrollWidth}/${d.clientWidth}`, el: el ? `${el.scrollWidth}/${el.clientWidth}` : "-" };
  }, selector ?? null);
async function checkOverflow(page, name, selector) {
  const r = await noOverflow(page, selector);
  check(`no horizontal overflow: ${name}`, r.ok, `page ${r.page} card ${r.el}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial" });

(async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // a cold dev compile of a route can take longer than Playwright's 30 s default
  context.setDefaultNavigationTimeout(90000);
  const page = await context.newPage();
  watch(page, "home");
  try {
    // ---------------------------------------------------------------- home
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "01-home");
    check("home renders brand", (await page.locator("body").innerText()).includes("Livelyrics"));

    await page.setInputFiles('input[aria-label="選擇音檔"]', path.join(REPO, "fixtures/demo-song.wav"));
    await page.waitForSelector('section[aria-label="新作品"]', { timeout: 60000 });
    const cardText = await page.locator('section[aria-label="新作品"]').innerText();
    check("analysis finished: 120 BPM shown", /120/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
    await page.locator("label", { hasText: "貼上歌詞" }).first().click();
    await page.fill('textarea[aria-label="貼上歌詞"]', LRC);
    await page.waitForTimeout(400);
    const titleValue = await page.locator('section[aria-label="新作品"] input[required]').inputValue();
    check("LRC [ti:]/[ar:] tags fill the song info", titleValue === "示範之歌", `title=${titleValue}`);
    await shot(page, "02-home-new-project");
    await checkOverflow(page, "new project card", 'section[aria-label="新作品"]');

    await page.getByRole("button", { name: /開始製作/ }).click();
    await page.waitForURL(/\/p\/[^/]+\/process/, { timeout: 90000 });
    const id = page.url().match(/\/p\/([^/?]+)\/process/)[1];
    console.log("project id", id);

    // ------------------------------------------------------------- process
    await page.getByRole("status").filter({ hasText: "設計完成" }).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(2500);
    await shot(page, "03-process-done");
    await checkOverflow(page, "design overview");
    check("process url stripped of run=1", !/run=1/.test(page.url()), page.url());
    const project = await (await fetch(`${BASE}/api/projects/${id}`)).json();
    check("project ready with plan", project.status === "ready" && !!project.plan, `status=${project.status} sections=${project.plan?.sections?.length}`);

    // ------------------------------------------------------------- a big upload (B1)
    // A 24 MB silent WAV through the same multipart route: over the proxy's old 10 MB body limit a
    // real 4-minute WAV was cut short and refused as 「上傳內容不完整」.
    {
      const seconds = 285;
      const rate = 44100;
      const dataBytes = seconds * rate * 2;
      const wav = Buffer.alloc(44 + dataBytes);
      wav.write("RIFF", 0);
      wav.writeUInt32LE(36 + dataBytes, 4);
      wav.write("WAVE", 8);
      wav.write("fmt ", 12);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(rate, 24);
      wav.writeUInt32LE(rate * 2, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(dataBytes, 40);
      const form = new FormData();
      form.set("audio", new Blob([wav], { type: "audio/wav" }), "silent-24mb.wav");
      form.set("meta", JSON.stringify({ title: "大檔上傳測試", artist: "示範樂團", duration: seconds }));
      form.set("analysis", "null");
      const res = await fetch(`${BASE}/api/projects`, { method: "POST", body: form });
      const body = await res.text();
      let big = null;
      try {
        big = JSON.parse(body);
      } catch {
        /* not JSON */
      }
      check(`a ${(wav.length / 1024 / 1024).toFixed(0)} MB WAV uploads and gets a project back`, res.status === 201 && !!big?.id, `${res.status} ${body.slice(0, 120)}`);
      if (big?.id) {
        const audio = await fetch(`${BASE}/api/projects/${big.id}/audio`, { method: "HEAD" }).catch(() => null);
        const len = Number(audio?.headers.get("content-length") ?? 0);
        check("the whole file arrived (the audio route serves every byte)", !!audio && audio.ok && len === wav.length, `${audio?.status} ${len}/${wav.length}`);
        await fetch(`${BASE}/api/projects/${big.id}`, { method: "DELETE" }).catch(() => {});
      }
    }
    check("lyrics saved from paste (14 synced lines)", project.lyrics.lines.length === 14 && project.lyrics.synced, `${project.lyrics.lines.length} lines synced=${project.lyrics.synced}`);
    check("analysis stored", !!project.analysis && Math.round(project.analysis.bpm) === 120, `bpm=${project.analysis?.bpm}`);
    check(
      "the analysis carries a 人聲 curve on its envelope grid (round 14)",
      Array.isArray(project.analysis?.vocal) && project.analysis.vocal.length === project.analysis.energy.length,
      `vocal ${project.analysis?.vocal?.length} / energy ${project.analysis?.energy?.length}`,
    );

    // ------------------------------------------------------------- console
    await page.goto(`${BASE}/p/${id}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[role="option"][data-line-index="0"]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot(page, "04-console");
    await checkOverflow(page, "console");
    const consoleText = await page.locator("body").innerText();
    check("console shows design panel", /主視覺|設計/.test(consoleText));
    check("console shows sections", /主歌|副歌/.test(consoleText));
    const timelineCanvas = await page.locator('section[aria-label="時間軸"] canvas').count();
    check("timeline canvas present", timelineCanvas > 0, `${timelineCanvas} canvas`);

    // ------------------------------------------------------------- output
    await context.addInitScript(() => {
      const m = location.pathname.match(/^\/p\/([^/]+)\/output/);
      if (!m) return;
      const ch = new BroadcastChannel(`livelyrics:${m[1]}`);
      window.__states = 0;
      ch.onmessage = (e) => {
        if (e.data?.type === "state") {
          window.__last = e.data.state;
          window.__states++;
        }
      };
    });
    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: /開啟投影視窗/ }).click()]);
    watch(popup, "output");
    await popup.waitForURL(/\/output/);
    await popup.waitForLoadState("load");
    await popup.waitForTimeout(3000);
    await shot(popup, "05-output-idle");
    await page.bringToFront();
    await page.waitForTimeout(500);
    const connected = (await page.locator("body").innerText()).includes("投影已連線");
    check("console shows output connected", connected);

    // play
    await page.keyboard.press("Space");
    await page.waitForTimeout(10000);
    // read the output clock on both sides of the console read: playback keeps running meanwhile
    const t = await popup.evaluate(() => window.__last?.t ?? -1);
    const cur = await page.locator('[role="option"][aria-current="true"]').first().innerText().catch(() => "");
    const tAfter = await popup.evaluate(() => window.__last?.t ?? -1);
    const outText = await popup.locator("body").innerText();
    console.log("t after 10 s:", t, "console current:", cur.replace(/\s+/g, " "), "| output:", outText.replace(/\s+/g, " ").slice(0, 80));
    const lines = project.lyrics.lines;
    const expected = lines.filter((l) => l.start != null && l.start <= t).at(-1);
    const expectedAfter = lines.filter((l) => l.start != null && l.start <= tAfter).at(-1);
    check("playing advances clock", t > 7, `t=${t.toFixed?.(2)}`);
    check(
      "console highlights line for current time",
      (!!expected && cur.includes(expected.text)) || (!!expectedAfter && cur.includes(expectedAfter.text)),
      `expected「${expected?.text}」`,
    );
    check("output shows the lyric line", !!expected && outText.replace(/\s+/g, "").includes(expected.text.replace(/\s+/g, "").slice(0, 4)), outText.slice(0, 60));
    await shot(popup, "06-output-playing");
    await shot(page, "07-console-playing");

    // seek by clicking a later line (就算世界再大再遠 @ 32 s)
    const target = lines.findIndex((l) => l.text.startsWith("就算世界"));
    await page.locator(`[role="option"][data-line-index="${target}"]`).click();
    await page.waitForTimeout(1500);
    const t2 = await popup.evaluate(() => window.__last?.t ?? -1);
    const cur2 = await page.locator('[role="option"][aria-current="true"]').first().innerText().catch(() => "");
    const out2 = (await popup.locator("body").innerText()).replace(/\s+/g, "");
    // karaoke draws every character twice (base + fill layer)
    const shows = (text, want) => text.includes(want) || text.replace(/(.)\1/g, "$1").includes(want);
    check("seek by clicking a lyric line", t2 >= 32 && t2 < 36, `t=${t2}`);
    check("console highlights sought line", cur2.includes("就算世界"), cur2.replace(/\s+/g, " "));
    check("output shows sought line", shows(out2, "就算世界"), out2.slice(0, 60));
    const hintOpacity = await popup.evaluate(() => {
      const el = [...document.querySelectorAll("span")].find((e) => e.textContent === "等待控制台連線…");
      return el ? getComputedStyle(el.parentElement).opacity : "missing";
    });
    check("output hides the waiting hint once connected", hintOpacity === "0", `opacity=${hintOpacity}`);
    await shot(popup, "08-output-after-seek");

    // blackout
    await page.mouse.move(5, 5);
    await page.keyboard.press("b");
    await page.waitForTimeout(1200);
    const bo = await popup.evaluate(() => window.__last?.overrides?.blackout);
    check("B blackout on", bo === true);
    await shot(popup, "09-output-blackout");
    await page.keyboard.press("b");
    await page.waitForTimeout(600);
    check("B blackout off", (await popup.evaluate(() => window.__last?.overrides?.blackout)) === false);

    // scene keys
    await page.keyboard.press("1");
    await page.waitForTimeout(600);
    const sc1 = await popup.evaluate(() => window.__last?.overrides?.scene);
    check("1 overrides scene", typeof sc1 === "string", `scene=${sc1}`);
    await page.waitForTimeout(900);
    await shot(popup, "10-output-scene1");
    await page.keyboard.press("0");
    await page.waitForTimeout(600);
    check("0 follows plan", (await popup.evaluate(() => window.__last?.overrides?.scene)) === null);
    await shot(page, "11-console-after-keys");

    // pause
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    check("Space pauses", (await popup.evaluate(() => window.__last?.playing)) === false);

    // LIVE mode: M switches, Space cues the next line on the output
    await page.keyboard.press("m");
    await page.waitForTimeout(600);
    const before = await popup.evaluate(() => window.__last?.lineIndex);
    await page.keyboard.press("Space");
    await page.waitForTimeout(1200);
    const live = await popup.evaluate(() => ({ mode: window.__last?.mode, lineIndex: window.__last?.lineIndex }));
    const cued = live.lineIndex != null ? lines[live.lineIndex]?.text ?? "" : "";
    const liveOut = (await popup.locator("body").innerText()).replace(/\s+/g, "");
    check("M switches to LIVE", live.mode === "live", JSON.stringify(live));
    check("LIVE Space cues the next line", live.lineIndex != null && live.lineIndex !== before, `before=${before} after=${live.lineIndex}「${cued}」`);
    check("output shows the cued line", !!cued && shows(liveOut, cued.replace(/\s+/g, "").slice(0, 4)), liveOut.slice(0, 50));
    await shot(popup, "10b-output-live-cue");
    // a presentation clicker aimed at the projector: PageDown / PageUp pressed in the output window
    await popup.keyboard.press("PageDown");
    await page.waitForTimeout(800);
    const clicked = await popup.evaluate(() => window.__last?.lineIndex);
    check("PageDown in the projection window cues the next line", clicked === live.lineIndex + 1, `before=${live.lineIndex} after=${clicked}`);
    await popup.keyboard.press("PageUp");
    await page.waitForTimeout(800);
    const back = await popup.evaluate(() => window.__last?.lineIndex);
    check("PageUp in the projection window goes back a line", back === live.lineIndex, `expected=${live.lineIndex} after=${back}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("m");
    await page.waitForTimeout(400);
    check("M returns to TRACK", (await popup.evaluate(() => window.__last?.mode)) === "track");

    // ------------------------------------------------------------- lyrics editor
    const editor = await context.newPage();
    watch(editor, "lyrics");
    await editor.goto(`${BASE}/p/${id}/lyrics`, { waitUntil: "networkidle" });
    await editor.locator('input[value="夜色慢慢落在城市的邊緣"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    await editor.waitForTimeout(500);
    await shot(editor, "12-lyrics-editor");
    const edText = await editor.locator("body").innerText();
    check("lyrics editor lists lines", edText.includes("夜色慢慢落在城市的邊緣") || (await editor.locator('input[value="夜色慢慢落在城市的邊緣"]').count()) > 0);
    await checkOverflow(editor, "lyrics editor");
    await editor.close();

    // ------------------------------------------------------------- stage lab
    const lab = await context.newPage();
    watch(lab, "stage-lab");
    await lab.goto(`${BASE}/stage-lab`, { waitUntil: "networkidle" });
    await lab.waitForTimeout(3000);
    await shot(lab, "13-stage-lab");
    await lab.close();

    // home library after the flow
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByText("示範之歌").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, "14-home-library");
    await checkOverflow(page, "home library");
    check("library lists the project", (await page.locator("body").innerText()).includes("示範之歌"));
    await popup.close().catch(() => {});
  } catch (err) {
    console.log("FATAL", err);
    await shot(page, "zz-fatal").catch(() => {});
    results.push({ name: "fatal", ok: false, detail: String(err) });
  }
  await browser.close();
  console.log("\n--- browser problems ---");
  for (const p of problems) console.log(p);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${problems.length} browser problems`);
  process.exit(failed.length || problems.length ? 1 : 0);
})();
