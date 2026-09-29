import { describe, expect, it } from "vitest";
import { breakLyricText } from "./linebreak";
import { NO_LINE_START, textWidth, tokenizeLyric } from "./tokenize";

describe("tokenizeLyric", () => {
  it("splits CJK per character and keeps Latin words whole", () => {
    const units = tokenizeLyric("Hey 跟著我唱, don't stop");
    expect(units.map((u) => [u.text, u.kind])).toEqual([
      ["Hey", "latin"],
      [" ", "space"],
      ["跟", "cjk"],
      ["著", "cjk"],
      ["我", "cjk"],
      ["唱", "cjk"],
      [",", "punct"],
      [" ", "space"],
      ["don't", "latin"],
      [" ", "space"],
      ["stop", "latin"],
    ]);
  });

  it("keeps UTF-16 offsets for astral characters", () => {
    const text = "𠮷野家";
    const units = tokenizeLyric(text);
    expect(units).toHaveLength(3);
    expect(text.slice(units[0].from, units[0].to)).toBe("𠮷");
    expect(units[1].from).toBe(2);
  });

  it("treats Tâi-lô romanization as words", () => {
    const units = tokenizeLyric("tsa-bóo gín-á");
    expect(units.filter((u) => u.kind === "latin").map((u) => u.text)).toEqual(["tsa-bóo", "gín-á"]);
  });
});

describe("breakLyricText", () => {
  it("keeps short lines on one row", () => {
    expect(breakLyricText("夜色慢慢落在城市的邊緣")).toEqual(["夜色慢慢落在城市的邊緣"]);
  });

  it("breaks long CJK lines into at most two balanced rows", () => {
    const rows = breakLyricText("我們把名字寫進風裡面每一盞燈都像一個誓言等待有人把它點燃");
    expect(rows.length).toBe(2);
    for (const r of rows) expect(textWidth(tokenizeLyric(r))).toBeLessThanOrEqual(16);
  });

  it("prefers breaking at spaces and punctuation", () => {
    const rows = breakLyricText("就算世界再大再遠，我們的歌會找到方向");
    expect(rows).toEqual(["就算世界再大再遠", "我們的歌會找到方向"]);
    const spaced = breakLyricText("安靜一下 聽見了嗎 這是我們唯一的晚上", { maxChars: 12 });
    expect(spaced[0].endsWith(" ")).toBe(false);
    expect(spaced.length).toBe(2);
    expect(spaced.join(" ")).toBe("安靜一下 聽見了嗎 這是我們唯一的晚上");
  });

  it("never starts a row with closing punctuation", () => {
    const text = "一二三四五六七八九十一二三四五六」七八九十一二三四五";
    const rows = breakLyricText(text, { maxChars: 16 });
    for (const r of rows) expect(NO_LINE_START.has([...r][0])).toBe(false);
    const commas = breakLyricText("一二三四五六七八，九十一二三四五六七八！");
    for (const r of commas) expect(NO_LINE_START.has([...r][0])).toBe(false);
  });

  it("drops soft punctuation at the end of rows but keeps ! ?", () => {
    expect(breakLyricText("直到天亮。")).toEqual(["直到天亮"]);
    expect(breakLyricText("聽見了嗎？")).toEqual(["聽見了嗎？"]);
    const rows = breakLyricText("一二三四五六七八九，十一二三四五六七八九");
    expect(rows[0].endsWith("，")).toBe(false);
  });

  it("never breaks inside Latin words", () => {
    const rows = breakLyricText("we are the champions of the night and the endless summer sky", { maxChars: 16 });
    const words = "we are the champions of the night and the endless summer sky".split(" ");
    for (const r of rows) for (const w of r.split(" ")) expect(words).toContain(w);
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("caps at maxLines even for very long text", () => {
    const rows = breakLyricText("一".repeat(60));
    expect(rows.length).toBe(2);
    expect(rows.join("")).toBe("一".repeat(60));
  });

  it("returns no rows for blank input", () => {
    expect(breakLyricText("   ")).toEqual([]);
  });

  it("keeps opening quotes with the following text", () => {
    const rows = breakLyricText("一二三四五六七八九十一二三四「五六七八九十一二三」", { maxChars: 15 });
    for (const r of rows) expect(r.endsWith("「")).toBe(false);
  });
});
