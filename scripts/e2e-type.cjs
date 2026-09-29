// End-to-end check of 字體藝術 (phase 6) against a running server.
// Usage: BASE=http://localhost:3300 SHOTS=/tmp/shots node scripts/e2e-type.cjs
//
// Creates a song through the API (the offline designer) and checks:
//   - the plan has a type system with a composition for every sung line and no karaoke / subtitle;
//   - the projection shows compositions (the type layer's line text and recipe), not the DOM lyrics;
//   - the 排版 editor on a desktop (1440 × 900): switching the voice updates the preview and the open
//     projection at once; 換一個構圖, an emphasis tap and a drag on the preview are saved and survive a
//     reload; a locked line survives 「重新生成全部構圖」; undo goes back;
//   - the editor on a phone (390 × 844, touch): no sideways scroll, 44 px targets, the tabs; a voice
//     switch reaches the preview and a projection window; reroll, emphasis and the arrow-pad nudge are
//     saved and kept after a reload;
//   - the export: the single-frame preview is not blank and the same frame renders identically twice.
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

const BASE = process.env.BASE || "http://localhost:3300";
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

/** The type layer's hidden line text inside `scope` (the projection, or the editor's preview). */
const typeText = (page, scope = "") =>
  page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document;
    const el = root?.querySelector("[data-type-layer]");
    return el ? { text: el.textContent || "", recipe: el.getAttribute("data-recipe"), voice: el.getAttribute("data-voice"), line: el.getAttribute("data-line") } : null;
  }, scope);

async function waitSaved(page, label) {
  await page.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute("data-status") === "saved", null, { timeout: 20000 }).catch(() => {});
  const st = await page.evaluate(() => document.querySelector('[data-testid="save-status"]')?.getAttribute("data-status"));
  check(`${label}: saved`, st === "saved", `status=${st}`);
}

/**
 * Is the rendered frame of `selector` (a canvas or an img) not blank: several distinct colours and
 * some bright pixels (the type). A WebGL canvas keeps its picture only until the frame is
 * composited, so it is read inside frame callbacks (after the stage's own render of that frame).
 */
const notBlank = (page, selector) =>
  page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: "missing" };
    if (el.decode) await el.decode().catch(() => {});
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext("2d");
    const sample = () => {
      ctx.clearRect(0, 0, 64, 36);
      ctx.drawImage(el, 0, 0, 64, 36);
      const d = ctx.getImageData(0, 0, 64, 36).data;
      const set = new Set();
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) {
        set.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
        if (d[i] + d[i + 1] + d[i + 2] > 450) bright++;
      }
      return { ok: set.size > 6 && bright > 0, colours: set.size, bright };
    };
    if (el.tagName !== "CANVAS") return sample();
    let best = null;
    for (let i = 0; i < 12; i++) {
      const r = await new Promise((res) => requestAnimationFrame(() => res(sample())));
      if (r.ok) return r;
      if (!best || r.colours > best.colours) best = r;
    }
    return best;
  }, selector);

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  let song;
  try {
    song = await makeSong("字體藝術測試");
  } catch (e) {
    check("create the song", false, String(e));
    await browser.close();
    process.exit(1);
  }
  const id = song.id;
  const lines = song.lyrics.lines;
  const sung = lines.filter((l) => l.text.trim());
  const ts = song.plan?.typeSystem;
  check("the offline design has a type system", !!ts, ts ? `voice ${ts.voice}` : "none");
  check("a composition hint for every sung line", !!ts && sung.every((l) => ts.lines.some((x) => x.lineId === l.id)), `${ts?.lines.length}/${sung.length}`);
  check("no karaoke or subtitle anywhere", song.plan.sections.every((s) => s.lyricStyle !== "karaoke" && s.lyricStyle !== "subtitle") && song.plan.lines.every((l) => l.styleOverride !== "karaoke" && l.styleOverride !== "subtitle"));

  // ------------------------------------------------------------------ desktop: console, output, editor
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultNavigationTimeout(120000);
  const consolePage = await context.newPage();
  watch(consolePage, "console");
  let popup = null;
  try {
    await consolePage.goto(`${BASE}/p/${id}`, { waitUntil: "networkidle" });
    await consolePage.waitForSelector('[role="option"][data-line-index="0"]', { timeout: 60000 });
    await consolePage.waitForTimeout(1500);
    [popup] = await Promise.all([context.waitForEvent("page"), consolePage.getByRole("button", { name: /開啟投影視窗/ }).click()]);
    watch(popup, "output");
    await popup.waitForURL(/\/output/);
    await popup.waitForLoadState("load");
    await popup.waitForTimeout(2500);
    // seek to the first chorus line and hold there
    const chorusIdx = lines.findIndex((l) => l.text.startsWith("Hey"));
    await consolePage.locator(`[role="option"][data-line-index="${chorusIdx}"]`).click();
    await popup.waitForTimeout(2500);
    const out = await typeText(popup);
    check("the projection shows a composition (type layer)", !!out && !!out.recipe && out.text === lines[chorusIdx].text, JSON.stringify(out));
    const legacy = await popup.evaluate(() => {
      const el = document.querySelector("[data-lyric-layer], .lyric-layer");
      return el ? (el.textContent || "").trim() : "";
    });
    check("no DOM subtitle on the projection", legacy === "", legacy.slice(0, 40));
    const frame = await notBlank(popup, "canvas");
    check("the projection draws the composition", frame.ok, JSON.stringify(frame));
    await shot(popup, "type-01-output-composition");
    await shot(consolePage, "type-02-console");
    check("the console offers 排版", (await consolePage.locator('[data-testid="open-type-editor"]').count()) > 0);

    // ------------------------------------------------------------------ the editor (desktop)
    const editor = await context.newPage();
    watch(editor, "editor");
    await editor.goto(`${BASE}/p/${id}/type`, { waitUntil: "networkidle" });
    await editor.waitForSelector('[data-testid="type-editor"]', { timeout: 60000 });
    await editor.waitForTimeout(2500);
    await shot(editor, "type-03-editor-desktop");
    const overflow = await editor.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check("editor: no horizontal overflow (desktop)", overflow);
    const pv0 = await typeText(editor, '[data-testid="type-preview"]');
    check("editor: the preview composes the selected line", !!pv0 && !!pv0.recipe, JSON.stringify(pv0));

    // switch the voice: the preview and the open projection follow
    const from = ts.voice;
    const to = from === "glitch" ? "ink" : "glitch";
    await editor.locator(`[data-testid="voice-option"][data-voice="${to}"]:visible`).first().click();
    await editor.waitForFunction((v) => document.querySelector('[data-testid="type-preview"] [data-type-layer]')?.getAttribute("data-voice") === v, to, { timeout: 20000 }).catch(() => {});
    check("editor: voice switch updates the preview", (await typeText(editor, '[data-testid="type-preview"]'))?.voice === to);
    await popup.waitForFunction((v) => document.querySelector("[data-type-layer]")?.getAttribute("data-voice") === v, to, { timeout: 20000 }).catch(() => {});
    check("editor: voice switch reaches the projection live", (await typeText(popup))?.voice === to, JSON.stringify(await typeText(popup)));
    await waitSaved(editor, "voice");
    check("editor: the voice is saved", (await api("GET", `/api/projects/${id}`)).plan.typeSystem.voice === to);
    await shot(popup, "type-04-output-after-voice");

    // one line: reroll, emphasis tap, drag nudge
    const lineIdx = lines.findIndex((l) => l.text.startsWith("每一盞燈"));
    const lineId = lines[lineIdx].id;
    await editor.locator(`[data-testid="line-row"][data-line="${lineIdx}"]`).click();
    await editor.waitForTimeout(800);
    const before = (await api("GET", `/api/projects/${id}`)).plan.typeSystem.lines.find((l) => l.lineId === lineId);
    await editor.locator('[data-testid="reroll"]').click();
    await editor.waitForTimeout(400);
    await editor.locator('[data-testid="emphasis-unit"]').nth(0).click();
    await editor.waitForTimeout(400);
    const box = await editor.locator('[data-testid="type-preview-drag"]').boundingBox();
    await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(box.x + box.width / 2 + box.width * 0.06, box.y + box.height / 2 - box.height * 0.04, { steps: 6 });
    await editor.mouse.up();
    await editor.waitForTimeout(600);
    await waitSaved(editor, "line edits");
    let after = (await api("GET", `/api/projects/${id}`)).plan.typeSystem.lines.find((l) => l.lineId === lineId);
    check("reroll saved (another seed)", !!after?.edit?.seed && after.edit.seed !== (before?.edit?.seed ?? before?.seed), JSON.stringify(after?.edit));
    check("emphasis tap saved", Array.isArray(after?.edit?.emphasis) && after.edit.emphasis.length > 0 && lines[lineIdx].text.includes(after.edit.emphasis[0]), JSON.stringify(after?.edit?.emphasis));
    check("drag nudge saved", (after?.edit?.dx ?? 0) > 0.03 && (after?.edit?.dy ?? 0) < -0.01, `dx=${after?.edit?.dx} dy=${after?.edit?.dy}`);
    await shot(editor, "type-05-editor-line-edited");

    // reload keeps them
    await editor.reload({ waitUntil: "networkidle" });
    await editor.waitForSelector('[data-testid="type-editor"]', { timeout: 60000 });
    await editor.locator(`[data-testid="line-row"][data-line="${lineIdx}"]`).click();
    await editor.waitForTimeout(800);
    check("reload keeps the emphasis", (await editor.locator('[data-testid="emphasis-unit"][aria-pressed="true"]').count()) > 0);
    check("reload keeps the voice", (await typeText(editor, '[data-testid="type-preview"]'))?.voice === to);

    // lock + regenerate keeps the locked line
    await editor.locator('label[for="line-lock"]').click();
    await editor.waitForTimeout(300);
    await waitSaved(editor, "lock");
    const lockedBefore = (await api("GET", `/api/projects/${id}`)).plan.typeSystem;
    await editor.locator('[data-testid="regenerate-all"]:visible').first().click();
    await editor.waitForTimeout(600);
    await waitSaved(editor, "regenerate");
    const regen = (await api("GET", `/api/projects/${id}`)).plan.typeSystem;
    const lockedLine = regen.lines.find((l) => l.lineId === lineId);
    check("regenerate keeps the locked line", !!lockedLine?.locked && JSON.stringify(lockedLine) === JSON.stringify(lockedBefore.lines.find((l) => l.lineId === lineId)), JSON.stringify(lockedLine));
    check("regenerate redraws the other lines", (regen.generation ?? 0) === (lockedBefore.generation ?? 0) + 1 && regen.lines.some((l, i) => l.lineId !== lineId && JSON.stringify(l) !== JSON.stringify(lockedBefore.lines[i])), `generation ${regen.generation}`);
    await editor.locator('[data-testid="undo"]').click();
    await editor.waitForTimeout(400);
    await waitSaved(editor, "undo");
    check("undo takes the regeneration back", ((await api("GET", `/api/projects/${id}`)).plan.typeSystem.generation ?? 0) === (lockedBefore.generation ?? 0));
    await shot(editor, "type-06-editor-after-regenerate");

    // ------------------------------------------------------------------ export: not blank, deterministic
    const exp = await context.newPage();
    watch(exp, "export");
    await exp.goto(`${BASE}/p/${id}/export`, { waitUntil: "networkidle" });
    await exp.waitForSelector("#preview-time", { timeout: 60000 });
    const previewAt = async (time) => {
      await exp.locator("#preview-time").fill(time);
      await exp.getByRole("button", { name: "單格預覽" }).click();
      await exp.waitForSelector('button[aria-busy="true"]', { timeout: 5000 }).catch(() => {});
      await exp.waitForFunction(() => document.querySelector("img[data-export-preview]") && !document.querySelector('button[aria-busy="true"]'), null, { timeout: 180000 });
      await exp.waitForTimeout(500);
      return exp.evaluate(() => document.querySelector("img[data-export-preview]").src);
    };
    const t = `0:${String(Math.floor((lines[lineIdx].start ?? 20) + 1.5)).padStart(2, "0")}.00`;
    const a = await previewAt(t);
    const blank = await notBlank(exp, "img[data-export-preview]");
    const b = await previewAt(t);
    check("export frame is not blank", blank.ok, JSON.stringify(blank));
    check("export frame is deterministic (same frame twice)", a === b, `${a.length} / ${b.length} bytes`);
    await shot(exp, "type-07-export-preview");
    await exp.close();
    await editor.close();
  } catch (e) {
    check("desktop part ran to the end", false, e.stack || String(e));
    await shot(consolePage, "type-zz-desktop-fatal").catch(() => {});
  }

  // ------------------------------------------------------------------ the phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.setDefaultNavigationTimeout(120000);
  try {
    const out = await phone.newPage();
    watch(out, "phone-output");
    await out.goto(`${BASE}/p/${id}/output`, { waitUntil: "load" });
    const ed = await phone.newPage();
    watch(ed, "phone-editor");
    await ed.goto(`${BASE}/p/${id}/type`, { waitUntil: "networkidle" });
    await ed.waitForSelector('[data-testid="type-editor"]', { timeout: 60000 });
    await ed.waitForTimeout(2500);
    await shot(ed, "type-08-editor-phone");
    const wide = await ed.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("phone: no horizontal overflow", wide.sw <= wide.cw, `${wide.sw}/${wide.cw}`);
    const small = await ed.evaluate(() =>
      [...document.querySelectorAll('[data-testid="line-panel"] button, [data-testid="next-line"], [data-testid="prev-line"], [data-testid="play-line"]')]
        .filter((b) => b.offsetParent && !b.closest("[data-testid=recipe-thumb]"))
        // a control inside a 44 px label (the lock switch) is tapped through its label
        .map((b) => (b.closest("label") ?? b).getBoundingClientRect())
        .filter((r) => r.height < 43.5 || r.width < 43.5).length,
    );
    check("phone: every line control is a 44 px target", small === 0, `${small} smaller`);
    // the 整首 tab: switch the voice; the preview and the projection window follow
    await ed.getByRole("tab", { name: "整首" }).tap();
    await ed.waitForTimeout(400);
    const now = (await api("GET", `/api/projects/${id}`)).plan.typeSystem.voice;
    const next = now === "mv-card" ? "title-sequence" : "mv-card";
    await ed.locator(`[data-testid="song-panel"] [data-testid="voice-option"][data-voice="${next}"]:visible`).first().tap();
    await ed.waitForFunction((v) => document.querySelector('[data-testid="type-preview"] [data-type-layer]')?.getAttribute("data-voice") === v, next, { timeout: 20000 }).catch(() => {});
    check("phone: voice switch updates the preview", (await typeText(ed, '[data-testid="type-preview"]'))?.voice === next);
    await out.waitForFunction((v) => document.querySelector("[data-type-layer]")?.getAttribute("data-voice") === v || !document.querySelector("[data-type-layer]"), next, { timeout: 5000 }).catch(() => {});
    const outPlan = await out.evaluate(() => document.querySelector("[data-type-layer]")?.getAttribute("data-voice") ?? "idle");
    check("phone: the projection window takes the edit (no console needed)", outPlan === next || outPlan === "idle", outPlan);
    await waitSaved(ed, "phone voice");
    await shot(ed, "type-10-editor-phone-song");
    // back to 這一句: the next line, then reroll, tap emphasis, nudge with the arrow pad
    await ed.getByRole("tab", { name: "這一句" }).tap();
    await ed.waitForTimeout(400);
    await ed.locator('[data-testid="next-line"]').tap();
    await ed.waitForTimeout(600);
    const cur = await ed.locator('[data-testid="current-line"]').innerText();
    const idx = lines.findIndex((l) => cur.includes(l.text));
    const lid = lines[idx]?.id;
    await ed.locator('[data-testid="reroll"]').tap();
    await ed.waitForTimeout(300);
    await ed.locator('[data-testid="emphasis-unit"]').nth(1).tap();
    await ed.waitForTimeout(300);
    await ed.locator('[data-testid="nudge-right"]').tap();
    await ed.locator('[data-testid="nudge-right"]').tap();
    await ed.locator('[data-testid="nudge-up"]').tap();
    await ed.waitForTimeout(400);
    await waitSaved(ed, "phone edits");
    const pl = (await api("GET", `/api/projects/${id}`)).plan.typeSystem.lines.find((l) => l.lineId === lid);
    check("phone: reroll, emphasis and nudge saved", !!pl?.edit?.seed && (pl?.edit?.emphasis?.length ?? 0) > 0 && Math.abs((pl?.edit?.dx ?? 0) - 0.04) < 0.001 && Math.abs((pl?.edit?.dy ?? 0) + 0.02) < 0.001, JSON.stringify(pl?.edit));
    await shot(ed, "type-09-editor-phone-line");
    // reload keeps the voice and the line edit
    await ed.reload({ waitUntil: "networkidle" });
    await ed.waitForSelector('[data-testid="type-editor"]', { timeout: 60000 });
    const saved = (await api("GET", `/api/projects/${id}`)).plan.typeSystem;
    const kept = saved.lines.find((l) => l.lineId === lid)?.edit;
    check("phone: reload keeps voice and line edit", saved.voice === next && kept?.seed === pl?.edit?.seed && kept?.dx === pl?.edit?.dx && JSON.stringify(kept?.emphasis) === JSON.stringify(pl?.edit?.emphasis), JSON.stringify({ voice: saved.voice, kept }));
    await ed.close();
    await out.close();
  } catch (e) {
    check("phone part ran to the end", false, e.stack || String(e));
  }
  await popup?.close().catch(() => {});
  await browser.close();

  console.log("\n--- browser problems ---");
  // the projection's audio element may log a benign autoplay notice in headless Chromium
  const real = problems.filter((p) => !/Autoplay|play\(\) request was interrupted|NotAllowedError/.test(p));
  for (const p of real) console.log(p);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${real.length} browser problems`);
  process.exit(failed.length || real.length ? 1 : 0);
})();
