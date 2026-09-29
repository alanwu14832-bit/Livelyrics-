// 專屬畫面 (phase 7): the hand-written example programs.

import { ENSO } from "./enso";
import { MONOLITH } from "./monolith";
import { NIGHT_DRIVE } from "./night-drive";
import { SIGNAL } from "./signal";
import { TIDAL_FLAT } from "./tidal-flat";
import type { ExampleProgram } from "./types";

export const EXAMPLE_PROGRAMS: readonly ExampleProgram[] = [NIGHT_DRIVE, TIDAL_FLAT, MONOLITH, ENSO, SIGNAL];

export function exampleProgram(id: string | null | undefined): ExampleProgram | null {
  return EXAMPLE_PROGRAMS.find((e) => e.id === id) ?? null;
}

export { instantiateExample, KIND_FALLBACK, type ExampleProgram, type KindState } from "./types";
