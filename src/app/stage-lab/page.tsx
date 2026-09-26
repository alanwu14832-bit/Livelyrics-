import type { Metadata } from "next";
import { StageLab, type StageLabInitial } from "./StageLab";

export const metadata: Metadata = {
  title: "舞台實驗室 — Livelyrics",
  description: "預覽每一種場景、歌詞樣式與位置的開發用頁面。",
};

type SearchParams = Record<string, string | string[] | undefined>;

function one(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Dev / demo gallery for the stage renderer.
 * Query params (for deterministic screenshots):
 *   ?scene=<SceneId|plan>&style=<LyricStyleId|plan>&placement=<LyricPlacement|plan>
 *   &t=<seconds>&play=0|1&cw=<colorway id>&chrome=0|1&guides=0|1&tp=0|1
 *   &gl=1 (force WebGL1) &aq=0 (no adaptive resolution) &intensity=&scale=&blackout=1&freeze=1&lyrics=0
 */
export default async function StageLabPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const initial: StageLabInitial = {
    scene: one(sp, "scene"),
    style: one(sp, "style"),
    placement: one(sp, "placement"),
    t: one(sp, "t"),
    play: one(sp, "play"),
    cw: one(sp, "cw"),
    chrome: one(sp, "chrome"),
    guides: one(sp, "guides"),
    tp: one(sp, "tp"),
    gl: one(sp, "gl"),
    aq: one(sp, "aq"),
    intensity: one(sp, "intensity"),
    scale: one(sp, "scale"),
    blackout: one(sp, "blackout"),
    freeze: one(sp, "freeze"),
    lyrics: one(sp, "lyrics"),
  };
  return <StageLab initial={initial} />;
}
