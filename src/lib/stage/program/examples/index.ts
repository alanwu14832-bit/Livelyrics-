// 專屬畫面 (phase 7): the hand-written example programs.

import { NIGHT_DRIVE } from "./night-drive";
import type { ExampleProgram } from "./types";

export const EXAMPLE_PROGRAMS: readonly ExampleProgram[] = [NIGHT_DRIVE];

export function exampleProgram(id: string | null | undefined): ExampleProgram | null {
  return EXAMPLE_PROGRAMS.find((e) => e.id === id) ?? null;
}

export { instantiateExample, type ExampleProgram, type KindState } from "./types";
