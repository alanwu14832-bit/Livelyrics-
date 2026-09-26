// "impact" style: a line is shown a few words at a time, huge.
// Chunks break at spaces/punctuation; CJK runs are split evenly into ≤ maxCjk chars,
// Latin words are shown one (or two short ones) at a time.

import type { TimedUnit } from "./timing";

export interface Chunk {
  /** unit index range [from, to) */
  from: number;
  to: number;
  /** seconds relative to the line start */
  t0: number;
  t1: number;
}

export function impactChunks(units: readonly TimedUnit[], maxCjk = 4): Chunk[] {
  // 1. phrases separated by spaces / punctuation
  const phrases: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < units.length; i++) {
    const breaker = units[i].kind === "space" || units[i].kind === "punct";
    if (breaker) {
      if (start >= 0) phrases.push([start, i]);
      start = -1;
    } else if (start < 0) start = i;
  }
  if (start >= 0) phrases.push([start, units.length]);

  // 2. split phrases into chunks
  const ranges: Array<[number, number]> = [];
  for (const [a, b] of phrases) {
    const latin = units.slice(a, b).every((u) => u.kind === "latin");
    if (latin) {
      ranges.push([a, b]);
      continue;
    }
    const n = b - a;
    if (n <= maxCjk) {
      ranges.push([a, b]);
      continue;
    }
    const parts = Math.ceil(n / maxCjk);
    const base = Math.floor(n / parts);
    let extra = n % parts;
    let at = a;
    for (let p = 0; p < parts; p++) {
      const len = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      ranges.push([at, at + len]);
      at += len;
    }
  }

  // 3. merge a lone short Latin word into its neighbouring Latin chunk ("Hey you")
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    const isLatin = (x: [number, number]) => units.slice(x[0], x[1]).every((u) => u.kind === "latin");
    const len = (x: [number, number]) =>
      units
        .slice(x[0], x[1])
        .map((u) => u.text.length)
        .reduce((s, v) => s + v, 0);
    if (prev && isLatin(prev) && isLatin(r) && len(prev) + len(r) <= 7 && units.slice(prev[1], r[0]).every((u) => u.kind === "space")) {
      prev[1] = r[1];
    } else merged.push([r[0], r[1]]);
  }

  return merged.map(([from, to]) => {
    const seg = units.slice(from, to);
    return {
      from,
      to,
      t0: Math.min(...seg.map((u) => u.t0)),
      t1: Math.max(...seg.map((u) => u.t1)),
    };
  });
}

/** Index of the chunk to show at `elapsed` (the last one that has started; 0 before start). */
export function chunkIndexAt(chunks: readonly Chunk[], elapsed: number): number {
  let idx = 0;
  for (let i = 0; i < chunks.length; i++) if (elapsed >= chunks[i].t0 - 0.02) idx = i;
  return idx;
}
