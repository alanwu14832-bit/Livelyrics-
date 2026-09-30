// Five contrasting song fixtures (phase 7): genre, mood, tempo and language differ, so the offline
// composer and the type engine can be checked for variety (tests, and the visual check through the
// stage lab). Each has a synthetic analysis (sections with energies on its own BPM grid), lyrics with
// times, and the public facts a 免費研究 would have found (MusicBrainz genres).

import { parseLyricsText } from "@/lib/lyrics/lrc";
import type { AudioAnalysis, PublicInfo } from "@/lib/types";
import type { DesignerInput } from "../types";

export interface SongFixture {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  /** [start, end, energy] */
  sections: Array<[number, number, number]>;
  lrc: string;
}

function lrc(rows: Array<[number, string]>): string {
  return rows.map(([t, s]) => `[${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}]${s}`).join("\n");
}

export const SONG_FIXTURES: SongFixture[] = [
  {
    id: "night-bus",
    title: "夜行巴士",
    artist: "霓虹通勤",
    genre: "city pop",
    bpm: 112,
    sections: [
      [0, 9, 0.25],
      [9, 30, 0.45],
      [30, 38, 0.6],
      [38, 56, 0.85],
      [56, 66, 0.4],
      [66, 84, 0.9],
      [84, 92, 0.3],
    ],
    lrc: lrc([
      [9.5, "末班車穿過城市的燈"],
      [14.5, "窗外的霓虹一格一格往後退"],
      [19.5, "你說今晚不想回家"],
      [24.5, "我們就坐到終點站"],
      [30.5, "紅燈亮起的時候"],
      [34, "把心事交給夜風"],
      [38.5, "夜行巴士 開往海的方向"],
      [43, "整座城市都在發光"],
      [47.5, "夜行巴士 不要停下"],
      [52, "我們還年輕"],
      [57, "後照鏡裡的我們"],
      [61, "像一首沒寫完的歌"],
      [66.5, "夜行巴士 開往海的方向"],
      [71, "整座城市都在發光"],
      [75.5, "夜行巴士 不要停下"],
      [80, "我們還年輕"],
    ]),
  },
  {
    id: "tide",
    title: "潮汐之間",
    artist: "海邊的人",
    genre: "folk",
    bpm: 72,
    sections: [
      [0, 12, 0.18],
      [12, 40, 0.32],
      [40, 62, 0.58],
      [62, 76, 0.26],
      [76, 100, 0.66],
      [100, 112, 0.2],
    ],
    lrc: lrc([
      [12.5, "退潮的時候你走得很慢"],
      [19, "沙上留著一排腳印"],
      [26, "月亮低低地掛在海上"],
      [33, "我數著浪回來的次數"],
      [40.5, "潮汐之間 我還在等"],
      [47, "等你把名字寫在水面"],
      [54, "潮汐之間 風很輕"],
      [62.5, "如果海記得"],
      [68, "就讓它替我記得"],
      [76.5, "潮汐之間 我還在等"],
      [83, "等你把名字寫在水面"],
      [90, "潮汐之間 風很輕"],
    ]),
  },
  {
    id: "last-light",
    title: "最後的光",
    artist: "灰階",
    genre: "post-rock",
    bpm: 88,
    sections: [
      [0, 20, 0.15],
      [20, 44, 0.35],
      [44, 60, 0.55],
      [60, 84, 0.95],
      [84, 100, 0.3],
      [100, 120, 0.2],
    ],
    lrc: lrc([
      [22, "沉默是一座很高的牆"],
      [30, "我們站在它的影子裡"],
      [38, "等"],
      [46, "光從縫隙裡滲出來"],
      [53, "像有人在另一邊敲門"],
      [61, "最後的光"],
      [68, "穿過我們"],
      [75, "最後的光"],
      [86, "牆倒下的聲音"],
      [93, "原來這麼安靜"],
    ]),
  },
  {
    id: "static-youth",
    title: "Static Youth",
    artist: "Voltage Kids",
    genre: "punk",
    bpm: 168,
    sections: [
      [0, 6, 0.6],
      [6, 22, 0.7],
      [22, 36, 0.95],
      [36, 44, 0.5],
      [44, 58, 0.98],
      [58, 64, 0.6],
    ],
    lrc: lrc([
      [6.3, "Wires in the walls and noise in my head"],
      [10, "Every screen is screaming what we never said"],
      [14, "Turn it up turn it up"],
      [18, "Burn the signal down"],
      [22.3, "Static youth we are the sound"],
      [26, "Static youth tear it down"],
      [30, "Hey hey hey"],
      [36.3, "One more night on the broken line"],
      [44.3, "Static youth we are the sound"],
      [48, "Static youth tear it down"],
      [52, "Hey hey hey"],
    ]),
  },
  {
    id: "rain-station",
    title: "雨の駅",
    artist: "月曜日",
    genre: "dream pop",
    bpm: 96,
    sections: [
      [0, 10, 0.2],
      [10, 34, 0.4],
      [34, 54, 0.7],
      [54, 66, 0.35],
      [66, 88, 0.75],
      [88, 96, 0.25],
    ],
    lrc: lrc([
      [10.5, "雨の駅で君を待っていた"],
      [16, "傘の中の小さな世界"],
      [22, "線路の向こうに夏が消える"],
      [28, "言えなかった言葉が落ちる"],
      [34.5, "雨よ 雨よ 連れて行って"],
      [40.5, "光る窓の向こうまで"],
      [46.5, "雨よ 雨よ 忘れないで"],
      [54.5, "水たまりに映る空"],
      [66.5, "雨よ 雨よ 連れて行って"],
      [72.5, "光る窓の向こうまで"],
      [78.5, "雨よ 雨よ 忘れないで"],
    ]),
  },
];

export function fixtureAnalysis(f: SongFixture): AudioAnalysis {
  const rate = 20;
  const duration = f.sections[f.sections.length - 1][1];
  const n = Math.round(duration * rate);
  const beat = 60 / f.bpm;
  const energy: number[] = [];
  const onset: number[] = [];
  const brightness: number[] = [];
  const bass: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = f.sections.find(([s, en]) => t >= s && t < en)?.[2] ?? 0.3;
    const pulse = Math.exp(-(t % beat) * 9);
    energy.push(Math.min(1, e * (0.85 + 0.15 * pulse)));
    onset.push(Math.min(1, pulse * (0.3 + e * 0.7)));
    brightness.push(0.3 + e * 0.5);
    bass.push(e * 0.6);
  }
  const beats: number[] = [];
  for (let t = 0; t < duration; t += beat) beats.push(Math.round(t * 1000) / 1000);
  return {
    duration,
    sampleRate: 44100,
    bpm: f.bpm,
    bpmConfidence: 0.9,
    beats,
    envelopeRate: rate,
    energy,
    onset,
    brightness,
    bass,
    peaks: Array.from({ length: 200 }, (_, i) => 0.2 + ((i * 37) % 60) / 100),
    sections: f.sections.map(([start, end, e]) => ({ start, end, energy: e })),
  };
}

export function fixturePublicInfo(f: SongFixture): PublicInfo {
  return {
    version: 1,
    query: { title: f.title, artist: f.artist },
    fetchedAt: "2026-09-01T00:00:00.000Z",
    musicbrainz: {
      recording: null,
      artist: { id: `mb-${f.id}`, name: f.artist, type: "Group", genres: [{ name: f.genre, count: 5 }], tags: [{ name: f.genre, count: 3 }], links: [] },
    },
    wikipedia: null,
    status: { musicbrainz: "ok", wikipedia: "none" },
    notes: [],
  };
}

export function fixtureInput(f: SongFixture): DesignerInput {
  const analysis = fixtureAnalysis(f);
  return {
    meta: { title: f.title, artist: f.artist, duration: analysis.duration, fileName: `${f.id}.wav`, mimeType: "audio/wav" },
    lyrics: parseLyricsText(f.lrc, "user"),
    analysis,
    publicInfo: fixturePublicInfo(f),
  };
}
