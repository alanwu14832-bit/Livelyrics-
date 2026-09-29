// 免費研究（公開資料＋歌詞與音訊分析）: the research step without the Claude API. Public facts from
// MusicBrainz and Wikipedia (in parallel, within a 15 s budget, cached on the project's research),
// then the local analysis (lyric imagery, emotion, point of view, sing-along phrases, audio mood,
// the genre's visual grammar), written up as a 繁中 brief with the same five headings as Claude's,
// so the design overview and the console show it the same way. Every source may fail: the brief
// then says so and stands on the lyrics and the audio.

import { formatTimeShort } from "@/lib/timeline";
import { FREE_RESEARCH_LABEL } from "@/lib/research-labels";
import { coercePublicInfo, isFreshPublicInfo, lookupPublicInfo, publicQuery, type LookupOptions } from "@/lib/server/research/public-info";
import { musicBrainzUrl } from "@/lib/server/research/musicbrainz";
import type { FetchLike } from "@/lib/server/research/http";
import type { PublicInfo, Research, ResearchSource } from "@/lib/types";
import { activeBible } from "./bible-style";
import { LYRIC_POLICY_INFO } from "@/lib/band";
import { SCENES, SECTION_KIND_LABELS } from "./catalog";
import { analyzeFindings, type Findings } from "./findings";
import { RESEARCH_HEADINGS } from "./prompts";
import { chooseVoice } from "./type-design";
import { VOICES } from "@/lib/type/vocab";
import { analyzeStructure, type SongStructure } from "./structure";
import type { DesignerCallbacks, DesignerInput } from "./types";

type Callbacks = Required<Omit<DesignerCallbacks, "signal">> & { signal?: AbortSignal };

export interface FreeResearchOptions {
  fetch?: FetchLike;
  now?: () => Date;
  /** why the free path runs (a Claude failure), named at the top of the brief */
  reason?: string;
  /** part of a Claude brief was already streamed: separate the free one */
  afterPartial?: boolean;
  /** lookup overrides (tests, the e2e stub): environment, budget, MusicBrainz spacing */
  lookup?: Pick<LookupOptions, "env" | "budgetMs" | "musicbrainzGapMs" | "musicbrainzGate" | "timeoutMs">;
}

const LINK_LABEL: Record<string, string> = {
  "official homepage": "官方網站",
  youtube: "官方 YouTube",
  "video channel": "官方影片頻道",
  bandcamp: "Bandcamp",
  setlistfm: "setlist.fm 現場歌單",
  soundcloud: "SoundCloud",
  "social network": "社群帳號",
  "free streaming": "串流",
  streaming: "串流",
};

const COUNTRY: Record<string, string> = { TW: "臺灣", HK: "香港", CN: "中國", JP: "日本", KR: "韓國", US: "美國", GB: "英國", MY: "馬來西亞", SG: "新加坡", CA: "加拿大", AU: "澳洲", DE: "德國", FR: "法國", SE: "瑞典", IS: "冰島" };
const ARTIST_TYPE: Record<string, string> = { Group: "樂團", Person: "音樂人", Orchestra: "樂團", Choir: "合唱團" };
/** MusicBrainz areas are English names: the common ones in 繁中 */
const AREA: Record<string, string> = {
  Taipei: "臺北",
  "New Taipei": "新北",
  Taichung: "臺中",
  Tainan: "臺南",
  Kaohsiung: "高雄",
  Hsinchu: "新竹",
  Taoyuan: "桃園",
  Keelung: "基隆",
  Hualien: "花蓮",
  Taitung: "臺東",
  "Hong Kong": "香港",
  Macau: "澳門",
  Tokyo: "東京",
  Osaka: "大阪",
  Kyoto: "京都",
  Seoul: "首爾",
  Busan: "釜山",
  Beijing: "北京",
  Shanghai: "上海",
  Guangzhou: "廣州",
  Shenzhen: "深圳",
  Chengdu: "成都",
  "Kuala Lumpur": "吉隆坡",
  Singapore: "新加坡",
  London: "倫敦",
  Manchester: "曼徹斯特",
  Glasgow: "格拉斯哥",
  "New York": "紐約",
  "Los Angeles": "洛杉磯",
  Austin: "奧斯汀",
  Chicago: "芝加哥",
  Seattle: "西雅圖",
  Reykjavík: "雷克雅維克",
  Paris: "巴黎",
  Berlin: "柏林",
};

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return Array.from(t).length > n ? `${Array.from(t).slice(0, n).join("")}…` : t;
}

function mdLink(title: string, url: string): string {
  return `[${title.replace(/[[\]]/g, "")}](${url})`;
}

/** The sources a free brief cites (public pages, then the band's official links). */
export function freeSources(info: PublicInfo | null): ResearchSource[] {
  const out: ResearchSource[] = [];
  const mb = info?.musicbrainz;
  if (mb?.artist) out.push({ title: `MusicBrainz：${mb.artist.name}`, url: musicBrainzUrl("artist", mb.artist.id) });
  if (mb?.recording) out.push({ title: `MusicBrainz：〈${mb.recording.title}〉`, url: musicBrainzUrl("recording", mb.recording.id) });
  const wp = info?.wikipedia;
  if (wp?.artist) out.push({ title: `維基百科：${wp.artist.title}`, url: wp.artist.url });
  if (wp?.song) out.push({ title: `維基百科：${wp.song.title}`, url: wp.song.url });
  for (const l of mb?.artist?.links ?? []) {
    if (out.length >= 9) break;
    if (!out.some((o) => o.url === l.url)) out.push({ title: LINK_LABEL[l.type] ?? l.type, url: l.url });
  }
  return out;
}

function artistSentence(info: PublicInfo): string | null {
  const a = info.musicbrainz?.artist;
  if (!a) return null;
  const country = a.country ? COUNTRY[a.country] ?? a.country : "";
  const areaName = a.area ? AREA[a.area] ?? a.area : "";
  const latinArea = /^[A-Za-z]/.test(areaName);
  const area = areaName && areaName !== country ? (country && latinArea ? `（${areaName}）` : areaName) : "";
  const where = `${country}${area}`;
  const whereText = where ? (/[A-Za-z]$/.test(where) ? `${where} 的` : `${where}的`) : "";
  const kind = a.type ? ARTIST_TYPE[a.type] ?? a.type : "音樂人";
  const since = a.beginYear ? `，${a.beginYear} 年開始活動` : "";
  const dis = a.disambiguation ? `（${a.disambiguation}）` : "";
  return `**${a.name}**：${whereText}${kind}${dis}${since}（${mdLink("MusicBrainz", musicBrainzUrl("artist", a.id))}）。`;
}

function sourcesStatus(info: PublicInfo): string {
  const s = info.status;
  const say = (label: string, st: typeof s.musicbrainz) => (st === "ok" ? `${label}有資料` : st === "none" ? `${label}沒有這首歌或樂團的條目` : st === "failed" ? `${label}這次連不上` : `${label}沒有查詢`);
  return `${say("MusicBrainz ", s.musicbrainz)}、${say("維基百科", s.wikipedia)}`;
}

function quietSections(st: SongStructure): string[] {
  return st.sections.filter((x) => x.energy <= 0.32 && x.kind !== "intro" && x.kind !== "outro").map((x) => formatTimeShort(x.start));
}

/** The 繁中 brief of the free research (the same five headings as Claude's). */
export function freeBrief(input: DesignerInput, f: Findings, st: SongStructure, opts: { reason?: string } = {}): string {
  const info = f.info;
  const artistName = input.meta?.artist?.trim() || "（未填樂團）";
  const title = input.meta?.title?.trim() || "（未填歌名）";
  const sung = f.lyrics.lineCount > 0;
  const g = f.genre;
  const bible = activeBible(input.bible);
  const found = info && (info.status.musicbrainz === "ok" || info.status.wikipedia === "ok");
  const head = [
    `> **${FREE_RESEARCH_LABEL}**：${opts.reason ? `${opts.reason}，改用免費研究。` : ""}這份簡報沒有使用 Claude：公開資料來自 MusicBrainz 與維基百科${info ? `（${sourcesStatus(info)}）` : ""}，其餘是 Livelyrics 在本機分析歌詞與音訊的結果。請把它當成起點，演出前和樂團確認。`,
  ];

  // ## 樂團視覺識別
  const identity: string[] = [];
  const who = info ? artistSentence(info) : null;
  if (who) identity.push(`- ${who}`);
  if (info?.wikipedia?.artist) identity.push(`- 維基百科：「${clip(info.wikipedia.artist.extract, 110)}」（${mdLink("維基百科", info.wikipedia.artist.url)}）`);
  if (f.genres.length) identity.push(`- 曲風：${f.genres.map((m) => `**${m.rule.label}**（${m.evidence[0]}）`).join("、")}。`);
  const links = (info?.musicbrainz?.artist?.links ?? []).slice(0, 4).map((l) => mdLink(LINK_LABEL[l.type] ?? l.type, l.url));
  if (links.length) identity.push(`- 官方連結：${links.join("、")}——先看 MV 與現場照片的色調、字體與剪輯節奏，再決定配色。`);
  if (!found) {
    const failed = [info?.status.musicbrainz === "failed", info?.status.wikipedia === "failed"].filter(Boolean).length;
    identity.push(`- 公開資料查不到 **${artistName}**${failed === 2 ? "（MusicBrainz 與維基百科這次都連不上）" : failed === 1 ? "（部分來源這次連不上）" : "（可能是獨立或新樂團）"}，以下依歌詞與音訊推論。`);
    identity.push("- 建議補上：專輯封面、logo、演出照片放進「樂團素材」，喜歡的畫面放進「參考圖」，設計就會跟著它們的顏色走。");
  }
  if (g) identity.push(`- 「${g.label}」的視覺語法：${g.palette.note}；場景偏向${g.scenes.slice(0, 3).map((x) => SCENES[x].label).join("、")}；字體${g.typography.note}。${g.why}`);
  if (bible) identity.push(`- 樂團視覺聖經：這首歌沿用聖經的${bible.palette.length ? `色盤（${bible.palette.slice(0, 5).map((c) => c.hex).join("、")}）` : "設定"}與字體，歌詞政策「${LYRIC_POLICY_INFO[bible.lyricPolicy.mode].label}」。`);

  // ## 歌曲意象與情緒
  const song: string[] = [];
  const rec = info?.musicbrainz?.recording;
  const wpSong = info?.wikipedia?.song;
  if (rec || wpSong) {
    const parts: string[] = [];
    if (rec?.releaseGroup) parts.push(`收錄於《${rec.releaseGroup.title}》${rec.year ? `（${rec.year}）` : ""}`);
    else if (rec?.year) parts.push(`${rec.year} 年發行`);
    song.push(`- 〈${title}〉：${parts.join("，")}${wpSong ? `${parts.length ? "。" : ""}「${clip(wpSong.extract, 120)}」（${mdLink("維基百科", wpSong.url)}）` : "。"}`);
  }
  song.push(`- 音訊：**${f.audio.label}**——${f.audio.why}`);
  if (sung) {
    if (f.imagery.length) {
      song.push(
        `- 歌詞意象：${f.imagery
          .slice(0, 4)
          .map((h) => `**${h.family.name}**（${h.words.slice(0, 2).join("、")}，${h.count} 次）→ ${h.family.colors}；${h.family.scenes.slice(0, 2).map((x) => SCENES[x].label).join("、")}`)
          .join("；")}。`,
      );
    } else song.push("- 歌詞中沒有抓到明顯的具象意象：畫面以音樂能量與色彩為主。");
    const e = f.lyrics.emotion;
    const words = [...e.positive.slice(0, 3), ...e.negative.slice(0, 3)];
    song.push(`- 情緒：**${e.label}**（正向程度 ${e.valence.toFixed(2)}、激昂程度 ${e.arousal.toFixed(2)}${words.length ? `；情緒詞：${words.join("、")}` : ""}${e.confidence === "low" ? "；情緒詞很少，僅供參考" : ""}）${e.hook ? `，副歌的 hook ${e.hook.arousal >= 0.6 ? "特別激昂" : e.hook.valence > e.valence + 0.2 ? "比主歌更明亮" : "延續整首的情緒"}` : ""}。`);
    song.push(`- 人稱：${f.lyrics.pov.label}——${f.lyrics.pov.note}`);
  } else {
    song.push("- 這首歌目前沒有歌詞：以音訊能量" + (g ? "與曲風" : "") + "為主，之後加入歌詞再重新研究，會得到意象與情緒的分析。");
  }

  // ## 現場表演觀察
  const live: string[] = [];
  const phrases = f.hints.singalong;
  if (phrases.length) {
    live.push(
      `- 大合唱重點：${phrases
        .map((p) => `「${p.text}」（${p.count} 次${p.start != null ? `，${formatTimeShort(p.start)} 起` : ""}）`)
        .join("、")}——這些字在畫面上加強，副歌讓歌詞提前出現，主唱把麥克風交給觀眾時保持在畫面上。`,
    );
  }
  const choruses = st.sections.filter((x) => x.kind === "chorus");
  live.push(choruses.length ? `- 副歌 ${choruses.length} 段（${choruses.map((x) => formatTimeShort(x.start)).join("、")}），最後一段是全曲最高點。` : "- 沒有偵測到重複的副歌：可能是敘事型的歌，歌詞可以更節制地出現。");
  const quiet = quietSections(st);
  if (quiet.length) live.push(`- 安靜段落：${quiet.join("、")}，適合收光、留白或直排文字。`);
  if (g && sung) live.push(`- ${g.label}的現場習慣：${g.live}`);
  else if (g) live.push(`- ${g.label}的現場：${g.palette.note}；畫面跟著能量的起伏走。`);
  const timed = st.lines.some((l) => l.start != null);
  if (sung) live.push(timed ? "- 歌詞已有時間碼，可用軌道模式自動播放；現場仍保留手動 cue。" : "- 歌詞沒有時間碼：先在歌詞編輯器打點，或在現場用手動 cue。");
  live.push("- 免費研究查不到這首歌的現場影片與樂迷習慣；需要的話用「用 claude.ai 研究」請 Claude 上網查。");

  // ## 設計方向建議
  const h = f.hints;
  // 字體藝術: every line is a composition in the song's typographic voice
  const voice = chooseVoice(f, st.cjk);
  const plan: string[] = [
    `- 世界觀：${h.world}`,
    `- 配色：${bible?.palette.length ? "沿用樂團視覺聖經的色盤；" : ""}${g ? `${g.palette.note}` : "由歌詞意象決定"}${f.imagery[0] ? `，點綴取自歌詞的「${f.imagery[0].family.name}」（${f.imagery[0].family.colors}）` : ""}；歌詞色與背景對比 4.5:1 以上。`,
    `- 母題：${h.motifs.slice(0, 4).join("、") || "一個簡單的幾何符號"}。`,
    `- 場景：${h.scenes
      .slice(0, 4)
      .map((x) => SCENES[x].label)
      .join("、")}${h.avoidScenes.length ? `；避免${h.avoidScenes.map((x) => SCENES[x].label).join("、")}` : ""}。`,
    sung
      ? `- 段落角色：前奏與間奏讓畫面主導；每一句歌詞都是一張排好的構圖，不是字幕：${SECTION_KIND_LABELS.verse}小而安靜、避開 IMAG，${SECTION_KIND_LABELS.chorus}放大成畫面的主角，一次比一次亮。${h.lyricDensity === "sparse" ? "這個曲風的歌詞份量要輕：主歌的字很小，只讓最關鍵的幾句放大。" : h.lyricDensity === "dense" ? "主歌字很密：用安靜的小字構圖，不要逐字動畫。" : ""}`
      : "- 段落角色：全程由畫面與燈光敘事，安靜段落退後、能量高的段落跟著節拍爆開。",
    `- 字體：${h.typography ? `${h.typography.note}，字重 ${Math.max(600, h.typography.weight)}` : "粗黑體或宋體，字重 700 以上"}；避開主唱 IMAG 與畫面下緣。`,
    ...(sung ? [`- 字體語言：${VOICES[voice.voice].label}——${voice.why}`] : []),
    `- 轉場：${h.motion === "soft" ? "柔和（光暈、淡入），不要硬切" : h.motion === "punchy" ? "跟著重拍硬切，爆點用閃白（LED 安全模式會改成淡入）" : "推進用擦除、爆點用閃白（LED 安全模式會改成淡入）、回落用淡出"}。`,
  ];

  const sources = freeSources(info);
  const refs = [
    ...sources.map((s) => `- ${mdLink(s.title, s.url)}`),
    "- 歌詞意象、情緒與音訊：Livelyrics 本機分析（策展的意象與情緒詞庫、曲風規則表）",
    ...(found ? [] : ["- 公開資料：這次沒有可用的條目"]),
  ];

  return [
    ...head,
    "",
    `## ${RESEARCH_HEADINGS[0]}`,
    ...identity,
    "",
    `## ${RESEARCH_HEADINGS[1]}`,
    ...song,
    "",
    `## ${RESEARCH_HEADINGS[2]}`,
    ...live,
    "",
    `## ${RESEARCH_HEADINGS[3]}`,
    ...plan,
    "",
    `## ${RESEARCH_HEADINGS[4]}`,
    ...refs,
  ].join("\n");
}

/** Run the free research: public facts (cached when fresh), the local analysis, the brief. Never throws except on cancellation. */
export async function freeResearch(input: DesignerInput, cb: Callbacks, opts: FreeResearchOptions = {}): Promise<Research> {
  const now = opts.now ?? (() => new Date());
  const delta = (t: string) => cb.onDelta(t);
  delta(`${opts.afterPartial ? "\n\n---\n\n" : ""}### 免費研究\n\n`);
  const q = publicQuery(input.meta);
  // the cached lookup comes from a stored project: read it defensively
  let info: PublicInfo | null = coercePublicInfo(input.publicInfo ?? null);
  if (info && isFreshPublicInfo(info, q, now())) {
    cb.onLog(`沿用先前查到的公開資料（${info.fetchedAt.slice(0, 10)}）`);
    delta("- 沿用先前查到的公開資料（MusicBrainz、維基百科）\n");
  } else {
    info = await lookupPublicInfo(q, {
      ...opts.lookup,
      fetch: opts.fetch,
      signal: cb.signal,
      now,
      onEvent: (e) => {
        if (e.kind === "start") {
          const label = e.source === "musicbrainz" ? "查詢 MusicBrainz…" : "讀取維基百科…";
          cb.onLog(label);
          cb.onSearch(`${e.source === "musicbrainz" ? "MusicBrainz" : "維基百科"}：${e.query}`);
          delta(`- ${label}\n`);
        } else {
          const label = e.source === "musicbrainz" ? "MusicBrainz" : "維基百科";
          const text = e.status === "ok" ? `找到 ${e.summary}` : e.summary;
          cb.onLog(`${label}：${text}`);
          delta(`  - ${label}：${text}\n`);
        }
      },
    });
    if (info.status.musicbrainz === "skipped" && info.status.wikipedia === "skipped" && info.notes[0]) {
      cb.onLog(info.notes[0]);
      delta(`- ${info.notes[0]}\n`);
    }
  }
  if (cb.signal?.aborted) throw cb.signal.reason instanceof Error ? cb.signal.reason : new Error("處理已取消");
  cb.onLog("分析歌詞意象…");
  delta("- 分析歌詞意象…\n");
  const st = analyzeStructure(input);
  const findings = analyzeFindings({ ...input, publicInfo: info }, st);
  cb.onLog("分析音訊情緒與曲風的視覺語法…");
  delta("- 分析音訊情緒與曲風的視覺語法…\n");
  const brief = freeBrief(input, findings, st, { reason: opts.reason });
  delta(`\n---\n\n${brief}`);
  const sources = freeSources(info);
  cb.onLog(`免費研究完成：${findings.genre ? `曲風「${findings.genre.label}」、` : ""}${findings.audio.label}、${sources.length} 個公開來源`);
  return { brief, sources, engine: "free", createdAt: now().toISOString(), publicInfo: info };
}
