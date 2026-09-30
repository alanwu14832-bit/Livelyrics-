// End-to-end check of 免費研究 and 用 claude.ai 研究 (manual Claude mode) against a running server
// without an API key. The public sources are this script's own stub (the real MusicBrainz and
// Wikipedia responses saved in fixtures/research/), so start the server pointing at it:
//
//   LIVELYRICS_DATA_DIR=/tmp/livelyrics-e2e \
//   LIVELYRICS_MUSICBRAINZ_URL=http://127.0.0.1:3199/musicbrainz/ws/2 \
//   LIVELYRICS_WIKIPEDIA_URL='http://127.0.0.1:3199/wikipedia/{lang}' \
//   LIVELYRICS_COVERART_URL=http://127.0.0.1:3199/coverart npx next start -p 3100
//   BASE=http://localhost:3100 SHOTS=/tmp/shots node scripts/e2e-free-research.cjs
//
//   1. The sources unreachable (the stub is not listening yet): the pipeline still finishes with a
//      free research brief built from the lyrics and the audio.
//   2. The sources stubbed: 〈大風吹〉 by 草東沒有派對 (uploaded through the page, so the audio is
//      analysed): the stream shows 查詢 MusicBrainz… / 讀取維基百科… / 分析歌詞意象…, the brief names the
//      album and the genre and cites the pages; the requests carry the Livelyrics User-Agent.
//   2b. 研究找到的素材 (phase 8): the stub also serves a Cover Art Archive listing for 《醜奴兒》 and its
//      image (fixtures/visuals/cover.jpg: a teal field, an orange sun, a magenta band). The research
//      collects the cover (measured, 只當參考 without the band's authorization), the design takes its
//      palette from it, the design overview shows it under 「研究找到的素材」; 確認樂團授權 puts it on
//      stage and a re-design shows it in a section; 只當參考 takes it off; 移除 removes it for good
//      (a new research does not bring it back).
//   3. 用 claude.ai 研究: copy the prompt (clipboard), paste a good reply wrapped in prose → the plan is
//      applied and shows in the console; paste a broken reply → the error and 複製修正提示詞; the
//      JSON-only fix applies and keeps the brief. 用 claude.ai 提案 builds the directions prompt.
// Screenshots: the connect sheet, the process page with the free brief (light, dark), the unreachable
// brief, the sheet (copy, paste, error light and dark, success), the console with the pasted plan.
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

const BASE = process.env.BASE || "http://localhost:3100";
const STUB_PORT = Number(process.env.STUB_PORT || 3199);
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");
const FIX = path.join(REPO, "fixtures/research");
const COVER_JPG = fs.readFileSync(path.join(REPO, "fixtures/visuals/cover.jpg"));
const RELEASE_GROUP = "0436f306-0993-4e12-acfa-4b725163b9bd";
const USER_AGENT = "Livelyrics/0.1 (contact: https://github.com/alanwu14832-bit/Livelyrics-)";

const problems = [];
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function watch(page, label) {
  page.on("console", (m) => {
    // the broken paste's 422 is also logged by the browser as a failed resource
    if (/status of 422/.test(m.text())) return;
    if (m.type() === "error" || m.type() === "warning") problems.push(`[${label}] console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on("response", (r) => {
    // the broken paste answers 422 on purpose
    if (r.status() >= 400 && !(r.status() === 422 && /\/manual$/.test(r.url()))) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial", ...opts });

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// the stub: MusicBrainz and Wikipedia from the saved responses
// ---------------------------------------------------------------------------

const stubRequests = [];
function stubHandler(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
  stubRequests.push({ path: `${url.pathname}${url.search}`, ua: req.headers["user-agent"] || "", lang: req.headers["accept-language"] || "" });
  const send = (file) => {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(fs.readFileSync(path.join(FIX, file)));
  };
  const p = url.pathname;
  // phase 8: the Cover Art Archive (the listing links to images on the same stub)
  if (p === `/coverart/release-group/${RELEASE_GROUP}`) {
    const img = `http://127.0.0.1:${STUB_PORT}/coverart/img/cover-1200.jpg`;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ images: [{ approved: true, front: true, types: ["Front"], image: img, thumbnails: { "1200": img, "500": img } }], release: "https://musicbrainz.org/release/7e1d1a0c-0000-4000-8000-000000000001" }));
  }
  if (p === "/coverart/img/cover-1200.jpg") {
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(COVER_JPG.length) });
    return res.end(COVER_JPG);
  }
  if (p === "/musicbrainz/ws/2/recording") return send("musicbrainz-recording-caodong.json");
  if (p.startsWith("/musicbrainz/ws/2/artist/1636f82a")) return send("musicbrainz-artist-caodong.json");
  if (p === "/musicbrainz/ws/2/artist") return send("musicbrainz-artist-search-empty.json");
  if (p === "/wikipedia/zh/w/rest.php/v1/search/page") return send("wikipedia-zh-search-caodong.json");
  if (p.startsWith("/wikipedia/zh/api/rest_v1/page/summary/")) {
    const title = decodeURIComponent(p.split("/").pop() || "");
    if (title === "草東沒有派對") return send("wikipedia-zh-summary-caodong.json");
    if (title === "大風吹_(歌曲)") return send("wikipedia-zh-summary-song-caodong.json");
  }
  if (p.startsWith("/wikipedia/en/w/rest.php/v1/search/page")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"pages":[]}');
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"title":"Not found."}');
}

function startStub() {
  const server = http.createServer(stubHandler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(STUB_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// replies a user pastes back from claude.ai
// ---------------------------------------------------------------------------

const BRIEF = [
  "我先搜尋了草東沒有派對與〈大風吹〉的資料。",
  "",
  "## 樂團視覺識別",
  "- 臺北的獨立搖滾樂團，首張專輯《醜奴兒》以黑白、粗糙的影像與手寫字著稱（[維基百科](https://zh.wikipedia.org/wiki/%E8%8D%89%E6%9D%B1%E6%B2%92%E6%9C%89%E6%B4%BE%E5%B0%8D)）。",
  "## 歌曲意象與情緒",
  "- 〈大風吹〉：遊戲的名字變成對世代焦慮的吶喊，副歌是全場一起喊的口號（推測）。",
  "## 現場表演觀察",
  "- 現場的副歌是大合唱，樂迷會一起喊；安靜段落後的爆發是重點（[MusicBrainz](https://musicbrainz.org/artist/1636f82a-b541-4867-9eb7-e4b224552eef)）。",
  "## 設計方向建議",
  "- 黑白為底、一道刺眼的紅；副歌用巨字，安靜段落收成全黑。",
  "## 參考來源",
  "- [草東沒有派對 - 維基百科](https://zh.wikipedia.org/wiki/%E8%8D%89%E6%9D%B1%E6%B2%92%E6%9C%89%E6%B4%BE%E5%B0%8D)",
].join("\n");

function planReply(plan, title) {
  const p = JSON.parse(JSON.stringify(plan));
  p.keyVisual.title = title;
  p.keyVisual.concept = "大風吹過空蕩的城市：黑白的畫面裡只留一道紅，副歌讓全場的吶喊變成巨字。";
  return JSON.stringify(p, null, 2);
}

// ---------------------------------------------------------------------------

async function waitForDone(page) {
  await page.getByRole("status").filter({ hasText: "設計完成" }).first().waitFor({ timeout: 120000 });
}

async function openResearchPanel(page) {
  const panel = page.locator('section[aria-label="研究簡報"]');
  await panel.waitFor({ timeout: 30000 });
  const summary = panel.locator("summary").first();
  const open = await panel.locator("details").first().evaluate((d) => d.open).catch(() => false);
  if (!open) await summary.click();
  await page.waitForTimeout(700);
  return panel;
}

/** Viewport screenshots down the research brief (sticky header and aside stay where they belong). */
async function briefShots(page, name) {
  const panel = page.locator('section[aria-label="研究簡報"]');
  await panel.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.waitForTimeout(500);
  await shot(page, `${name}-1`);
  await page.evaluate(() => window.scrollBy(0, 820));
  await page.waitForTimeout(400);
  await shot(page, `${name}-2`);
}

async function clipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

(async () => {
  const status = await api("GET", "/api/status");
  check("server runs without an API key (免費研究模式)", status.claude === false, `claude=${status.claude}`);

  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  context.setDefaultNavigationTimeout(90000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  watch(page, "process");
  let stub = null;
  try {
    // ----------------------------------------------- 0. the home page status copy
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    check("home says 免費研究模式", (await page.locator("body").innerText()).includes("目前使用免費研究模式"));
    await page.getByRole("button", { name: "免費研究模式" }).click();
    const connect = page.getByRole("dialog", { name: "連接 Claude" });
    await connect.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    const connectText = await connect.innerText();
    check("the connect sheet explains the free mode and the claude.ai option", connectText.includes("MusicBrainz") && connectText.includes("用 claude.ai 研究") && connectText.includes("ANTHROPIC_API_KEY"));
    await shot(page, "home-connect-sheet");
    await page.getByRole("button", { name: "關閉" }).click();
    await page.waitForTimeout(400);

    // ----------------------------------------------- 1. sources unreachable
    const form = new FormData();
    form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
    form.set("meta", JSON.stringify({ title: "連不上的歌", artist: "沒人知道的樂團", duration: 73 }));
    form.set("analysis", "null");
    const created = await fetch(`${BASE}/api/projects`, { method: "POST", body: form }).then((r) => r.json());
    const run = await fetch(`${BASE}/api/projects/${created.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: LRC }) });
    const events = await run.text();
    const finished = /"type":"done"/.test(events);
    check("pipeline finishes with the sources unreachable", finished, finished ? "" : events.slice(-160));
    check("the stream showed the free research progress", events.includes("查詢 MusicBrainz…") && events.includes("讀取維基百科…") && events.includes("分析歌詞意象…"));
    const offline = await api("GET", `/api/projects/${created.id}`);
    check("a free research brief was still produced", offline.research?.engine === "free" && /## 歌曲意象與情緒/.test(offline.research.brief), offline.research?.engine);
    check("it says the sources could not be reached", /連不上|查不到/.test(offline.research?.brief ?? ""));
    check("the design followed it", !!offline.plan && /免費研究的發現/.test(offline.plan.designerNotes), offline.plan?.keyVisual?.title);
    check("no request reached a stub that was not running", stubRequests.length === 0);
    await page.goto(`${BASE}/p/${created.id}/process`, { waitUntil: "networkidle" });
    await openResearchPanel(page);
    await briefShots(page, "free-unreachable-light");

    // ----------------------------------------------- 2. sources stubbed
    stub = await startStub();
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.setInputFiles('input[aria-label="選擇音檔"]', path.join(REPO, "fixtures/demo-song.wav"));
    await page.waitForSelector('section[aria-label="新作品"]', { timeout: 60000 });
    await page.locator("label", { hasText: "貼上歌詞" }).first().click();
    await page.fill('textarea[aria-label="貼上歌詞"]', LRC.replace(/^\[(ti|ar):[^\]]*\]\n/gm, ""));
    await page.getByLabel("歌名").fill("大風吹");
    await page.getByLabel("樂團／演出者").fill("草東沒有派對");
    await page.getByRole("button", { name: /開始製作/ }).click();
    await page.waitForURL(/\/p\/[^/]+\/process/, { timeout: 90000 });
    const id = page.url().match(/\/p\/([^/?]+)\/process/)[1];
    // the stream while it runs
    const streamed = await page
      .waitForFunction(() => /查詢 MusicBrainz|讀取維基百科|分析歌詞意象|免費研究/.test(document.body.innerText), null, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    check("the process page streams the free research", streamed);
    await waitForDone(page);
    await page.waitForTimeout(1500);
    const song = await api("GET", `/api/projects/${id}`);
    const brief = song.research?.brief ?? "";
    check("brief engine is 免費研究", song.research?.engine === "free");
    check("brief names the album and the genre from MusicBrainz", brief.includes("醜奴兒") && brief.includes("獨立搖滾"), brief.slice(0, 120).replace(/\n/g, " "));
    check("brief quotes Wikipedia", brief.includes("維基百科"));
    check("sources cite MusicBrainz and Wikipedia", (song.research?.sources ?? []).some((s) => s.url.startsWith("https://musicbrainz.org/")) && (song.research?.sources ?? []).some((s) => /wikipedia\.org/.test(s.url)), (song.research?.sources ?? []).map((s) => s.title).join("、"));
    check("public facts cached on the project", song.research?.publicInfo?.status?.musicbrainz === "ok", JSON.stringify(song.research?.publicInfo?.status));
    check("the stub was asked, with the Livelyrics User-Agent", stubRequests.length >= 3 && stubRequests.every((r) => r.ua === USER_AGENT), `${stubRequests.length} requests`);
    check("zh Wikipedia asked for Taiwan variants", stubRequests.filter((r) => r.path.startsWith("/wikipedia/zh")).every((r) => /zh-TW/.test(r.lang)));
    check("the design used the genre", /獨立搖滾/.test(song.plan?.designerNotes ?? ""), song.plan?.keyVisual?.title);
    const panel = await openResearchPanel(page);
    const panelText = await panel.innerText();
    check("research panel labelled 免費研究（公開資料＋歌詞與音訊分析）", panelText.includes("免費研究（公開資料＋歌詞與音訊分析）"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, "free-process-light");
    await briefShots(page, "free-brief-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(600);
    await briefShots(page, "free-brief-dark");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, "free-process-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(300);

    // ----------------------------------------------- 2b. 研究找到的素材
    {
      const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const near = (h, t, d = 30) => hexRgb(h).every((c, i) => Math.abs(c - t[i]) < d);
      const collected = song.collected ?? [];
      const cover = collected[0];
      check("research collected the album cover from the Cover Art Archive", collected.length === 1 && cover?.provenance?.kind === "cover" && cover?.provenance?.foundBy === "cover-art-archive" && cover?.name === "專輯封面《醜奴兒》", JSON.stringify(collected.map((c) => c.name)));
      check("the stub served the listing and the image (with the Livelyrics User-Agent)", stubRequests.some((r) => r.path === `/coverart/release-group/${RELEASE_GROUP}`) && stubRequests.some((r) => r.path === "/coverart/img/cover-1200.jpg" && r.ua === USER_AGENT));
      check("the cover was measured on the server (teal field, orange sun)", !!cover?.stats && near(cover.stats.palette[0], [0x0b, 0x3b, 0x3f]) && cover.stats.palette.some((h) => near(h, [0xff, 0x7a, 0x1a])), JSON.stringify(cover?.stats?.palette));
      check("provenance: source page, image URL, fetched time, the authorization note", /^https:\/\/musicbrainz\.org\/release\//.test(cover?.provenance?.sourceUrl ?? "") && /cover-1200\.jpg$/.test(cover?.provenance?.imageUrl ?? "") && !!cover?.provenance?.fetchedAt && /尚未確認/.test(cover?.provenance?.authorization ?? ""));
      check("without the band's authorization it is 只當參考", cover?.use === "reference" && !(song.plan?.sections ?? []).some((s) => s.media?.assetId === cover?.id));
      const hexes = (song.plan?.keyVisual?.palette ?? []).map((c) => c.hex);
      check("the design took its palette from the cover", hexes.some((h) => near(h, [0xfa, 0x7a, 0x1d], 12)) && /研究找到的樂團素材/.test(song.plan?.keyVisual?.concept ?? ""), hexes.join(" "));
      check("the step log said what was found", (await page.locator("body").innerText()).includes("找到專輯封面"));
      const section = page.getByTestId("collected-visuals");
      await section.waitFor({ timeout: 20000 });
      const sectionText = await section.innerText();
      check("「研究找到的素材」 shows the cover with its kind and source", sectionText.includes("研究找到的素材") && sectionText.includes("專輯封面") && sectionText.includes("Cover Art Archive") && sectionText.includes("還沒確認樂團授權"), sectionText.replace(/\s+/g, " ").slice(0, 160));
      const card = section.getByTestId("collected-card").first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="collected-card"] img');
        return img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 15000 });
      await page.waitForTimeout(400);
      await section.screenshot({ path: path.join(SHOTS, "collected-reference.png") });
      // 可以上台 is locked until the band's authorization: it asks for it
      await card.getByRole("radio", { name: "可以上台" }).click();
      const ask = page.locator("dialog[open]").filter({ hasText: "確認樂團授權" });
      await ask.waitFor({ timeout: 10000 });
      await ask.getByRole("button", { name: "樂團已授權" }).click();
      await page.locator('[data-testid="collected-card"][data-use="stage"]').waitFor({ timeout: 15000 });
      const authorized = await api("GET", `/api/projects/${id}/collected`);
      check("確認樂團授權 stores the acknowledgement and puts the cover on stage", !!authorized.authorization?.at && authorized.items[0]?.use === "stage");
      await page.waitForTimeout(400);
      await section.screenshot({ path: path.join(SHOTS, "collected-stage.png") });
      // a re-design (the offline designer): the cover appears in a section with a treatment
      const redesign = await fetch(`${BASE}/api/projects/${id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ steps: ["design"] }) }).then((r) => r.text());
      const staged = await api("GET", `/api/projects/${id}`);
      const shown = (staged.plan?.sections ?? []).filter((s) => s.media?.assetId === cover.id);
      check("re-designed: the cover is a section's media, with restraint", /"type":"done"/.test(redesign) && shown.length >= 1 && shown.length <= 3 && shown.every((s) => ["duotone", "halftone", "slow-drift", "grain-film"].includes(s.media.treatment)), shown.map((s) => `${s.label}:${s.media.treatment}`).join("、"));
      const assetFile = await fetch(`${BASE}/api/projects/${id}/assets/${cover.id}`);
      check("an item on stage is served by the asset route (the stage and the export load it)", assetFile.status === 200 && (assetFile.headers.get("content-type") ?? "").startsWith("image/jpeg"));
      await page.goto(`${BASE}/p/${id}/process`, { waitUntil: "networkidle" });
      await page.getByTestId("collected-visuals").waitFor({ timeout: 20000 });
      await page.getByTestId("collected-visuals").scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await shot(page, "collected-process-light");
      // 只當參考: off the stage, the sections go back to the scene
      await page.getByTestId("collected-card").first().getByRole("radio", { name: "只當參考" }).click();
      await page.locator('[data-testid="collected-card"][data-use="reference"]').waitFor({ timeout: 15000 });
      const reference = await api("GET", `/api/projects/${id}`);
      check("只當參考 clears the sections that showed it", reference.collected[0].use === "reference" && !(reference.plan?.sections ?? []).some((s) => s.media?.assetId === cover.id));
      check("…and the asset route no longer serves it", (await fetch(`${BASE}/api/projects/${id}/assets/${cover.id}`)).status === 404);
      // phone
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await page.getByTestId("collected-visuals").scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, "collected-phone");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("the section fits a phone (no sideways scroll)", overflow <= 1, `${overflow}px`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(400);
      // 移除: gone for good
      await page.getByTestId("collected-card").first().getByRole("button", { name: /移除/ }).click();
      const confirmRemove = page.locator("dialog[open]").filter({ hasText: "移除這個素材" });
      await confirmRemove.waitFor({ timeout: 10000 });
      await confirmRemove.getByRole("button", { name: "移除" }).click();
      await page.getByTestId("collected-visuals").waitFor({ state: "detached", timeout: 15000 });
      const removed = await api("GET", `/api/projects/${id}`);
      check("移除 removes the item and its file", (removed.collected ?? []).length === 0 && (await fetch(`${BASE}/api/projects/${id}/collected/${cover.id}`)).status === 404);
      const rerun = await fetch(`${BASE}/api/projects/${id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ steps: ["research"] }) }).then((r) => r.text());
      const after = await api("GET", `/api/projects/${id}`);
      check("a new research does not bring a removed item back", /"type":"done"/.test(rerun) && (after.collected ?? []).length === 0);
      await page.goto(`${BASE}/p/${id}/process`, { waitUntil: "networkidle" });
    }

    // ----------------------------------------------- 3. 用 claude.ai 研究
    await page.getByTestId("manual-open").click();
    const prompt = page.getByTestId("manual-prompt");
    await prompt.waitFor({ timeout: 30000 });
    const promptText = await prompt.inputValue();
    check("the prompt carries the song, lyrics by section, findings and the schema", promptText.includes("〈大風吹〉") && promptText.includes("【a") && promptText.includes("醜奴兒") && promptText.includes("- keyVisual：物件") && promptText.includes("```json"), `${promptText.length} chars`);
    await page.getByTestId("manual-copy").click();
    await page.getByTestId("manual-copy").filter({ hasText: "已複製" }).waitFor({ timeout: 5000 });
    check("複製提示詞 puts the prompt on the clipboard", (await clipboard(page)) === promptText);
    check("打開 claude.ai links to a new chat", (await page.getByTestId("manual-open-claude").getAttribute("href")) === "https://claude.ai/new");
    await page.waitForTimeout(300);
    await shot(page, "manual-copy");
    // 精簡版
    await page.getByRole("radio", { name: "精簡版" }).click();
    await page.waitForFunction((full) => {
      const el = document.querySelector('[data-testid="manual-prompt"]');
      return el && el.value && el.value.length < full;
    }, promptText.length, { timeout: 20000 });
    check("精簡版 is shorter", (await prompt.inputValue()).length < promptText.length);
    await page.getByRole("radio", { name: "完整版" }).click();

    // a good reply, wrapped in prose
    const good = `${BRIEF}\n\n以下是設計方案：\n\n\`\`\`json\n${planReply(song.plan, "大風吹過空城")}\n\`\`\`\n\n希望這份設計對你們的演出有幫助！`;
    await page.getByTestId("manual-reply").fill(good);
    await page.waitForTimeout(300);
    await shot(page, "manual-paste");
    await page.getByTestId("manual-apply").click();
    await page.getByTestId("manual-success").waitFor({ timeout: 30000 });
    const successText = await page.getByTestId("manual-success").innerText();
    check("套用 applies the pasted plan", successText.includes("已套用 claude.ai 的設計方案") && successText.includes("大風吹過空城"), successText.replace(/\s+/g, " ").slice(0, 100));
    await shot(page, "manual-success");
    const applied = await api("GET", `/api/projects/${id}`);
    check("saved plan and brief marked manual-claude", applied.plan?.keyVisual?.title === "大風吹過空城" && applied.planSource?.engine === "manual-claude" && applied.research?.engine === "manual-claude");
    check("the pasted brief kept its sources and the cached public facts", (applied.research?.sources ?? []).some((s) => /wikipedia/.test(s.url)) && applied.research?.publicInfo?.status?.musicbrainz === "ok");
    await page.getByTestId("manual-console").click();
    await page.waitForURL(new RegExp(`/p/${id}$`), { timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes("大風吹過空城"), null, { timeout: 30000 });
    const consoleText = await page.locator("body").innerText();
    check("the console shows the pasted plan", consoleText.includes("大風吹過空城") && consoleText.includes("claude.ai 設計"));
    await page.waitForTimeout(1500);
    await shot(page, "console-manual");

    // a broken reply → the errors and 複製修正提示詞; then the JSON-only fix
    await page.goto(`${BASE}/p/${id}/process`, { waitUntil: "networkidle" });
    await page.getByTestId("manual-open").click();
    await page.getByTestId("manual-prompt").waitFor({ timeout: 30000 });
    const broken = `${BRIEF}\n\n\`\`\`json\n${planReply(applied.plan, "大風吹：第二版").replace('"lines": [', '"lines": [ ... ')}\n\`\`\``;
    await page.getByTestId("manual-reply").fill(broken);
    await page.getByTestId("manual-apply").click();
    await page.getByTestId("manual-error").waitFor({ timeout: 30000 });
    const errorText = await page.getByTestId("manual-error").innerText();
    check("a broken reply shows a clear Chinese error with the line", /JSON 格式有錯/.test(errorText) && /省略了一部分內容/.test(errorText) && /第 \d+ 行第 \d+ 個字/.test(errorText), errorText.replace(/\s+/g, " ").slice(0, 160));
    await page.getByTestId("manual-fix-copy").click();
    await page.getByTestId("manual-fix-copy").filter({ hasText: "已複製" }).waitFor({ timeout: 5000 });
    const fix = await clipboard(page);
    check("複製修正提示詞 copies a fix request naming the problem", fix.includes("沒辦法套用到 Livelyrics") && /第 \d+ 行第 \d+ 個字/.test(fix) && fix.includes("不能用 ... 代替") && fix.includes("```json"));
    check("nothing was saved from the broken reply", (await api("GET", `/api/projects/${id}`)).plan.keyVisual.title === "大風吹過空城");
    await page.getByTestId("manual-error").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, "manual-error-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(500);
    await shot(page, "manual-error-dark");
    await page.emulateMedia({ colorScheme: "light" });
    // the corrected JSON from the same chat, without a brief
    await page.getByTestId("manual-reply").fill(`好的，這是修正後的 JSON：\n\`\`\`json\n${planReply(applied.plan, "大風吹：第二版")}\n\`\`\``);
    await page.getByTestId("manual-apply").click();
    await page.getByTestId("manual-success").waitFor({ timeout: 30000 });
    const fixed = await api("GET", `/api/projects/${id}`);
    check("the JSON-only fix applies and keeps the brief", fixed.plan.keyVisual.title === "大風吹：第二版" && /## 設計方向建議/.test(fixed.research?.brief ?? "") && fixed.research?.engine === "manual-claude");
    check("復原 is offered (the previous plan is kept)", fixed.previousPlan?.plan?.keyVisual?.title === "大風吹過空城");
    await page.getByRole("button", { name: "完成" }).click();
    await page.waitForTimeout(500);

    // 用 claude.ai 提案 (directions)
    await page.getByTestId("directions-manual").click();
    await page.getByTestId("manual-prompt").waitFor({ timeout: 30000 });
    const dirPrompt = await page.getByTestId("manual-prompt").inputValue();
    check("用 claude.ai 提案 builds the directions prompt", dirPrompt.includes("提出設計方向") && dirPrompt.includes("- directions：陣列"));
    await page.getByRole("button", { name: "取消" }).click();
  } catch (err) {
    check("run", false, err && err.stack ? err.stack : String(err));
    await shot(page, "free-research-failure").catch(() => {});
  } finally {
    await browser.close();
    if (stub) await new Promise((r) => stub.close(r));
  }
  const relevant = problems.filter((p) => !/favicon|Download the React DevTools/.test(p));
  if (relevant.length) {
    console.log("\nBrowser problems:");
    for (const p of relevant.slice(0, 30)) console.log(`  ${p}`);
  }
  check("no browser errors", relevant.length === 0, `${relevant.length}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
