// End-to-end check of 設計方向提案與樂團確認 (phase 4) against a running server (offline designer).
// Usage: BASE=http://localhost:3140 SHOTS=/tmp/shots node scripts/e2e-directions.cjs
//
// Creates a song through the API, then on the design overview:
//   - uploads three generated PNG reference images with distinct colours to the mood board (and
//     writes a note on one), plus one to a band's mood board shown read-only on the song;
//   - 「提出設計方向」 (offline): 2–3 distinct directions whose palettes reflect the mood board;
//   - the style frames render as non-blank images (the real renderer, in the browser);
//   - 「採用這個方向」 changes the plan the console shows; 「復原」 brings the old plan back;
//   - the 一頁提案 fits one A4 landscape page (print emulation: no overflow, page.pdf has 1 page).
// Screenshots: the directions comparison (light, dark), the mood board, the proposal (screen + PDF).
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
const zlib = require("node:zlib");

const BASE = process.env.BASE || "http://localhost:3140";
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
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial", ...opts });

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// PNG generation (no dependencies): stripes of colours with the given shares
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, parts) {
  const rows = [];
  const cols = parts.flatMap(([hex, share]) => Array(Math.round(share * width)).fill(hex));
  while (cols.length < width) cols.push(parts[0][0]);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const v = parseInt(cols[x].slice(1), 16);
      row[1 + x * 3] = (v >> 16) & 255;
      row[2 + x * 3] = (v >> 8) & 255;
      row[3 + x * 3] = v & 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const MOOD = [
  { file: "紅橘海報.png", parts: [["#e8452c", 0.7], ["#15151c", 0.3]] },
  { file: "青綠劇照.png", parts: [["#1fa3a8", 0.65], ["#f2efe8", 0.35]] },
  { file: "深藍金光.png", parts: [["#1b2a6b", 0.6], ["#f0b429", 0.4]] },
];

function hsl(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

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

/** mean and spread of an <img>'s luminance (drawn into a small canvas) */
function imageStats(page, selector) {
  return page.$$eval(selector, (imgs) =>
    imgs.map((img) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 36;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      let sq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        sum += y;
        sq += y * y;
      }
      const mean = sum / n;
      return { w: img.naturalWidth, h: img.naturalHeight, mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
    }),
  );
}

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  const page = await context.newPage();
  watch(page, "process");
  try {
    const song = await makeSong("方向測試之歌");
    const originalTitle = song.plan.keyVisual.title;
    check("song designed (offline)", !!song.plan && song.status === "ready", originalTitle);

    // buffers, not paths: Playwright's file chooser drops files whose path is not ASCII
    const files = MOOD.map((m) => ({ name: m.file, mimeType: "image/png", buffer: png(240, 180, m.parts) }));

    // --- mood board --------------------------------------------------------
    await page.goto(`${BASE}/p/${song.id}/process`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="directions"]');
    await page.setInputFiles('[data-testid="mood-input"]', files);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-card"]').length === 3, null, { timeout: 30000 });
    const stored = await api("GET", `/api/projects/${song.id}/moodboard`);
    const measured = stored.images.map((m) => m.stats?.palette?.[0]);
    check("3 reference images uploaded and measured in the browser", stored.images.length === 3 && measured.every(Boolean), measured.join(" "));
    const firstDominant = stored.images.find((m) => m.name === "紅橘海報")?.stats?.palette?.[0] ?? "";
    check("k-means found the dominant colour", hueDist(hsl(firstDominant).h, hsl("#e8452c").h) < 6, firstDominant);
    check("uploads are downscaled WebP / JPEG copies", stored.images.every((m) => /image\/(webp|jpeg)/.test(m.mimeType) && Math.max(m.width, m.height) <= 1024), stored.images.map((m) => m.mimeType).join(" "));
    // a note on the first image
    await page.locator('[data-testid="mood-card"] button').first().click();
    await page.getByRole("textbox", { name: "給設計師的說明" }).fill("喜歡這個顏色");
    await page.getByRole("button", { name: "完成" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="mood-card"]')].some((c) => c.textContent.includes("喜歡這個顏色")), null, { timeout: 10000 });
    check("note saved on a reference image", (await api("GET", `/api/projects/${song.id}/moodboard`)).images.some((m) => m.note === "喜歡這個顏色"));
    await page.waitForTimeout(400);
    await page.locator('[data-testid="moodboard"]').screenshot({ path: path.join(SHOTS, "moodboard.png") });

    // band mood board, read-only on the song
    const band = await api("POST", "/api/bands", { name: "方向測試樂團" });
    const form = new FormData();
    form.set("meta", JSON.stringify({ width: 240, height: 180, note: "樂團的顏色" }));
    form.set("file", new Blob([png(240, 180, [["#7a3cff", 1]])], { type: "image/png" }), "band.png");
    const bandUp = await fetch(`${BASE}/api/bands/${band.id}/moodboard`, { method: "POST", body: form });
    check("band mood board upload", bandUp.status === 201);
    await api("PATCH", `/api/projects/${song.id}`, { bandId: band.id });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-card"]').length === 4, null, { timeout: 15000 });
    const bandCard = await page.locator('[data-testid="mood-card"]').first().textContent();
    check("the band's image shows first on the song's board, marked 樂團", /圖 1/.test(bandCard) && /樂團/.test(bandCard), bandCard.slice(0, 40));
    await api("PATCH", `/api/projects/${song.id}`, { bandId: null });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="mood-card"]').length === 3, null, { timeout: 15000 });

    // --- directions --------------------------------------------------------
    await page.getByRole("button", { name: "提出設計方向" }).click();
    await page.waitForSelector('[data-testid="direction-card"]', { timeout: 60000 });
    const dirs = await page.$$eval('[data-testid="direction-card"]', (cards) =>
      cards.map((c) => ({
        letter: c.getAttribute("data-direction"),
        name: c.querySelector("h3")?.textContent?.replace(/^方向 .：/, "") ?? "",
        swatches: [...c.querySelectorAll('[data-testid="direction-swatch"]')].map((s) => s.getAttribute("data-hex")),
        status: c.querySelector('[data-testid="direction-status"]')?.textContent ?? "",
      })),
    );
    check("2–3 directions proposed", dirs.length >= 2 && dirs.length <= 3, dirs.map((d) => `${d.letter}「${d.name}」`).join(" "));
    check("the directions are distinct (names and palettes)", new Set(dirs.map((d) => d.name)).size === dirs.length && new Set(dirs.map((d) => d.swatches.join())).size === dirs.length);
    const moodHues = MOOD.map((m) => hsl(m.parts[0][0]).h);
    const reflects = dirs.map((d) => d.swatches.some((hex) => {
      const c = hsl(hex);
      return c.s > 0.2 && c.l > 0.12 && c.l < 0.92 && moodHues.some((h) => hueDist(c.h, h) < 25);
    }));
    check("every direction's palette reflects the mood board", reflects.every(Boolean), dirs.map((d) => d.swatches.join(",")).join(" | "));
    check("the favourite colour (note 「喜歡這個顏色」) leads a direction", dirs.some((d) => d.swatches.some((h) => hueDist(hsl(h).h, hsl("#e8452c").h) < 12 && hsl(h).s > 0.4)));
    check("directions are saved on the project", ((await api("GET", `/api/projects/${song.id}`)).directions?.directions ?? []).length === dirs.length);

    // style frames
    await page.waitForFunction(
      (n) => {
        const imgs = [...document.querySelectorAll('[data-testid="style-frame"]')];
        return imgs.length >= n * 3 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      },
      dirs.length,
      { timeout: 240000 },
    );
    const stats = await imageStats(page, '[data-testid="style-frame"]');
    const blank = stats.filter((s) => s.sd < 0.01 && s.mean < 0.02);
    check("style frames rendered for every direction (3–4 each)", stats.length >= dirs.length * 3 && stats.length <= dirs.length * 4, `${stats.length} frames`);
    check("style frames are non-blank images at preview size", blank.length === 0 && stats.every((s) => s.w === 960 && s.h === 540), stats.map((s) => `${s.mean.toFixed(2)}/${s.sd.toFixed(2)}`).join(" "));
    await page.waitForTimeout(500);
    await page.locator('[data-testid="directions"]').screenshot({ path: path.join(SHOTS, "directions-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="directions"]').screenshot({ path: path.join(SHOTS, "directions-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // comment + select
    const b = dirs[1];
    const cardB = page.locator('[data-testid="direction-card"][data-direction="B"]');
    await cardB.getByPlaceholder("樂團的意見…").fill("副歌再大聲一點");
    await cardB.getByRole("button", { name: "記下" }).click();
    await cardB.getByText("副歌再大聲一點").waitFor({ timeout: 10000 });
    check("a band comment is kept on the direction", true);
    await cardB.getByRole("button", { name: "採用這個方向" }).click();
    await cardB.getByTestId("direction-status").filter({ hasText: "已選定" }).waitFor({ timeout: 15000 });
    const selected = await api("GET", `/api/projects/${song.id}`);
    check("採用這個方向 makes it the project's plan", selected.plan.keyVisual.title === b.name && selected.previousPlan?.plan?.keyVisual?.title === originalTitle, `${originalTitle} → ${selected.plan.keyVisual.title}`);
    const consolePage = await context.newPage();
    watch(consolePage, "console");
    await consolePage.goto(`${BASE}/p/${song.id}`, { waitUntil: "networkidle" });
    await consolePage.waitForTimeout(1500);
    const consoleText = await consolePage.evaluate(() => document.body.innerText);
    check("the console shows the new plan", consoleText.includes(b.name), b.name);
    await consolePage.close();

    // undo
    await page.getByRole("button", { name: "復原" }).first().click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="direction-status"]')].some((t) => t.textContent.includes("已選定")), null, { timeout: 15000 });
    const undone = await api("GET", `/api/projects/${song.id}`);
    check("復原 brings the previous plan back", undone.plan.keyVisual.title === originalTitle && !undone.previousPlan, undone.plan.keyVisual.title);
    // select again, for the sheet
    await cardB.getByRole("button", { name: "採用這個方向" }).click();
    await cardB.getByTestId("direction-status").filter({ hasText: "已選定" }).waitFor({ timeout: 15000 });

    // --- proposal -----------------------------------------------------------
    const t0 = Date.now();
    await page.getByRole("link", { name: "一頁提案" }).first().click();
    await page.waitForURL(/\/proposal$/);
    await page.waitForSelector('[data-testid="proposal-sheet"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="print-proposal"]')?.hasAttribute("disabled"), null, { timeout: 120000 });
    check("proposal frames come from the client cache after navigation", Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
    const sheetText = await page.locator('[data-testid="proposal-sheet"]').innerText();
    check("the sheet names the song, every direction and the sign-off", sheetText.includes("方向測試之歌") && dirs.every((d) => sheetText.includes(d.name)) && /選擇方向/.test(sheetText) && /簽名/.test(sheetText) && /日期/.test(sheetText));
    check("the sheet has the mood board references", (await page.locator('[data-testid="proposal-sheet"] img[alt^="圖 "]').count()) === 3);
    const frames = await imageStats(page, '[data-testid="proposal-frame"]');
    check("the sheet shows the style frames", frames.length >= dirs.length * 3 && frames.every((f) => f.w > 0 && f.sd > 0.005), `${frames.length}`);
    await page.waitForTimeout(400);
    await shot(page, "proposal-screen", { fullPage: true });

    await page.emulateMedia({ media: "print" });
    const fit = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="proposal-sheet"]');
      const r = sheet.getBoundingClientRect();
      const mm = 96 / 25.4;
      const overflow = [...sheet.querySelectorAll('[data-testid="proposal-direction"], [data-testid="signoff"]')].filter((el) => el.scrollHeight > el.clientHeight + 1).length;
      const hidden = [...document.body.querySelectorAll(".print-hide")].every((el) => getComputedStyle(el).display === "none");
      return { w: r.width / mm, h: r.height / mm, overflow, hidden, scroll: sheet.scrollHeight - sheet.clientHeight };
    });
    check("print layout is exactly A4 landscape with nothing cut off", Math.abs(fit.w - 297) < 1 && Math.abs(fit.h - 210) < 1 && fit.overflow === 0 && fit.scroll <= 1 && fit.hidden, JSON.stringify(fit));
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, path: path.join(SHOTS, "proposal.pdf") });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
    check("page.pdf is one A4 landscape page", pages === 1 && box && Math.abs(Number(box[1]) - 841.9) < 3 && Math.abs(Number(box[2]) - 595.3) < 3, `${pages} page(s), ${box ? `${box[1]}×${box[2]} pt` : "no MediaBox"}`);
    await page.emulateMedia({ media: "screen" });

    // dark chrome, light paper
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    const paperBg = await page.$eval('[data-testid="proposal-sheet"]', (el) => getComputedStyle(el).backgroundColor);
    check("the paper stays white in dark mode", /255, 255, 255/.test(paperBg), paperBg);
    await shot(page, "proposal-screen-dark");
    await page.emulateMedia({ colorScheme: "light" });

    // revise (offline: the instruction path) and reject
    await page.goto(`${BASE}/p/${song.id}/process`, { waitUntil: "networkidle" });
    const cardA = page.locator('[data-testid="direction-card"][data-direction="A"]');
    await cardA.getByRole("button", { name: "修改" }).click();
    await page.getByRole("textbox", { name: /樂團的意見/ }).fill("整體藍一點");
    await page.getByRole("button", { name: "請設計師修改" }).click();
    await cardA.getByText("整體藍一點").waitFor({ timeout: 60000 });
    const revised = (await api("GET", `/api/projects/${song.id}`)).directions.directions[0];
    check("修改 revises one direction with the note (redesign path)", revised.comments.some((c) => c.kind === "revision" && c.text === "整體藍一點"));
    const cardC = page.locator('[data-testid="direction-card"][data-direction="C"]');
    await cardC.getByRole("button", { name: "退回" }).click();
    await cardC.getByTestId("direction-status").filter({ hasText: "已退回" }).waitFor({ timeout: 10000 });
    check("退回 marks a direction 已退回", true);
  } catch (err) {
    check("run", false, err && err.stack ? err.stack : String(err));
    await shot(page, "directions-failure").catch(() => {});
  } finally {
    await browser.close();
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
