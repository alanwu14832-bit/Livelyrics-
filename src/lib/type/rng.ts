// Deterministic randomness for compositions: a seed plus the line and recipe always give the same
// sequence, on every machine (no Math.random anywhere in the type engine).

/** FNV-1a 32-bit hash of a string. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
  /** uniform in [lo, hi) */
  range(lo: number, hi: number): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** one of the items */
  pick<T>(items: readonly T[]): T;
  /** true with probability p */
  chance(p: number): boolean;
}

/** mulberry32: small, fast and good enough for layout jitter. */
export function createRng(seed: number | string): Rng {
  let a = (typeof seed === "string" ? hash32(seed) : Math.floor(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.min(n - 1, Math.floor(next() * n)),
    pick: (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))],
    chance: (p) => next() < p,
  };
}

/** A stable [0, 1) value for a key (no state). */
export function hashUnit(key: string): number {
  return hash32(key) / 4294967296;
}
