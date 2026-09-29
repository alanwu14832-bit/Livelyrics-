// 免費研究's local analysis: the lyric tokenizer, imagery, emotion, point of view and sing-along
// phrases (Traditional and Simplified Chinese, English), the audio mood, and the genre rules.

import { describe, expect, it } from "vitest";
import type { AudioAnalysis, Lyrics } from "@/lib/types";
import { analyzeAudioMood } from "./audio-mood";
import { matchGenres, tagKey } from "./genre";
import { GENRE_RULES } from "./lexicon/genres";
import { IMAGERY_FAMILIES } from "./lexicon/imagery";
import { SENTIMENT } from "./lexicon/sentiment";
import { estimateEmotion, findImageryFamilies, pointOfView, singalongPhrases, tokenize } from "./lyric-analysis";
import { analyzeStructure } from "./structure";
import { demoAnalysis, demoInput, demoMeta } from "./testing/fixtures";
import { publicInfoWith } from "./testing/public-sources";

describe("tokenize", () => {
  it("splits Chinese by the lexicon, with code point offsets that rebuild the line", () => {
    const line = "夜色慢慢落在城市的邊緣";
    const tokens = tokenize(line);
    expect(tokens.map((t) => t.surface)).toEqual(expect.arrayContaining(["夜色", "慢慢", "城市"]));
    for (const t of tokens) expect(Array.from(line).slice(t.start, t.start + t.length).join("")).toBe(t.surface);
    expect(tokens.map((t) => t.surface).join("")).toBe(line);
  });

  it("reads Simplified lyrics through the traditional forms but reports what is written", () => {
    const tokens = tokenize("城市的灯光 我们没有眼泪");
    const byKey = new Map(tokens.map((t) => [t.key, t.surface]));
    expect(byKey.get("燈光")).toBe("灯光");
    expect(byKey.get("我們")).toBe("我们");
    expect(byKey.get("眼淚")).toBe("眼泪");
  });

  it("lowercases English words and keeps apostrophes", () => {
    expect(tokenize("We don't stop, my FRIEND!").map((t) => t.key)).toEqual(["we", "don't", "stop", "my", "friend"]);
  });
});

describe("imagery", () => {
  it("finds the sea in 海／浪／潮, counts the title double, and keeps exact surfaces", () => {
    const hits = findImageryFamilies(["海浪拍打著沉默的礁石", "潮水帶走了我們的名字", "浪花在月光下碎成星星"], "海");
    const sea = hits.find((h) => h.family.id === "sea")!;
    expect(hits[0].family.id).toBe("sea");
    expect(sea.count).toBeGreaterThanOrEqual(5);
    expect(sea.surfaces).toEqual(expect.arrayContaining(["海浪", "浪花"]));
    expect(hits.map((h) => h.family.id)).toEqual(expect.arrayContaining(["moon", "stars"]));
  });

  it("rain and the city, in Simplified too", () => {
    const hits = findImageryFamilies(["雨一直下 冰冷的街", "城市的灯 在雨里模糊"]);
    expect(hits[0].family.id).toBe("rain");
    expect(hits.some((h) => h.family.id === "city")).toBe(true);
  });

  it("does not see imagery in everyday words (上海, 花錢, 電影)", () => {
    const ids = findImageryFamilies(["今天在上海花錢看電影", "大家都很開心"]).map((h) => h.family.id);
    expect(ids).not.toContain("sea");
    expect(ids).not.toContain("flower");
  });

  it("every family has colours, scenes and words (the lexicon is well formed)", () => {
    expect(IMAGERY_FAMILIES.length).toBeGreaterThanOrEqual(40);
    for (const f of IMAGERY_FAMILIES) {
      expect(f.words.length, f.id).toBeGreaterThan(0);
      expect(f.scenes.length, f.id).toBeGreaterThan(0);
      expect(f.hues.length, f.id).toBeGreaterThan(0);
    }
    expect(SENTIMENT.length).toBeGreaterThan(150);
  });
});

describe("emotion", () => {
  it("sad lyrics are 憂傷低迴 with their words", () => {
    const e = estimateEmotion(["我好難過 眼淚停不下來", "心碎了 再也回不去", "孤單的夜 只剩下寂寞"]);
    expect(e.label).toBe("憂傷低迴");
    expect(e.valence).toBeLessThan(-0.3);
    expect(e.negative).toEqual(expect.arrayContaining(["難過", "心碎"]));
  });

  it("a shouted, happy chorus is 明亮激昂 (chants and ! raise the arousal)", () => {
    const e = estimateEmotion(["我們一起大聲唱", "快樂的笑 燦爛的光", "Hey! 跳起來!"]);
    expect(e.label).toBe("明亮激昂");
    expect(e.arousal).toBeGreaterThan(0.6);
  });

  it("negation turns a word around", () => {
    expect(estimateEmotion(["我很快樂"]).valence).toBeGreaterThan(0);
    expect(estimateEmotion(["我不快樂"]).valence).toBeLessThan(0);
  });

  it("calm and warm words are 溫柔明亮; no sentiment words at all is 情緒不明顯", () => {
    expect(estimateEmotion(["安靜的午後", "慢慢地走", "溫柔的風"]).label).toBe("溫柔明亮");
    expect(estimateEmotion(["一二三四", "五六七八"]).label).toBe("情緒不明顯");
  });

  it("weighs the hook in", () => {
    const verse = ["我走在路上", "看著天空"];
    const withHook = estimateEmotion(verse, ["燃燒吧 大聲唱！"]);
    expect(withHook.hook).not.toBeNull();
    expect(withHook.arousal).toBeGreaterThan(estimateEmotion(verse).arousal);
  });
});

describe("point of view", () => {
  it("我們 is collective, 我 and 你 a confession, 我 alone a monologue", () => {
    expect(pointOfView(["我們一起唱", "我們的夢", "我們不會放棄"]).voice).toBe("we");
    expect(pointOfView(["我想你", "你在哪裡", "我等你", "你是否也想我"]).voice).toBe("i-you");
    expect(pointOfView(["我走在路上", "我看著天空", "我不知道"]).voice).toBe("i");
    expect(pointOfView(["We are young", "we run", "our song"]).voice).toBe("we");
    expect(pointOfView(["風", "雨"]).voice).toBe("none");
  });
});

describe("sing-along phrases", () => {
  const lines = [
    { id: "l0", text: "我們在夜裡奔跑", start: 10 },
    { id: "l1", text: "燃燒吧 我們的青春", start: 20 },
    { id: "l2", text: "燃燒吧 我們的青春", start: 40 },
    { id: "l3", text: "Oh oh oh 燃燒吧", start: 44 },
    { id: "l4", text: "Oh oh oh 燃燒吧", start: 60 },
  ];

  it("finds the repeated chant and phrases, shorter than every line they come from", () => {
    const phrases = singalongPhrases(lines, null);
    expect(phrases.map((p) => p.text)).toEqual(expect.arrayContaining(["Oh oh oh", "燃燒吧", "我們的青春"]));
    for (const p of phrases) {
      for (const id of p.lineIds) {
        const line = lines.find((l) => l.id === id)!.text;
        expect(line).toContain(p.text);
        expect(Array.from(p.text).length).toBeLessThan(Array.from(line).length);
      }
    }
    expect(phrases.find((p) => p.text === "燃燒吧")).toMatchObject({ count: 4, start: 20 });
  });

  it("the demo song's chorus: Hey, 跟著我唱, 我們的歌", () => {
    const input = demoInput();
    const st = analyzeStructure(input);
    const phrases = singalongPhrases(
      input.lyrics.lines.map((l) => ({ id: l.id, text: l.text, start: l.start })),
      st,
    );
    expect(phrases.map((p) => p.text)).toEqual(["Hey", "跟著我唱", "我們的歌"]);
  });

  it("no repeats, no phrases", () => {
    expect(singalongPhrases([{ id: "l0", text: "只唱一次的句子" }], null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// audio mood
// ---------------------------------------------------------------------------

function analysis(opts: { bpm: number; sections: Array<[number, number, number]>; brightness: number; bass: number; onset?: number }): AudioAnalysis {
  const base = demoAnalysis();
  const rate = base.envelopeRate;
  const duration = opts.sections[opts.sections.length - 1][1];
  const n = Math.round(duration * rate);
  const energy = Array.from({ length: n }, (_, i) => opts.sections.find(([s, e]) => i / rate >= s && i / rate < e)?.[2] ?? 0.3);
  return {
    ...base,
    duration,
    bpm: opts.bpm,
    energy,
    onset: Array.from({ length: n }, () => opts.onset ?? 0.4),
    brightness: Array.from({ length: n }, () => opts.brightness),
    bass: Array.from({ length: n }, () => opts.bass),
    sections: opts.sections.map(([start, end, e]) => ({ start, end, energy: e })),
  };
}

function mood(a: AudioAnalysis) {
  const input = { meta: demoMeta({ duration: a.duration }), lyrics: { source: "none", synced: false, lines: [] } as Lyrics, analysis: a };
  return analyzeAudioMood(a, analyzeStructure(input));
}

describe("audio mood", () => {
  it("quiet parts that explode: 爆發釋放 (the demo song)", () => {
    const m = mood(demoAnalysis());
    expect(m.quadrant).toBe("release");
    expect(m.label).toBe("爆發釋放");
    expect(m.peakAt).toBe(48);
    expect(m.why).toContain("120 BPM");
  });

  it("fast, dark and heavy: 冷冽推進", () => {
    const m = mood(analysis({ bpm: 150, sections: [[0, 30, 0.7], [30, 60, 0.75], [60, 90, 0.72]], brightness: 0.2, bass: 0.85, onset: 0.7 }));
    expect(m.quadrant).toBe("cold-drive");
    expect(m.label).toBe("冷冽推進");
  });

  it("grooving and bright: 溫暖律動", () => {
    const m = mood(analysis({ bpm: 112, sections: [[0, 30, 0.62], [30, 60, 0.66], [60, 90, 0.64]], brightness: 0.8, bass: 0.3, onset: 0.6 }));
    expect(m.quadrant).toBe("warm-groove");
  });

  it("slow and dark: 陰鬱緩慢; slow and bright: 溫柔漂浮", () => {
    expect(mood(analysis({ bpm: 68, sections: [[0, 40, 0.25], [40, 80, 0.3], [80, 120, 0.22]], brightness: 0.2, bass: 0.6, onset: 0.2 })).quadrant).toBe("dark-slow");
    expect(mood(analysis({ bpm: 72, sections: [[0, 40, 0.28], [40, 80, 0.32], [80, 120, 0.26]], brightness: 0.8, bass: 0.2, onset: 0.2 })).quadrant).toBe("gentle-float");
  });

  it("works without an analysis (unknown tempo, section guesses)", () => {
    const input = { ...demoInput(), analysis: null };
    const m = analyzeAudioMood(null, analyzeStructure(input));
    expect(m.tempo).toBe("unknown");
    expect(m.why).toContain("速度未知");
  });
});

// ---------------------------------------------------------------------------
// genre rules
// ---------------------------------------------------------------------------

describe("genre rules", () => {
  const top = (info: ReturnType<typeof publicInfoWith>) => matchGenres(info)[0]?.rule.id ?? null;

  it("MusicBrainz genres and tags name the rule (case, spaces and hyphens do not matter)", () => {
    expect(top(publicInfoWith({ genres: ["post-rock"] }))).toBe("post-rock");
    expect(top(publicInfoWith({ genres: ["Post Rock"] }))).toBe("post-rock");
    expect(top(publicInfoWith({ tags: ["shoegaze"] }))).toBe("shoegaze");
    expect(top(publicInfoWith({ genres: ["city pop"] }))).toBe("city-pop");
    expect(top(publicInfoWith({ genres: ["hip hop"] }))).toBe("hip-hop");
    expect(top(publicInfoWith({ genres: ["math rock"] }))).toBe("math-rock");
    expect(tagKey("Post‐Rock")).toBe(tagKey("post rock"));
  });

  it("a specific genre beats a general tag; a general tag alone is not enough", () => {
    expect(top(publicInfoWith({ tags: ["rock", "dream pop"] }))).toBe("dream-pop");
    expect(matchGenres(publicInfoWith({ tags: ["rock"] }))).toEqual([]);
  });

  it("Wikipedia's words count too (Chinese and English), with the evidence", () => {
    const zh = matchGenres(publicInfoWith({ wiki: { title: "某樂團", description: "臺灣的獨立搖滾樂團", extract: "某樂團是一個來自臺北的獨立搖滾樂團。" } }));
    expect(zh[0].rule.id).toBe("indie-rock");
    expect(zh[0].evidence[0]).toContain("獨立搖滾");
    const en = matchGenres(publicInfoWith({ wiki: { lang: "en", title: "Band", description: "American post-rock band", extract: "Band is an American post-rock band from Texas." } }));
    expect(en[0].rule.id).toBe("post-rock");
  });

  it("nothing public: no genre", () => {
    expect(matchGenres(null)).toEqual([]);
    expect(matchGenres(publicInfoWith())).toEqual([]);
  });

  it("every rule is explainable and uses real vocabularies", () => {
    expect(GENRE_RULES.length).toBeGreaterThanOrEqual(15);
    for (const r of GENRE_RULES) {
      expect(r.why.length, r.id).toBeGreaterThan(10);
      expect(r.palette.hues.length, r.id).toBeGreaterThan(0);
      expect(r.scenes.length, r.id).toBeGreaterThan(0);
      expect(r.typography.weight, r.id).toBeGreaterThanOrEqual(600);
    }
  });
});
