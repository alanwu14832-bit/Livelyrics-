// Usage: node shot.mjs <url> <out.png> [width] [height] [waitMs]
// Headless Chromium screenshot + console error dump (WebGL via SwiftShader).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
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
