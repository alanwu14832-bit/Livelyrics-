// Prompts for the two Claude calls: research (web search, Markdown brief) and design
// (structured DesignPlan). Written in Traditional Chinese: the persona is a Taiwanese
// band's dedicated stage-visual director, and every user-facing field is 繁中.

import { formatBytes, formatDuration } from "@/lib/assets";
import { FONT_IDS, LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, MEDIA_BLENDS, MEDIA_TREATMENTS, SCENE_IDS, SECTION_KINDS } from "@/lib/schema";
import { LYRIC_POLICY_INFO, bibleHasContent } from "@/lib/band";
import { ARC_ROLE_INFO, PALETTE_EMPHASIS_INFO } from "@/lib/show";
import type { Asset, BandBible, DesignPlan, Research, SongArcDirective, SongMeta } from "@/lib/types";
import { formatTimeShort } from "@/lib/timeline";
import { FONT_CATALOG, LYRIC_PLACEMENTS_INFO, LYRIC_STYLES, MEDIA_BLEND_INFO, MEDIA_TREATMENT_INFO, SCENES, SECTION_KIND_LABELS, TRANSITIONS } from "./catalog";
import { findImagery } from "./imagery";
import { moodboardBlock } from "./moodboard";
import { energyCurve, readingUnits, type SongStructure } from "./structure";
import type { DesignerInput, DesignRequest } from "./types";

export const RESEARCH_HEADINGS = ["樂團視覺識別", "歌曲意象與情緒", "現場表演觀察", "設計方向建議", "參考來源"] as const;

const MAX_BRIEF_CHARS = 12_000;
const MAX_LYRIC_LINES = 400;
const MAX_PREVIOUS_CHARS = 40_000;

// ---------------------------------------------------------------------------
// shared context
// ---------------------------------------------------------------------------

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function songBlock(input: DesignerInput, duration: number): string {
  const m: Partial<SongMeta> = input.meta ?? {};
  const rows = [
    `- 歌名：${m.title?.trim() || "（未提供）"}`,
    `- 樂團／歌手：${m.artist?.trim() || "（未提供）"}`,
  ];
  if (m.album) rows.push(`- 專輯：${m.album}${m.year ? `（${m.year}）` : ""}`);
  else if (m.year) rows.push(`- 年份：${m.year}`);
  rows.push(`- 長度：${formatTimeShort(duration)}（${duration.toFixed(1)} 秒）`);
  if (input.lyrics?.language) rows.push(`- 歌詞語言：${input.lyrics.language}`);
  return rows.join("\n");
}

function kindGuess(st: SongStructure, i: number): string {
  const s = st.sections[i];
  return `${s.kind}（${SECTION_KIND_LABELS[s.kind]}）`;
}

function lineRange(st: SongStructure, ids: string[]): string {
  if (!ids.length) return "無";
  return ids.length === 1 ? ids[0] : `${ids[0]}–${ids[ids.length - 1]}（${ids.length} 行）`;
}

/** Tempo, energy arc and section guesses — the audio analysis summary both prompts share. */
export function analysisSummary(input: DesignerInput, st: SongStructure): string {
  const a = input.analysis;
  const rows: string[] = [];
  if (a && Number.isFinite(a.bpm) && a.bpm > 0) {
    const conf = Number.isFinite(a.bpmConfidence) ? `（信心 ${a.bpmConfidence.toFixed(2)}）` : "";
    rows.push(`- 速度：約 ${Math.round(a.bpm)} BPM${conf}`);
  }
  else rows.push("- 速度：未知");
  if (!a) rows.push("- 沒有音訊分析：段落是依歌詞時間" + (st.source === "even" ? "平均切分" : "間隔推測") + "的，能量是依段落種類估計的。");
  rows.push("- 段落推測（邊界來自音訊的變化點，種類是依歌詞重複與能量推測，僅供參考）：");
  st.sections.forEach((s, i) => {
    rows.push(
      `  - a${i} ${s.start.toFixed(2)}–${s.end.toFixed(2)} 秒（${formatTimeShort(s.start)}–${formatTimeShort(s.end)}）能量 ${s.energy.toFixed(2)}｜推測 ${kindGuess(st, i)}｜歌詞 ${lineRange(st, s.lineIds)}${
        s.lineIds.length ? `｜重複比例 ${s.repeatedRatio.toFixed(2)}｜密度 ${s.density.toFixed(1)} 字/秒` : ""
      }`,
    );
  });
  return rows.join("\n");
}

export function energyCurveBlock(input: DesignerInput, st: SongStructure): string {
  const curve = energyCurve(input.analysis, st.duration, 2);
  if (!curve.length) return "（沒有音訊分析）";
  const rows: string[] = [];
  for (let i = 0; i < curve.length; i += 10) {
    rows.push(`${formatTimeShort(i * 2).padStart(5)}  ${curve.slice(i, i + 10).map((v) => v.toFixed(2)).join(" ")}`);
  }
  return rows.join("\n");
}

export function repetitionBlock(st: SongStructure): string {
  const groups = new Map<number, string[]>();
  for (const l of st.lines) {
    if (l.repeats < 2) continue;
    const g = groups.get(l.cluster) ?? [];
    g.push(l.id);
    groups.set(l.cluster, g);
  }
  if (!groups.size) return "- 沒有重複的歌詞行（可能是敘事型、沒有明顯副歌的歌）。";
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12)
    .map(([c, ids]) => `- ${ids.join(" = ")}${c === st.hookCluster ? "（最常重複，可能是 hook）" : ""}`);
  return rows.join("\n");
}

function fmt(t: number | null | undefined): string {
  return typeof t === "number" && Number.isFinite(t) ? t.toFixed(2) : "?";
}

function lyricsBlock(input: DesignerInput, st: SongStructure): string {
  const lines = input.lyrics?.lines ?? [];
  if (!lines.length) return "（沒有歌詞：可能是器樂曲，或歌詞尚未匯入。整首以畫面為主，歌詞樣式用 hidden。）";
  const rows = lines.slice(0, MAX_LYRIC_LINES).map((l, i) => {
    const info = st.lines[i];
    const span = info?.start != null ? `[${fmt(info.start)}–${fmt(info.end)}]` : "[未對時]";
    const tr = l.translation ? ` ／ 譯：${clip(l.translation, 80)}` : "";
    return `${l.id} ${span} ${clip(l.text, 120)}${tr}`;
  });
  if (lines.length > MAX_LYRIC_LINES) rows.push(`…（其餘 ${lines.length - MAX_LYRIC_LINES} 行省略）`);
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// band bible and show arc
// ---------------------------------------------------------------------------

/** The band's visual bible as a hard constraint (null when the band has none). */
export function bibleBlock(bible: BandBible | null | undefined, bandName?: string): string | null {
  if (!bible || !bibleHasContent(bible)) return null;
  const rows: string[] = [];
  if (bandName?.trim()) rows.push(`- 樂團：${clip(bandName, 60)}`);
  if (bible.summary.trim()) rows.push(`- 世界觀與氣質：\n${bible.summary.trim().slice(0, 3000).split("\n").map((l) => `  ${l}`).join("\n")}`);
  if (bible.palette.length) rows.push(`- 樂團色盤（配色必須從這裡取，可調整明暗但不換色相）：${bible.palette.map((c) => `${c.hex}（${c.role}，${c.name}）`).join("、")}`);
  rows.push(`- 字體：CJK ${bible.fonts.cjkFont}（${FONT_CATALOG[bible.fonts.cjkFont]?.label ?? ""}），拉丁 ${bible.fonts.latinFont}（${FONT_CATALOG[bible.fonts.latinFont]?.label ?? ""}），字重 ${bible.fonts.weight}`);
  if (bible.motifs.length) rows.push(`- 樂團母題：${bible.motifs.join("、")}`);
  if (bible.sceneAffinity.length) rows.push(`- 偏好場景：${bible.sceneAffinity.map((id) => `${id}（${SCENES[id].label}）`).join("、")}`);
  if (bible.sceneAvoid.length) rows.push(`- 避免場景（不要使用）：${bible.sceneAvoid.map((id) => `${id}（${SCENES[id].label}）`).join("、")}`);
  if (bible.treatments.length) rows.push(`- 素材偏好處理：${bible.treatments.map((id) => `${id}（${MEDIA_TREATMENT_INFO[id].label}）`).join("、")}`);
  rows.push(`- 歌詞政策：${LYRIC_POLICY_INFO[bible.lyricPolicy.mode].label}（${LYRIC_POLICY_INFO[bible.lyricPolicy.mode].description}）${bible.lyricPolicy.note ? `；補充：${clip(bible.lyricPolicy.note, 300)}` : ""}`);
  if (bible.dos.length) rows.push(`- 要：${bible.dos.join("；")}`);
  if (bible.donts.length) rows.push(`- 不要：${bible.donts.join("；")}`);
  return rows.join("\n");
}

export const BIBLE_RULE =
  "這是樂團所有歌共用的視覺聖經，是硬性規範：這首歌必須活在同一個世界裡（同一套色盤、字體、母題與禁忌）。只有在這首歌真的需要時才偏離，並且在 designerNotes 與該段 rationale 寫明偏離的理由。";

/** The song's place in the show arc (null without one). */
export function arcBlock(arc: SongArcDirective | null | undefined): string | null {
  if (!arc) return null;
  return [
    `- 演出：「${clip(arc.showName, 60)}」，第 ${arc.position + 1} 首（共 ${arc.total} 首）`,
    `- 角色：${ARC_ROLE_INFO[arc.role].label}；目標能量 ${arc.energy.toFixed(2)}（0 到 1，相對於整場）`,
    `- 配色重心：${PALETTE_EMPHASIS_INFO[arc.emphasis].label}（${PALETTE_EMPHASIS_INFO[arc.emphasis].description}）`,
    arc.note ? `- 弧線說明：${clip(arc.note, 400)}` : "",
    arc.role === "finale" || arc.role === "encore"
      ? "- 這首歌可以用整場最大的畫面（tunnel、最高強度、最滿的素材）。"
      : "- 整場最大的畫面（tunnel、最高強度）留給壓軸，這首歌的最高點要比壓軸收斂。",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// research
// ---------------------------------------------------------------------------

export const RESEARCH_SYSTEM = `你是這個樂團的專職舞台視覺總監（stage visual director），負責音樂祭與演唱會 LED 大螢幕的主視覺、背景動畫與歌詞呈現。你的工作方式和專業團隊一樣：先把樂團與這首歌研究透徹、訂出「世界觀」，才開始想特效。你相信影像是配角——它是樂團背後的一道牆，托起表演而不搶戲。

現在的任務是演前研究：用網路搜尋研究這個樂團與這首歌，寫一份設計師可以直接拿來做決策的研究簡報。

## 研究重點
1. 樂團視覺識別：專輯與單曲封面、MV 的美學（色調、場景、材質、剪輯節奏）、logo 與字體、招牌色彩與符號、過往演唱會／音樂祭的舞台設計與 VJ 影像、樂迷文化（應援色、口號、大合唱傳統）。
2. 歌曲意象與情緒：這首歌在說什麼、歌詞裡的具體意象（物件、場景、天氣、顏色、動作）、情緒弧線與轉折、創作背景（查得到的話）。
3. 現場表演觀察：這首歌在現場怎麼被演出——大合唱段落、call & response、drop 或爆點、安靜段落、樂團常見的延長或改編、觀眾反應。
4. 設計方向建議：把研究轉成可執行的方向——一句話的世界觀、配色方向（附理由）、2–5 個視覺母題、每種段落的螢幕角色（意象／歌詞／燈光能量）、哪些段落讓歌詞成為畫面主角、哪些段落不放歌詞。

## 搜尋方式
- 最多 8 次搜尋，先廣後窄：樂團名＋歌名、樂團名＋演唱會或舞台設計、MV、專輯封面、live 影片或樂評、樂迷討論。依樂團所在的語言圈搭配中文、英文、日文等關鍵字。
- 只採用與這個樂團、這首歌有關的資料；同名的其他樂團或歌曲要排除。
- 查不到就直說：如果公開資料很少（獨立樂團、新團、冷門歌），明確寫出「公開資料有限」，再根據曲風、歌詞與提供的音訊分析合理推論，並標示為推論。

## 寫作規則
- 以繁體中文撰寫 Markdown，依序使用這五個二級標題：
${RESEARCH_HEADINGS.map((h) => `  ## ${h}`).join("\n")}
- 直接從第一個標題開始，不要開場白或結語。全文約 600–1200 字，多用條列，寫具體的東西（顏色、物件、時間點、段落），不要空泛的形容詞。
- 查證過的事實在句中附上 Markdown 來源連結；推論要寫明「推測」或「可能」。
- 版權：不要重製歌詞。提到歌詞時只用幾個字的意象短語，絕不整句或整段抄錄。
- 「參考來源」列出實際用到的網址（標題＋連結）。
- 回覆中不要包含任何內部或系統用的 XML 標籤。`;

/** Short lyric context for research: counts, the opening and the hook (a few characters each), imagery words. */
export function lyricExcerpt(input: DesignerInput, st: SongStructure): string {
  const lines = input.lyrics?.lines ?? [];
  if (!lines.length) return "- 沒有歌詞（可能是器樂曲或尚未匯入）。";
  const rows = [`- 共 ${lines.length} 行，${input.lyrics.synced ? "已對時" : "尚未對時"}。`];
  const first = lines.find((l) => l.text.trim());
  if (first) rows.push(`- 開頭：「${clip(first.text, 8)}」`);
  const hook = st.hookCluster != null ? st.lines.find((l) => l.cluster === st.hookCluster) : undefined;
  if (hook && hook.text !== first?.text) rows.push(`- 最常重複的句子（可能是 hook）：「${clip(hook.text, 10)}」，出現 ${hook.repeats} 次`);
  const imagery = findImagery(lines.map((l) => l.text)).slice(0, 6);
  if (imagery.length) rows.push(`- 歌詞中的意象詞：${imagery.map((h) => h.words[0]).join("、")}`);
  const units = lines.reduce((a, l) => a + readingUnits(l.text), 0);
  rows.push(`- 平均每行約 ${Math.round(units / lines.length)} 個字`);
  return rows.join("\n");
}

export function buildResearchPrompt(input: DesignerInput, st: SongStructure): string {
  const bible = bibleBlock(input.bible, input.bandName);
  return [
    "# 歌曲",
    songBlock(input, st.duration),
    "",
    "# 歌詞摘要（只供理解，簡報中不要重製歌詞）",
    lyricExcerpt(input, st),
    "",
    "# 音訊分析（瀏覽器自動分析，可能有誤差）",
    analysisSummary(input, st),
    ...(bible
      ? ["", "# 樂團視覺聖經（已確立的樂團世界觀）", BIBLE_RULE, "研究時以它為前提：「設計方向建議」要說明這首歌如何在這個世界裡找到自己的位置，而不是另起爐灶。", bible]
      : []),
    "",
    "請開始研究，然後依規定的五個標題寫出研究簡報。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// design
// ---------------------------------------------------------------------------

export function catalogBlock(): string {
  const scenes = SCENE_IDS.map((id) => `- ${id}（${SCENES[id].label}，適合能量 ${SCENES[id].energy[0]}–${SCENES[id].energy[1]}）：${SCENES[id].description}`);
  const styles = LYRIC_STYLE_IDS.map((id) => `- ${id}（${LYRIC_STYLES[id].label}）：${LYRIC_STYLES[id].description}`);
  const placements = LYRIC_PLACEMENTS.map((id) => `- ${id}：${LYRIC_PLACEMENTS_INFO[id]}`);
  const transitions = (Object.keys(TRANSITIONS) as Array<keyof typeof TRANSITIONS>).map((id) => `- ${id}：${TRANSITIONS[id]}`);
  const fonts = FONT_IDS.map((id) => `- ${id}（${FONT_CATALOG[id].label}，${FONT_CATALOG[id].cjk ? "CJK 中文字體" : "拉丁字體"}）：${FONT_CATALOG[id].description}`);
  const kinds = SECTION_KINDS.map((k) => `${k}＝${SECTION_KIND_LABELS[k]}`).join("、");
  const treatments = MEDIA_TREATMENTS.map((id) => `- ${id}（${MEDIA_TREATMENT_INFO[id].label}）：${MEDIA_TREATMENT_INFO[id].description}`);
  const blends = MEDIA_BLENDS.map((id) => `- ${id}：${MEDIA_BLEND_INFO[id]}`);
  return [
    "# 場景 scene（背景 GLSL 動畫，會吃 colorway 三色與 sceneParams）",
    ...scenes,
    "",
    "# 歌詞樣式 lyricStyle",
    ...styles,
    "",
    "# 歌詞位置 lyricPlacement（畫面有約 90% 的安全區）",
    ...placements,
    "",
    "# 轉場 transitionIn（進入該段時）",
    ...transitions,
    "",
    "# 字體（typography.cjkFont 必須是 CJK 中文字體；latinFont 必須是拉丁字體）",
    ...fonts,
    "",
    `# 段落種類 kind：${kinds}`,
    "",
    "# 樂團素材 media.treatment（素材放在場景之上、歌詞之下，會用該段 colorway 處理）",
    ...treatments,
    "",
    "# 素材混合 media.blend",
    ...blends,
  ].join("\n");
}

export const DESIGN_SYSTEM = `你是這個樂團的專職舞台視覺總監，要為一首歌設計音樂祭／演唱會 LED 大螢幕的完整視覺方案（DesignPlan）。方案會被即時渲染器逐段播放：底層是 GLSL 場景動畫，上層是文字引擎排版的歌詞；現場的視覺操作員會依照你寫的 cue 操作。

# 設計原則
1. 視覺是配角、托起樂團。螢幕是樂團背後的一道牆，不和主唱搶戲。每一段先決定螢幕的角色：傳達意象、顯示歌詞，還是像燈光一樣堆疊能量。
2. 先有世界觀。先訂主視覺概念（這首歌在舞台上是一個什麼樣的世界、為什麼），再由它推出配色與母題，最後才是逐段畫面。配色與母題優先取自研究到的樂團識別（專輯封面、MV、招牌色、符號），其次才是歌詞意象。整首歌要像同一個世界，而不是 12 種特效的拼貼。
3. 歌詞是作品的一部分，而且要節制——不是整首卡拉 OK 字幕：
   - 畫面主導的主歌：subtitle 或 hidden；敘事歌的主歌可用 line-fade／stack 讓歌詞本身成為視覺。
   - 大合唱副歌：karaoke（整行提前出現，觀眾才能跟唱）或 impact（口號、hook，一次幾個字的巨字）；快歌副歌也可用 word-pop。
   - 詩意的中文短句（橋段、安靜段）：vertical 直排最有海報感。拉丁文字不要直排。
   - 前奏、間奏、solo、純器樂：hidden。
   - 字很密的段落（每秒超過約 5 個字，例如饒舌、快歌主歌）：不要逐字動畫，改 subtitle 或 hidden，把歌詞留給副歌。
4. 大螢幕可讀性：字重 600 以上（建議 700–900）；歌詞色與該段背景 colorway[0] 的對比至少 4.5:1（建議 7:1 以上）；同時最多 2 行、每行約 16 個中文字內。避開主唱 IMAG（畫面中央偏下、主唱臉的位置）與畫面最下緣（會被觀眾的頭、旗子與手機擋住）：重要的句子放 center 或 upper-third，lower-third 只給安靜的字幕。
5. 能量對應：場景、速度、密度、亮度與音訊反應跟著音訊能量走；副歌一次比一次強，最後一次副歌是全曲最高點；安靜段真的要安靜（低 intensity、慢、少元素）。轉場配合能量：爆點用 flash 或 cut，推進用 wipe，進入抒情用 bloom，回落用 fade。相鄰段落避免用同一個場景（刻意延續除外）。
6. 樂團自己的素材是最強的識別。有提供素材時，像專業 VJ 一樣使用它們，讓畫面一看就是「這個樂團」而不是通用特效：
   - 專輯封面就是這首歌的世界：開場、橋段或最後一次副歌用 slow-drift 或 duotone 把封面鋪成整個畫面，配色與母題也從封面取。
   - 照片（排練、後台、樂手特寫）用 duotone 或 grain-film 處理成 colorway 的顏色，不要原色直接貼上；它們和場景要像同一個世界。
   - MV 片段在高能量段落（副歌、drop、solo）用 beat-cut 跟著拍子剪；安靜段落改 blur-glow 或 slow-drift。
   - logo 節制使用：前奏開場與尾奏收尾各一次最有力（fit 用 contain、blend 用 screen），不要每段都出現。
   - 永遠不和歌詞搶：該段有歌詞時用 mask-lyrics、blur-glow，或把 opacity 降到 0.35–0.6；hidden 的器樂段才讓素材滿版 0.8–1。
   - 不是每段都要放素材：留一些段落只用場景，讓素材出現時有份量。素材的 note 與 tags 是操作員的說明（例如哪張是專輯封面），請依此選用。
   - 沒有提供素材時，每段的 media 一律是 null。
7. 樂團視覺聖經：如果提供了「樂團視覺聖經」，它是這個樂團所有歌共用的世界觀，屬於硬性規範：配色取自聖經色盤、字體用聖經字體、避免的場景不用、遵守歌詞政策與禁忌。偏離時要在 rationale 寫出理由。如果提供了「整場弧線中的位置」，依它調整這首歌的整體強度與配色重心。
8. 給操作員的 cue：在大的能量上升（drop）、大合唱、安靜段、以及容易出錯的地方（樂團可能延長、即興、突然停）寫提示，說清楚「什麼時候、做什麼」，例如「最後一拍後按 B 全黑」「強度可推到 1.2」「主唱把麥克風交給觀眾時保持歌詞在畫面上」。

${catalogBlock()}

# 輸出規則
- 所有給人看的文字都用繁體中文。
- sections 依時間排序、id 依序為 s0、s1…；第一段從 0 開始、最後一段在歌曲長度 duration 結束，前一段的 end 等於下一段的 start，不可有空隙或重疊。段落邊界對齊提供的音訊段落推測與歌詞結構（重複出現的句子群通常是副歌）；每段至少約 4 秒。label 用「主歌一」「副歌二」這類好懂的名稱。
- palette 4–6 色、色碼一律小寫 6 碼 #rrggbb；第一色是最深的背景色，並至少包含一個給歌詞用的高對比亮色。每段的 colorway 恰好 3 色、取自 palette：[背景, 主色, 點綴]。
- sceneParams 與 energy 是 0–1；lyricScale 是 0.6–1.8（1 是預設可讀大小）；typography.letterSpacing 以 em 為單位，約 -0.02 到 0.2。
- lines 只放需要特別處理的歌詞行（hook 的強調字、改成 impact 的口號、關鍵意象字）。lineId 必須是提供的歌詞 id；emphasis 必須是該行歌詞中逐字相同的片段。
- cues 3–12 個、依時間排序，time 以秒為單位。
- motifSvg：一個簡潔的主視覺符號（viewBox="0 0 100 100"），只能用 svg、g、path、circle、rect、polygon、polyline、line、ellipse；fill／stroke 用 currentColor；不要文字、腳本、style、外部連結或漸層；2500 字元內。它會被平鋪、環繞與脈動，所以要是清楚、可辨識的剪影，並呼應主視覺母題。
- designerNotes：150–400 字的 Markdown，說明敘事弧線、歌詞與動畫怎麼搭配、現場注意事項。
- media：null（只用場景）或 { assetId, treatment, fit, opacity, blend }；assetId 必須是「樂團素材」清單裡逐字相同的 id。用到素材的段落在 rationale 說明為什麼這樣用。
- 不要重製歌詞；rationale、notes 裡提到歌詞只用幾個字。`;

const MAX_ASSETS_IN_PROMPT = 60;

/** The band's uploaded material, one line per asset (id, kind, size, note, tags). */
export function assetsBlock(assets: readonly Asset[] | undefined): string {
  const list: readonly Asset[] = Array.isArray(assets) ? (assets as readonly Asset[]) : [];
  if (!list.length) return "（沒有提供素材：每段的 media 一律填 null。）";
  const kind: Record<string, string> = { image: "圖片", video: "影片", logo: "標誌" };
  const rows = list.slice(0, MAX_ASSETS_IN_PROMPT).map((a) => {
    const parts = [`${a.id}｜${kind[a.kind] ?? a.kind}｜「${clip(a.name, 60)}」｜${a.width}×${a.height}`];
    if (a.duration) parts.push(`長度 ${formatDuration(a.duration)}（${a.duration.toFixed(1)} 秒）`);
    parts.push(formatBytes(a.bytes));
    if (a.note) parts.push(`說明：${clip(a.note, 200)}`);
    if (a.tags?.length) parts.push(`標籤：${a.tags.slice(0, 8).join("、")}`);
    return `- ${parts.join("｜")}`;
  });
  if (list.length > MAX_ASSETS_IN_PROMPT) rows.push(`…（其餘 ${list.length - MAX_ASSETS_IN_PROMPT} 個素材省略）`);
  return rows.join("\n");
}

export function trimBrief(research: Research | null): string {
  const brief = research?.brief?.trim();
  if (!brief) return "（沒有研究簡報：請根據歌詞與音訊分析推論，並在 designerNotes 註明。）";
  const clipped = brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS)}\n…（簡報過長，已截斷）` : brief;
  if (research?.engine === "offline") return `（以下是離線的啟發式簡報，沒有經過網路研究，僅供參考）\n\n${clipped}`;
  if (research?.engine === "free") return `（以下是免費研究的簡報：MusicBrainz／維基百科的公開資料加上歌詞與音訊的自動分析，沒有深入的網路研究，請查證後再採用）\n\n${clipped}`;
  return clipped;
}

function previousBlock(previous: DesignPlan): string {
  let json = JSON.stringify(previous);
  if (json.length > MAX_PREVIOUS_CHARS) json = JSON.stringify({ ...previous, designerNotes: "", keyVisual: { ...previous.keyVisual, motifSvg: "" } });
  return "```json\n" + json + "\n```";
}

export function buildDesignPrompt(req: DesignRequest, st: SongStructure): string {
  const parts = [
    "# 歌曲",
    songBlock(req, st.duration),
    `- duration：${st.duration.toFixed(3)} 秒（最後一段的 end 必須剛好是這個值）`,
    "",
    "# 音訊分析",
    analysisSummary(req, st),
    "",
    "## 能量曲線（每 2 秒一個值，0–1）",
    energyCurveBlock(req, st),
    "",
    "## 歌詞重複（副歌線索）",
    repetitionBlock(st),
    "",
    "# 歌詞（id [開始–結束 秒] 文字）",
    lyricsBlock(req, st),
    "",
    "# 研究簡報",
    trimBrief(req.research),
    "",
    "# 樂團素材（id｜種類｜名稱｜尺寸｜…）",
    assetsBlock(req.assets),
  ];
  const bible = bibleBlock(req.bible, req.bandName);
  if (bible) parts.push("", "# 樂團視覺聖經（硬性規範）", BIBLE_RULE, bible);
  const mood = moodboardBlock(req.moodboard, req.moodboardImages);
  if (mood) parts.push("", "# 參考圖（mood board）", mood, "把參考圖的線索寫進 keyVisual.concept 與相關段落的 rationale（註明圖號）。");
  const arc = arcBlock(req.arc);
  if (arc) parts.push("", "# 整場弧線中的位置", "這首歌是一整場演出的一部分，依它在弧線中的位置調整強度與配色重心：", arc);
  const instruction = req.instruction?.trim();
  if (req.previous && instruction) {
    parts.push(
      "",
      "# 重新設計",
      `操作員的指示：「${clip(instruction, 600)}」`,
      "以目前的方案為基礎，只修改指示要求的部分；指示沒有提到的段落時間、場景、配色、歌詞樣式與 cue 盡量保持不變。在 designerNotes 開頭用一句話說明這次改了什麼。",
      "目前的方案：",
      previousBlock(req.previous),
    );
  } else if (instruction) {
    parts.push("", "# 操作員的指示", `「${clip(instruction, 600)}」——請在設計中落實這個方向。`);
  } else if (req.previous) {
    parts.push("", "# 先前的方案（參考）", "歌詞、分析或研究可能已經更新。請重新設計；仍然成立的部分（例如主視覺與配色）可以沿用。", previousBlock(req.previous));
  }
  parts.push("", "請輸出完整的 DesignPlan。");
  return parts.join("\n");
}
