// Round 24 (N4): what the wall actually shows, in the operator's words. Since the scene program (專屬
// 畫面) took over the wall, a section's built-in scene (粒子星空, 水墨流動…) is only what a number key
// or a failed compile falls back to; the console, the timeline and the design tab name the program's
// form and what it does in the section (退後, 長大, 打開…) instead. Pure, client-safe.

import { SCENE_LABELS } from "../scenes/labels";
import type { DesignPlan, SectionDesign, SectionKind } from "../../types";
import { activeProgram, planSection } from "./model";

export interface SectionWall {
  /** short name for lists and the timeline: 「軌道・打開」, or the built-in scene's label */
  name: string;
  /** one sentence: what the picture does in this section */
  note: string;
  /** the scene program draws this section (false: the built-in scene does) */
  program: boolean;
}

/** The verb of a section's program state: how the form behaves here. */
export function programRole(kind: SectionKind, mode: number, lyrics = true): string {
  if (mode === 1) return "長大";
  switch (kind) {
    case "chorus":
    case "solo":
      return lyrics ? "打開" : "展開";
    case "bridge":
      return "變形";
    case "breakdown":
      return "留白";
    case "intro":
      return "微光";
    case "outro":
      return "收光";
    case "pre-chorus":
      return "長大";
    case "interlude":
      return lyrics ? "退後" : "展開";
    default:
      return "退後";
  }
}

const ROLE_NOTE: Record<string, string> = {
  長大: "形狀隨著這一段慢慢長大，準備在下一段打開",
  打開: "形狀放大到越出畫面，整面牆打開",
  展開: "形狀完全展開，層次加到最多",
  變形: "同一個形狀換一個規則",
  留白: "幾乎只剩留白",
  微光: "只留一點點光",
  收光: "慢慢收回光",
  退後: "畫面退後，形狀小小地站在字的另一側",
};

/** The program's name on the wall (its title), or null when no program draws the song. */
export function programName(plan: DesignPlan | null | undefined): string | null {
  const p = activeProgram(plan);
  return p ? p.title?.trim() || "專屬畫面" : null;
}

/** The song has words on the wall (an instrumental's plan hides every section). */
function hasWords(plan: DesignPlan): boolean {
  return (plan.typeSystem?.lines?.length ?? 0) > 0 || plan.sections.some((s) => s.lyricStyle !== "hidden");
}

/** What the wall shows in a section: the program's form and its role there, else the built-in scene. */
export function sectionWall(plan: DesignPlan | null | undefined, index: number | null): SectionWall {
  const section: SectionDesign | null = plan && index != null ? (plan.sections[index] ?? null) : null;
  const program = activeProgram(plan);
  if (program && plan) {
    const state = planSection(plan, program, section, index);
    const title = program.title?.trim() || "專屬畫面";
    const role = programRole(section?.kind ?? "verse", Math.round(state.mode), hasWords(plan));
    const note = program.sections.find((s) => s.sectionId === section?.id)?.note?.trim() || ROLE_NOTE[role] || "";
    return { name: `${title}・${role}`, note, program: true };
  }
  const scene = section?.scene ?? "gradient";
  return { name: SCENE_LABELS[scene] ?? scene, note: "", program: false };
}
