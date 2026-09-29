// 用 claude.ai 研究: reading the reply a user pastes back from claude.ai. The text is untrusted: it is
// only scanned, never evaluated, and capped at MAX_REPLY_BYTES. The JSON block is found (a
// ```json fence, any fence, or a bare balanced object, with prose around it), parsed with
// JSON.parse, and when that fails, repaired by a small string-aware scanner — smart quotes and
// single quotes as delimiters, trailing commas, comments, fullwidth punctuation, unquoted keys, raw
// line breaks and stray quotes inside strings, missing commas between lines, True / False / None —
// and parsed again. The value is then checked like a Claude API answer: the zod schema (every issue
// as a 繁中 message with its path), the same usability test, and normalizePlan (clamping, contrast,
// SVG sanitizing, timeline coverage) whose repairs become notes; LED 安全模式's pre-show report is
// added. What cannot be used comes back as errors plus a 修正提示詞 for the same claude.ai chat.
// The research brief (the text around the JSON) is kept when it looks like one.

import { DesignPlanSchema } from "@/lib/schema";
import { safetyReport, type ActiveSafety } from "@/lib/stage/safety";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignDirection, DesignPlan, ResearchSource } from "@/lib/types";
import { isUsablePlan, tidyBrief } from "./claude";
import { buildDirections, DirectionDraftSchema, normalizeDirectionDrafts, offlineDirectionSpecs } from "./directions";
import { PLACEHOLDER_RE, type ManualTarget } from "./manual";
import { normalizePlanWithReport } from "./normalize";
import { RESEARCH_HEADINGS } from "./prompts";
import { analyzeStructure } from "./structure";
import type { DesignRequest } from "./types";

/** Largest reply accepted (UTF-8 bytes); the browser checks the same limit (MANUAL_REPLY_MAX_BYTES). */
export const MAX_REPLY_BYTES = 200 * 1024;
/** Longest research brief kept from a reply (characters). */
export const MAX_BRIEF_CHARS = 16_000;
/** More schema problems than this and the JSON is probably of another shape: refuse it. */
const MAX_TOLERATED_ISSUES = 15;

export interface ReplyIssue {
  /** JSON path, e.g. "sections[2].scene" (absent for whole-reply problems) */
  path?: string;
  message: string;
  severity: "error" | "warning";
}

// ---------------------------------------------------------------------------
// finding the JSON
// ---------------------------------------------------------------------------

export interface JsonCandidate {
  text: string;
  /** span in the cleaned reply */
  start: number;
  end: number;
  fenced: boolean;
  /** the value's braces balance */
  complete: boolean;
  /** the reply ended inside the value (an unclosed fence, or no closing bracket at the end): cut off */
  truncated: boolean;
}

/** Byte order marks, zero-width characters and CRLF, which copy-paste brings along. */
export function cleanReply(text: string): string {
  return text.replace(/[​-‍⁠﻿]/g, "").replace(/\r\n?/g, "\n");
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

interface Fence {
  lang: string;
  body: string;
  /** offset of the body in the text */
  bodyStart: number;
  /** from the opening fence to after the closing one */
  start: number;
  end: number;
  closed: boolean;
}

function fences(text: string): Fence[] {
  const out: Fence[] = [];
  const open = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const marker = m[1];
    const bodyStart = m.index + m[0].length + 1;
    const close = new RegExp(`^[ \\t]*${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`, "gm");
    close.lastIndex = Math.min(text.length, bodyStart);
    const c = close.exec(text);
    const bodyEnd = c ? c.index : text.length;
    out.push({ lang: m[2].toLowerCase(), body: text.slice(Math.min(text.length, bodyStart), Math.max(bodyStart, bodyEnd)), bodyStart, start: m.index, end: c ? c.index + c[0].length : text.length, closed: !!c });
    if (!c) break;
    open.lastIndex = c.index + c[0].length;
  }
  return out;
}

/** From the `{` (or `[`) at `from`: the end of the balanced value (exclusive), or -1 when the text ends first. */
function balancedEnd(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const TARGET_KEYS: Record<ManualTarget, RegExp> = {
  plan: /["'“”]?(keyVisual|sections)["'“”]?\s*[:：]/,
  directions: /["'“”]?directions["'“”]?\s*[:：]/,
};
const ANY_KEY = /["'“”]?(keyVisual|sections|directions|version)["'“”]?\s*[:：]/;

/**
 * The JSON value inside a fence body or raw text: the first top-level `{…}` (or `[…]` in a fence)
 * that names the target's keys, else the first one naming any plan / directions key (in a fence:
 * else the first value at all). Top-level values only, so the scan is linear.
 */
function valueIn(text: string, offset: number, fenced: boolean, target: ManualTarget): JsonCandidate | null {
  let best: JsonCandidate | null = null;
  let first = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && !(fenced && ch === "[")) continue;
    const end = balancedEnd(text, i);
    const slice = end > 0 ? text.slice(i, end) : text.slice(i);
    const cand: JsonCandidate = { text: slice, start: offset + i, end: offset + (end > 0 ? end : text.length), fenced, complete: end > 0, truncated: end < 0 && !/[}\]]\s*$/.test(slice) };
    if (TARGET_KEYS[target].test(slice)) return cand;
    if (ANY_KEY.test(slice) || (fenced && first)) best ??= cand;
    first = false;
    // an unclosed value runs to the end of the text: nothing follows it
    if (end < 0) break;
    i = end - 1;
  }
  return best;
}

/** The reply's JSON: the best fenced block (json first, the one naming the target's keys), else a bare object. */
export function findJson(reply: string, target: ManualTarget): JsonCandidate | null {
  const text = cleanReply(reply);
  const blocks = fences(text).filter((f) => /[{[]/.test(f.body));
  const scored = blocks
    .map((f) => {
      const cand = valueIn(f.body, f.bodyStart, true, target);
      if (!cand) return null;
      const score = (f.lang === "json" || f.lang === "jsonc" || f.lang === "json5" ? 2 : f.lang === "" || f.lang === "js" || f.lang === "javascript" ? 1 : 0) + (TARGET_KEYS[target].test(cand.text) ? 4 : ANY_KEY.test(cand.text) ? 1 : 0);
      // the fence's span (so the brief drops it); a balanced value counts as complete even when the closing fence was not copied
      return { cand: { ...cand, start: f.start, end: f.end, truncated: !cand.complete && (!f.closed || cand.truncated) }, score, length: cand.text.length };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.score - a.score || b.length - a.length);
  if (scored.length && scored[0].score > 0) return scored[0].cand;
  return valueIn(text, 0, false, target) ?? scored[0]?.cand ?? null;
}

// ---------------------------------------------------------------------------
// lenient repair (a scanner, never an evaluator)
// ---------------------------------------------------------------------------

const DOUBLE_QUOTES = new Set(['"', "“", "”", "„", "‟", "＂"]);
const SINGLE_QUOTES = new Set(["'", "‘", "’"]);
/** a quoted key follows (the comma before it is missing): the quote before it closes a string */
const KEY_AHEAD = /^\s*"[^"\n]{1,60}"\s*[:：]/;
/** what may follow a string's closing quote (anything else: the quote is part of the text) */
const STRUCTURAL_AFTER_STRING = new Set([":", ",", "}", "]", "：", "，", "｝", "］", "\n", "/"]);
const FULLWIDTH: Record<string, string> = { "：": ":", "，": ",", "｛": "{", "｝": "}", "［": "[", "］": "]" };
const LITERALS: Record<string, string> = { true: "true", false: "false", null: "null", True: "true", False: "false", None: "null", undefined: "null", NaN: "null" };

export interface RepairResult {
  text: string;
  /** 繁中, what was repaired */
  fixes: string[];
}

function nextSignificant(text: string, from: number): string {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") return "\n";
    if (ch !== " " && ch !== "\t") return ch;
  }
  return "";
}

/**
 * Turn almost-JSON into JSON. Only structure outside strings is rewritten; inside strings only the
 * escaping (line breaks, stray quotes, bad backslashes) changes.
 */
export function repairJson(input: string): RepairResult {
  const fixes = new Set<string>();
  let out = "";
  let i = 0;
  type Last = "none" | "open" | "value" | "colon" | "comma";
  let last: Last = "none";
  const n = input.length;

  // a value right after a value is never JSON: the comma between them is missing
  const valueStart = () => {
    if (last === "value") {
      out += ",";
      fixes.add("補上缺少的逗號");
    }
  };

  while (i < n) {
    const ch = input[i];
    // whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === " " || ch === "　") {
      out += ch === " " || ch === "　" ? " " : ch;
      i++;
      continue;
    }
    // comments
    if (ch === "/" && input[i + 1] === "/") {
      while (i < n && input[i] !== "\n") i++;
      fixes.add("移除註解");
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      fixes.add("移除註解");
      continue;
    }
    // strings (straight, smart or single quotes as delimiters)
    if (DOUBLE_QUOTES.has(ch) || SINGLE_QUOTES.has(ch)) {
      valueStart();
      const family = DOUBLE_QUOTES.has(ch) ? DOUBLE_QUOTES : SINGLE_QUOTES;
      const smart = ch !== '"';
      if (smart) fixes.add(family === SINGLE_QUOTES ? "單引號改成雙引號" : "智慧引號改成直引號");
      out += '"';
      i++;
      let closed = false;
      while (i < n) {
        const c = input[i];
        if (c === "\\") {
          const e = input[i + 1];
          if (e !== undefined && '"\\/bfnrtu'.includes(e)) {
            if (e === "u" && !/^[0-9a-fA-F]{4}$/.test(input.slice(i + 2, i + 6))) {
              out += "\\\\";
              fixes.add("修正字串中的反斜線");
              i++;
              continue;
            }
            out += c + e;
            i += 2;
          } else if (e === "'") {
            out += "'";
            i += 2;
          } else {
            out += "\\\\";
            fixes.add("修正字串中的反斜線");
            i++;
          }
          continue;
        }
        const closes = smart ? family.has(c) : c === '"';
        if (closes) {
          const after = nextSignificant(input, i + 1);
          if (after === "" || STRUCTURAL_AFTER_STRING.has(after) || (after === '"' && KEY_AHEAD.test(input.slice(i + 1, i + 200)))) {
            closed = true;
            i++;
            break;
          }
          // a quote inside the text (an apostrophe, 「他說"好"」): kept, escaped when it is a straight double quote
          if (c === '"') {
            out += '\\"';
            fixes.add("跳脫字串中的引號");
          } else out += c;
          i++;
          continue;
        }
        if (c === '"') {
          out += '\\"';
          i++;
          continue;
        }
        if (c === "\n") {
          out += "\\n";
          fixes.add("字串中的換行改成 \\n");
          i++;
          continue;
        }
        if (c === "\t") {
          out += "\\t";
          i++;
          continue;
        }
        if (c < " ") {
          i++;
          continue;
        }
        out += c;
        i++;
      }
      out += '"';
      if (!closed) fixes.add("補上字串結尾的引號");
      last = "value";
      continue;
    }
    // fullwidth structure
    const mapped = FULLWIDTH[ch];
    const s = mapped ?? ch;
    if (mapped) fixes.add("全形標點改成半形");
    if (s === "{" || s === "[") {
      valueStart();
      out += s;
      last = "open";
      i++;
      continue;
    }
    if (s === "}" || s === "]") {
      out += s;
      last = "value";
      i++;
      continue;
    }
    if (s === ",") {
      // a trailing comma before a closing bracket
      let j = i + 1;
      while (j < n && /\s/.test(input[j])) j++;
      const nx = FULLWIDTH[input[j]] ?? input[j];
      if (nx === "}" || nx === "]" || j >= n) {
        fixes.add("移除結尾多餘的逗號");
        i++;
        continue;
      }
      if (last === "comma" || last === "open") {
        fixes.add("移除多餘的逗號");
        i++;
        continue;
      }
      out += ",";
      last = "comma";
      i++;
      continue;
    }
    if (s === ":") {
      out += ":";
      last = "colon";
      i++;
      continue;
    }
    // numbers
    if (/[-+0-9.]/.test(s)) {
      valueStart();
      let j = i;
      while (j < n && /[-+0-9.eE]/.test(input[j])) j++;
      let num = input.slice(i, j);
      if (num.startsWith("+")) {
        num = num.slice(1);
        fixes.add("修正數字格式");
      }
      if (num.startsWith(".")) {
        num = `0${num}`;
        fixes.add("修正數字格式");
      }
      if (num.endsWith(".")) {
        num = num.slice(0, -1);
        fixes.add("修正數字格式");
      }
      out += num;
      last = "value";
      i = j;
      continue;
    }
    // words: literals and unquoted keys
    if (/[A-Za-z_$]/.test(s)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$-]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const after = nextSignificant(input, j);
      valueStart();
      if (after === ":" || after === "：") {
        out += `"${word}"`;
        fixes.add("欄位名稱補上雙引號");
      } else if (LITERALS[word]) {
        if (LITERALS[word] !== word) fixes.add("True／False／None 改成 JSON 寫法");
        out += LITERALS[word];
      } else {
        out += word;
      }
      last = "value";
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, fixes: [...fixes] };
}

// ---------------------------------------------------------------------------
// parsing with Chinese errors
// ---------------------------------------------------------------------------

export type ParseOutcome =
  | { ok: true; value: unknown; fixes: string[]; candidate: JsonCandidate }
  | { ok: false; issues: ReplyIssue[]; truncated: boolean; candidate: JsonCandidate | null };

const JSON_ERRORS: Array<[RegExp, string]> = [
  [/Expected ',' or '}' after property value/i, "缺少逗號，或少了右大括號 }"],
  [/Expected ',' or ']' after array element/i, "缺少逗號，或少了右中括號 ]"],
  [/Expected double-quoted property name|Expected property name/i, "這裡應該是用雙引號包起來的欄位名稱（或多了一個逗號）"],
  [/Expected ':' after property name/i, "欄位名稱後面缺少冒號 :"],
  [/Unterminated string/i, "字串沒有結束（少了結尾的雙引號）"],
  [/Bad control character/i, "字串裡有換行或控制字元"],
  [/Bad escaped character|Bad Unicode escape/i, "字串裡有錯誤的反斜線跳脫"],
  [/Unexpected non-whitespace character after JSON/i, "JSON 結束之後還有其他內容"],
  [/Unexpected end of JSON input/i, "JSON 沒有結束"],
  [/Unexpected token/i, "這裡有無法辨識的字元"],
];

function positionOf(message: string, text: string): number | null {
  const m = /position (\d+)/.exec(message);
  if (m) return Number(m[1]);
  // "Unexpected token '@', "…" is not valid JSON" has no position: the token's first appearance
  const t = /Unexpected token '(.+?)'/.exec(message);
  if (t) {
    const at = text.indexOf(t[1]);
    return at >= 0 ? at : null;
  }
  return null;
}

function locate(text: string, pos: number): { line: number; column: number; snippet: string } {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", pos);
  const full = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const column = pos - lineStart + 1;
  const from = Math.max(0, column - 1 - 30);
  const snippet = `${from > 0 ? "…" : ""}${full.slice(from, column - 1)}⟪這裡⟫${full.slice(column - 1, column - 1 + 30)}${column - 1 + 30 < full.length ? "…" : ""}`;
  return { line, column, snippet: snippet.trim() };
}

function jsonErrorIssue(err: unknown, text: string): ReplyIssue {
  const message = err instanceof Error ? err.message : String(err);
  const what = JSON_ERRORS.find(([re]) => re.test(message))?.[1] ?? "JSON 格式錯誤";
  const pos = positionOf(message, text);
  if (pos == null) return { message: `JSON 格式錯誤：${what}。`, severity: "error" };
  const at = locate(text, Math.min(pos, text.length));
  return { message: `JSON 第 ${at.line} 行第 ${at.column} 個字：${what}。附近的內容：${at.snippet}`, severity: "error" };
}

/** Find and parse the reply's JSON (repairing what can be repaired). Never throws. */
export function parseReply(reply: string, target: ManualTarget): ParseOutcome {
  const candidate = findJson(reply, target);
  if (!candidate) {
    return {
      ok: false,
      truncated: false,
      candidate: null,
      issues: [{ message: "回覆裡找不到 JSON：Claude 應該在最後輸出一個 ```json 程式碼區塊。請確認貼上的是完整的回覆（用 claude.ai 回覆下方的「複製」按鈕）。", severity: "error" }],
    };
  }
  if (candidate.truncated) {
    return {
      ok: false,
      truncated: true,
      candidate,
      issues: [{ message: "JSON 沒有結束：回覆在中途被截斷了（可能是 claude.ai 的回覆長度上限，或沒有複製到最後）。可以請 Claude 重新輸出完整的 JSON，或改用精簡版提示詞。", severity: "error" }],
    };
  }
  const raw = candidate.text.trim();
  try {
    return { ok: true, value: JSON.parse(raw), fixes: [], candidate };
  } catch {
    const repaired = repairJson(raw);
    try {
      return { ok: true, value: JSON.parse(repaired.text), fixes: repaired.fixes, candidate };
    } catch (err) {
      const issues = [jsonErrorIssue(err, repaired.text)];
      if (!candidate.complete) issues.push({ message: "左右括號的數量對不上：可能少了一個 } 或 ]。", severity: "error" });
      return { ok: false, truncated: false, candidate, issues };
    }
  }
}

// ---------------------------------------------------------------------------
// schema issues in 繁中
// ---------------------------------------------------------------------------

function pathText(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || "（最外層）";
}

function valueAt(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let v: unknown = root;
  for (const p of path) {
    if (v == null || typeof v !== "object") return undefined;
    v = (v as Record<PropertyKey, unknown>)[p];
  }
  return v;
}

const TYPE_NAME: Record<string, string> = { string: "字串", number: "數字", boolean: "true／false", object: "物件", array: "陣列", null: "null", int: "整數" };

function shown(v: unknown): string {
  if (v === undefined) return "沒有這個欄位";
  if (v === null) return "null";
  if (Array.isArray(v)) return "陣列";
  if (typeof v === "object") return "物件";
  if (typeof v === "string") return `「${v.length > 24 ? `${v.slice(0, 24)}…` : v}」`;
  return String(v);
}

interface ZodIssueLike {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  expected?: string;
  values?: readonly unknown[];
}

export function issueMessage(issue: ZodIssueLike, root: unknown): string {
  const path = pathText(issue.path);
  const v = valueAt(root, issue.path);
  if (issue.code === "invalid_type") {
    if (v === undefined) return `缺少欄位 ${path}`;
    return `${path} 應該是${TYPE_NAME[issue.expected ?? ""] ?? issue.expected ?? "其他型別"}（現在是${shown(v)}）`;
  }
  if (issue.code === "invalid_value" && issue.values) {
    const values = issue.values.map((x) => String(x));
    if (values.length === 1) return `${path} 必須是 ${values[0]}（現在是${shown(v)}）`;
    return `${path} 的${shown(v)}不是可用的值，請改用：${values.slice(0, 14).join("、")}`;
  }
  return `${path}：${issue.message}`;
}

function schemaIssues(error: { issues: readonly ZodIssueLike[] } | undefined, root: unknown): ReplyIssue[] {
  return (error?.issues ?? []).map((i) => ({ path: pathText(i.path), message: issueMessage(i, root), severity: "warning" as const }));
}

/** String values still reading like the template's （…） placeholders. */
export function placeholders(value: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 40) return out;
  if (typeof value === "string") {
    if (PLACEHOLDER_RE.test(value.trim())) out.push(path || "（最外層）");
  } else if (Array.isArray(value)) value.forEach((v, i) => placeholders(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) placeholders(v, path ? `${path}.${k}` : k, out);
  return out;
}

function unwrap(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value) && value.length === 1) return unwrap(value[0], keys);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const k of keys) if (o[k] && typeof o[k] === "object") return o[k];
  }
  return value;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------
// the two targets
// ---------------------------------------------------------------------------

export type PlanCheck = { ok: true; plan: DesignPlan; notes: string[] } | { ok: false; issues: ReplyIssue[] };

/** A parsed plan reply: refused when it cannot become this song's plan, else normalized with notes. */
export function checkPlan(value: unknown, req: DesignRequest): PlanCheck {
  const raw = unwrap(value, ["plan", "designPlan", "DesignPlan", "design_plan"]);
  if (!isObj(raw)) return { ok: false, issues: [{ message: "JSON 的最外層應該是一個物件 { … }（DesignPlan）。", severity: "error" }] };
  if (Array.isArray(raw.directions) && !raw.keyVisual) {
    return { ok: false, issues: [{ message: "這是「設計方向」的 JSON，不是設計方案：請到「設計方向」那邊用 claude.ai 提案並貼上，或請 Claude 依設計方案的規格重新輸出。", severity: "error" }] };
  }
  const issues: ReplyIssue[] = [];
  const checked = DesignPlanSchema.safeParse(raw);
  const warnings = checked.success ? [] : schemaIssues(checked.error, raw);
  if (!isUsablePlan(raw)) {
    if (!isObj(raw.keyVisual)) issues.push({ path: "keyVisual", message: "缺少 keyVisual（主視覺：標題、概念、配色、字體）。", severity: "error" });
    if (!Array.isArray(raw.sections)) issues.push({ path: "sections", message: "缺少 sections（每一段的畫面設計）。", severity: "error" });
    else issues.push({ path: "sections", message: "sections 裡沒有任何有數字 start／end（秒）的段落。", severity: "error" });
  }
  const left = placeholders(raw);
  if (left.length >= 3) issues.push({ message: `還有 ${left.length} 個欄位是範本裡的（…）文字（例如 ${left.slice(0, 3).join("、")}）：Claude 沒有把範本填完。`, severity: "error" });
  const st = analyzeStructure(req);
  const timed = Array.isArray(raw.sections) ? raw.sections.filter((s) => isObj(s) && typeof s.start === "number" && typeof s.end === "number").length : 0;
  if (timed > 0 && timed <= 2 && st.sections.length >= 5) {
    issues.push({ path: "sections", message: `設計方案只有 ${timed} 個段落，但這首歌大約有 ${st.sections.length} 段（${st.sections.map((s) => formatTimeShort(s.start)).join("、")}）：範本只列了前幾段，請 Claude 輸出全部段落。`, severity: "error" });
  }
  if (warnings.length > MAX_TOLERATED_ISSUES) issues.push({ message: `有 ${warnings.length} 處不符合 DesignPlan 的規格，看起來是另一種格式的 JSON。`, severity: "error" });
  if (issues.length) return { ok: false, issues: [...issues, ...warnings.slice(0, 20)] };

  const { plan, repairs } = normalizePlanWithReport(checked.success ? checked.data : raw, req);
  const notes = [
    ...warnings.slice(0, 12).map((w) => `${w.message}（已自動修正）`),
    ...(warnings.length > 12 ? [`另外 ${warnings.length - 12} 處不符合規格的欄位也已自動修正`] : []),
    ...repairs,
    ...left.map((p) => `${p} 還是範本的文字，請之後在控制台修改`),
  ];
  return { ok: true, plan, notes };
}

export type DirectionsCheck = { ok: true; directions: DesignDirection[]; notes: string[] } | { ok: false; issues: ReplyIssue[] };

/** A parsed directions reply: 2–3 usable, distinct directions, each expanded to a plan. */
export function checkDirections(value: unknown, req: DesignRequest, now: string): DirectionsCheck {
  let raw = unwrap(value, ["designDirections", "result"]);
  if (Array.isArray(raw)) raw = { directions: raw };
  if (!isObj(raw)) return { ok: false, issues: [{ message: "JSON 的最外層應該是 { \"directions\": [ … ] }。", severity: "error" }] };
  if (!Array.isArray(raw.directions)) {
    if (isObj(raw.keyVisual) || Array.isArray(raw.sections)) {
      return { ok: false, issues: [{ message: "這是「設計方案」的 JSON，不是設計方向：請在設計總覽的「用 claude.ai 研究」貼上，或請 Claude 依設計方向的規格重新輸出。", severity: "error" }] };
    }
    return { ok: false, issues: [{ path: "directions", message: "缺少 directions（2 到 3 個設計方向的陣列）。", severity: "error" }] };
  }
  const checked = DirectionDraftSchema.safeParse(raw);
  const warnings = checked.success ? [] : schemaIssues(checked.error, raw);
  const issues: ReplyIssue[] = [];
  const left = placeholders(raw);
  if (left.length >= 3) issues.push({ message: `還有 ${left.length} 個欄位是範本裡的（…）文字（例如 ${left.slice(0, 3).join("、")}）：Claude 沒有把範本填完。`, severity: "error" });
  const offline = offlineDirectionSpecs(req);
  const specs = normalizeDirectionDrafts(raw, req, offline).filter((s) => !offline.includes(s));
  const named = raw.directions.filter((d) => isObj(d) && typeof d.name === "string" && d.name.trim()).length;
  if (specs.length < 2) {
    issues.push({
      path: "directions",
      message:
        named < 2
          ? `只有 ${named} 個有名稱（name）的方向：需要 2 到 3 個彼此不同的設計方向。`
          : `只有 ${specs.length} 個可用的方向：有幾個方向的名稱或配色重複了，需要 2 到 3 個彼此不同的方向。`,
      severity: "error",
    });
  }
  if (warnings.length > MAX_TOLERATED_ISSUES * 2) issues.push({ message: `有 ${warnings.length} 處不符合設計方向的規格，看起來是另一種格式的 JSON。`, severity: "error" });
  if (issues.length) return { ok: false, issues: [...issues, ...warnings.slice(0, 20)] };
  const directions = buildDirections(specs, req, { engine: "manual-claude", now });
  const notes = [
    ...warnings.slice(0, 12).map((w) => `${w.message}（已自動修正）`),
    ...(warnings.length > 12 ? [`另外 ${warnings.length - 12} 處不符合規格的欄位也已自動修正`] : []),
    ...(raw.directions.length > specs.length ? [`${raw.directions.length - specs.length} 個方向因為缺少名稱或與其他方向重複而略過`] : []),
    ...left.map((p) => `${p} 還是範本的文字`),
  ];
  return { ok: true, directions, notes };
}

// ---------------------------------------------------------------------------
// the research brief around the JSON
// ---------------------------------------------------------------------------

const SKIP_HOSTS = /(^|\.)(claude\.ai|anthropic\.com)$/i;

function httpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (SKIP_HOSTS.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Sources cited in the brief: Markdown links first, then bare URLs (http/https only). */
export function briefSources(brief: string): ResearchSource[] {
  const out: ResearchSource[] = [];
  const add = (title: string, url: string) => {
    const u = httpUrl(url.replace(/[)\]>，。、」』]+$/, ""));
    if (!u || out.some((s) => s.url === u) || out.length >= 20) return;
    out.push({ title: title.replace(/\s+/g, " ").trim().slice(0, 120) || new URL(u).hostname.replace(/^www\./, ""), url: u });
  };
  for (const m of brief.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g)) add(m[1], m[2]);
  for (const m of brief.matchAll(/(?<![(\[])\bhttps?:\/\/[^\s<>()"'「」]+/g)) add("", m[0]);
  return out;
}

/**
 * The research brief: the reply without its code blocks (and without the bare JSON), tidied like
 * Claude's API brief. Null when what is left does not read like a brief.
 */
export function extractBrief(reply: string, candidate: JsonCandidate | null): { brief: string; sources: ResearchSource[] } | null {
  const text = cleanReply(reply);
  const strip = (t: string) => {
    let out = t;
    // every fenced block goes (the JSON, examples), and the code-block labels a manual copy brings along
    for (const f of fences(out).reverse()) out = `${out.slice(0, f.start)}${out.slice(f.end)}`;
    return out
      .split("\n")
      .filter((l) => !/^\s*(json|JSON|複製|Copy)\s*$/.test(l))
      .join("\n")
      .trim();
  };
  // the brief is written before the JSON (a closing remark after it is chat); a reply that puts
  // the JSON first keeps what follows it
  let before = candidate ? strip(text.slice(0, candidate.start)) : strip(text);
  const after = candidate ? strip(text.slice(candidate.end)) : "";
  // 「以下是設計方案：」, the lead-in to the JSON
  before = before.replace(/\n*[^\n]{0,80}[：:]\s*$/, "").trim();
  const looksLikeBrief = (t: string) => {
    const b = tidyBrief(t);
    const headings = RESEARCH_HEADINGS.filter((h) => new RegExp(`^#{1,3}\\s*${h}`, "m").test(b)).length;
    return Array.from(b).length >= 80 && (headings > 0 || Array.from(b).length >= 300);
  };
  const chosen = looksLikeBrief(before) ? before : looksLikeBrief(after) ? after : null;
  if (!chosen) return null;
  const brief = tidyBrief(chosen).slice(0, MAX_BRIEF_CHARS).trim();
  return { brief, sources: briefSources(brief) };
}

// ---------------------------------------------------------------------------
// the fix prompt
// ---------------------------------------------------------------------------

/** What to paste into the same claude.ai chat to get a JSON that works. */
export function fixPrompt(target: ManualTarget, issues: readonly ReplyIssue[], opts: { truncated?: boolean } = {}): string {
  const what = target === "plan" ? "設計方案（DesignPlan）" : "設計方向（{ \"directions\": [...] }）";
  if (opts.truncated) {
    return [
      `你上一則回覆的 JSON 在中途被截斷了，Livelyrics 沒辦法套用。`,
      `請只重新輸出**完整的${what} JSON**：一個 \`\`\`json 程式碼區塊，不要再寫研究簡報或其他說明。`,
      "為了讓整個 JSON 能完整輸出：rationale 每段 1 句、designerNotes 150 字內、不要省略任何段落或欄位。",
    ].join("\n");
  }
  const rows = issues.slice(0, 24).map((i) => `- ${i.message}`);
  return [
    `你剛才回覆的 JSON 沒辦法套用到 Livelyrics，問題如下：`,
    ...rows,
    ...(issues.length > 24 ? [`- 另外還有 ${issues.length - 24} 個類似的問題`] : []),
    "",
    `請修正這些問題，重新輸出**完整的${what} JSON**：一個 \`\`\`json 程式碼區塊，不要省略任何段落或欄位，也不需要再寫研究簡報。`,
    "記得：只用雙引號、沒有註解、沒有結尾逗號；scene、lyricStyle、lyricPlacement、transitionIn、kind 與字體只能用規格裡的 id。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// everything together
// ---------------------------------------------------------------------------

export type ManualOutcome =
  | {
      ok: true;
      target: ManualTarget;
      plan?: DesignPlan;
      directions?: DesignDirection[];
      notes: string[];
      /** what LED 安全模式 changes on stage (the pre-show report) */
      safety: string[];
      brief: { brief: string; sources: ResearchSource[] } | null;
    }
  | {
      ok: false;
      error: string;
      issues: ReplyIssue[];
      fixPrompt: string;
      /** the brief found in this reply, so a JSON-only fix can still save it */
      brief: { brief: string; sources: ResearchSource[] } | null;
    };

function safetyLines(plan: DesignPlan, safety: ActiveSafety, bpm: number | null): string[] {
  const r = safetyReport(plan, safety, { bpm });
  return [...r.sections.map((s) => `${formatTimeShort(s.start)} ${s.label}：${s.changes.map((c) => c.text).join("；")}`), ...r.notes];
}

/** Read a pasted claude.ai reply for a song: the plan or the directions, the brief, notes and errors. */
export function readManualReply(
  reply: string,
  target: ManualTarget,
  req: DesignRequest,
  opts: { safety: ActiveSafety; now: string },
): ManualOutcome {
  if (utf8Bytes(reply) > MAX_REPLY_BYTES) {
    const issues: ReplyIssue[] = [{ message: `貼上的內容超過 ${Math.round(MAX_REPLY_BYTES / 1024)} KB：請只貼 Claude 的這一則回覆。`, severity: "error" }];
    return { ok: false, error: "貼上的內容太大", issues, fixPrompt: fixPrompt(target, issues), brief: null };
  }
  if (!reply.trim()) {
    const issues: ReplyIssue[] = [{ message: "還沒有貼上 Claude 的回覆。", severity: "error" }];
    return { ok: false, error: "沒有內容", issues, fixPrompt: fixPrompt(target, issues), brief: null };
  }
  const parsed = parseReply(reply, target);
  const brief = extractBrief(reply, parsed.candidate);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.truncated ? "回覆被截斷了" : parsed.candidate ? "JSON 格式有錯" : "找不到 JSON",
      issues: parsed.issues,
      fixPrompt: fixPrompt(target, parsed.issues, { truncated: parsed.truncated }),
      brief,
    };
  }
  const fixNotes = parsed.fixes.length ? [`JSON 有小問題，已自動修正：${parsed.fixes.join("、")}`] : [];
  const bpm = req.analysis && Number.isFinite(req.analysis.bpm) && req.analysis.bpm > 0 ? req.analysis.bpm : null;
  if (target === "plan") {
    const c = checkPlan(parsed.value, req);
    if (!c.ok) return { ok: false, error: "設計方案不能使用", issues: c.issues, fixPrompt: fixPrompt(target, c.issues), brief };
    return { ok: true, target, plan: c.plan, notes: [...fixNotes, ...c.notes], safety: safetyLines(c.plan, opts.safety, bpm), brief };
  }
  const c = checkDirections(parsed.value, req, opts.now);
  if (!c.ok) return { ok: false, error: "設計方向不能使用", issues: c.issues, fixPrompt: fixPrompt(target, c.issues), brief };
  return { ok: true, target, directions: c.directions, notes: [...fixNotes, ...c.notes], safety: [], brief };
}
