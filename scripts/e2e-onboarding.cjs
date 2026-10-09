// Round 13 end-to-end ("sell it"): against a running server without an API key (local mode).
//
//   LIVELYRICS_DATA_DIR=/tmp/livelyrics-e2e npx next start -p 3100
//   BASE=http://localhost:3100 SHOTS=/tmp/shots node scripts/e2e-onboarding.cjs
//
//   1. 設定: the header says 基本模式; the sheet stores a fake key (sk-ant-test-…, never used: the key
//      is removed again before anything could call Claude), shows it masked, no API route returns
//      it, /api/status only says "configured"; 移除金鑰 clears it.
//   2. Untimed lyrics: a song created with plain lyrics gets estimated times, flagged line by line
//      (timing "estimated", synced false); the console starts in 手動切換 and counts them
//      (「還有 6 句時間是估的」) with a link; the lyric editor marks them 「估」. A partial 對拍 makes
//      only the tapped lines real, re-estimates the rest and keeps the warning with a count;
//      tapping every line clears it (saved: synced, no flag) and the console no longer warns.
//   2b. A song analysed before round 14 (no 人聲 curve): 自動分配 › 重新估算 computes the curve in
//      the browser and saves it with the project (PATCH vocal, validated against the grid).
//   3. The projection's 「等待控制台連線…」 pill leaves the wall after 5 s without a console.
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
const FAKE_KEY = "sk-ant-test-e2e0000000000000000LIVE";
const PLAIN = ["第一句只是文字", "第二句沒有時間", "第三句等你對拍", "第四句在副歌裡", "第五句慢慢結束", "第六句說晚安"].join("\n");

const problems = [];
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[${label}] console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial" });
async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text}`);
  return { json: JSON.parse(text), text };
}

(async () => {
  const before = (await api("GET", "/api/status")).json;
  if (before.claude) {
    console.log("SKIP: this server already has a Claude credential; run it without ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  context.setDefaultNavigationTimeout(90000);
  const page = await context.newPage();
  watch(page, "onboarding");
  let keySaved = false;
  try {
    // ------------------------------------------------------------- 1. 設定 › API 金鑰
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const badge = page.getByRole("button", { name: "基本模式" });
    await badge.waitFor({ timeout: 15000 });
    check("the header badge says 基本模式", await badge.isVisible());
    await badge.hover();
    await page.waitForTimeout(900);
    const tip = await page.locator('[role="tooltip"]').first().innerText().catch(() => "");
    check("its tooltip says what it does and what a key adds", /公開資料/.test(tip) && /金鑰/.test(tip), tip.slice(0, 60));
    await shot(page, "r13-home-badge");
    await badge.click();
    const sheet = page.getByRole("dialog", { name: "設定" });
    await sheet.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const text = await sheet.innerText();
    check("the 設定 sheet explains the key in plain language", text.includes("什麼是 API 金鑰") && text.includes("到 Anthropic Console 建立金鑰"));
    check("no developer instructions", !/\.env\.local|npm run dev|ANTHROPIC_API_KEY/.test(text));
    await shot(page, "r13-settings-sheet");
    await sheet.getByLabel("Anthropic API 金鑰").fill(FAKE_KEY);
    await sheet.getByRole("button", { name: "儲存金鑰" }).click();
    keySaved = true;
    await sheet.locator('[data-testid="key-saved"]').waitFor({ timeout: 10000 });
    const savedText = await sheet.innerText();
    check("the saved key shows masked", savedText.includes("sk-ant-…LIVE") && !savedText.includes(FAKE_KEY));
    check("the field no longer holds the key", (await page.locator("input").evaluateAll((els, k) => els.some((e) => e.value === k), FAKE_KEY)) === false);
    await shot(page, "r13-settings-saved");
    const status = await api("GET", "/api/status");
    check("/api/status says configured", status.json.claude === true && status.json.keySource === "settings", JSON.stringify({ claude: status.json.claude, keySource: status.json.keySource }));
    check("/api/status never contains the key (not even masked)", !status.text.includes(FAKE_KEY) && !status.text.includes("LIVE"));
    const key = await api("GET", "/api/settings/api-key");
    check("/api/settings/api-key returns only the masked form", key.json.masked === "sk-ant-…LIVE" && !key.text.includes(FAKE_KEY));
    const cross = await fetch(`${BASE}/api/settings/api-key`, { method: "DELETE", headers: { origin: "https://evil.example" } });
    check("another site cannot remove it", cross.status === 403, `status ${cross.status}`);
    await sheet.getByRole("button", { name: "移除金鑰" }).click();
    await sheet.getByLabel("Anthropic API 金鑰").waitFor({ timeout: 10000 });
    keySaved = false;
    const after = (await api("GET", "/api/status")).json;
    check("移除金鑰 clears it", after.claude === false && after.keySource === null);
    await page.getByRole("button", { name: "完成" }).click();
    await page.waitForTimeout(400);

    // ------------------------------------------------------------- 2. untimed lyrics (round 14: per-line provenance)
    const form = new FormData();
    form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
    form.set("meta", JSON.stringify({ title: "沒有時間的歌", artist: "對拍樂團", duration: 73 }));
    form.set("analysis", "null");
    const created = await fetch(`${BASE}/api/projects`, { method: "POST", body: form }).then((r) => r.json());
    const run = await fetch(`${BASE}/api/projects/${created.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: PLAIN }) });
    const events = await run.text();
    check("the pipeline finishes with pasted plain lyrics", /"type":"done"/.test(events));
    let p = (await api("GET", `/api/projects/${created.id}`)).json;
    check(
      "spread lyrics are estimated line by line, not synced",
      p.lyrics.timing === "estimated" && p.lyrics.synced === false && p.lyrics.lines.every((l) => l.start != null && l.estimated === true),
      JSON.stringify({ timing: p.lyrics.timing, synced: p.lyrics.synced, flags: p.lyrics.lines.map((l) => !!l.estimated) }),
    );
    const noAnalysis = await fetch(`${BASE}/api/projects/${created.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vocal: [0.5, 0.5] }) });
    check("PATCH vocal needs a stored analysis", noAnalysis.status === 400, `status ${noAnalysis.status}`);

    await page.goto(`${BASE}/p/${created.id}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').first().waitFor({ timeout: 30000 });
    let banner = await page.locator('[data-testid="timing-estimated"]').first().innerText();
    check("the console counts the estimated lines", banner.includes("還有 6 句時間是估的，先到歌詞編輯器對拍"), banner.slice(0, 40));
    check("the top bar links to the lyric editor", (await page.locator('[data-testid="timing-estimated-link"]').getAttribute("href")) === `/p/${created.id}/lyrics`);
    let live = await page.getByRole("radio", { name: "手動切換" }).first().getAttribute("aria-checked").catch(() => null);
    check("the console starts in 手動切換", live === "true", `aria-checked=${live}`);
    const overlay = await page.evaluate(() => ({ fps: document.querySelectorAll("[data-fps-readout]").length, text: document.querySelector('[data-preview-badges]')?.textContent ?? "" }));
    check("no fps / resolution readout on the preview without 測試圖", overlay.fps === 0 && !/fps|1920 × 1080/.test(overlay.text), JSON.stringify(overlay));
    await shot(page, "r13-console-estimated");

    const editorNote = () => page.locator('[data-testid="timing-estimated"]').innerText().catch(() => "");
    const marks = () => page.locator("[data-estimated]").count();
    await page.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').waitFor({ timeout: 30000 });
    check("the editor counts the estimated lines", (await editorNote()).includes("還有 6 句時間是估的"), await editorNote());
    check("every estimated row carries 「估」", (await marks()) === 6, `${await marks()} marks`);
    await shot(page, "r14-editor-estimated");

    // partial 對拍: two taps, then Esc — the rest is re-estimated between the taps and still counted
    await page.getByRole("button", { name: "開始對拍", exact: true }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    // (this song has no analysis: the rest is spread evenly between the taps)
    const toast = page.getByText(/已標記 2 句；其餘 4 句(依.+重新估算|在對好的句子之間重新平均分配)（仍是估的）/);
    await toast.first().waitFor({ timeout: 10000 }).catch(() => {});
    check("ending the tap session says what was re-estimated", (await toast.count()) > 0);
    // (the toast's entrance is a short blur-in)
    await page.waitForTimeout(1000);
    await shot(page, "r14-reestimate-toast");
    check("partial 對拍 keeps the warning, with a count", (await editorNote()).includes("還有 4 句時間是估的"), await editorNote());
    check("the tapped rows lost 「估」", (await marks()) === 4, `${await marks()} marks`);
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(2500);
    p = (await api("GET", `/api/projects/${created.id}`)).json;
    check(
      "saved after a partial 對拍: the two tapped lines are real, the rest still estimated",
      p.lyrics.timing === "estimated" && p.lyrics.synced === false && JSON.stringify(p.lyrics.lines.map((l) => !!l.estimated)) === JSON.stringify([false, false, true, true, true, true]),
      JSON.stringify({ timing: p.lyrics.timing, synced: p.lyrics.synced, flags: p.lyrics.lines.map((l) => !!l.estimated) }),
    );
    await page.goto(`${BASE}/p/${created.id}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').first().waitFor({ timeout: 30000 });
    banner = await page.locator('[data-testid="timing-estimated"]').first().innerText();
    check("the console now counts 4", banner.includes("還有 4 句時間是估的，先到歌詞編輯器對拍"), banner.slice(0, 40));
    live = await page.getByRole("radio", { name: "手動切換" }).first().getAttribute("aria-checked").catch(() => null);
    check("手動切換 stays the default while a line is estimated", live === "true", `aria-checked=${live}`);
    await shot(page, "r14-console-estimated-count");

    // tap every line: the warning goes
    await page.goto(`${BASE}/p/${created.id}/lyrics`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "開始對拍", exact: true }).click();
    await page.waitForTimeout(1500);
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press("Space");
      await page.waitForTimeout(600);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    check("tapping every line clears the editor's note", (await page.locator('[data-testid="timing-estimated"]').count()) === 0 && (await marks()) === 0);
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(2500);
    p = (await api("GET", `/api/projects/${created.id}`)).json;
    check("saved after tapping every line: synced, no estimated flag", p.lyrics.synced === true && p.lyrics.timing === undefined && p.lyrics.lines.every((l) => !l.estimated), JSON.stringify({ timing: p.lyrics.timing, synced: p.lyrics.synced }));
    await page.goto(`${BASE}/p/${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    check("the console no longer warns", (await page.locator('[data-testid="timing-estimated"]').count()) === 0 && (await page.locator('[data-testid="timing-estimated-link"]').count()) === 0);

    // ------------------------------------------------------------- 2b. a song analysed before round 14 (no 人聲 curve)
    // its stored analysis has no `vocal`: 自動分配 › 重新估算 computes the curve from the audio in the
    // browser and saves it with the project (PATCH vocal, checked against the analysis's grid)
    const frames = Math.floor(73 * 20) + 1;
    const flat = (v) => new Array(frames).fill(v);
    const oldAnalysis = { duration: 73, sampleRate: 22050, bpm: 120, bpmConfidence: 0.8, beats: [], envelopeRate: 20, energy: flat(0.5), onset: flat(0.2), brightness: flat(0.5), bass: flat(0.4), peaks: [], sections: [] };
    const oldForm = new FormData();
    oldForm.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
    oldForm.set("meta", JSON.stringify({ title: "舊的分析", artist: "對拍樂團", duration: 73 }));
    oldForm.set("analysis", JSON.stringify(oldAnalysis));
    const old = await fetch(`${BASE}/api/projects`, { method: "POST", body: oldForm }).then((r) => r.json());
    await fetch(`${BASE}/api/projects/${old.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: PLAIN }) }).then((r) => r.text());
    p = (await api("GET", `/api/projects/${old.id}`)).json;
    check("an old analysis has no 人聲 curve", !!p.analysis && p.analysis.vocal === undefined && p.lyrics.timing === "estimated");
    const wrongGrid = await fetch(`${BASE}/api/projects/${old.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ vocal: new Array(frames + 40).fill(0.5) }) });
    check("PATCH vocal refuses a curve off the analysis's grid", wrongGrid.status === 400, `status ${wrongGrid.status}`);
    await page.goto(`${BASE}/p/${old.id}/lyrics`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="timing-estimated"]').waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "自動分配" }).click();
    const alert = page.getByRole("alertdialog", { name: "自動分配時間" });
    await alert.waitFor({ timeout: 10000 });
    check("the dialog offers 重新估算『估的』行", (await alert.getByText("重新估算『估的』行（保留已對好的）").count()) > 0);
    await shot(page, "r14-distribute-dialog");
    await alert.getByRole("button", { name: /^重新估算 6 行$/ }).click();
    const done = page.getByText(/已依人聲估算 6 句的時間（仍是估的）/);
    await done.first().waitFor({ timeout: 60000 }).catch(() => {});
    check("the editor computed the 人聲 curve and re-estimated with it", (await done.count()) > 0);
    check("the timelines show the 人聲 lane", (await page.locator('canvas[data-vocal-lane="on"]').count()) === 2);
    await page.waitForTimeout(400);
    await shot(page, "r14-vocal-lane");
    // with the curve, a partial 對拍 re-estimates the rest 依人聲
    await page.getByRole("button", { name: "開始對拍", exact: true }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    const vocalToast = page.getByText(/已標記 2 句；其餘 4 句依人聲重新估算（仍是估的）/);
    await vocalToast.first().waitFor({ timeout: 10000 }).catch(() => {});
    check("…and a partial 對拍 re-estimates the rest 依人聲", (await vocalToast.count()) > 0);
    await page.waitForTimeout(1000);
    await shot(page, "r14-reestimate-toast-vocal");
    p = (await api("GET", `/api/projects/${old.id}`)).json;
    check("…and saved the curve with the project", Array.isArray(p.analysis?.vocal) && p.analysis.vocal.length === frames, `vocal ${p.analysis?.vocal?.length} / ${frames}`);
    check("the lyrics themselves were not saved behind the operator's back", p.lyrics.lines.every((l) => l.estimated === true));

    // ------------------------------------------------------------- 3. the projection's waiting pill
    const out = await context.newPage();
    watch(out, "output");
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" }); // no console on this channel
    await out.goto(`${BASE}/p/${created.id}/output`, { waitUntil: "domcontentloaded" });
    await out.waitForTimeout(1500);
    const early = await out.locator("[data-waiting-hint]").getAttribute("data-waiting-hint");
    await out.waitForTimeout(5000);
    const late = await out.locator("[data-waiting-hint]").getAttribute("data-waiting-hint");
    check("the waiting pill shows at first and is gone from the wall after 5 s", early === "on" && late === "off", `${early} → ${late}`);
    await out.close();
  } catch (err) {
    check("no exception", false, err instanceof Error ? err.stack : String(err));
  } finally {
    if (keySaved) await fetch(`${BASE}/api/settings/api-key`, { method: "DELETE" }).catch(() => {});
    await browser.close();
  }
  if (problems.length) console.log(`browser problems:\n  ${problems.join("\n  ")}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${problems.length ? `, ${problems.length} browser problems` : ""}`);
  process.exit(failed.length || problems.length ? 1 : 0);
})();
