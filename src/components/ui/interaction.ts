// Pure interaction logic behind the component kit (keyboard, stepping, floating placement,
// tooltip warm-up, toast stacking, presence, key glyphs). No DOM, no React: unit-tested in
// interaction.test.ts and shared by the components in this folder.

// ---------------------------------------------------------------- roving focus

export type Orientation = "horizontal" | "vertical" | "both";

/**
 * Next index for a roving-tabindex group (segmented control, tabs, menus) after `key`,
 * or null when the key is not a navigation key. Disabled items are skipped; with `loop`
 * the ends wrap (menus, segments), without it they stop (sliders of options).
 */
export function rovingIndex(
  key: string,
  current: number,
  count: number,
  { orientation = "both", loop = true, isDisabled }: { orientation?: Orientation; loop?: boolean; isDisabled?: (index: number) => boolean } = {},
): number | null {
  if (count <= 0) return null;
  const prevKeys = orientation === "horizontal" ? ["ArrowLeft"] : orientation === "vertical" ? ["ArrowUp"] : ["ArrowLeft", "ArrowUp"];
  const nextKeys = orientation === "horizontal" ? ["ArrowRight"] : orientation === "vertical" ? ["ArrowDown"] : ["ArrowRight", "ArrowDown"];
  const enabled = (i: number) => !isDisabled?.(i);
  const firstFrom = (start: number, dir: 1 | -1): number | null => {
    for (let n = 0, i = start; n < count; n++, i += dir) {
      if (i < 0 || i >= count) {
        if (!loop) return null;
        i = (i + count) % count;
      }
      if (enabled(i)) return i;
    }
    return null;
  };
  if (key === "Home") return firstFrom(0, 1);
  if (key === "End") return firstFrom(count - 1, -1);
  const from = current >= 0 && current < count ? current : -1;
  if (nextKeys.includes(key)) {
    const r = firstFrom(from + 1, 1);
    return r ?? (from >= 0 ? from : null);
  }
  if (prevKeys.includes(key)) {
    const r = firstFrom(from < 0 ? count - 1 : from - 1, -1);
    return r ?? (from >= 0 ? from : null);
  }
  return null;
}

/**
 * Type-to-select for menus and lists: characters typed within `timeoutMs` build a prefix;
 * the next label (after the current one) starting with it wins. Repeating one letter cycles.
 */
export function createTypeahead(timeoutMs = 500) {
  let buffer = "";
  let last = -Infinity;
  return {
    /** index to move to, or null when nothing matches */
    next(char: string, now: number, labels: readonly string[], current: number): number | null {
      if (char.length !== 1 || char === " ") return null;
      buffer = now - last > timeoutMs ? char : buffer + char;
      last = now;
      const q = buffer.toLocaleLowerCase();
      const single = q.split("").every((c) => c === q[0]);
      const n = labels.length;
      // repeating the same letter cycles through items starting with it
      const needle = single ? q[0] : q;
      const start = single || current < 0 ? current + 1 : current;
      for (let k = 0; k < n; k++) {
        const i = (((start + k) % n) + n) % n;
        if (labels[i].trim().toLocaleLowerCase().startsWith(needle)) return i;
      }
      return null;
    },
    reset() {
      buffer = "";
      last = -Infinity;
    },
  };
}

// ---------------------------------------------------------------- numbers

/** Decimal places of a step (0.05 → 2), so repeated steps do not accumulate float noise. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step)) return 0;
  const s = String(step);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** value + delta, clamped to [min, max] and rounded to the precision of `precisionStep`. */
export function stepValue(value: number, delta: number, { min = -Infinity, max = Infinity, precisionStep = delta }: { min?: number; max?: number; precisionStep?: number } = {}): number {
  const d = Math.max(decimalsOf(Math.abs(precisionStep)), decimalsOf(Math.abs(delta)));
  const next = clamp(value + delta, min, max);
  return Number(next.toFixed(Math.min(d, 10)));
}

/**
 * Keyboard delta for a slider: arrows move one step, Shift + arrow ten steps (the native range
 * input handles plain arrows, Home, End and Page keys; this is for the Shift case and custom
 * sliders). Returns null for keys that are not arrows.
 */
export function sliderKeyDelta(key: string, shift: boolean, step: number, bigStepMultiplier = 10): number | null {
  const dir = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
  if (!dir) return null;
  return dir * step * (shift ? bigStepMultiplier : 1);
}

/** 0..100 position of `value` in [min, max] for the slider's --p. */
export function percentOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Stepper auto-repeat (iOS): the first repeat after 400 ms, then every 80 ms. */
export const AUTO_REPEAT_DELAY_MS = 400;
export const AUTO_REPEAT_INTERVAL_MS = 80;

/** Segment under a pointer at `x` for a control starting at `left` with `count` equal segments. */
export function segmentAt(x: number, left: number, width: number, count: number, padding = 2): number {
  if (count <= 0 || width <= 0) return 0;
  const inner = width - padding * 2;
  return clamp(Math.floor(((x - left - padding) / inner) * count), 0, count - 1);
}

// ---------------------------------------------------------------- floating placement

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-${Exclude<Align, "center">}`;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingPosition {
  left: number;
  top: number;
  side: Side;
  align: Align;
  /** CSS transform-origin: the side facing the trigger (menus grow out of their button) */
  origin: string;
}

function splitPlacement(p: Placement): [Side, Align] {
  const [side, align] = p.split("-") as [Side, Align | undefined];
  return [side, align ?? "center"];
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Where to put a floating surface (menu, popover, tooltip) next to `anchor` inside a viewport.
 * Flips to the opposite side when the preferred one does not fit, then clamps into the viewport
 * `margin`. `origin` points back at the trigger, for the scale-in.
 */
export function placeFloating({
  anchor,
  floating,
  viewport,
  placement = "bottom-start",
  offset = 6,
  margin = 8,
}: {
  anchor: Rect;
  floating: { width: number; height: number };
  viewport: { width: number; height: number };
  placement?: Placement;
  offset?: number;
  margin?: number;
}): FloatingPosition {
  const split = splitPlacement(placement);
  let side = split[0];
  const align = split[1];
  const room = {
    top: anchor.top - margin,
    bottom: viewport.height - (anchor.top + anchor.height) - margin,
    left: anchor.left - margin,
    right: viewport.width - (anchor.left + anchor.width) - margin,
  };
  const need = side === "top" || side === "bottom" ? floating.height + offset : floating.width + offset;
  if (room[side] < need && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];

  let left: number;
  let top: number;
  if (side === "top" || side === "bottom") {
    top = side === "bottom" ? anchor.top + anchor.height + offset : anchor.top - offset - floating.height;
    left = align === "start" ? anchor.left : align === "end" ? anchor.left + anchor.width - floating.width : anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = side === "right" ? anchor.left + anchor.width + offset : anchor.left - offset - floating.width;
    top = align === "start" ? anchor.top : align === "end" ? anchor.top + anchor.height - floating.height : anchor.top + anchor.height / 2 - floating.height / 2;
  }
  left = clamp(left, margin, Math.max(margin, viewport.width - margin - floating.width));
  top = clamp(top, margin, Math.max(margin, viewport.height - margin - floating.height));

  // origin: the edge facing the trigger, horizontally/vertically at the trigger's centre
  const ax = clamp(anchor.left + anchor.width / 2 - left, 0, floating.width);
  const ay = clamp(anchor.top + anchor.height / 2 - top, 0, floating.height);
  const origin =
    side === "bottom" ? `${Math.round(ax)}px 0px` : side === "top" ? `${Math.round(ax)}px ${Math.round(floating.height)}px` : side === "right" ? `0px ${Math.round(ay)}px` : `${Math.round(floating.width)}px ${Math.round(ay)}px`;
  return { left: Math.round(left), top: Math.round(top), side, align, origin };
}

// ---------------------------------------------------------------- tooltip warm-up

export const TOOLTIP_DELAY_MS = 400;
export const TOOLTIP_SKIP_WINDOW_MS = 600;

/**
 * First tooltip waits `delay`; while one is open, or within `skipWindow` after one closed,
 * the next shows at once and without animation (emil-design-eng › Tooltips).
 */
export function tooltipTiming({ now, lastClosedAt, anyOpen, delay = TOOLTIP_DELAY_MS, skipWindow = TOOLTIP_SKIP_WINDOW_MS }: { now: number; lastClosedAt: number; anyOpen: boolean; delay?: number; skipWindow?: number }): {
  delay: number;
  instant: boolean;
} {
  const warm = anyOpen || now - lastClosedAt <= skipWindow;
  return warm ? { delay: 0, instant: true } : { delay, instant: false };
}

// ---------------------------------------------------------------- stacks and presence

/** translateY of each item in a stack (newest first), from measured heights and a gap. */
export function stackOffsets(heights: readonly number[], gap = 8): number[] {
  const out: number[] = [];
  let y = 0;
  for (const h of heights) {
    out.push(y);
    y += Math.max(0, h) + gap;
  }
  return out;
}

export interface Presence<T> {
  key: string;
  item: T;
  exiting: boolean;
}

/**
 * Keep items that left `next` in the rendered list (flagged `exiting`, at their old place)
 * so they can animate out; items that come back are revived. Order follows `next`, with
 * exiting items kept after the item that preceded them.
 */
export function mergePresence<T>(rendered: readonly Presence<T>[], next: readonly T[], keyOf: (item: T) => string): Presence<T>[] {
  const nextKeys = new Set(next.map(keyOf));
  const out: Presence<T>[] = next.map((item) => ({ key: keyOf(item), item, exiting: false }));
  // re-insert exiting ones after their previous neighbour
  rendered.forEach((r, idx) => {
    if (nextKeys.has(r.key)) return;
    let at = 0;
    for (let j = idx - 1; j >= 0; j--) {
      const pos = out.findIndex((o) => o.key === rendered[j].key);
      if (pos >= 0) {
        at = pos + 1;
        break;
      }
    }
    out.splice(at, 0, { key: r.key, item: r.item, exiting: true });
  });
  return out;
}

/** At most `max` capsules; the rest collapse into one "+n". */
export function capsuleOverflow<T>(items: readonly T[], max = 3): { visible: T[]; overflow: T[] } {
  if (items.length <= max) return { visible: [...items], overflow: [] };
  const keep = Math.max(0, max - 1);
  return { visible: items.slice(0, keep), overflow: items.slice(keep) };
}

/** HUD (console keyboard feedback): shows in 0 ms, holds 900 ms, fades 250 ms. */
export const HUD_HOLD_MS = 900;
export const HUD_FADE_MS = 250;

/** Toast lifetimes (ms): errors stay longer. */
export const TOAST_DURATION_MS = { info: 4500, ok: 4500, warn: 6000, error: 9000 } as const;

// ---------------------------------------------------------------- key glyphs

const KEY_GLYPHS: Record<string, string> = {
  meta: "⌘",
  cmd: "⌘",
  command: "⌘",
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  control: "⌃",
  ctrl: "⌃",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  backspace: "⌫",
  delete: "⌫",
  enter: "↩",
  return: "↩",
  escape: "Esc",
  esc: "Esc",
  tab: "Tab",
  " ": "Space",
  space: "Space",
  spacebar: "Space",
  pageup: "PgUp",
  pagedown: "PgDn",
};

const MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];

/**
 * Display label for a shortcut: "Shift+ArrowUp" → "⇧↑", "Meta+S" → "⌘S", "Space" → "Space",
 * "b" → "B". Modifiers follow the macOS order ⌃⌥⇧⌘. Unknown names pass through.
 */
export function keyLabel(combo: string): string {
  if (combo === " ") return "Space";
  // "+" itself can be the key: "+", "Shift++"
  const parts = combo === "+" ? ["+"] : combo.endsWith("++") ? [...combo.slice(0, -2).split("+"), "+"] : combo.split("+");
  const mods: string[] = [];
  const keys: string[] = [];
  for (const p of parts) {
    if (p === "") continue;
    const g = KEY_GLYPHS[p.toLowerCase()];
    const label = g ?? (p.length === 1 ? p.toUpperCase() : p);
    if (MODIFIER_ORDER.includes(label)) mods.push(label);
    else keys.push(label);
  }
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return mods.join("") + keys.join("");
}

/** `aria-keyshortcuts` value for a combo ("⇧↑" style input is not accepted; pass key names). */
export function ariaKeyShortcut(combo: string): string {
  const map: Record<string, string> = { cmd: "Meta", command: "Meta", mod: "Meta", ctrl: "Control", option: "Alt", opt: "Alt", esc: "Escape", " ": "Space" };
  return combo
    .split("+")
    .map((p) => map[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join("+");
}
