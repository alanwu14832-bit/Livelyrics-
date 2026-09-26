import { describe, expect, it } from "vitest";
import { parseFileName, readAudioMetadata, repairMojibake, stripNoise } from "./metadata";
import { buildWav } from "./testing/signals";

describe("parseFileName", () => {
  it.each([
    ["五月天 - 倔強.mp3", "五月天", "倔強"],
    ["01 - Mayday - Stubborn.flac", "Mayday", "Stubborn"],
    ["Artist_-_Title.mp3", "Artist", "Title"],
    ["IU _ Blueming.mp3", "IU", "Blueming"],
    ["Some_Song_Name.wav", "", "Some Song Name"],
    ["Taylor Swift - Anti-Hero (Official Music Video).mp3", "Taylor Swift", "Anti-Hero"],
    ["[MV] 告五人 Accusefive - 愛人錯過.m4a", "告五人 Accusefive", "愛人錯過"],
    ["五月天 Mayday【倔強 Stubborn】Official Music Video.mp3", "五月天 Mayday", "倔強 Stubborn"],
    ["周杰倫 Jay Chou【告白氣球 Love Confession】-Official Music Video.mp3", "周杰倫 Jay Chou", "告白氣球 Love Confession"],
    ["告五人 Accusefive《愛人錯過》Official Music Video.webm", "告五人 Accusefive", "愛人錯過"],
    ["《倔強》五月天.mp3", "五月天", "倔強"],
    ["滅火器 Fire EX. - 島嶼天光 Island's Sunrise (Official Music Video).mp3", "滅火器 Fire EX.", "島嶼天光 Island's Sunrise"],
    ["五月天-倔強.mp3", "五月天", "倔強"],
    ["Beyond-海闊天空.mp3", "Beyond", "海闊天空"],
    ["Band－Song（官方MV）.mp3", "Band", "Song"],
    ["五月天—倔強.mp3", "五月天", "倔強"],
    ["1-05 Artist - Title.m4a", "Artist", "Title"],
    ["03. Title Only.mp3", "", "Title Only"],
    ["Artist - Album - 03 - Title.mp3", "Artist", "Title"],
    ["Artist - Title - Live.mp3", "Artist", "Title - Live"],
    ["Artist | Title.mp3", "Artist", "Title"],
    ["C:\\Music\\Band - Song.mp3", "Band", "Song"],
    ["/home/me/Band - Song.ogg", "Band", "Song"],
  ])("%s → %s / %s", (name, artist, title) => {
    expect(parseFileName(name)).toEqual({ artist, title });
  });

  it.each([
    ["Anne-Marie - 2002.mp3", "Anne-Marie", "2002"],
    ["Anti-Hero.mp3", "", "Anti-Hero"],
    ["99 Luftballons.mp3", "", "99 Luftballons"],
    ["Song (Live).mp3", "", "Song (Live)"],
    ["Song (Instrumental).mp3", "", "Song (Instrumental)"],
    ["Title (feat. Someone) [Official Audio].mp3", "", "Title (feat. Someone)"],
    ["My Song (2019 Remaster).mp3", "", "My Song"],
    ["Unofficial Anthem.mp3", "", "Unofficial Anthem"],
    ["...Ready For It.mp3", "", "...Ready For It"],
    ["Vol.2.mp3", "", "Vol.2"],
    ["song.mp3", "", "song"],
  ])("keeps meaningful parts: %s", (name, artist, title) => {
    expect(parseFileName(name)).toEqual({ artist, title });
  });

  it("never returns an empty title for a non-empty name", () => {
    expect(parseFileName("MV.mp3").title).toBe("MV");
    expect(parseFileName("(Official Video).mp3").title.length).toBeGreaterThan(0);
    expect(parseFileName("")).toEqual({ artist: "", title: "" });
  });

  it("can parse strings that carry no extension", () => {
    expect(parseFileName("Band - Song.v2", { hasExtension: false })).toEqual({ artist: "Band", title: "Song.v2" });
  });
});

describe("stripNoise", () => {
  it("removes upload noise but keeps versions", () => {
    expect(stripNoise("倔強【官方完整版】")).toBe("倔強");
    expect(stripNoise("Song [HD] (Lyric Video)")).toBe("Song");
    expect(stripNoise("Song (Acoustic Version)")).toBe("Song (Acoustic Version)");
    expect(stripNoise("Song - Official MV")).toBe("Song");
  });
});

describe("repairMojibake", () => {
  it("re-decodes Big5 bytes stored as Latin-1", () => {
    const latin1 = (bytes: number[]) => String.fromCharCode(...bytes);
    expect(repairMojibake(latin1([0xa7, 0xda, 0xb7, 0x52, 0xa7, 0x41]))).toBe("我愛你");
    expect(repairMojibake("¤­¤ë¤Ñ Mayday")).toBe("五月天 Mayday");
  });

  it("leaves real text alone", () => {
    for (const s of ["Sigur Rós", "Motörhead", "Björk Guðmundsdóttir", "Beyoncé", "五月天", "Mayday", ""]) expect(repairMojibake(s)).toBe(s);
  });
});

describe("readAudioMetadata", () => {
  const tone = new Float32Array(22050).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 22050));

  it("reads RIFF INFO tags (title, artist, album, year, duration, sample rate)", async () => {
    const bytes = buildWav([tone], 22050, { INAM: "倔強", IART: "五月天", IPRD: "神的孩子都在跳舞", ICRD: "2004-11-05" });
    const file = new File([bytes], "whatever.wav", { type: "audio/wav" });
    const meta = await readAudioMetadata(file);
    expect(meta.title).toBe("倔強");
    expect(meta.artist).toBe("五月天");
    expect(meta.album).toBe("神的孩子都在跳舞");
    expect(meta.year).toBe(2004);
    expect(meta.duration).toBeCloseTo(1, 2);
    expect(meta.sampleRate).toBe(22050);
  });

  it("repairs Big5 mojibake in legacy tags", async () => {
    const big5 = new Uint8Array([0xa7, 0xda, 0xb7, 0x52, 0xa7, 0x41]); // 我愛你
    const file = new File([buildWav([tone], 22050, { INAM: big5, IART: "Band" })], "x.wav");
    const meta = await readAudioMetadata(file);
    expect(meta.title).toBe("我愛你");
  });

  it("falls back to the file name for missing or placeholder tags", async () => {
    const file = new File([buildWav([tone], 22050, { INAM: "Track 1", IART: "Unknown Artist" })], "01 - 告五人 - 披星戴月的想你.wav");
    const meta = await readAudioMetadata(file);
    expect(meta.title).toBe("披星戴月的想你");
    expect(meta.artist).toBe("告五人");
  });

  it("splits an 'Artist - Title' title tag when no artist is known", async () => {
    const file = new File([buildWav([tone], 22050, { INAM: "告五人 - 愛人錯過 (Official MV)" })], "audio.wav");
    expect(await readAudioMetadata(file)).toMatchObject({ artist: "告五人", title: "愛人錯過" });
  });

  it("never throws on garbage and uses the file name", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "樂團 - 歌名.mp3");
    expect(await readAudioMetadata(file)).toEqual({ artist: "樂團", title: "歌名" });
  });
});

describe("repairMojibake: UTF-8 read as Latin-1", () => {
  const asLatin1 = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));
  it.each(["倔強", "告五人 - 愛人錯過", "Beyoncé", "ヨルシカ"])("%s", (text) => {
    expect(repairMojibake(asLatin1(text))).toBe(text);
  });
});
