// Keyword heuristics that let the offline designer follow simple art-direction
// instructions ("副歌更熱血一點", "主歌不要歌詞", "整體藍一點", "歌詞放上面") when Claude
// is unavailable. Each clause of the instruction is parsed separately; the result is
// applied on top of the previous plan so a Claude-made plan is kept, not replaced.

import type { DesignPlan, FontId, LyricPlacement, LyricStyleId, SceneId, SectionKind } from "@/lib/types";
import { FONT_CATALOG, LYRIC_STYLES, SCENES, SECTION_KIND_LABELS } from "./catalog";
import { colorName, hexToHsl, hsl, normalizeHex } from "./color";
import { normalizePlan } from "./normalize";
import { clamp } from "./structure";
import type { DesignerInput } from "./types";

export interface ClauseIntent {
  /** null = every section */
  targets: SectionKind[] | null;
  /** -1..1 energy push */
  energy: number;
  /** additive lyric scale change */
  lyricScale: number;
  lyrics: "hide" | "show" | "less" | null;
  style: LyricStyleId | null;
  placement: LyricPlacement | null;
  scene: SceneId | null;
  hue: number | null;
  mono: boolean;
  font: FontId | null;
}

const TARGETS: Array<[RegExp, SectionKind[]]> = [
  [/導歌|pre-?chorus|預副歌/i, ["pre-chorus"]],
  [/副歌|合唱|chorus|hook/i, ["chorus"]],
  [/主歌|verse/i, ["verse"]],
  [/前奏|開場|intro/i, ["intro"]],
  [/尾奏|結尾|收尾|ending|outro/i, ["outro"]],
  [/間奏|獨奏|solo|interlude|器樂/i, ["interlude", "solo"]],
  [/橋段|bridge/i, ["bridge"]],
  [/breakdown|安靜段/i, ["breakdown"]],
];
const ALL = /整首|全曲|整體|全部|所有|每一段|everything|overall/i;

const MORE = /熱血|激烈|炸|嗨|更強|強一點|猛|爆|衝|更亮|亮一點|華麗|熱鬧|更快|快一點|動感|刺激|能量|高潮|燃/;
const LESS = /安靜|柔和|溫柔|冷靜|低調|簡約|極簡|暗一點|更暗|慢一點|更慢|收斂|內斂|沉穩|抒情|乾淨|素一點|不要太花/;
const HIDE = /不要歌詞|隱藏歌詞|拿掉歌詞|歌詞不要|不顯示歌詞|不放歌詞|沒有歌詞|去掉歌詞|關掉歌詞/;
const FEWER = /歌詞少一點|少放歌詞|歌詞太多|少一點歌詞|減少歌詞/;
const SHOW = /顯示歌詞|放歌詞|歌詞多一點|要有歌詞|每句都要|完整歌詞|加上歌詞/;
const BIGGER = /字大一點|字再大|歌詞大一點|放大|字太小|大字|更大/;
const SMALLER = /字小一點|歌詞小一點|縮小|字太大|小一點/;

const STYLE_WORDS: Array<[RegExp, LyricStyleId]> = [
  [/卡拉\s*ok|karaoke|填色/i, "karaoke"],
  [/直排|直書|vertical/i, "vertical"],
  [/字幕|subtitle/i, "subtitle"],
  [/打字|typewriter/i, "typewriter"],
  [/巨字|衝擊|impact/i, "impact"],
  [/逐字|跳出|彈出|pop/i, "word-pop"],
  [/堆疊|詩句|stack/i, "stack"],
  [/淡入|fade/i, "line-fade"],
];
const PLACEMENT_WORDS: Array<[RegExp, LyricPlacement]> = [
  [/上方|上面|上三分之一|往上/, "upper-third"],
  [/下方|下面|下三分之一|往下/, "lower-third"],
  [/左邊|左側|靠左/, "left"],
  [/右邊|右側|靠右/, "right"],
  [/中間|置中|正中/, "center"],
];
const SCENE_WORDS: Array<[RegExp, SceneId]> = [
  [/星雲|雲霧|nebula/i, "nebula"],
  [/粒子|星空|燈海|particles?/i, "particles"],
  [/波浪|波形|海浪|waves?/i, "waves"],
  [/網格|synthwave|grid/i, "grid"],
  [/隧道|tunnel/i, "tunnel"],
  [/雨|rain/i, "rain"],
  [/光斑|散景|bokeh/i, "bokeh"],
  [/碎片|玻璃|shards?/i, "shards"],
  [/水墨|墨|ink/i, "ink"],
  [/主視覺|符號|logo|motif/i, "motif"],
  [/漸層|gradient/i, "gradient"],
  [/全黑|黑幕|blackout/i, "blackout"],
];
const HUES: Array<[RegExp, number]> = [
  [/紅/, 356],
  [/橘|橙/, 26],
  [/金|黃/, 46],
  [/綠/, 140],
  [/青/, 180],
  [/藍/, 218],
  [/靛/, 240],
  [/紫/, 276],
  [/粉/, 330],
];
const COLOR_CONTEXT = /(紅|橘|橙|金|黃|綠|青|藍|靛|紫|粉)(色|調|系|一點|一些)|配色|顏色|色調|主色/;
const MONO = /黑白|單色|灰階|monochrome/i;
const FONTS: Array<[RegExp, FontId]> = [
  [/宋體|明體|襯線|文學/, "noto-serif-tc"],
  [/楷書|手寫|文楷/, "lxgw-wenkai-tc"],
  [/圓體|可愛/, "huninn"],
  [/黑體|粗體/, "chiron-hei-hk"],
  [/復古|古典/, "cactus-classical-serif"],
];

function firstMatch<T>(clause: string, table: Array<[RegExp, T]>): T | null {
  for (const [re, v] of table) if (re.test(clause)) return v;
  return null;
}

function parseClause(clause: string, inherited: SectionKind[] | null): ClauseIntent {
  const targets = ALL.test(clause)
    ? null
    : (() => {
        const found = TARGETS.filter(([re]) => re.test(clause)).flatMap(([, k]) => k);
        return found.length ? [...new Set(found)] : inherited;
      })();
  const hide = HIDE.test(clause);
  const colorful = COLOR_CONTEXT.test(clause);
  return {
    targets,
    energy: MORE.test(clause) ? 0.25 : LESS.test(clause) ? -0.25 : 0,
    lyricScale: BIGGER.test(clause) && !SMALLER.test(clause) ? 0.2 : SMALLER.test(clause) ? -0.2 : 0,
    lyrics: hide ? "hide" : FEWER.test(clause) ? "less" : SHOW.test(clause) ? "show" : null,
    style: hide ? null : firstMatch(clause, STYLE_WORDS),
    placement: firstMatch(clause, PLACEMENT_WORDS),
    // color words inside a color clause are not scene names ("藍一點" is not rain)
    scene: colorful ? null : firstMatch(clause, SCENE_WORDS),
    hue: colorful ? firstMatch(clause, HUES) : null,
    mono: MONO.test(clause),
    font: firstMatch(clause, FONTS),
  };
}

function isEmpty(c: ClauseIntent): boolean {
  return !c.energy && !c.lyricScale && !c.lyrics && !c.style && !c.placement && !c.scene && c.hue == null && !c.mono && !c.font;
}

/** Parse an instruction into per-clause intents; clauses without a target inherit the previous one. */
export function parseInstruction(instruction: string): ClauseIntent[] {
  const clauses = String(instruction ?? "")
    .slice(0, 2000)
    .split(/[，,。；;！!？?\n]|然後|但是|但|而且|另外|還有/)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: ClauseIntent[] = [];
  let inherited: SectionKind[] | null = null;
  for (const c of clauses) {
    const intent = parseClause(c, inherited);
    inherited = intent.targets;
    if (!isEmpty(intent)) out.push(intent);
  }
  return out;
}

const ENERGIZE: Partial<Record<SceneId, SceneId>> = {
  gradient: "waves",
  bokeh: "particles",
  nebula: "particles",
  waves: "grid",
  ink: "shards",
  rain: "shards",
  particles: "tunnel",
  motif: "particles",
  grid: "tunnel",
  blackout: "gradient",
};
const CALM: Partial<Record<SceneId, SceneId>> = {
  tunnel: "particles",
  grid: "waves",
  shards: "ink",
  particles: "bokeh",
  waves: "nebula",
  motif: "gradient",
};

function rotateHex(hex: string, targetHue: number | null, deltaHue: number, mono: boolean): string {
  const c = normalizeHex(hex);
  if (!c) return hex;
  const { h, s, l } = hexToHsl(c);
  if (mono) return hsl(h, 0, l);
  if (targetHue == null || s < 0.08) return c;
  return hsl(h + deltaHue, s, l);
}

function describeTargets(t: SectionKind[] | null): string {
  return t ? t.map((k) => SECTION_KIND_LABELS[k]).join("／") : "全曲";
}

/**
 * Apply instruction heuristics to a plan. Returns the normalized plan and a list of
 * changes (繁中); an empty list means nothing in the instruction was understood.
 */
export function applyInstruction(plan: DesignPlan, instruction: string, input: DesignerInput): { plan: DesignPlan; changes: string[] } {
  const intents = parseInstruction(instruction);
  if (!intents.length) return { plan, changes: [] };
  const next: DesignPlan = structuredClone(plan);
  const changes: string[] = [];

  for (const it of intents) {
    const where = describeTargets(it.targets);
    const secs = next.sections.filter((s) => !it.targets || it.targets.includes(s.kind));
    if (!secs.length) {
      changes.push(`找不到「${where}」段落，略過`);
      continue;
    }
    if (it.energy) {
      for (const s of secs) {
        const p = s.sceneParams;
        const k = it.energy;
        p.speed = clamp(p.speed + k * 0.8, 0, 1);
        p.density = clamp(p.density + k * 0.6, 0, 1);
        p.intensity = clamp(p.intensity + k * 0.6, 0, 1);
        p.audioReactivity = clamp(p.audioReactivity + k, 0, 1);
        if (!it.scene) s.scene = (k > 0 ? ENERGIZE : CALM)[s.scene] ?? s.scene;
        if (k > 0) {
          if (s.kind === "chorus" && (s.lyricStyle === "line-fade" || s.lyricStyle === "subtitle")) s.lyricStyle = "word-pop";
          if (s.transitionIn === "fade" || s.transitionIn === "bloom") s.transitionIn = s.kind === "chorus" ? "flash" : "wipe";
        } else {
          if (s.lyricStyle === "impact" || s.lyricStyle === "word-pop") s.lyricStyle = "line-fade";
          if (s.transitionIn === "flash" || s.transitionIn === "cut") s.transitionIn = "fade";
        }
      }
      changes.push(`${where}${it.energy > 0 ? "提高能量：場景更快更亮、反應更強" : "收斂能量：場景放慢、降低亮度"}`);
    }
    if (it.scene) {
      for (const s of secs) s.scene = it.scene;
      changes.push(`${where}改用「${SCENES[it.scene].label}」場景`);
    }
    if (it.lyrics === "hide") {
      for (const s of secs) s.lyricStyle = "hidden";
      changes.push(`${where}隱藏歌詞`);
    } else if (it.lyrics === "less") {
      const pool = it.targets ? secs : secs.filter((s) => s.kind !== "chorus");
      for (const s of pool) if (s.lyricStyle !== "hidden") s.lyricStyle = s.kind === "verse" ? "subtitle" : "hidden";
      changes.push(`${it.targets ? where : "副歌以外的段落"}減少歌詞`);
    } else if (it.lyrics === "show") {
      for (const s of secs) if (s.lyricStyle === "hidden") s.lyricStyle = s.kind === "chorus" ? "karaoke" : "line-fade";
      changes.push(`${where}顯示歌詞`);
    }
    if (it.style) {
      for (const s of secs) {
        s.lyricStyle = it.style;
        if (it.style === "vertical") s.lyricPlacement = "vertical-right";
        else if (s.lyricPlacement.startsWith("vertical")) s.lyricPlacement = "center";
      }
      changes.push(`${where}歌詞改為「${LYRIC_STYLES[it.style].label}」`);
    }
    if (it.placement) {
      for (const s of secs) {
        s.lyricPlacement = it.placement;
        if (s.lyricStyle === "vertical") s.lyricStyle = "line-fade";
      }
      changes.push(`${where}歌詞位置調整`);
    }
    if (it.lyricScale) {
      for (const s of secs) s.lyricScale = clamp(s.lyricScale + it.lyricScale, 0.6, 1.8);
      changes.push(`${where}歌詞${it.lyricScale > 0 ? "放大" : "縮小"}`);
    }
    if (it.hue != null || it.mono) {
      const base = hexToHsl(next.keyVisual.palette[1]?.hex ?? next.keyVisual.palette[0].hex).h;
      const delta = it.hue != null ? it.hue - base : 0;
      const recolor = (hex: string) => rotateHex(hex, it.hue, delta, it.mono);
      // color changes apply to the whole key visual so the show stays coherent
      next.keyVisual.palette = next.keyVisual.palette.map((p) => {
        const hex = recolor(p.hex);
        return { ...p, hex, name: colorName(hex) };
      });
      for (const s of next.sections) {
        s.colorway = s.colorway.map(recolor);
        s.lyricColor = recolor(s.lyricColor);
      }
      changes.push(it.mono ? "配色改為黑白單色" : "整體配色轉向指定色系");
    }
    if (it.font) {
      next.keyVisual.typography.cjkFont = it.font;
      next.keyVisual.typography.latinFont = FONT_CATALOG[it.font].generic === "serif" ? "playfair-display" : "space-grotesk";
      changes.push(`字體改為${FONT_CATALOG[it.font].label}`);
    }
  }
  return { plan: normalizePlan(next, input), changes };
}
