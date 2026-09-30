// URL contract of the process page (owned by HOME):
//   /p/[id]/process               observe / show the result (auto-runs when the project is new or processing)
//   /p/[id]/process?run=1          run the pipeline once on arrival (lyrics may come from the sessionStorage handoff)
//   /p/[id]/process?run=1&steps=design            run only some steps (comma-separated, pipeline order)
//   ...&instruction=<text>                         art-direction instruction for a re-design

import type { ProcessRequest } from "@/lib/api-client";

export type ProcessStep = NonNullable<ProcessRequest["steps"]>[number];

export const PROCESS_STEPS: readonly ProcessStep[] = ["lyrics", "research", "design", "scene"];

type ParamValue = string | string[] | undefined | null;

function values(v: ParamValue): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(/[\s,]+/));
}

/** Parse the `steps` query value; undefined = the full pipeline. Unknown names are ignored. */
export function parseStepsParam(v: ParamValue): ProcessStep[] | undefined {
  const wanted = new Set(values(v).map((s) => s.trim().toLowerCase()));
  const steps = PROCESS_STEPS.filter((s) => wanted.has(s));
  return steps.length ? steps : undefined;
}

export function parseRunParam(v: ParamValue): boolean {
  return values(v).some((s) => s === "1" || s === "true" || s === "yes");
}

export function firstParam(v: ParamValue): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function processHref(id: string, opts: { run?: boolean; steps?: readonly ProcessStep[]; instruction?: string } = {}): string {
  const p = new URLSearchParams();
  if (opts.run) p.set("run", "1");
  const steps = opts.steps ? PROCESS_STEPS.filter((s) => opts.steps!.includes(s)) : [];
  if (steps.length && steps.length < PROCESS_STEPS.length) p.set("steps", steps.join(","));
  if (opts.instruction?.trim()) p.set("instruction", opts.instruction.trim());
  const q = p.toString();
  return `/p/${encodeURIComponent(id)}/process${q ? `?${q}` : ""}`;
}

/** Steps from `failed` to the end of `requested` (pipeline order), for "retry from where it failed". */
export function stepsFrom(requested: readonly ProcessStep[] | undefined, failed: ProcessStep): ProcessStep[] {
  const all = requested && requested.length ? PROCESS_STEPS.filter((s) => requested.includes(s)) : [...PROCESS_STEPS];
  const i = all.indexOf(failed);
  return i >= 0 ? all.slice(i) : all;
}
