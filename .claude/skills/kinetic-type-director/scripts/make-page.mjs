#!/usr/bin/env node
/*
 * Builds the type-script page for one video.
 *
 *   node make-page.mjs <data.json> <out.html>
 *
 * It checks the type script (see references/type-script-format.md), then writes ONE
 * self-contained HTML file: the page template with the technique menu, the preview
 * library and the data written into it. The file needs nothing else (only Google Fonts,
 * which it can do without). If the data has a problem, it prints what is wrong and
 * exits with code 1 without writing anything.
 *
 * To look at the page in the Claude desktop app's browser pane, serve its folder:
 *   node serve.mjs <folder of out.html>      then open http://127.0.0.1:3018/<file>.html
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, "../../kinetic-type/assets");
const TEMPLATE = path.resolve(here, "../assets/type-script.html");
const require = createRequire(import.meta.url);
const { KT_MENU } = require(path.join(ASSETS, "menu.js"));
const MENU = new Map(KT_MENU.map((m) => [m.id, m]));

const MODES = ["teaching", "free"];
const ASPECTS = ["16:9", "9:16", "1:1"];

function fail(lines) {
  console.error(["make-page: the page was not written.", ...lines].join("\n"));
  process.exit(1);
}

// ---------------------------------------------------------------- read the input

const [dataPath, outPath] = process.argv.slice(2);
if (!dataPath || !outPath) fail(["Usage: node make-page.mjs <data.json> <out.html>"]);

let raw;
try {
  raw = fs.readFileSync(dataPath, "utf8");
} catch (e) {
  fail([`Can't read "${dataPath}": ${e.code === "ENOENT" ? "there is no such file" : e.message}.`]);
}
let data;
try {
  data = JSON.parse(raw.replace(/^\uFEFF/, ""));
} catch (e) {
  fail([`"${dataPath}" isn't valid JSON: ${e.message}`]);
}

// ---------------------------------------------------------------- check it

const problems = [];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const q = (x) => JSON.stringify(x);

/** Records a problem when `id` is not a technique on the menu; returns true when it is. */
function known(id, where) {
  if (typeof id === "string" && MENU.has(id)) return true;
  problems.push(`${where}: ${q(id)} is not on the menu. Use an id from skills/kinetic-type/references/menu.md.`);
  return false;
}

/** Checks a list of { id, why } picks. */
function picks(list, where) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    problems.push(`${where} must be a list of { id, why }.`);
    return [];
  }
  return list.map((s, i) => {
    if (!isObj(s)) {
      problems.push(`${where} item ${i + 1} must be { id, why }.`);
      return { id: "", why: "" };
    }
    known(s.id, `${where} item ${i + 1}`);
    if (s.why !== undefined && typeof s.why !== "string") problems.push(`${where} item ${i + 1}: why must be text.`);
    return { id: s.id, why: s.why || "" };
  });
}

if (!isObj(data)) fail(["The data must be one JSON object: { title, mode, aspect, houseOptions, house, lines }."]);

if (typeof data.title !== "string" || !data.title.trim()) problems.push("title is missing (it names the page and the saved choices).");
const mode = data.mode === undefined ? "teaching" : data.mode;
if (!MODES.includes(mode)) problems.push(`mode ${q(data.mode)} must be "teaching" or "free".`);
const aspect = data.aspect === undefined ? "16:9" : data.aspect;
if (!ASPECTS.includes(aspect)) problems.push(`aspect ${q(data.aspect)} must be "16:9", "9:16" or "1:1".`);

let houseOptions = [];
if (!Array.isArray(data.houseOptions)) {
  problems.push("houseOptions must be a list of exactly 3 house options, each { id, why }.");
} else {
  if (data.houseOptions.length !== 3) problems.push(`houseOptions needs exactly 3 house options (found ${data.houseOptions.length}).`);
  houseOptions = picks(data.houseOptions, "houseOptions");
  houseOptions.forEach((h, i) => {
    const m = MENU.get(h.id);
    if (m && !m.calm) problems.push(`houseOptions item ${i + 1}: ${q(h.id)} is not calm, so it can't be a house style. Calm ones: ${KT_MENU.filter((x) => x.calm).map((x) => x.id).join(", ")}.`);
  });
  const ids = houseOptions.map((h) => h.id);
  if (new Set(ids).size !== ids.length) problems.push("houseOptions has the same technique twice; offer 3 different ones.");
}

const house = data.house === undefined ? houseOptions[0] && houseOptions[0].id : data.house;
if (known(house, "house") && houseOptions.length && !houseOptions.some((h) => h.id === house)) {
  problems.push(`house ${q(house)} is not one of the 3 house options.`);
}

let lines = [];
if (!Array.isArray(data.lines) || data.lines.length === 0) {
  problems.push("lines must be a list with at least one line.");
} else {
  lines = data.lines.map((L, i) => {
    const where = `line ${i + 1}`;
    if (!isObj(L)) {
      problems.push(`${where} must be an object { t, dur, text, key, style, suggest }.`);
      return null;
    }
    if (typeof L.text !== "string" || !L.text.trim()) problems.push(`${where} is missing its text.`);
    if (!isNum(L.t) || L.t < 0) problems.push(`${where} is missing t (its start, in seconds from 0).`);
    if (!isNum(L.dur) || L.dur <= 0) problems.push(`${where} is missing dur (how long it stays, in seconds, more than 0).`);
    if (L.key !== undefined && typeof L.key !== "string") problems.push(`${where}: key must be text ("" for none).`);
    const style = L.style === undefined ? "house" : L.style;
    if (style !== "house") known(style, `${where} style`);
    return {
      t: L.t,
      dur: L.dur,
      text: L.text,
      key: L.key || "",
      style,
      suggest: picks(L.suggest, `${where} suggest`),
    };
  });
}

if (problems.length) fail(["Fix these in " + q(dataPath) + ":", ...problems.map((p) => "  - " + p)]);

const clean = { title: data.title, mode, aspect, houseOptions, house, lines };

// ---------------------------------------------------------------- write the page

/**
 * Makes code safe inside an inline <script>: "</script", "<script" or "<!--" in it would
 * end or confuse the block (and the page must contain no "<script src"). "\x3C" is "<" in
 * JS strings, template literals and regexes alike, and these sequences only ever occur
 * inside those (or in comments, where the change is harmless).
 */
function scriptSafe(js) {
  return js.replace(/<(\/?script)/gi, "\\x3C$1").replace(/<!--/g, "\\x3C!--");
}
/** JSON for an inline script: "<" becomes \u003c, so nothing in the data reads as HTML. */
function jsonSafe(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let page = fs.readFileSync(TEMPLATE, "utf8");
const fills = {
  "@KT_TITLE@": escHTML(clean.title),
  "/*@KT_MENU@*/": scriptSafe(fs.readFileSync(path.join(ASSETS, "menu.js"), "utf8")),
  "/*@KT_PREVIEWS@*/": scriptSafe(fs.readFileSync(path.join(ASSETS, "previews.js"), "utf8")),
  "/*@KT_DATA@*/null": jsonSafe(clean),
};
for (const [mark, value] of Object.entries(fills)) {
  const parts = page.split(mark);
  if (parts.length !== 2) fail([`The template ${TEMPLATE} should contain ${mark} exactly once (found ${parts.length - 1}).`]);
  page = parts.join(value); // split/join, not replace: "$" in the libraries must stay as it is
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, page);
console.log(`Wrote ${path.resolve(outPath)} (${clean.lines.length} lines, house: ${clean.house}).`);
console.log(`To open it in the browser pane: node "${path.join(here, "serve.mjs")}" "${path.dirname(path.resolve(outPath))}"`);
console.log(`then go to http://127.0.0.1:3018/${encodeURIComponent(path.basename(outPath))}`);
