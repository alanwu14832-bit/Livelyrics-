// Usage: node shot.mjs <url> <out.png> [width] [height] [waitMs]
// Headless Chromium screenshot + console error dump (WebGL via SwiftShader).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
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
const [url, out, w = "1600", h = "900", wait = "2500"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`[console.${m.type()}]`, m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log("saved", out);
await browser.close();
