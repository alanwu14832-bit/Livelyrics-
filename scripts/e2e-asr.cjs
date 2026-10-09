// Round 15 end-to-end: 「AI 自動對時」 in the lyric editor, with a FAKE engine (no model download):
// the page sets window.__livelyricsFakeAsr before it loads, and the real worker returns that canned
// transcript (Simplified Chinese, one homophone, one line unheard) with simulated progress instead
// of running Whisper. Against a running server without an API key (local mode):
//
//   LIVELYRICS_DATA_DIR=/tmp/livelyrics-e2e npx next start -p 3320
//   BASE=http://localhost:3320 SHOTS=/tmp/shots node scripts/e2e-asr.cjs
//
//   1. First use: the sheet explains it (runs on this computer, the song is not uploaded, the
//      one-time download per model: 準確（約 250 MB，建議）/ 快速（約 80 MB）, results are suggestions).
//   2. Progress: 下載模型 nn % → 聽歌中 m:ss / m:ss, cancellable, the editor stays usable, one run at a time.
//   3. Result: the toast 「AI 對上 5 句（共 6 句），其餘 1 句依人聲估算；都還是『估』…」, every line still
//      「估」 (the AI's fainter), the matched starts where the transcript said, saved as estimated + aligned;
//      the console still warns.
//   4. 確認全部時間 (confirm dialog) → every line real, undo / redo work, saved synced → the console
//      no longer warns.
//   5. Cancel, a failure (memory → 改用快速), the 自動分配 dialog's entry, a low-memory computer (快速 preselected).
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

const BASE = process.env.BASE || "http://localhost:3320";
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LINES = ["我們的歌會找到方向", "在每個夜裡唱著", "風吹過了城市", "啦啦啦啦", "你說的話還在耳邊", "一起走到天亮"];

/** what the fake recogniser "heard": Simplified, 再 for 在, line 4 (啦啦啦啦) not understood */
const HEARD = [
  ["我们的歌会找到方向", 8.2],
  ["再每个夜里唱着", 17.4],
  ["风吹过了城市", 26.1],
  null,
  ["你说的话还在耳边", 44.3],
  ["一起走到天亮", 53.6],
];
function fakeWords() {
  const words = [];
  for (const h of HEARD) {
    if (!h) continue;
    const [text, at] = h;
    Array.from(text).forEach((c, k) => words.push({ text: c, start: Math.round((at + k * 0.32) * 100) / 100, end: Math.round((at + k * 0.32 + 0.28) * 100) / 100 }));
  }
  return words;
}

const problems = [];
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const hfRequests = [];
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
  page.on("request", (r) => {
    if (/huggingface\.co|hf\.co|jsdelivr/.test(r.url())) hfRequests.push(r.url());
  });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial" });
async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text}`);
  return { json: JSON.parse(text), text };
}
/** the start times shown in the table (seconds) */
async function rowStarts(page) {
  const values = await page.locator('input[data-field="time"]').evaluateAll((els) => els.map((e) => e.value));
  return values.map((v) => {
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  });
}

(async () => {
  const status = (await api("GET", "/api/status")).json;
  if (status.claude) {
    console.log("SKIP: this server already has a Claude credential; run it without ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  context.setDefaultNavigationTimeout(90000);
  await context.addInitScript((words) => {
    window.__livelyricsFakeAsr = { words, stepMs: 300 };
  }, fakeWords());
  const page = await context.newPage();
  watch(page, "asr");
  try {
    // a song with untimed (plain) lyrics: every line estimated by the 人聲 aligner
    const form = new FormData();
    form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
    form.set("meta", JSON.stringify({ title: "讓 AI 聽的歌", artist: "對時樂團", duration: 73 }));
    form.set("analysis", "null");
    const created = await fetch(`${BASE}/api/projects`, { method: "POST", body: form }).then((r) => r.json());
    const run = await fetch(`${BASE}/api/projects/${created.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: LINES.join("\n") }) });
    check("the pipeline finishes with plain lyrics", /"type":"done"/.test(await run.text()));
    let p = (await api("GET", `/api/projects/${created.id}`)).json;
    check("the lyrics start estimated", p.lyrics.timing === "estimated" && p.lyrics.lines.length === 6);

    // ------------------------------------------------------------- 1. first use
    await page.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("livelyrics:asr:intro-done");
      localStorage.removeItem("livelyrics:asr:choice");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('input[data-field="time"]').first().waitFor({ timeout: 30000 });
    const before = await rowStarts(page);
    const startButton = page.getByTestId("asr-start");
    check("the toolbar offers 「AI 自動對時」", (await startButton.innerText()).includes("AI 自動對時"));
    await startButton.click();
    const sheet = page.getByRole("dialog", { name: "AI 自動對時" });
    await sheet.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const intro = await sheet.innerText();
    check("first use: the sheet says it runs on this computer and the song is not uploaded", intro.includes("在這台電腦上執行") && intro.includes("歌曲不會上傳"), intro.slice(0, 80));
    check("…the one-time download per choice", intro.includes("準確（約 250 MB，建議）") && intro.includes("快速（約 80 MB）"));
    check("…that the results are suggestions to check", intro.includes("都還是「估」") && intro.includes("確認全部時間"));
    check("…準確 is preselected", await sheet.getByRole("radio", { name: /準確/ }).isChecked());
    check("…and credits the open-source parts", /Whisper（MIT）/.test(intro) && /transformers\.js（Apache-2\.0）/.test(intro) && /ONNX Runtime（MIT）/.test(intro));
    await shot(page, "asr-01-first-use-sheet");

    // ------------------------------------------------------------- 2. progress
    // every progress text the card shows, recorded as it changes (no polling race)
    await page.evaluate(() => {
      window.__asrSeen = [];
      new MutationObserver(() => {
        const t = document.querySelector('[data-testid="asr-progress"]')?.textContent ?? "";
        if (t && window.__asrSeen[window.__asrSeen.length - 1] !== t) window.__asrSeen.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await sheet.getByRole("button", { name: "開始" }).click();
    const progress = page.getByTestId("asr-progress");
    await page.waitForFunction(() => /下載模型 [1-9]\d? %/.test(document.querySelector('[data-testid="asr-progress"]')?.textContent ?? ""), null, { timeout: 30000 });
    await shot(page, "asr-02-progress-download");
    check("one run at a time: the button is disabled while it runs", await startButton.isDisabled());
    await page.waitForFunction(() => /聽歌中 [0-9]:\d\d \/ 1:13/.test(document.querySelector('[data-testid="asr-progress"]')?.textContent ?? ""), null, { timeout: 30000 });
    await shot(page, "asr-03-progress-listen");
    const banner = await page.locator('[role="status"]', { has: progress }).innerText();
    check("the progress card says the song stays on this computer", banner.includes("不會上傳"));
    // the editor stays usable meanwhile
    const tr = page.locator('input[aria-label="第 1 行翻譯"]');
    const usable = (await tr.count()) === 0 || !(await tr.isDisabled());
    check("the editor stays usable during the run", usable && !(await page.getByRole("button", { name: "匯入" }).isDisabled()));

    // ------------------------------------------------------------- 3. the result
    const toast = page.getByText(/AI 對上 5 句（共 6 句），其餘 1 句依(人聲|音訊能量)估算；都還是『估』，播放檢查後可按『確認全部時間』/);
    await toast.first().waitFor({ timeout: 60000 });
    check("the result toast counts what the AI matched and what was filled", (await toast.count()) > 0);
    check("the progress card is gone", (await page.getByTestId("asr-progress").count()) === 0);
    const seen = await page.evaluate(() => window.__asrSeen);
    check("progress: 下載模型 nn %（loaded / 252 MB）", seen.some((t) => /下載模型 \d+ %（\d+ \/ 252 MB）/.test(t)), seen.find((t) => t.includes("下載模型")));
    check("progress: 聽歌中 m:ss / m:ss, then 對齊歌詞", seen.some((t) => /聽歌中 0:[1-9]\d \/ 1:13/.test(t)) && seen.some((t) => t.includes("對齊歌詞")), seen.filter((t) => t.includes("聽歌中")).join(" | "));
    const marks = await page.locator("[data-estimated]").count();
    const aiMarks = await page.locator("[data-aligned]").count();
    check("every line keeps 「估」 (the AI's lines a fainter one)", marks === 6 && aiMarks === 5, `${marks} 估, ${aiMarks} AI`);
    const after = await rowStarts(page);
    const expected = [8.2, 17.4, 26.1, null, 44.3, 53.6];
    const near = expected.every((t, i) => t == null || (after[i] != null && Math.abs(after[i] - t) < 0.06));
    check("the matched lines start where the AI heard them (Simplified + a homophone matched)", near, JSON.stringify(after));
    check("the unheard line is placed between its neighbours", after[3] != null && after[3] > after[2] && after[3] < after[4], JSON.stringify(after));
    check("the times changed from the 人聲 estimate", JSON.stringify(after) !== JSON.stringify(before));
    check("no model was downloaded (fake engine)", hfRequests.length === 0, hfRequests.slice(0, 2).join(" "));
    await shot(page, "asr-04-result-toast");
    await page.keyboard.press("Control+s");
    await page.getByText("已儲存", { exact: true }).first().waitFor({ timeout: 15000 });
    p = (await api("GET", `/api/projects/${created.id}`)).json;
    check(
      "saved: still estimated, the AI's lines flagged aligned, not synced",
      p.lyrics.timing === "estimated" && p.lyrics.synced === false && p.lyrics.lines.every((l) => l.estimated) && p.lyrics.lines.filter((l) => l.aligned).length === 5,
      JSON.stringify(p.lyrics.lines.map((l) => [l.start, !!l.estimated, !!l.aligned])),
    );
    await page.goto(`${BASE}/p/${created.id}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').first().waitFor({ timeout: 30000 });
    const warn = await page.locator('[data-testid="timing-estimated"]').first().innerText();
    check("the console still warns: the AI's times are estimates", warn.includes("還有 6 句時間是估的"), warn.slice(0, 40));

    // ------------------------------------------------------------- 4. 確認全部時間
    await page.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await page.locator('input[data-field="time"]').first().waitFor({ timeout: 30000 });
    check("the AI's provenance survives a reload", (await page.locator("[data-aligned]").count()) === 5);
    await page.getByTestId("confirm-all").click();
    const confirm = page.getByRole("alertdialog", { name: /確認全部 6 句的時間/ });
    await confirm.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    check("確認全部時間 asks first and says what it does", (await confirm.innerText()).includes("跟音檔"));
    await shot(page, "asr-05-confirm-dialog");
    await confirm.getByRole("button", { name: "確認全部時間" }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-estimated]").length === 0, null, { timeout: 10000 });
    check("every line is real now (no 「估」, no count)", (await page.locator('[data-testid="timing-estimated"]').count()) === 0);
    check("…the times did not move", JSON.stringify(await rowStarts(page)) === JSON.stringify(after));
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => document.querySelectorAll("[data-estimated]").length === 6, null, { timeout: 10000 });
    check("undo brings the 「估」 back", (await page.locator("[data-aligned]").count()) === 5);
    await page.keyboard.press("Control+Shift+z");
    await page.waitForFunction(() => document.querySelectorAll("[data-estimated]").length === 0, null, { timeout: 10000 });
    check("redo confirms again", true);
    await page.keyboard.press("Control+s");
    await page.getByText("已儲存", { exact: true }).first().waitFor({ timeout: 15000 });
    await shot(page, "asr-06-after-confirm");
    p = (await api("GET", `/api/projects/${created.id}`)).json;
    check("saved: synced, nothing estimated", p.lyrics.synced === true && p.lyrics.timing === undefined && p.lyrics.lines.every((l) => !l.estimated && !l.aligned), JSON.stringify({ synced: p.lyrics.synced, timing: p.lyrics.timing }));
    await page.goto(`${BASE}/p/${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    check("the console no longer warns", (await page.locator('[data-testid="timing-estimated"]').count()) === 0 && (await page.locator('[data-testid="timing-estimated-link"]').count()) === 0);
    await shot(page, "asr-07-console");

    // ------------------------------------------------------------- 5. the 自動分配 entry, cancel, failure, low memory
    await page.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await page.locator('input[data-field="time"]').first().waitFor({ timeout: 30000 });
    check("every line real: 「AI 自動對時」 has nothing to place", await page.getByTestId("asr-start").isDisabled());
    await page.getByRole("button", { name: "自動分配" }).click();
    let distribute = page.getByRole("alertdialog", { name: "自動分配時間" });
    await distribute.waitFor({ timeout: 10000 });
    check("the 自動分配 dialog offers AI 自動對時", (await distribute.getByTestId("distribute-asr").count()) === 1);
    await distribute.getByTestId("distribute-asr").click();
    await page.getByRole("dialog", { name: "AI 自動對時" }).waitFor({ timeout: 10000 });
    check("…which opens the model choice", await page.getByRole("dialog", { name: "AI 自動對時" }).isVisible());
    await page.getByRole("dialog", { name: "AI 自動對時" }).getByRole("button", { name: "取消" }).click();
    await page.waitForTimeout(400);
    // lay everything out again (estimated), so the AI has lines to place
    await page.getByRole("button", { name: "自動分配" }).click();
    distribute = page.getByRole("alertdialog", { name: "自動分配時間" });
    await distribute.waitFor({ timeout: 10000 });
    await distribute.getByRole("button", { name: /^重新分配全部 6 行$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("[data-estimated]").length === 6, null, { timeout: 30000 });
    const timed = await rowStarts(page);
    await page.evaluate(() => {
      window.__livelyricsFakeAsr.stepMs = 600;
    });
    await page.getByTestId("asr-start").click();
    check("after the first use it starts straight away (the choice is remembered)", (await page.getByRole("dialog", { name: "AI 自動對時" }).count()) === 0 || !(await page.getByRole("dialog", { name: "AI 自動對時" }).isVisible()));
    await page.getByTestId("asr-progress").waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "取消" }).first().click();
    await page.waitForTimeout(800);
    check("取消 stops it and changes nothing", (await page.getByTestId("asr-progress").count()) === 0 && JSON.stringify(await rowStarts(page)) === JSON.stringify(timed) && !(await page.getByTestId("asr-start").isDisabled()));
    await page.evaluate(() => {
      window.__livelyricsFakeAsr.stepMs = 40;
      window.__livelyricsFakeAsr.fail = "memory";
    });
    await page.getByTestId("asr-start").click();
    const failure = page.getByRole("alert").filter({ hasText: "AI 自動對時失敗" });
    await failure.waitFor({ timeout: 30000 });
    check("out of memory: plain Chinese and 改用快速", (await failure.innerText()).includes("記憶體不夠") && (await failure.getByRole("button", { name: "改用快速" }).count()) === 1);
    check("…and the lines did not change", JSON.stringify(await rowStarts(page)) === JSON.stringify(timed));
    await shot(page, "asr-08-error-memory");
    await failure.getByRole("button", { name: "關閉" }).click();
    await page.evaluate(() => {
      delete window.__livelyricsFakeAsr.fail;
    });
    // the low-memory computer opens the same (now estimated) song
    await page.keyboard.press("Control+s");
    await page.getByText("已儲存", { exact: true }).first().waitFor({ timeout: 15000 });

    const low = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
    await low.addInitScript(() => {
      Object.defineProperty(navigator, "deviceMemory", { get: () => 2 });
      try {
        localStorage.removeItem("livelyrics:asr:intro-done");
        localStorage.removeItem("livelyrics:asr:choice");
      } catch {
        /* ignore */
      }
    });
    const lowPage = await low.newPage();
    watch(lowPage, "low-memory");
    await lowPage.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await lowPage.getByTestId("asr-start").click();
    const lowSheet = lowPage.getByRole("dialog", { name: "AI 自動對時" });
    await lowSheet.waitFor({ timeout: 10000 });
    await lowPage.waitForTimeout(500);
    check("low memory: 快速 preselected, and why", (await lowSheet.getByRole("radio", { name: /快速/ }).isChecked()) && (await lowSheet.getByTestId("asr-low-memory").innerText()).includes("記憶體約 2 GB"));
    await lowPage.screenshot({ path: path.join(SHOTS, "asr-09-low-memory-sheet.png") });
    await low.close();
  } catch (err) {
    check("FATAL", false, err instanceof Error ? err.stack : String(err));
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  if (problems.length) console.log(`\nbrowser problems:\n${problems.join("\n")}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${problems.length} browser problems`);
  process.exit(failed.length || problems.length ? 1 : 0);
})();
