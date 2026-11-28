// 專屬畫面 (round 25): render → metrics → critique. A written program is rendered on the CPU (the
// luminance probe, probe.ts) in the four states that carry the song's arc — a verse, the build into
// the chorus, the first chorus, the last chorus — and measured against the composition targets the
// scene prompt states (shot-composition / color-motion digest): a verse under 10 % of the wall lit,
// a chorus 25–45 % and at least twice the verse, the last chorus no smaller than the first, one focal
// subject inside the safe area, nothing pushed to white, no NaN and no blank frame. The designer sends
// the failed checks back to Claude for one corrected program and keeps whichever version scores better.

import type { DesignPlan, SceneProgram, SceneProgramCheck, SectionDesign } from "../../types";
import { isBuildSection } from "./composer";
import { PROBE_BLACK_MEAN, PROBE_MEAN_MAX, probePlanProgram, type ProbeSample } from "./probe";

export type CheckState = SceneProgramCheck["states"][number]["state"];

/** The composition targets (fractions of the wall above the probe's coverage luma 0.2). */
export const CRITIQUE_TARGETS = {
  verseMax: 0.1,
  chorusMin: 0.25,
  chorusMax: 0.45,
  lastChorusMax: 0.5,
  chorusOverVerse: 2,
  /** the largest lit shape's share of the lit area in a chorus (one focal subject) */
  focusMin: 0.5,
  /** the subject's centre stays this far from the frame's edges (safe area) */
  safe: 0.05,
  /** nothing on the wall is pushed to white: at most this fraction of a state above PROBE_WHITE (a highlight, not an area) */
  whiteMax: 0.03,
  /**
   * Round 27 (N1/N6): behind the words (the padded text box, the words on screen) at most this fraction
   * lit above PROBE_BOX_LIT — calibrated on the audit: threads 11–22 %, pillars 15–21 %, the folk moon
   * in the chorus poster band 10–16 %, demo's last-chorus rings 7 %; city pop's sun 0 %…
   */
  boxLitMax: 0.06,
  /** …and at most this fraction of neighbouring samples an edge (threads 0.20–0.26, rings 0.09–0.12; the sun 0.01–0.03) */
  boxEdgeMax: 0.06,
} as const;

const STATE_LABEL: Record<CheckState, string> = { verse: "主歌", build: "漸強", chorus: "副歌", "last-chorus": "最後副歌" };

export interface SceneCritique {
  check: Omit<SceneProgramCheck, "fixTurn" | "kept" | "summary">;
  /** higher is better: every passed check counts 10, minus how far the misses are from their targets */
  score: number;
  /** the failed checks, worded for Claude (with the numbers and what to change) */
  failed: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The four arc states of a plan: indices into its sections (a state the song lacks is left out). */
export function critiqueStates(sections: readonly Pick<SectionDesign, "id" | "kind" | "energy">[]): Array<{ state: CheckState; index: number }> {
  const cs = sections.map((s) => ({ id: s.id, kind: s.kind, energy: s.energy }));
  const out: Array<{ state: CheckState; index: number }> = [];
  const build = cs.findIndex((s, i) => s.kind === "pre-chorus" || ((s.kind === "verse" || s.kind === "interlude") && isBuildSection(cs, i)));
  // the verse: one that does not lead into a chorus, else the song's only verse (then it is not also the build)
  const plain = cs.findIndex((s, i) => s.kind === "verse" && i !== build);
  const verse = plain >= 0 ? plain : cs.findIndex((s) => s.kind === "verse");
  const verseAny = verse >= 0 ? verse : cs.findIndex((s) => s.kind === "intro");
  const choruses = cs.map((s, i) => (s.kind === "chorus" ? i : -1)).filter((i) => i >= 0);
  if (verseAny >= 0) out.push({ state: "verse", index: verseAny });
  if (build >= 0 && build !== verseAny) out.push({ state: "build", index: build });
  if (choruses.length) out.push({ state: "chorus", index: choruses[0] });
  if (choruses.length > 1) out.push({ state: "last-chorus", index: choruses[choruses.length - 1] });
  return out;
}

/**
 * Render the program in the plan's arc states and check it. Null when the CPU evaluator cannot run the
 * program (nothing to critique; the program is kept as it is).
 */
export function critiqueProgram(program: SceneProgram, plan: Pick<DesignPlan, "sections" | "keyVisual">): SceneCritique | null {
  const probe = probePlanProgram(program, plan);
  if (probe.unsupported || probe.samples.length !== plan.sections.length) return null;
  const T = CRITIQUE_TARGETS;
  const states = critiqueStates(plan.sections).map(({ state, index }) => ({ state, s: probe.samples[index] as ProbeSample }));
  const at = (k: CheckState) => states.find((x) => x.state === k)?.s;
  const verse = at("verse");
  const build = at("build");
  const chorus = at("chorus");
  const last = at("last-chorus");
  const checks: SceneProgramCheck["checks"] = [];
  const failed: string[] = [];
  let miss = 0;
  const add = (id: string, ok: boolean, label: string, fix: string, distance: number) => {
    checks.push({ id, ok, label });
    if (!ok) {
      failed.push(`${label}——${fix}`);
      miss += Math.min(1, Math.abs(distance));
    }
  };
  if (verse) add("verse-quiet", verse.cover < T.verseMax, `主歌亮的面積 ${pct(verse.cover)}（目標 < ${pct(T.verseMax)}）`, "主歌的主角縮小、退後，大部分畫面留暗", (verse.cover - T.verseMax) / T.verseMax);
  if (chorus) {
    const inRange = chorus.cover >= T.chorusMin && chorus.cover <= T.chorusMax;
    add("chorus-open", inRange, `副歌亮的面積 ${pct(chorus.cover)}（目標 ${pct(T.chorusMin)}–${pct(T.chorusMax)}）`, chorus.cover < T.chorusMin ? "副歌讓主角變大、多一層形狀，打開畫面（不是整個調亮）" : "副歌的亮部收一點，留出暗的背景", chorus.cover < T.chorusMin ? (T.chorusMin - chorus.cover) / T.chorusMin : (chorus.cover - T.chorusMax) / T.chorusMax);
    if (verse) add("chorus-over-verse", chorus.cover >= Math.max(0.05, verse.cover * T.chorusOverVerse), `副歌是主歌的 ${verse.cover > 0 ? (chorus.cover / verse.cover).toFixed(1) : "∞"} 倍（目標 ≥ ${T.chorusOverVerse} 倍）`, "主歌更安靜、副歌更開，兩者的差要一眼看得出來", 1 - chorus.cover / Math.max(0.01, verse.cover * T.chorusOverVerse));
    add("one-subject", chorus.subjects != null && chorus.subjects >= 1 && (chorus.focus ?? 0) >= T.focusMin, `副歌有 ${chorus.subjects ?? 0} 個亮的形狀，最大的佔亮部 ${pct(chorus.focus ?? 0)}（目標：一個主角佔一半以上）`, "讓一個主角形狀明顯最大，其他的縮小或變暗", T.focusMin - (chorus.focus ?? 0));
    const cx = chorus.cx ?? 0.5;
    const cy = chorus.cy ?? 0.5;
    add("safe-area", chorus.cover === 0 || (cx >= T.safe && cx <= 1 - T.safe && cy >= T.safe && cy <= 1 - T.safe), `副歌主角的中心在 (${cx.toFixed(2)}, ${cy.toFixed(2)})（目標：離邊緣 ${pct(T.safe)} 以上）`, "把主角往畫面裡收", Math.max(T.safe - cx, cx - (1 - T.safe), T.safe - cy, cy - (1 - T.safe)) * 4);
  }
  if (chorus && last) add("last-grows", last.cover >= chorus.cover - 0.02 && last.cover <= T.lastChorusMax, `最後副歌 ${pct(last.cover)}，第一次副歌 ${pct(chorus.cover)}（目標：不比第一次小，上限 ${pct(T.lastChorusMax)}）`, last.cover < chorus.cover ? "最後一次副歌要比第一次更大" : "最後一次副歌的亮部收一點", (chorus.cover - last.cover) / Math.max(0.05, chorus.cover));
  if (build && verse) add("build-rises", build.cover >= verse.cover - 0.01, `漸強 ${pct(build.cover)}，主歌 ${pct(verse.cover)}（目標：漸強不比主歌暗）`, "漸強段讓形狀開始長大", (verse.cover - build.cover) / Math.max(0.05, verse.cover));
  // round 27: nothing fights the words — the box behind them stays dark and calm in every arc state
  const boxLit = states.reduce((m, { state, s }) => ((s.boxLit ?? 0) > m.v ? { v: s.boxLit ?? 0, at: state } : m), { v: 0, at: "verse" as CheckState });
  const boxEdge = states.reduce((m, { state, s }) => ((s.boxEdge ?? 0) > m.v ? { v: s.boxEdge ?? 0, at: state } : m), { v: 0, at: "verse" as CheckState });
  add("words-dark", boxLit.v <= T.boxLitMax, `字後面亮的面積最多 ${pct(boxLit.v)}（${STATE_LABEL[boxLit.at]}；目標 ≤ ${pct(T.boxLitMax)}）`, "形狀長大越過字的位置時，用 wordsMask(uv, 0.05) 把它在字的周圍淡出到背景色（羽化），不要讓亮部壓在字上", (boxLit.v - T.boxLitMax) / T.boxLitMax);
  add("words-calm", boxEdge.v <= T.boxEdgeMax, `字後面的線條／邊緣密度最多 ${pct(boxEdge.v)}（${STATE_LABEL[boxEdge.at]}；目標 ≤ ${pct(T.boxEdgeMax)}）`, "字的周圍不要有細條紋、圓環或形狀的邊緣穿過；用 wordsMask 讓它們在字後面消失", (boxEdge.v - T.boxEdgeMax) / T.boxEdgeMax);
  const whiteArea = Math.max(0, ...probe.samples.map((s) => s.white ?? 0));
  const maxMean = Math.max(0, ...probe.samples.map((s) => s.mean));
  add("no-white", whiteArea <= T.whiteMax && maxMean <= PROBE_MEAN_MAX, `接近白色的面積 ${pct(whiteArea)}、最亮的段落平均亮度 ${maxMean.toFixed(2)}（目標 ≤ ${pct(T.whiteMax)}、≤ ${PROBE_MEAN_MAX}）`, "最亮處也要是 uPri／uAcc 的顏色，用 mix 疊色，不要一路相加推到白", (whiteArea - T.whiteMax) * 10 + Math.max(0, maxMean - PROBE_MEAN_MAX) * 5);
  const nan = probe.samples.reduce((a, s) => a + (s.nan ?? 0), 0);
  const blank = states.filter(({ state, s }) => (state === "chorus" || state === "last-chorus" ? s.cover < 0.05 : s.mean < PROBE_BLACK_MEAN && s.cover === 0)).map(({ state }) => STATE_LABEL[state]);
  add("healthy", nan === 0 && blank.length === 0, nan ? `有 ${nan} 個取樣是 NaN` : blank.length ? `${blank.join("、")}的畫面幾乎是空的` : "沒有 NaN、沒有空白畫面", nan ? "除數加小量、pow／sqrt 的底先 max(0.0)、避開 atan(0,0) 與 normalize(0)" : "每一段都要有看得見的主角", 1);
  const passed = checks.filter((c) => c.ok).length;
  return {
    check: {
      passed,
      total: checks.length,
      checks,
      states: states.map(({ state, s }) => ({ state, sectionId: s.sectionId, cover: r3(s.cover), mean: r3(s.mean), max: r3(s.max ?? 0), subjects: s.subjects ?? 0, focus: r3(s.focus ?? 0), cx: s.cx, cy: s.cy ?? null, boxLit: r3(s.boxLit ?? 0), boxEdge: r3(s.boxEdge ?? 0) })),
    },
    score: r3(passed * 10 - miss),
    failed,
  };
}

/** The critique as the follow-up turn's prompt block (the numbers per state and the failed checks). */
export function critiqueBlock(c: SceneCritique): string {
  const rows = c.check.states.map((s) => `- ${STATE_LABEL[s.state]}（${s.sectionId}）：亮的面積 ${pct(s.cover)}，平均亮度 ${s.mean.toFixed(2)}，最亮 ${s.max.toFixed(2)}，亮的形狀 ${s.subjects} 個（最大佔 ${pct(s.focus)}），中心 ${s.cx == null ? "—" : `(${s.cx.toFixed(2)}, ${(s.cy ?? 0.5).toFixed(2)})`}，字後面亮 ${pct(s.boxLit ?? 0)}、邊緣 ${pct(s.boxEdge ?? 0)}`);
  return [`在伺服器上把你的程式渲染出來量到的結果（通過 ${c.check.passed}／${c.check.total} 項）：`, ...rows, "", "沒有達標的項目：", ...c.failed.map((f) => `- ${f}`)].join("\n");
}

/** One line for the console (Traditional Chinese): what the self-check found and whether a fix turn ran. */
export function checkLine(check: SceneProgramCheck | null | undefined): string | null {
  if (!check) return null;
  const chorus = check.states.find((s) => s.state === "chorus");
  const verse = check.states.find((s) => s.state === "verse");
  const nums = [verse && `主歌亮 ${pct(verse.cover)}`, chorus && `副歌 ${pct(chorus.cover)}`].filter(Boolean).join("、");
  const tally = `通過 ${check.passed}／${check.total} 項${nums ? `（${nums}）` : ""}`;
  if (!check.fixTurn) return `畫面自我檢查：${tally}${check.passed === check.total ? "，不需修正" : ""}`;
  if (check.kept === "fixed") return `畫面自我檢查：第一版只通過 ${check.firstPassed ?? "?"}／${check.total} 項，Claude 修正一次 → ${tally}`;
  return `畫面自我檢查：${check.fixFailed ? "修正失敗" : "修正版沒有比較好"}，保留第一版，${tally}`;
}
