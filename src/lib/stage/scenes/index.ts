// Registry: one fragment shader body per SceneId (see src/lib/schema.ts).

import type { SceneId } from "../../types";
import { blackout } from "./blackout";
import { bokeh } from "./bokeh";
import { gradient } from "./gradient";
import { grid } from "./grid";
import { ink } from "./ink";
import { motif } from "./motif";
import { nebula } from "./nebula";
import { particles } from "./particles";
import { rain } from "./rain";
import { shards } from "./shards";
import { tunnel } from "./tunnel";
import { waves } from "./waves";

export const SCENE_SHADERS: Record<SceneId, string> = {
  nebula,
  particles,
  waves,
  grid,
  tunnel,
  rain,
  bokeh,
  shards,
  ink,
  motif,
  gradient,
  blackout,
};

/** 中文名稱 for operator-facing UIs (stage lab, console pickers). */
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

export { buildSceneFragment, buildVertex, UNIFORM_NAMES } from "./common";
export { COMPOSITE_FRAGMENT, COMPOSITE_UNIFORMS } from "./composite";
