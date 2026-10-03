// The lyric-vs-picture contrast of a rendered stage frame (phase 7's legibility guarantee).
//
// measureContrast(page, frame, probe, region?): two PNG screenshots (Buffers) of the same moment of
// the song — `frame` over the picture being checked, `probe` over a flat mid-grey program. The type
// is laid out the same in both (the layout does not depend on the picture), so the probe tells where
// the glyphs are: over flat grey the letters are the pixels that stand out furthest from the grey, in
// the ink's direction (the darkened pocket around light ink goes the other way); other pixels that
// move in the ink's direction, or take a colour over the grey, are the type's own (glow, glitch
// echo, RGB-split fringe, labels) and are not counted as picture. In `frame`, the ratio is the WCAG
// contrast of the median glyph pixel against the 90th-percentile picture pixel in a ring 3 px – 1.2 %
// of the short side around the glyphs (light ink; the 10th percentile for dark ink). `region`
// ({ x0, y0, x1, y1 } fractions of the frame, y down) restricts the glyphs to that box (the display
// word). Returns { ratio, ink, ring, glyphs, ringPx, decor, dark }. Runs in the page (a 2D canvas
// decodes the PNGs), so it needs no dependency.
//
// As a script (round 10, B3): checks every sung line of the given projects (every project of the
// server without ids) on the song's own program — ≥ 4.5 : 1 for every line, ≥ 7 : 1 for the display
// word (the giant / bled / window word, from the type layer's `data-display` box):
//
//   BASE=http://localhost:3100 [SHOTS=/tmp/shots] node scripts/legibility.cjs [projectId ...]
//
// Each project's program is swapped for the flat-grey probe while the probe frames are taken and
// restored afterwards. Exit code 1 when any line fails.

/** A scene program that draws flat mid-grey (the probe's picture). */
const PROBE_PROGRAM = "vec3 scene(vec2 fc) {\n  return vec3(0.5);\n}\n";
/** What every readable line must meet, and what a display word must meet (scenes/legibility.ts LEGIBLE_MIN / DISPLAY_MIN). */
const LINE_MIN = 4.5;
const DISPLAY_MIN = 7;

async function measureContrast(page, frame, probe, region = null) {
  return page.evaluate(
    async ({ a, b, region }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const W = ia.naturalWidth;
      const H = ia.naturalHeight;
      const px = (im) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d");
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, W, H).data;
      };
      const A = px(ia);
      const P = px(ib);
      const LUT = new Float32Array(256).map((_, i) => {
        const x = i / 255;
        return x < 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      const lum = (d, i) => 0.2126 * LUT[d[i]] + 0.7152 * LUT[d[i + 1]] + 0.0722 * LUT[d[i + 2]];
      const N = W * H;
      const La = new Float32Array(N);
      const Sp = new Float32Array(N);
      for (let p = 0; p < N; p++) {
        La[p] = lum(A, p * 4);
        Sp[p] = Math.sqrt(lum(P, p * 4));
      }
      // the probe's grey (its most common level)
      const hist = new Uint32Array(256);
      for (let p = 0; p < N; p++) hist[Math.min(255, Math.floor(Sp[p] * 256))]++;
      let mode = 0;
      for (let k = 1; k < 256; k++) if (hist[k] > hist[mode]) mode = k;
      const grey = (mode + 0.5) / 256;
      // the ink's direction: the side of the grey the most extreme pixels lie on
      const devs = [];
      for (let p = 0; p < N; p++) {
        const d = Sp[p] - grey;
        if (Math.abs(d) > 0.04) devs.push(d);
      }
      if (devs.length < 40) return { ratio: null, glyphs: 0 };
      devs.sort((u, v) => Math.abs(v) - Math.abs(u));
      const top = devs.slice(0, Math.max(40, Math.floor(devs.length * 0.02)));
      const lightInk = top.filter((d) => d > 0).length >= top.length / 2;
      const sgn = lightInk ? 1 : -1;
      const same = top.filter((d) => Math.sign(d) === sgn).map(Math.abs).sort((u, v) => u - v);
      const inkDev = same[Math.floor(same.length / 2)];
      const glyph = new Uint8Array(N);
      const decor = new Uint8Array(N);
      // the region (the display word's box): glyph pixels outside it are the type's own, not measured
      const rx0 = region ? Math.floor(region.x0 * W) : 0;
      const ry0 = region ? Math.floor(region.y0 * H) : 0;
      const rx1 = region ? Math.ceil(region.x1 * W) : W;
      const ry1 = region ? Math.ceil(region.y1 * H) : H;
      for (let p = 0; p < N; p++) {
        const d = (Sp[p] - grey) * sgn;
        const x = p % W;
        const y = (p - x) / W;
        const inRegion = x >= rx0 && x < rx1 && y >= ry0 && y < ry1;
        if (d > inkDev * 0.72) {
          if (inRegion) glyph[p] = 1;
          else decor[p] = 1;
        } else if (d > 0.03) decor[p] = 1;
        // a coloured pixel over the grey probe is the type's own colour too (an RGB-split fringe,
        // an accent echo that happens to match the grey's luminance)
        else {
          const i = p * 4;
          const chroma = Math.max(P[i], P[i + 1], P[i + 2]) - Math.min(P[i], P[i + 1], P[i + 2]);
          if (chroma > 36) decor[p] = 1;
        }
      }
      const gl = [];
      for (let p = 0; p < N; p++) if (glyph[p]) gl.push(La[p]);
      if (gl.length < 40) return { ratio: null, glyphs: gl.length };
      // distance bands around the glyphs: 1–2 px is the antialiased edge, 3–R px is the ring
      const R = Math.max(5, Math.round(Math.min(W, H) * 0.012));
      const near = new Uint8Array(N);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!glyph[y * W + x]) continue;
          for (let dy = -R; dy <= R; dy++)
            for (let dx = -R; dx <= R; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const q = yy * W + xx;
              const d2 = dx * dx + dy * dy;
              if (d2 <= 4) near[q] = 2;
              else if (d2 <= R * R && near[q] === 0) near[q] = 1;
            }
        }
      const ringL = [];
      let decorN = 0;
      for (let p = 0; p < N; p++) {
        if (near[p] !== 1 || glyph[p]) continue;
        if (decor[p]) {
          decorN++;
          continue;
        }
        ringL.push(La[p]);
      }
      gl.sort((u, v) => u - v);
      ringL.sort((u, v) => u - v);
      const g = gl[Math.floor(gl.length / 2)];
      const ring = ringL.length ? ringL[Math.floor(ringL.length * (lightInk ? 0.9 : 0.1))] : 0;
      const ratio = (Math.max(g, ring) + 0.05) / (Math.min(g, ring) + 0.05);
      return { ratio, ink: g, ring, glyphs: gl.length, ringPx: ringL.length, decor: decorN, dark: !lightInk };
    },
    { a: `data:image/png;base64,${frame.toString("base64")}`, b: `data:image/png;base64,${probe.toString("base64")}`, region },
  );
}

module.exports = { measureContrast, PROBE_PROGRAM, LINE_MIN, DISPLAY_MIN };

// ---------------------------------------------------------------------------
// the check (run as a script)
// ---------------------------------------------------------------------------

if (require.main === module) {
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
  const SHOTS = process.env.SHOTS || "";
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"];
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const W = Number(process.env.LEGIBILITY_WIDTH || 1280);
  const H = Math.round((W * 9) / 16);

  const api = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  /** the moment a line is read: settled after its entrance, well inside its time (capture.cjs uses the same) */
  const momentOf = (l) => Math.round((l.start + Math.min(2.2, Math.max(0.8, (l.end - l.start) * 0.55))) * 100) / 100;

  (async () => {
    const browser = await chromium.launch({ args: ARGS });
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    context.setDefaultNavigationTimeout(90000);
    const measurePage = await context.newPage();
    const grab = async (id, t) => {
      const p = await context.newPage();
      await p.setViewportSize({ width: W, height: H });
      await p.goto(`${BASE}/stage-lab?project=${id}&program=plan&chrome=0&play=0&aq=0&t=${t}`, { waitUntil: "load" });
      await p
        .waitForFunction(() => document.querySelector("[data-stage-backend]")?.getAttribute("data-scene-program") === "ready", null, { timeout: 60000 })
        .catch(() => {});
      await p.waitForTimeout(2500);
      const info = await p.evaluate(() => {
        const el = document.querySelector("[data-type-layer]");
        return { display: el?.getAttribute("data-display") ?? null, recipe: el?.getAttribute("data-recipe") ?? null, text: el?.textContent ?? "" };
      });
      const png = await p.screenshot();
      await p.close();
      return { png, ...info };
    };
    const rows = [];
    let failures = 0;
    const list = ids.length ? ids : (await api("GET", "/api/projects")).map((p) => p.id);
    for (const id of list) {
      const project = await api("GET", `/api/projects/${id}`);
      const plan = project.plan;
      const program = plan?.sceneProgram;
      const title = project.meta?.title ?? id;
      if (!plan?.typeSystem) {
        console.log(`-- ${title}: no type system, skipped`);
        continue;
      }
      const duration = project.meta?.duration || project.analysis?.duration || 0;
      const lines = (project.lyrics?.lines ?? []).map((l, i, all) => ({ ...l, end: l.end ?? all[i + 1]?.start ?? duration, index: i })).filter((l) => l.text && l.text.trim() && l.end - l.start > 0.9);
      if (!lines.length) {
        console.log(`-- ${title}: no sung lines, skipped`);
        continue;
      }
      console.log(`-- ${title} (${id}): ${lines.length} lines${program ? `, ${program.recipe ?? program.title}` : ", built-in scenes"}`);
      // the probe: the same moments over flat grey (where the glyphs are)
      const probes = new Map();
      try {
        if (program) await api("PATCH", `/api/projects/${id}`, { plan: { ...plan, sceneProgram: { ...program, source: PROBE_PROGRAM, title: "灰階探針" } } });
        else await api("PATCH", `/api/projects/${id}`, { plan: { ...plan, sceneProgram: { version: 1, engine: "manual", title: "灰階探針", concept: "", source: PROBE_PROGRAM, sections: [], enabled: true } } });
        for (const l of lines) probes.set(l.index, await grab(id, momentOf(l)));
      } finally {
        await api("PATCH", `/api/projects/${id}`, { plan });
      }
      for (const l of lines) {
        const t = momentOf(l);
        const probe = probes.get(l.index);
        const frame = await grab(id, t);
        const all = await measureContrast(measurePage, frame.png, probe.png);
        let display = null;
        const box = (probe.display ?? frame.display ?? "").split(",").map(Number);
        if (box.length === 4 && box.every(Number.isFinite)) {
          display = await measureContrast(measurePage, frame.png, probe.png, { x0: Math.max(0, box[0] - 0.01), y0: Math.max(0, box[1] - 0.01), x1: Math.min(1, box[2] + 0.01), y1: Math.min(1, box[3] + 0.01) });
        }
        const lineOk = all.ratio == null ? false : all.ratio >= LINE_MIN;
        const displayOk = display == null || display.ratio == null || display.ratio >= DISPLAY_MIN;
        const ok = lineOk && displayOk;
        if (!ok) failures++;
        rows.push({ project: title, id, line: l.index, t, text: l.text, recipe: frame.recipe, ratio: all.ratio, display: display?.ratio ?? null, glyphs: all.glyphs, ok });
        console.log(`${ok ? "PASS" : "FAIL"} ${title} #${l.index} @${t}s ${frame.recipe ?? "?"} ${all.ratio == null ? "—" : all.ratio.toFixed(2)}:1${display ? ` display ${display.ratio == null ? "—" : display.ratio.toFixed(2)}:1` : ""} 「${l.text}」`);
        if (SHOTS) fs.writeFileSync(path.join(SHOTS, `legibility-${title.replace(/[^\w一-鿿-]+/g, "_")}-${l.index}.png`), frame.png);
      }
    }
    await browser.close();
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, "legibility.json"), JSON.stringify(rows, null, 2));
    const measured = rows.filter((r) => r.ratio != null);
    const displays = rows.filter((r) => r.display != null);
    const worst = measured.length ? Math.min(...measured.map((r) => r.ratio)) : null;
    const worstDisplay = displays.length ? Math.min(...displays.map((r) => r.display)) : null;
    console.log(`\n${rows.length - failures}/${rows.length} lines pass (≥ ${LINE_MIN}:1 every line, ≥ ${DISPLAY_MIN}:1 display words); worst line ${worst == null ? "—" : worst.toFixed(2)}:1, worst display word ${worstDisplay == null ? "—" : worstDisplay.toFixed(2)}:1 over ${displays.length} display words`);
    process.exit(failures ? 1 : 0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
