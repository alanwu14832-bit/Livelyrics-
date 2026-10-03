// The round-9 audit's seven songs: the demo plus six variants on the same 73 s analysis with different
// meta, lyrics and public facts (a Mandarin ballad by a solo singer, a punk chant, city pop with Spanish
// lines, English indie folk, a post-rock instrumental, 27-character lines with a 4× chorus). The
// designer's words must differ between them (concept, title, motifs, cues); the lexicon must read
// them right (牆 is a wall, one 「安靜」 is not an emotion, a sung phrase is never cut mid-word).

import type { Lyrics, LyricLine, PublicInfo } from "@/lib/types";
import type { DesignerInput } from "../types";
import { demoAnalysis, demoInput, demoLyrics, demoMeta } from "./fixtures";

export interface AuditSong {
  key: string;
  title: string;
  artist: string;
  /** MusicBrainz genres the stub answers for the artist */
  tags: string[];
  /** MusicBrainz artist type */
  type?: "Group" | "Person";
  country?: string;
  area?: string;
  lines: Array<[number, string]> | null;
}

export const AUDIT_SONGS: readonly AuditSong[] = [
  { key: "demo", title: "示範之歌", artist: "Livelyrics Band", tags: ["indie rock", "taiwanese indie"], lines: null },
  {
    key: "ballad",
    title: "夜雨未眠",
    artist: "林晚晴",
    tags: ["mandopop", "ballad", "pop"],
    type: "Person",
    lines: [
      [6, "窗外的雨還在下 像沒說完的話"],
      [13, "你留下的傘 在門邊慢慢風乾"],
      [20, "我學會一個人 把燈調暗"],
      [27, "夜太長 想念卻太短"],
      [34, "如果思念是一場雨 我願淋成一片海"],
      [41, "把你的名字 一字一字放回心裡來"],
      [48, "夜雨未眠 我也未眠"],
      [55, "等天亮 等一句再見"],
      [62, "等一句 再見"],
    ],
  },
  {
    key: "punk",
    title: "拆掉這面牆",
    artist: "廢墟少年",
    tags: ["punk", "post-hardcore", "hardcore"],
    lines: [
      [4, "他們說安靜 他們說聽話"],
      [6, "把你的夢塞進抽屜鎖上"],
      [8, "我不要 我不要"],
      [10, "拆掉這面牆"],
      [12, "拆掉這面牆"],
      [14, "拆掉這面牆 讓光進來"],
      [20, "撕掉那張表 燒掉那本帳"],
      [22, "誰規定我們只能這樣"],
      [24, "我不要 我不要"],
      [26, "拆掉這面牆"],
      [28, "拆掉這面牆"],
      [30, "拆掉這面牆 讓光進來"],
      [40, "Hey Hey Hey"],
      [42, "Hey Hey Hey"],
      [46, "拆掉這面牆"],
      [48, "拆掉這面牆"],
      [50, "拆掉這面牆 讓光進來"],
      [56, "拆掉這面牆"],
      [58, "拆掉這面牆"],
      [60, "拆掉這面牆 讓光進來"],
      [66, "讓光進來"],
    ],
  },
  {
    key: "citypop",
    title: "Midnight Avenida",
    artist: "霓虹公路",
    tags: ["city pop", "synthpop", "japanese city pop"],
    lines: [
      [6, "午夜的高架橋 收音機放著舊歌"],
      [12, "Luces de la ciudad, bailando en tu mirada"],
      [18, "你靠著車窗 數著經過的霓虹"],
      [24, "Midnight avenida, llévame contigo"],
      [30, "Midnight avenida 把我帶走"],
      [36, "在這條沒有盡頭的大道上 慢慢跳舞"],
      [42, "Luces de la ciudad"],
      [48, "Midnight avenida, llévame contigo"],
      [54, "Midnight avenida 把我帶走"],
      [60, "在這條沒有盡頭的大道上 慢慢跳舞"],
      [66, "Hasta el amanecer"],
    ],
  },
  {
    key: "folk",
    title: "River Stones",
    artist: "The Hollow Pines",
    tags: ["indie folk", "folk", "singer-songwriter"],
    country: "US",
    area: "Portland",
    lines: [
      [6, "I carried river stones in both my coat pockets"],
      [12, "So the wind wouldn't take me when you left"],
      [18, "The porch light hums a song it half remembers"],
      [24, "And the maple drops its hands onto the step"],
      [30, "Oh, lay me down where the water's slow"],
      [36, "Where the stones forget the weight they used to know"],
      [42, "Lay me down, lay me down"],
      [50, "The kettle sings, the kitchen holds its breath"],
      [56, "Oh, lay me down where the water's slow"],
      [62, "Where the stones forget the weight they used to know"],
      [67, "Lay me down"],
    ],
  },
  { key: "instrumental", title: "無人海岸", artist: "遠山樂隊", tags: ["post-rock", "instrumental rock"], lines: [] },
  {
    key: "longlines",
    title: "午夜高速公路上那盞不會熄滅的燈",
    artist: "日落車隊",
    tags: ["indie rock", "alternative rock"],
    lines: [
      [6, "我們曾經在午夜的高速公路上追逐一盞永遠不會熄滅的燈，以為那就是遠方"],
      [13, "後來才知道所有的遠方其實都只是另一個人的家門口，亮著等誰回來"],
      [20, "如果你還記得那一年夏天我們在加油站買的兩罐冰汽水，那就不要忘記我"],
      [26, "就算整個世界都睡著了，我們還醒著，在這條路上一直開一直開"],
      [32, "就算整個世界都睡著了，我們還醒著，在這條路上一直開一直開"],
      [38, "就算整個世界都睡著了，我們還醒著，在這條路上一直開一直開"],
      [44, "就算整個世界都睡著了，我們還醒著，在這條路上一直開一直開"],
      [50, "收音機裡那首歌唱到一半就斷了訊號，像我們沒有說完的所有的話"],
      [57, "就算整個世界都睡著了，我們還醒著"],
      [63, "一直開一直開"],
    ],
  },
];

function artistId(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return `${h.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** The public facts the audit stub answered: a MusicBrainz artist with the song's tags, no Wikipedia. */
export function auditPublicInfo(song: AuditSong): PublicInfo {
  const tags = song.tags.map((name) => ({ name, count: 3 }));
  return {
    version: 1,
    query: { title: song.title, artist: song.artist },
    fetchedAt: "2026-09-29T08:00:00.000Z",
    status: { musicbrainz: "ok", wikipedia: "none" },
    notes: [],
    musicbrainz: {
      recording: { id: `rec-${artistId(song.artist)}`, title: song.title, tags, year: 2023, firstReleaseDate: "2023" },
      artist: { id: artistId(song.artist), name: song.artist, type: song.type ?? "Group", country: song.country ?? "TW", area: song.area ?? "Taipei", genres: tags, tags, links: [] },
    },
    wikipedia: null,
  };
}

export function auditLyrics(song: AuditSong): Lyrics {
  if (song.lines == null) return demoLyrics();
  const lines: LyricLine[] = song.lines.map(([start, text], i) => ({ id: `l${i}`, text, start, end: null }));
  return lines.length ? { source: "user", synced: true, lines } : { source: "none", synced: false, lines: [] };
}

/** The designer input of one audit song (the demo's 73 s analysis, its own meta, lyrics and public facts). */
export function auditInput(song: AuditSong): DesignerInput {
  return { ...demoInput(), meta: demoMeta({ title: song.title, artist: song.artist }), lyrics: auditLyrics(song), analysis: demoAnalysis(), publicInfo: auditPublicInfo(song) };
}

export const auditSong = (key: string): AuditSong => AUDIT_SONGS.find((s) => s.key === key)!;
