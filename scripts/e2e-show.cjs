// End-to-end check of the live show mode (phase 2b) on an isolated dev server.
// Usage: start a dev server (e.g. on :3110), then
//   BASE=http://localhost:3110 SHOTS=/tmp/shots node scripts/e2e-show.cjs
//
// Builds a band and a show through the API (walk-in, the demo song, an interlude, a second song,
// walk-out), opens the show page's 「開始演出」, the show console /s/<id>/live and its projection
// window /s/<id>/output, GOes through every item, and checks what the projection shows: the look
// text, the song's lyrics, standby mid-song, a held section while the lyrics advance, a loop that
// wraps in LIVE and seeks back in TRACK, and a reload of the console tab.
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.BASE || "http://localhost:3110";
const REPO = path.resolve(__dirname, "..");
const SHOTS = process.env.SHOTS || path.join(REPO, ".e2e-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const WAV = fs.readFileSync(path.join(REPO, "fixtures/demo-song.wav"));
const LRC = fs.readFileSync(path.join(REPO, "fixtures/demo-lyrics.lrc"), "utf8");
// the second song: same audio, its own words (so the output shows which song is on)
const LRC2 = LRC.replace("[ti:示範之歌]", "[ti:第二首歌]")
  .replace("夜色慢慢落在城市的邊緣", "第二首歌從這裡開始")
  .replace("我們把名字寫進風裡面", "海風吹過安靜的港口");

const WALKIN_TEXT = "示範樂團";
const INTERLUDE_TEXT = "稍等一下";
const WALKOUT_TEXT = "謝謝大家";

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
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(f)) problems.push(`[${label}] requestfailed: ${r.url()} ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`);
  });
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), caret: "initial" });
const squash = (s) => s.replace(/\s+/g, "");
// karaoke draws every character twice (base + fill layer)
const shows = (text, want) => squash(text).includes(squash(want)) || squash(text).replace(/(.)\1/g, "$1").includes(squash(want));

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Create a song from the demo WAV and run the pipeline with the given lyrics (offline designer). */
async function makeSong(title, lrc) {
  const form = new FormData();
  form.set("audio", new Blob([WAV], { type: "audio/wav" }), "demo-song.wav");
  form.set("meta", JSON.stringify({ title, artist: "示範樂團", duration: 73 }));
  form.set("analysis", "null");
  const res = await fetch(`${BASE}/api/projects`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`create ${title}: ${res.status}`);
  const project = await res.json();
  const run = await fetch(`${BASE}/api/projects/${project.id}/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lyricsText: lrc }) });
  const text = await run.text(); // the SSE stream to the end
  if (!/"type":"done"/.test(text)) throw new Error(`process ${title} did not finish: ${text.slice(-300)}`);
  return api("GET", `/api/projects/${project.id}`);
}

const look = (text, durationHint) => ({ scene: "gradient", colorway: ["#07070b", "#3d5afe", "#ff4f8b"], media: null, ...(text ? { text } : {}), ...(durationHint ? { durationHint } : {}) });

(async () => {
  // ------------------------------------------------------------------ data
  const song1 = await makeSong("示範之歌", LRC);
  const song2 = await makeSong("第二首歌", LRC2);
  const band = await api("POST", "/api/bands", { name: "示範樂團" });
  await api("PATCH", `/api/projects/${song1.id}`, { bandId: band.id });
  await api("PATCH", `/api/projects/${song2.id}`, { bandId: band.id });
  let show = await api("POST", "/api/shows", { bandId: band.id, name: "e2e 演出", venue: "測試場" });
  const items = [
    { id: "walkin", kind: "walk-in", title: "進場", look: look(WALKIN_TEXT, 300) },
    { id: "song1", kind: "song", projectId: song1.id },
    { id: "mc", kind: "interlude", title: "串場", look: look(INTERLUDE_TEXT, 60) },
    { id: "song2", kind: "song", projectId: song2.id },
    { id: "walkout", kind: "walk-out", title: "散場", look: look(WALKOUT_TEXT) },
  ];
  show = await api("PATCH", `/api/shows/${show.id}`, { items });
  check("show created with 5 items", show.items.length === 5, show.id);
  const plan = song1.plan;
  const lines = song1.lyrics.lines;
  console.log("sections", plan.sections.map((s) => `${s.label}@${s.start}`).join(" "));

  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  context.setDefaultNavigationTimeout(90000);
  // spy on the show channel inside the projection window (what it receives)
  await context.addInitScript(() => {
    const m = location.pathname.match(/^\/s\/([^/]+)\/output/);
    if (!m) return;
    const ch = new BroadcastChannel(`livelyrics:show:${m[1]}`);
    window.__projects = [];
    window.__preloads = [];
    ch.onmessage = (e) => {
      const d = e.data;
      if (d?.type === "state") window.__last = d.state;
      if (d?.type === "project") window.__projects.push({ id: d.project.id, transition: d.transition ?? null });
      if (d?.type === "preload") window.__preloads.push(d.project.id);
    };
    // the darkest the take overlay got since the test last reset it (sampled every frame)
    window.__fadeMax = 0;
    const sample = () => {
      const el = document.querySelector("[data-take-fade]");
      if (el) window.__fadeMax = Math.max(window.__fadeMax, Number(getComputedStyle(el).opacity) || 0);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const page = await context.newPage();
  watch(page, "console");
  try {
    // ---------------------------------------------------------- show page → 開始演出
    await page.goto(`${BASE}/s/${show.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "開始演出" }).waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "開始演出" }).click();
    await page.waitForURL(/\/s\/[^/]+\/live/, { timeout: 90000 });
    check("開始演出 opens the show console", page.url().endsWith(`/s/${show.id}/live`), page.url());
    await page.locator('aside[aria-label="演出清單"]').waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const rail = await page.locator('aside[aria-label="演出清單"]').innerText();
    check("rail lists every item", ["進場", "示範之歌", "串場", "第二首歌", "散場"].every((t) => rail.includes(t)), squash(rail).slice(0, 120));
    check("GO names the armed item", /GO[\s\S]*進場/.test(await page.getByRole("button", { name: /^GO/ }).innerText()));
    await shot(page, "show-01-preshow");

    // ---------------------------------------------------------- projection window
    const [output] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "開啟投影視窗" }).first().click()]);
    watch(output, "output");
    await output.waitForURL(/\/s\/[^/]+\/output/);
    await output.waitForLoadState("load");
    await output.waitForTimeout(2500);
    check("the show output opens at /s/<id>/output", output.url().endsWith(`/s/${show.id}/output`), output.url());
    await page.bringToFront();
    await page.waitForTimeout(800);
    check("console sees the output before the first GO", (await page.locator("body").innerText()).includes("投影已連線"));
    const preloads = await output.evaluate(() => window.__preloads.slice());
    check("output warms the first item before GO", preloads.includes("look-walkin"), preloads.join(","));

    const outText = () => output.locator("body").innerText();
    const last = () => output.evaluate(() => window.__last ?? null);
    const projects = () => output.evaluate(() => window.__projects.slice());
    /** Poll the projection window until `pred(text)` holds (SwiftShader renders at a few fps); ms taken, or -1. */
    const until = async (pred, timeout = 6000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (pred(await outText())) return Date.now() - t0;
        await output.waitForTimeout(100);
      }
      return -1;
    };
    const go = async () => {
      await page.mouse.move(5, 5);
      await page.keyboard.press("g");
      await page.waitForTimeout(1000); // fade through black (0.8 s)
    };

    // ---------------------------------------------------------- GO 1: walk-in
    await go();
    let st = await last();
    check("GO 1 takes the walk-in", st?.projectId === "look-walkin", JSON.stringify({ projectId: st?.projectId, lineIndex: st?.lineIndex }));
    let ms = await until((t) => shows(t, WALKIN_TEXT));
    check("output shows the walk-in text", ms >= 0, `${ms + 1000} ms after GO`);
    const take1 = (await projects()).find((p) => p.id === "look-walkin");
    check("take announces a fade through black", take1?.transition?.kind === "fade" && take1.transition.ms >= 600 && take1.transition.ms <= 1000, JSON.stringify(take1));
    check("rail marks the walk-in on air", /進場[\s\S]*播出中/.test(await page.locator('aside[aria-label="演出清單"]').innerText()));
    await shot(page, "show-02-console-look");
    await shot(output, "show-03-output-look");

    // ---------------------------------------------------------- GO 2: song 1, armed at its start
    await page.waitForTimeout(500);
    await go();
    st = await last();
    check("GO 2 takes the song, at its start, paused", st?.projectId === song1.id && st.t < 0.5 && st.playing === false, JSON.stringify({ projectId: st?.projectId, t: st?.t, playing: st?.playing }));
    ms = await until((t) => !shows(t, WALKIN_TEXT));
    check("the look text is gone from the output", ms >= 0, `${ms + 1000} ms after GO`);
    await page.keyboard.press("Space"); // the band counts in
    await page.waitForTimeout(9500);
    st = await last();
    const first = lines[0];
    check("Space starts the song", st?.playing === true && st.t > 8, `t=${st?.t}`);
    check("output shows the song's lyrics", shows(await outText(), first.text), squash(await outText()).slice(0, 40));

    // ---------------------------------------------------------- hold: the section stays while the lyrics advance
    const heldSection = st.sectionIndex;
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    const chorus = lines.findIndex((l) => l.text.startsWith("Hey"));
    await page.locator(`[role="option"][data-line-index="${chorus}"]`).click();
    await page.waitForTimeout(1200);
    st = await last();
    check(
      "hold keeps the section while the lyrics advance",
      st?.sectionHeld === true && st.sectionIndex === heldSection && st.lineIndex === chorus,
      JSON.stringify({ held: st?.sectionHeld, section: st?.sectionIndex, heldSection, line: st?.lineIndex, chorus }),
    );
    check("output follows the lyric under hold", shows(await outText(), lines[chorus].text));
    check("hold is never shown on the output", !/保持|循環/.test(await outText()));

    // ---------------------------------------------------------- TRACK loop: back to the section start at its end
    await page.mouse.move(5, 5);
    await page.keyboard.press("r"); // loop the section being played (the chorus)
    await page.waitForTimeout(300);
    const loopIndex = plan.sections.findIndex((s) => s.start <= lines[chorus].start + 0.01 && lines[chorus].start < s.end);
    const loopSection = plan.sections[loopIndex];
    const lastInLoop = lines.reduce((k, l, i) => (l.start != null && l.start >= loopSection.start && l.start < loopSection.end ? i : k), chorus);
    await page.locator(`[role="option"][data-line-index="${lastInLoop}"]`).click();
    await page.waitForTimeout(400);
    await shot(page, "show-04-console-song-hold-loop");
    const before = (await last())?.t ?? 0;
    const wait = Math.max(0, loopSection.end - before) + 1.8;
    await page.waitForTimeout(wait * 1000);
    st = await last();
    check(
      "TRACK loop seeks back to the section start",
      st != null && st.t >= loopSection.start && st.t < loopSection.start + 3.5 && st.playing,
      JSON.stringify({ t: st?.t, section: [loopSection.start, loopSection.end], waited: wait.toFixed(1) }),
    );

    // ---------------------------------------------------------- LIVE loop: the last line wraps to the first
    await page.keyboard.press("h"); // release the hold (the loop stays)
    await page.keyboard.press("m"); // LIVE
    await page.waitForTimeout(400);
    await page.locator(`[role="option"][data-line-index="${lastInLoop}"]`).click(); // cue the section's last line
    await page.waitForTimeout(400);
    await page.mouse.move(5, 5);
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
    st = await last();
    const firstInLoop = lines.findIndex((l) => l.start != null && l.start >= loopSection.start && l.start < loopSection.end);
    check("LIVE loop wraps from the last line to the first", st?.mode === "live" && st.lineIndex === firstInLoop, JSON.stringify({ mode: st?.mode, line: st?.lineIndex, firstInLoop, lastInLoop }));
    check("output shows the wrapped line", shows(await outText(), lines[firstInLoop].text));
    await page.keyboard.press("r"); // loop off
    await page.keyboard.press("m"); // back to TRACK
    await page.waitForTimeout(300);

    // ---------------------------------------------------------- standby mid-song, then re-take the song
    await page.keyboard.press("s");
    await page.waitForTimeout(1000);
    st = await last();
    check("S takes the standby look mid-song", st?.projectId === "look-auto-standby", st?.projectId);
    ms = await until((t) => !shows(t, lines[firstInLoop].text));
    check("standby shows no lyrics", ms >= 0, `${ms + 1000} ms after S`);
    check("rail offers the standby on air", (await page.locator('aside[aria-label="演出清單"]').innerText()).includes("待機畫面播出中"));
    await shot(output, "show-05-output-standby");
    await page.locator('aside[aria-label="演出清單"] li', { hasText: "示範之歌" }).locator("button").first().click();
    await page.waitForTimeout(600);
    await go();
    st = await last();
    check("the song is re-taken from the rail", st?.projectId === song1.id && st.t < 0.5, JSON.stringify({ projectId: st?.projectId, t: st?.t }));

    // ---------------------------------------------------------- GO: interlude, song 2, walk-out
    const fadeOpacity = () => output.evaluate(() => Number(getComputedStyle(document.querySelector("[data-take-fade]")).opacity));
    await output.evaluate(() => {
      window.__fadeMax = 0;
    });
    await page.mouse.move(5, 5);
    await page.keyboard.press("g");
    await page.waitForTimeout(1000);
    st = await last();
    check("GO takes the interlude", st?.projectId === "look-mc", st?.projectId);
    ms = await until((t) => shows(t, INTERLUDE_TEXT));
    check("output shows the interlude text", ms >= 0, `${ms + 1000} ms after GO`);
    let fadeEnd = -1;
    for (const t0 = Date.now(); Date.now() - t0 < 4000; await output.waitForTimeout(100)) {
      if ((await fadeOpacity()) === 0) {
        fadeEnd = Date.now() - t0;
        break;
      }
    }
    const darkest = await output.evaluate(() => window.__fadeMax);
    check("the output fades through black by itself", darkest >= 0.9 && fadeEnd >= 0, JSON.stringify({ darkestOverlay: darkest, clearAfterText: `${fadeEnd} ms` }));
    await go();
    st = await last();
    check("GO takes the second song", st?.projectId === song2.id, st?.projectId);
    await page.keyboard.press("Space");
    await page.waitForTimeout(9500);
    check("output shows the second song's lyrics", shows(await outText(), "第二首歌從這裡開始"), squash(await outText()).slice(0, 40));
    await go();
    st = await last();
    check("GO takes the walk-out", st?.projectId === "look-walkout", st?.projectId);
    ms = await until((t) => shows(t, WALKOUT_TEXT));
    check("output shows the walk-out text", ms >= 0, `${ms + 1000} ms after GO`);
    check("GO past the end is disabled", await page.getByRole("button", { name: /^GO/ }).isDisabled());
    const rowColors = await page.evaluate(() => {
      const title = (id) => {
        const el = document.querySelector(`aside[aria-label="演出清單"] li[data-item-id="${id}"] > button`);
        return el ? { state: el.dataset.state ?? null, color: getComputedStyle(el.querySelector(".truncate")).color } : null;
      };
      return { walkin: title("walkin"), walkout: title("walkout") };
    });
    check("played items are dimmed in the rail", rowColors.walkin?.state === "past" && rowColors.walkout?.state === "on-air" && rowColors.walkin.color !== rowColors.walkout.color, JSON.stringify(rowColors));
    // re-take the item on air from the rail: the same item fades through black again
    const takesBefore = (await projects()).length;
    await page.locator('aside[aria-label="演出清單"] li[data-item-id="walkout"] > button').click();
    await page.waitForTimeout(300);
    await go();
    const retake = (await projects()).slice(takesBefore);
    check("re-taking the item on air fades it in again", retake.some((p) => p.id === "look-walkout" && p.transition?.kind === "fade"), JSON.stringify(retake));
    ms = await until((t) => shows(t, WALKOUT_TEXT));
    check("output shows the walk-out after the re-take", ms >= 0 && (await last())?.projectId === "look-walkout", `${ms + 1000} ms after GO`);
    await shot(page, "show-06-console-walkout");

    // ---------------------------------------------------------- reload the console tab
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('aside[aria-label="演出清單"]').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    const railAfter = await page.locator('aside[aria-label="演出清單"]').innerText();
    check("a reload comes back to the item on air", /散場[\s\S]*播出中/.test(railAfter), squash(railAfter).slice(-60));
    const sentAt1 = (await last())?.sentAt ?? 0;
    await page.waitForTimeout(1500);
    st = await last();
    check("the output keeps receiving the same item after the reload", st?.projectId === "look-walkout" && st.sentAt > sentAt1, JSON.stringify({ projectId: st?.projectId }));
    check("the output still shows the walk-out", shows(await outText(), WALKOUT_TEXT));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check("no horizontal overflow: show console", overflow);
    await shot(page, "show-07-console-after-reload");
    await output.close().catch(() => {});
  } catch (err) {
    console.log("FATAL", err);
    await shot(page, "show-zz-fatal").catch(() => {});
    results.push({ name: "fatal", ok: false, detail: String(err) });
  }
  await browser.close();
  console.log("\n--- browser problems ---");
  for (const p of problems) console.log(p);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${problems.length} browser problems`);
  process.exit(failed.length || problems.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
