// The operator-facing 繁中 name of every built-in scene: the one source every surface uses (the
// timeline, the design tab, the stage lab, the designer's catalogue and its rationale sentences), so
// a section never reads 「粒子」 in one place and 「粒子星空」 in another.

import type { SceneId } from "../../types";

export const SCENE_LABELS: Record<SceneId, string> = {
  nebula: "星雲煙霧",
  particles: "粒子星空",
  waves: "光之波紋",
  grid: "復古網格",
  tunnel: "光速隧道",
  rain: "光雨",
  bokeh: "散景光球",
  shards: "彩繪玻璃",
  ink: "水墨流動",
  motif: "主視覺符號",
  gradient: "柔和漸層",
  blackout: "全黑",
};
