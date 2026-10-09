import { describe, expect, it } from "vitest";
import type { AudioAnalysis, LyricLine } from "../types";
import {
  DEFAULT_ASR_ALIGN,
  alignTranscript,
  applyAnchors,
  asrLanguage,
  hanTables,
  hasHan,
  loadHanTables,
  loopTokens,
  similarity,
  tokenize,
  type AsrWord,
  type HanData,
  type HanTables,
} from "./asr-align";
import hanData from "./han-data.json";
import { detectLanguage, normalizeLyrics } from "./lrc";

const HAN: HanTables = hanTables(hanData as HanData);

/** Recognised words for a text, one word (or Han / kana character) every `step` seconds from `at`. */
function say(text: string, at: number, step = 0.4): AsrWord[] {
  const parts = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? Array.from(text.replace(/\s+/g, "")) : text.split(/\s+/).filter(Boolean);
  return parts.map((w, k) => ({ text: ` ${w}`, start: at + k * step, end: at + k * step + step * 0.8 }));
}

/** Anchor starts per line; without the timestamp calibration (`offset`), so the times read as said. */
const startsOf = (lines: readonly string[], words: AsrWord[], extra: Partial<Parameters<typeof alignTranscript>[0]> = {}) => {
  const r = alignTranscript({ lines, words, ...extra, params: { offset: 0, ...extra.params } });
  const out: Array<number | null> = lines.map(() => null);
  for (const a of r.anchors) out[a.line] = a.start;
  return { starts: out, result: r };
};

describe("tokens", () => {
  it("Latin words: accents, case, punctuation and apostrophes go", () => {
    expect(tokenize("Don't stop — Believin', ÉTÉ!").map((t) => t.s)).toEqual(["dont", "stop", "believin", "ete"]);
    expect(tokenize("Straße, l'abandon").map((t) => t.s)).toEqual(["strasse", "labandon"]);
  });

  it("Han, kana and hangul: one token per character; full-width Latin folds", () => {
    expect(tokenize("我們的歌 ＯＫ").map((t) => [t.s, t.kind])).toEqual([
      ["我", "han"],
      ["們", "han"],
      ["的", "han"],
      ["歌", "han"],
      ["ok", "word"],
    ]);
    // with the tables, Traditional characters compare as Simplified
    expect(tokenize("我們的歌", HAN).map((t) => t.s).join("")).toBe("我们的歌");
    expect(tokenize("カタカナ").map((t) => t.s).join("")).toBe("かたかな");
    expect(tokenize("사랑해").map((t) => t.kind)).toEqual(["hangul", "hangul", "hangul"]);
  });

  it("similarity: exact, edit distance, variants, homophones", () => {
    const w = (s: string) => tokenize(s, HAN)[0];
    expect(similarity(w("heart"), w("heart"), HAN)).toBe(1);
    expect(similarity(w("heart"), w("hearts"), HAN)).toBeCloseTo(5 / 6);
    expect(similarity(w("們"), w("们"), HAN)).toBe(1);
    // 在 / 再 (zài): a homophone; 是 / 四 (shì / sì): a near reading
    expect(similarity(w("在"), w("再"), HAN)).toBe(0.7);
    expect(similarity(w("是"), w("四"), HAN)).toBe(0.5);
    expect(similarity(w("愛"), w("海"), HAN)).toBe(0);
    expect(similarity(w("愛"), w("love"), HAN)).toBe(0);
  });

  it("hasHan / loadHanTables", async () => {
    expect(hasHan(["hello", "世界"])).toBe(true);
    expect(hasHan(["hello"])).toBe(false);
    const t = await loadHanTables();
    expect(t.canon.get("們")).toBe("们");
    expect(t.readings.get("長")).toEqual(expect.arrayContaining(["chang", "zhang"]));
  });
});

describe("hallucination guards", () => {
  it("a long run of one token keeps its first repeats", () => {
    const toks = tokenize("oh oh oh oh oh oh oh oh oh oh you can't");
    const drop = loopTokens(toks);
    expect(drop.size).toBe(6);
    expect([...drop].every((k) => k >= 4 && k < 10)).toBe(true);
  });

  it("a repeated phrase loop keeps its first three repeats", () => {
    const toks = tokenize(Array.from({ length: 10 }, () => "de la ville").join(" "));
    expect(loopTokens(toks).size).toBe(30 - 9);
  });

  it("an 'oh oh oh' loop does not move the lines around it", () => {
    const lines = ["Let it whisper in every bit", "Oh oh oh", "You can't forever, you can't forever"];
    const loop: AsrWord[] = Array.from({ length: 120 }, (_, k) => ({ text: " oh,", start: 20 + Math.floor(k / 10) * 0.5, end: 20.2 + Math.floor(k / 10) * 0.5 }));
    const words = [...say("Let it whisper in every bit", 10), ...loop, ...say("You can't forever you can't forever", 30)];
    const { starts } = startsOf(lines, words);
    expect(starts[0]).toBeCloseTo(10, 1);
    expect(starts[2]).toBeCloseTo(30, 1);
    // the 'oh' line lands inside the loop or is left to the aligner, never after the last line
    if (starts[1] != null) expect(starts[1]).toBeLessThan(30);
  });

  it("text where the 人聲 curve is silent is dropped", () => {
    const rate = 20;
    const curve = new Array(60 * rate).fill(0);
    for (let i = 20 * rate; i < 40 * rate; i++) curve[i] = 0.9;
    const lines = ["the end of the night", "we carried into the end"];
    // a hallucinated "the end" in the instrumental intro (5 s), the real lines from 20 s
    const words = [...say("the end", 5), ...say("the end of the night", 20), ...say("we carried into the end", 25)];
    const plain = startsOf(lines, words);
    const guarded = startsOf(lines, words, { vocal: { curve, rate } });
    expect(guarded.result.silent).toBe(2);
    expect(guarded.starts[0]).toBeCloseTo(20, 1);
    expect(guarded.starts[1]).toBeCloseTo(25, 1);
    expect(plain.result.silent).toBe(0);
  });
});

describe("alignTranscript", () => {
  const verse = ["Hey on your heart", "you're involved in the fight", "Feeling far above the sky", "My heart is feeling dark"];

  it("English: every clearly sung line gets its start", () => {
    const words = verse.flatMap((l, i) => say(l, 10 + i * 4));
    const { starts, result } = startsOf(verse, words);
    starts.forEach((s, i) => expect(s).toBeCloseTo(10 + i * 4, 2));
    expect(result.anchors.every((a) => a.confidence === 1)).toBe(true);
    expect(result.scorable).toBe(4);
  });

  it("garbled words: near misses still anchor, a line heard as something else is left to the aligner", () => {
    const words = [...say("Hey on your heart", 10), ...say("you're evolved in a fright", 14), ...say("Fee lean car a bob the ski", 18), ...say("all the noise in my head", 22), ...say("My heart is feeling dark", 26)];
    const lines = [...verse.slice(0, 3), "Tonight we burn it down", verse[3]];
    const { starts } = startsOf(lines, words);
    expect(starts[0]).toBeCloseTo(10, 2);
    expect(starts[1]).toBeCloseTo(14, 2); // "you're … in … fight" match well enough
    expect(Math.abs((starts[2] ?? 99) - 18)).toBeLessThan(0.5); // "far"~"car", "the", "sky"~"ski": 3 of 5, backed off from "car"
    expect(starts[3]).toBeNull(); // heard as something else entirely
    expect(starts[4]).toBeCloseTo(26, 2);
  });

  it("the first word unheard: the line anchors on its second word, a little earlier", () => {
    const words = [...say("Hey on your heart", 10), ...say("mm involved in the fight", 14)];
    const { starts } = startsOf(verse.slice(0, 2), words);
    expect(starts[1]).toBeLessThan(14.4);
    expect(starts[1]).toBeGreaterThan(13.9);
  });

  it("a repeated chorus maps each repeat in order", () => {
    const chorus = ["You can't forever", "Don't close your eyes"];
    const lines = [...chorus, "In the other side of this", ...chorus];
    const words = [...say("You can't forever", 30), ...say("Don't close your eyes", 34), ...say("In the other side of this", 60), ...say("You can't forever", 90), ...say("Don't close your eyes", 94)];
    const { starts } = startsOf(lines, words);
    expect(starts).toEqual([30, 34, 60, 90, 94].map((t) => expect.closeTo(t, 2)));
  });

  it("a missing line (not sung, or not heard) gets no anchor; its neighbours do", () => {
    const words = [...say(verse[0], 10), ...say(verse[2], 18), ...say(verse[3], 22)];
    const { starts } = startsOf(verse, words);
    expect(starts[0]).toBeCloseTo(10, 2);
    expect(starts[1]).toBeNull();
    expect(starts[2]).toBeCloseTo(18, 2);
    expect(starts[3]).toBeCloseTo(22, 2);
  });

  it("out-of-order guesses are dropped (the anchors increase, ≥ 0.3 s apart)", () => {
    // the recogniser repeated line 1 late (a chunk-overlap duplicate)
    const words = [...say(verse[0], 10), ...say(verse[2], 18), ...say(verse[3], 22), ...say(verse[1], 40)];
    const { starts } = startsOf(verse, words);
    const known = starts.filter((s): s is number => s != null);
    for (let k = 1; k < known.length; k++) expect(known[k]).toBeGreaterThanOrEqual(known[k - 1] + 0.3);
  });

  it("real (tapped) lines are never anchors, and AI anchors that contradict them are dropped", () => {
    const words = verse.flatMap((l, i) => say(l, 10 + i * 4));
    // the operator tapped line 2 at 15 s: line 1's AI time (14 s) still fits, line 3's (22 s) too
    const ok = startsOf(verse, words, { fixed: [null, null, 15, null] });
    expect(ok.starts).toEqual([expect.closeTo(10, 2), expect.closeTo(14, 2), null, expect.closeTo(22, 2)]);
    // tapped at 25 s: line 3's AI time (22 s) would come before it → dropped
    const clash = startsOf(verse, words, { fixed: [null, null, 25, null] });
    expect(clash.starts[3]).toBeNull();
    expect(clash.result.rejected).toBeGreaterThan(0);
  });

  it("Simplified output for Traditional lyrics, and a homophone", () => {
    const lines = ["我們的歌會找到方向", "在每個夜裡唱著", "風吹過了城市"];
    // Whisper wrote Simplified, and 再 for 在, 着 for 著
    const words = [...say("我们的歌会找到方向", 10, 0.3), ...say("再每个夜里唱着", 16, 0.3), ...say("风吹过了城市", 22, 0.3)];
    const withTables = startsOf(lines, words, { han: HAN });
    expect(withTables.starts).toEqual([expect.closeTo(10, 2), expect.closeTo(16, 2), expect.closeTo(22, 2)]);
    expect(withTables.result.anchors[1].confidence).toBe(1);
    // without the tables most characters differ: fewer lines anchor
    const without = startsOf(lines, words);
    expect(without.result.anchors.length).toBeLessThan(3);
  });

  it("a mixed Chinese line with English words", () => {
    const lines = ["我愛你 baby", "不要走 tonight"];
    const words = [...say("我爱你", 5, 0.3), { text: " baby", start: 6, end: 6.5 }, ...say("不要走", 9, 0.3), { text: " tonight", start: 10, end: 10.6 }];
    const { starts } = startsOf(lines, words, { han: HAN });
    expect(starts).toEqual([expect.closeTo(5, 2), expect.closeTo(9, 2)]);
  });

  it("Japanese kana and kanji (katakana written as hiragana still matches)", () => {
    const lines = ["君の名前を呼んでいる", "ココロが叫んでる"];
    const words = [...say("君の名前を呼んでいる", 12, 0.25), ...say("こころが叫んでる", 18, 0.25)];
    const { starts } = startsOf(lines, words, { han: HAN });
    expect(starts).toEqual([expect.closeTo(12, 2), expect.closeTo(18, 2)]);
  });

  it("the default calibration: a line starts 0.15 s before Whisper's word, and ends after its last word", () => {
    expect(DEFAULT_ASR_ALIGN.offset).toBe(-0.15);
    const r = alignTranscript({ lines: [verse[0], verse[1]], words: [...say(verse[0], 10), ...say(verse[1], 20)] });
    expect(r.anchors[0].start).toBeCloseTo(9.85, 3);
    expect(r.anchors[1].start).toBeCloseTo(19.85, 3);
    // "Hey on your heart": the last word starts at 11.2 and lasts 0.32 s; + endPad 0.3
    expect(r.anchors[0].end).toBeCloseTo(11.82, 3);
  });

  it("nothing recognised, or nothing to match: no anchors", () => {
    expect(alignTranscript({ lines: verse, words: [] }).anchors).toEqual([]);
    expect(alignTranscript({ lines: ["...", "♪"], words: say("hello there", 3) }).scorable).toBe(0);
  });
});

describe("applyAnchors", () => {
  const analysis = (duration: number): AudioAnalysis => {
    const rate = 20;
    const n = duration * rate;
    const vocal = Array.from({ length: n }, (_, i) => (Math.floor(i / rate) % 4 < 3 ? 0.9 : 0));
    return {
      duration,
      sampleRate: 22050,
      bpm: 120,
      beats: [],
      downbeats: [],
      sections: [],
      energy: new Array(n).fill(0.5),
      onset: new Array(n).fill(0.1),
      brightness: new Array(n).fill(0.5),
      bass: new Array(n).fill(0.3),
      envelopeRate: rate,
      peaks: [],
      vocal,
    } as unknown as AudioAnalysis;
  };

  it("anchors stay estimated, real lines never move, the rest are laid out between them", () => {
    const lines: LyricLine[] = [
      { id: "a", text: "one two three", start: null, end: null },
      { id: "b", text: "four five six", start: 9, end: null },
      { id: "c", text: "seven eight", start: 20, end: null, estimated: true },
      { id: "d", text: "nine ten", start: null, end: null },
      { id: "e", text: "eleven twelve", start: 40, end: null },
    ];
    const { lines: out, matched } = applyAnchors(lines, [{ line: 2, start: 24, end: null, confidence: 1 }], analysis(60), 60);
    expect(matched).toEqual([false, false, true, false, false]);
    expect(out[1]).toMatchObject({ start: 9 });
    expect(out[1].estimated).toBeUndefined();
    expect(out[4]).toMatchObject({ start: 40 });
    expect(out[2]).toMatchObject({ start: 24, estimated: true });
    expect(out[0].estimated).toBe(true);
    expect(out[0].start).toBeLessThan(9);
    expect(out[3].estimated).toBe(true);
    expect(out[3].start).toBeGreaterThan(24);
    expect(out[3].start).toBeLessThan(40);
    const lyrics = normalizeLyrics({ source: "user", synced: false, lines: out });
    expect(lyrics.timing).toBe("estimated");
    expect(lyrics.synced).toBe(false);
  });

  it("an anchor's sung end is kept only before a real gap", () => {
    const lines: LyricLine[] = [
      { id: "a", text: "one two three", start: null, end: null },
      { id: "b", text: "four five six", start: null, end: null },
      { id: "c", text: "seven eight", start: null, end: null },
    ];
    const anchors = [
      { line: 0, start: 2, end: 4.5, confidence: 1 },
      { line: 1, start: 5, end: 7, confidence: 1 },
      { line: 2, start: 20, end: 22, confidence: 1 },
    ];
    const { lines: out } = applyAnchors(lines, anchors, analysis(40), 40);
    expect(out[0].end).toBeNull(); // the next line starts 0.5 s later
    expect(out[1].end).toBe(7); // 13 s of instrumental follow
  });
});

describe("asrLanguage", () => {
  it("picks the recogniser's language from the lyrics", () => {
    expect(asrLanguage(["我們的歌會找到方向", "在每個夜裡唱著"])).toBe("zh");
    expect(asrLanguage(["我们的歌会找到方向"])).toBe("zh");
    expect(asrLanguage(["君の名前を呼んでいる"])).toBe("ja");
    expect(asrLanguage(["사랑해 너를"])).toBe("ko");
    expect(asrLanguage(["I want you to know that I love you", "and all the things you do"])).toBe("en");
    expect(asrLanguage(["Te quiero más que a mi vida", "y no me dejes, mi amor, que yo no sé"])).toBe("es");
    expect(asrLanguage(["Je ne sais pas où tu es", "mais dans mon cœur tu es là, pour moi"])).toBe("fr");
    expect(asrLanguage(["Ich kann dich nicht vergessen", "und du bist so weit weg von mir"])).toBe("de");
    expect(asrLanguage(["la la la", "na na"])).toBeNull();
    expect(asrLanguage([])).toBeNull();
  });

  it("detectLanguage keeps its labels", () => {
    expect(detectLanguage(["我們的歌會找到方向"])).toBe("zh-Hant");
    expect(detectLanguage(["We will rock you"])).toBe("en");
  });
});
