// 專屬畫面 (phase 7): hand-written example programs — the quality the Claude prompt asks for, the
// fixtures of the tests and the visual check (stage lab ?program=<id>), and few-shot guidance.

import type { DesignPlan, SceneProgram, SceneProgramSection, SectionKind } from "../../../types";
import { KIND_DEFAULTS } from "../model";

export type KindState = Omit<SceneProgramSection, "sectionId">;

export interface ExampleProgram {
  id: string;
  title: string;
  concept: string;
  /** the song it was written for (genre, mood, imagery): the prompt's example header */
  brief: string;
  source: string;
  /** the section states by kind (a plan's sections take their kind's) */
  byKind: Partial<Record<SectionKind, KindState>>;
}

/** The kind an example's missing kind borrows from. */
export const KIND_FALLBACK: Record<SectionKind, SectionKind> = {
  intro: "outro",
  verse: "verse",
  "pre-chorus": "verse",
  chorus: "chorus",
  bridge: "breakdown",
  solo: "chorus",
  breakdown: "bridge",
  outro: "intro",
  interlude: "bridge",
};

/** The example's program laid onto a plan's sections (their kinds pick the states). */
export function instantiateExample(ex: ExampleProgram, plan: Pick<DesignPlan, "sections">): SceneProgram {
  return {
    version: 1,
    engine: "example",
    title: ex.title,
    concept: ex.concept,
    source: ex.source,
    sections: plan.sections.map((s) => {
      const k = ex.byKind[s.kind] ?? ex.byKind[KIND_FALLBACK[s.kind]] ?? ex.byKind.verse;
      const d = KIND_DEFAULTS[s.kind] ?? KIND_DEFAULTS.verse;
      return k ? { sectionId: s.id, ...k, params: [...k.params] } : { sectionId: s.id, mode: d.mode, params: [...d.params], zone: { x: 0.08, y: 0.14, w: 0.42, h: 0.6 }, relation: "plain", note: "" };
    }),
    keyMoment: null,
    enabled: true,
  };
}
