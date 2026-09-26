// Imperative DOM lyric layer. One instance per <StageView>; `update()` is called
// from the StageView's requestAnimationFrame loop. DOM is rebuilt only when the
// displayed line / style / typography changes; per frame we only write the few
// style properties that actually changed (opacity, transform, clip-path).
//
// Timing model: enter/exit animations run on the wall clock (so they also work
// while paused, when scrubbing and in live cue mode); per-word progress runs on
// song time (deterministic under seeking), or on the time since the console cued
// the line for untimed lyrics.

import type { LyricPlacement, LyricStyleId, Project } from "@/lib/types";
import { lightness, rgba, shade } from "@/lib/stage/color";
import { chunkIndexAt, impactChunks, type Chunk } from "@/lib/stage/lyrics/chunks";
import {
  STYLE_METRICS,
  clampWeight,
  flexAlign,
  placementBox,
  writingModeFor,
  type PlacementBox,
  type StyleMetrics,
  type WritingMode,
} from "@/lib/stage/lyrics/layout";
import { lineElapsed, prepareLine, type PreparedLine } from "@/lib/stage/lyrics/model";
import { unitProgress } from "@/lib/stage/lyrics/timing";
import type { StageState } from "@/lib/stage/protocol";
import { resolveLineDesign, type StageLook } from "@/lib/stage/resolve";
import type { StageTypography } from "@/lib/stage/typography";
import styles from "./lyrics.module.css";

export interface LyricFrame {
  project: Project;
  state: StageState;
  /** song time, seconds */
  t: number;
  /** Date.now() */
  nowEpoch: number;
  /** performance.now() */
  now: number;
  look: StageLook;
  typography: StageTypography;
  /** 0..1.5 beat punch (already scaled by reactivity) */
  pulse: number;
  /** overrides.lyricsVisible */
  visible: boolean;
}

// ---------------------------------------------------------------------------
// small helpers

const lastStyle = new WeakMap<HTMLElement, Record<string, string>>();

function css(el: HTMLElement, prop: string, value: string) {
  let rec = lastStyle.get(el);
  if (!rec) {
    rec = {};
    lastStyle.set(el, rec);
  }
  if (rec[prop] === value) return;
  rec[prop] = value;
  el.style.setProperty(prop, value);
}

function toggle(el: HTMLElement, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOutBack = (x: number) => {
  const t = clamp01(x);
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const f3 = (x: number) => (Math.round(x * 1000) / 1000).toString();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// block construction

interface BuildOptions {
  metrics: StyleMetrics;
  typography: StageTypography;
  mode: WritingMode;
  textAlign: string;
  karaoke?: boolean;
  /** display rows (unit indices); defaults to line.rows */
  rows?: number[][];
  translation?: boolean;
  next?: PreparedLine | null;
  sizeScale?: number;
}

interface BuiltBlock {
  block: HTMLDivElement;
  units: Array<HTMLSpanElement | null>;
  fills: Array<HTMLSpanElement | null>;
  next: HTMLSpanElement | null;
}

function buildBlock(line: PreparedLine, o: BuildOptions): BuiltBlock {
  const vertical = o.mode === "vertical";
  const block = el("div", cls(styles.block, vertical && styles.vertical));
  const weight = clampWeight(o.typography.weight + o.metrics.weightDelta);
  const size = o.metrics.size * (o.sizeScale ?? 1);
  block.style.setProperty("--ly-fit", "1");
  block.style.setProperty("--ly-leading", String(o.metrics.leading));
  block.style.fontSize = `calc(${size}cqh * var(--ly-scale, 1) * var(--ly-fit, 1))`;
  block.style.fontWeight = String(weight);
  block.style.letterSpacing = `${f3(o.typography.letterSpacing + o.metrics.trackingDelta)}em`;
  block.style.textAlign = o.textAlign;

  const units: Array<HTMLSpanElement | null> = new Array(line.units.length).fill(null);
  const fills: Array<HTMLSpanElement | null> = new Array(line.units.length).fill(null);
  const emWeight = String(clampWeight(weight + 100));
  for (const row of o.rows ?? line.rows) {
    const rowEl = el("span", styles.row);
    for (const i of row) {
      const u = line.units[i];
      if (!u) continue;
      if (u.kind === "space") {
        rowEl.append(document.createTextNode(" "));
        continue;
      }
      const span = el("span", cls(styles.u, u.kind === "latin" && styles.latin, line.emphasis[i] && styles.em, o.karaoke && styles.kara));
      span.textContent = u.text;
      if (line.emphasis[i]) span.style.fontWeight = emWeight;
      if (o.karaoke) {
        const fill = el("span", styles.fill);
        fill.textContent = u.text;
        fill.setAttribute("aria-hidden", "true");
        span.append(fill);
        fills[i] = fill;
      }
      units[i] = span;
      rowEl.append(span);
    }
    block.append(rowEl);
  }

  if (o.translation !== false && line.translationRows.length) {
    const tr = el("span", styles.tr);
    tr.style.fontSize = `${o.metrics.translationScale}em`;
    tr.style.fontWeight = String(clampWeight(weight - 200));
    for (const r of line.translationRows) {
      const rowEl = el("span", styles.row);
      rowEl.textContent = r;
      tr.append(rowEl);
    }
    block.append(tr);
  }

  let next: HTMLSpanElement | null = null;
  if (o.next && o.next.rows.length) {
    next = el("span", styles.next);
    next.style.fontSize = "0.46em";
    next.style.fontWeight = String(clampWeight(weight - 100));
    next.textContent = o.next.rows[0].map((i) => o.next!.units[i]?.text ?? "").join("");
    block.append(next);
  }
  return { block, units, fills, next };
}

/** Standalone translation line (used under "impact" chunks). */
function buildTranslationBlock(rows: string[], metrics: StyleMetrics, typography: StageTypography): HTMLDivElement {
  const block = el("div", cls(styles.block, styles.noScrim));
  const weight = clampWeight(typography.weight + metrics.weightDelta - 200);
  block.style.setProperty("--ly-fit", "1");
  block.style.fontSize = `calc(${f3(metrics.size * metrics.translationScale)}cqh * var(--ly-scale, 1) * var(--ly-fit, 1))`;
  block.style.fontWeight = String(weight);
  block.style.textAlign = "center";
  block.style.marginTop = "0.4em";
  block.style.opacity = "0";
  for (const r of rows) {
    const rowEl = el("span", styles.row);
    rowEl.textContent = r;
    block.append(rowEl);
  }
  return block;
}

function textAlignFor(box: PlacementBox, mode: WritingMode): string {
  const a = mode === "vertical" ? box.alignY : box.alignX;
  return a === "start" ? "start" : a === "end" ? "end" : "center";
}

/** Largest --ly-fit (≤ 1) that makes `block` fit inside `w`×`h`. */
function fitBlock(block: HTMLElement, w: number, h: number) {
  if (w <= 0 || h <= 0) return;
  css(block, "--ly-fit", "1");
  const bw = block.offsetWidth;
  const bh = block.offsetHeight;
  if (!bw || !bh) return;
  const k = Math.min(1, w / bw, h / bh);
  css(block, "--ly-fit", k < 1 ? f3(k * 0.98) : "1");
}

// ---------------------------------------------------------------------------
// views

export interface ViewSpec {
  style: LyricStyleId;
  placement: LyricPlacement;
  mode: WritingMode;
  box: PlacementBox;
  metrics: StyleMetrics;
  typography: StageTypography;
}

interface ViewFrame {
  now: number;
  t: number;
  nowEpoch: number;
  pulse: number;
}

const DURATIONS: Record<LyricStyleId, [number, number]> = {
  karaoke: [360, 320],
  "line-fade": [650, 560],
  "word-pop": [160, 300],
  typewriter: [160, 360],
  stack: [520, 620],
  vertical: [720, 800],
  impact: [90, 240],
  subtitle: [260, 260],
  hidden: [0, 0],
};

abstract class LyricView {
  readonly group: HTMLDivElement;
  protected enterAt: number;
  protected exitAt: number | null = null;
  protected enterDur: number;
  protected exitDur: number;
  protected fitDirty = true;

  constructor(
    readonly key: string,
    protected readonly spec: ViewSpec,
    host: HTMLElement,
    now: number,
  ) {
    const [enter, exit] = DURATIONS[spec.style];
    this.enterDur = enter;
    this.exitDur = exit;
    this.enterAt = now;
    this.group = el("div", styles.group);
    const b = spec.box;
    Object.assign(this.group.style, {
      left: `${b.left}%`,
      top: `${b.top}%`,
      width: `${b.width}%`,
      height: `${b.height}%`,
      justifyContent: flexAlign(b.alignY),
      alignItems: flexAlign(b.alignX),
    });
    host.append(this.group);
  }

  /** Delay the entry (used when replacing a line so the two don't muddle). */
  delayEnter(ms: number) {
    this.enterAt += ms;
  }

  startExit(now: number, replaced: boolean) {
    if (this.exitAt != null) return;
    this.exitAt = now;
    if (replaced) this.exitDur = Math.min(this.exitDur, 340);
  }

  get exiting(): boolean {
    return this.exitAt != null;
  }

  isDone(now: number): boolean {
    return this.exitAt != null && now - this.exitAt >= this.exitDur;
  }

  invalidateFit() {
    this.fitDirty = true;
  }

  protected enter(now: number): number {
    return this.enterDur <= 0 ? 1 : clamp01((now - this.enterAt) / this.enterDur);
  }

  protected exit(now: number): number {
    if (this.exitAt == null) return 0;
    return this.exitDur <= 0 ? 1 : clamp01((now - this.exitAt) / this.exitDur);
  }

  protected boxSize(): [number, number] {
    return [this.group.clientWidth, this.group.clientHeight];
  }

  setScrim(bg: string) {
    this.group.style.setProperty("--ly-scrim", rgba(shade(bg, 0.55), this.spec.metrics.scrim * 0.62));
  }

  abstract render(f: ViewFrame): void;

  destroy() {
    this.group.remove();
  }
}

/** Views for one line: karaoke, line-fade, word-pop, typewriter, vertical, subtitle. */
class LineView extends LyricView {
  private built: BuiltBlock;
  private lastCaret = -1;

  constructor(
    key: string,
    spec: ViewSpec,
    host: HTMLElement,
    now: number,
    private readonly line: PreparedLine,
    private readonly startedAt: number,
    next: PreparedLine | null,
  ) {
    super(key, spec, host, now);
    this.built = buildBlock(line, {
      metrics: spec.metrics,
      typography: spec.typography,
      mode: spec.mode,
      textAlign: textAlignFor(spec.box, spec.mode),
      karaoke: spec.style === "karaoke",
      next: spec.metrics.showNext ? next : null,
    });
    this.built.block.style.opacity = "0";
    this.group.append(this.built.block);
  }

  render(f: ViewFrame) {
    const { block, units, fills } = this.built;
    if (this.fitDirty) {
      const [w, h] = this.boxSize();
      fitBlock(block, w, h);
      this.fitDirty = false;
    }
    const e = this.enter(f.now);
    const x = this.exit(f.now);
    const elapsed = lineElapsed(this.line, f.t, this.startedAt, f.nowEpoch);
    const vertical = this.spec.mode === "vertical";
    const axis = vertical ? "X" : "Y";
    const line = this.line;

    switch (this.spec.style) {
      case "karaoke": {
        const a = easeOutCubic(e) * (1 - easeInOut(x));
        css(block, "opacity", f3(a));
        const shift = (1 - easeOutCubic(e)) * 0.22 - easeInOut(x) * 0.18;
        css(block, "transform", vertical ? `translateX(${f3(-shift)}em)` : `translateY(${f3(shift)}em)`);
        for (let i = 0; i < fills.length; i++) {
          const fill = fills[i];
          if (!fill) continue;
          const p = unitProgress(line.units[i], elapsed);
          const rest = f3((1 - p) * 100);
          css(fill, "clip-path", vertical ? `inset(0 0 ${rest}% 0)` : `inset(0 ${rest}% 0 0)`);
        }
        break;
      }
      case "line-fade": {
        const ein = easeOutCubic(e);
        const eout = easeInOut(x);
        css(block, "opacity", f3(ein * (1 - eout)));
        const blur = (1 - ein) * 0.14 + eout * 0.09;
        css(block, "filter", blur > 0.002 ? `blur(${f3(blur)}em)` : "none");
        const scale = 1 + (1 - ein) * 0.045 - eout * 0.02;
        css(block, "transform", `scale(${f3(scale)}) translate${axis}(${f3(-eout * 0.08)}em)`);
        break;
      }
      case "word-pop": {
        css(block, "opacity", f3(easeOutCubic(e) * (1 - easeInOut(x))));
        css(block, "transform", `scale(${f3(1 + easeInOut(x) * 0.05)})`);
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (!u) continue;
          const pt = clamp01((elapsed - line.units[i].t0) / 0.24);
          const s = pt >= 1 ? 1 : 0.55 + 0.45 * easeOutBack(pt);
          const y = (1 - easeOutCubic(pt)) * 0.28;
          css(u, "opacity", f3(clamp01(pt * 2.4)));
          css(u, "transform", pt >= 1 ? "none" : `translate${axis}(${f3(vertical ? -y : y)}em) scale(${f3(s)})`);
        }
        break;
      }
      case "typewriter": {
        css(block, "opacity", f3(clamp01(e * 1.5) * (1 - easeInOut(x))));
        let caret = -1;
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (!u) continue;
          const pt = clamp01((elapsed - line.units[i].t0) / 0.07);
          css(u, "opacity", f3(pt));
          if (pt > 0) caret = i;
        }
        if (caret !== this.lastCaret) {
          if (this.lastCaret >= 0 && units[this.lastCaret]) units[this.lastCaret]!.classList.remove(styles.caret, styles.caretBlink);
          if (caret >= 0 && units[caret]) units[caret]!.classList.add(styles.caret);
          this.lastCaret = caret;
        }
        if (caret >= 0 && units[caret]) toggle(units[caret]!, styles.caretBlink, elapsed >= line.sungDuration);
        break;
      }
      case "vertical": {
        const ein = easeOutCubic(e);
        const eout = easeInOut(x);
        css(block, "opacity", f3(ein * (1 - eout)));
        const blur = (1 - ein) * 0.1 + eout * 0.12;
        css(block, "filter", blur > 0.002 ? `blur(${f3(blur)}em)` : "none");
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (!u) continue;
          const pt = easeOutCubic(clamp01((elapsed - line.units[i].t0) / 0.45));
          css(u, "opacity", f3(0.2 + 0.8 * pt));
          const y = (1 - pt) * -0.16;
          css(u, "transform", pt >= 1 ? "none" : vertical ? `translateY(${f3(y)}em)` : `translateX(${f3(y)}em)`);
        }
        break;
      }
      case "subtitle":
      default: {
        const a = easeOutCubic(e) * (1 - easeInOut(x));
        css(block, "opacity", f3(a));
        const shift = (1 - easeOutCubic(e)) * 0.18;
        css(block, "transform", `translate${axis}(${f3(vertical ? -shift : shift)}em)`);
        break;
      }
    }
  }
}

/** "impact": huge chunks of the line, a few words at a time. */
class ImpactView extends LyricView {
  private chunks: Chunk[];
  private blocks: HTMLDivElement[] = [];
  private shownAt: number[] = [];
  private hiddenAt: number[] = [];
  private active = -1;
  private tr: HTMLDivElement | null = null;
  private stage: HTMLDivElement;

  constructor(
    key: string,
    spec: ViewSpec,
    host: HTMLElement,
    now: number,
    private readonly line: PreparedLine,
    private readonly startedAt: number,
  ) {
    super(key, spec, host, now);
    this.chunks = impactChunks(line.units, spec.mode === "vertical" ? 3 : 4);
    this.stage = el("div", styles.chunkStage);
    this.group.append(this.stage);
    for (const c of this.chunks) {
      const rows = [Array.from({ length: c.to - c.from }, (_, k) => c.from + k)];
      const { block } = buildBlock(line, {
        metrics: spec.metrics,
        typography: spec.typography,
        mode: spec.mode,
        textAlign: "center",
        rows,
        translation: false,
      });
      block.style.opacity = "0";
      this.stage.append(block);
      this.blocks.push(block);
      this.shownAt.push(-1);
      this.hiddenAt.push(-1);
    }
    if (line.translationRows.length) {
      this.tr = buildTranslationBlock(line.translationRows, spec.metrics, spec.typography);
      this.group.append(this.tr);
    }
  }

  render(f: ViewFrame) {
    if (this.fitDirty) {
      const [w, h] = this.boxSize();
      const trH = this.tr ? this.tr.offsetHeight : 0;
      for (const b of this.blocks) fitBlock(b, w, Math.max(10, h - trH));
      if (this.tr) fitBlock(this.tr, w, h);
      this.fitDirty = false;
    }
    const elapsed = lineElapsed(this.line, f.t, this.startedAt, f.nowEpoch);
    const idx = this.chunks.length ? chunkIndexAt(this.chunks, elapsed) : -1;
    if (idx !== this.active) {
      if (this.active >= 0) this.hiddenAt[this.active] = f.now;
      if (idx >= 0) {
        this.shownAt[idx] = f.now;
        this.hiddenAt[idx] = -1;
      }
      this.active = idx;
    }
    const x = this.exit(f.now);
    const groupFade = 1 - easeInOut(x);
    const beat = 1 + 0.03 * Math.min(1, f.pulse);
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      if (i === this.active) {
        const p = clamp01((f.now - this.shownAt[i]) / 160);
        const s = (1.28 - 0.28 * easeOutCubic(p)) * beat;
        css(b, "opacity", f3(clamp01(p * 2) * groupFade));
        css(b, "transform", `scale(${f3(s + easeInOut(x) * 0.06)})`);
      } else if (this.hiddenAt[i] >= 0) {
        const p = clamp01((f.now - this.hiddenAt[i]) / 150);
        css(b, "opacity", f3((1 - p) * groupFade));
        css(b, "transform", `scale(${f3(1 - 0.1 * easeOutCubic(p))})`);
        if (p >= 1) this.hiddenAt[i] = -1;
      } else {
        css(b, "opacity", "0");
      }
    }
    if (this.tr) css(this.tr, "opacity", f3(easeOutCubic(this.enter(f.now)) * groupFade * 0.9));
  }
}

interface StackItem {
  index: number;
  el: HTMLDivElement;
  opacity: number;
  scale: number;
}

/** "stack": lines stack up and drift upward like a poem; older lines dim. */
class StackView extends LyricView {
  private column: HTMLDivElement;
  private items = new Map<number, StackItem>();
  private current = -1;
  private y = 0;
  private targetY = 0;
  private lastNow = 0;

  constructor(
    key: string,
    spec: ViewSpec,
    host: HTMLElement,
    now: number,
    private readonly prepare: (index: number) => PreparedLine | null,
    private readonly inStack: (index: number) => boolean,
  ) {
    super(key, spec, host, now);
    this.column = el("div", styles.stackColumn);
    this.column.style.alignItems = flexAlign(spec.box.alignX);
    this.column.style.fontSize = `calc(${spec.metrics.size}cqh * var(--ly-scale, 1))`;
    this.group.append(this.column);
    this.lastNow = now;
  }

  private anchor(h: number): number {
    const a = this.spec.box.alignY;
    return h * (a === "start" ? 0.3 : a === "end" ? 0.72 : 0.5);
  }

  private makeItem(index: number): StackItem | null {
    const line = this.prepare(index);
    if (!line) return null;
    const { block } = buildBlock(line, {
      metrics: this.spec.metrics,
      typography: this.spec.typography,
      mode: "horizontal",
      textAlign: textAlignFor(this.spec.box, "horizontal"),
    });
    block.style.fontSize = "calc(1em * var(--ly-fit, 1))";
    block.style.opacity = "0";
    return { index, el: block, opacity: 0, scale: 0.86 };
  }

  setIndex(index: number) {
    if (index === this.current) return;
    const sequential = this.current >= 0 && index === this.current + 1;
    const ref = this.items.get(this.current)?.el ?? null;
    const refTop = ref ? ref.offsetTop : 0;
    const wanted = new Set<number>();
    for (let i = index - 2; i <= index + 1; i++) if (i === index || (i >= 0 && this.inStack(i))) wanted.add(i);

    if (!sequential) {
      for (const it of this.items.values()) it.el.remove();
      this.items.clear();
    }
    // add missing items in order
    const sorted = [...wanted].sort((a, b) => a - b);
    for (const i of sorted) {
      if (this.items.has(i)) continue;
      const item = this.makeItem(i);
      if (!item) continue;
      const after = [...this.items.values()].filter((it) => it.index > i).sort((a, b) => a.index - b.index)[0];
      if (after) this.column.insertBefore(item.el, after.el);
      else this.column.append(item.el);
      this.items.set(i, item);
      const [w, h] = this.boxSize();
      fitBlock(item.el, w, h);
    }
    this.current = index;
    const cur = this.items.get(index);
    if (sequential && ref && ref.isConnected) this.y += refTop - ref.offsetTop;
    if (cur) {
      const [, h] = this.boxSize();
      this.targetY = this.anchor(h) - (cur.el.offsetTop + cur.el.offsetHeight / 2);
      if (!sequential) this.y = this.targetY;
    }
  }

  render(f: ViewFrame) {
    const dt = Math.min(0.1, Math.max(0, (f.now - this.lastNow) / 1000));
    this.lastNow = f.now;
    if (this.fitDirty) {
      const [w, h] = this.boxSize();
      for (const it of this.items.values()) fitBlock(it.el, w, h);
      const cur = this.items.get(this.current);
      if (cur) {
        this.targetY = this.anchor(h) - (cur.el.offsetTop + cur.el.offsetHeight / 2);
        this.y = this.targetY;
      }
      this.fitDirty = false;
    }
    const k = 1 - Math.exp(-dt / 0.2);
    this.y += (this.targetY - this.y) * (dt > 0 ? k : 0);
    if (Math.abs(this.targetY - this.y) < 0.2) this.y = this.targetY;
    css(this.column, "transform", `translateY(${f3(this.y)}px)`);

    const groupA = easeOutCubic(this.enter(f.now)) * (1 - easeInOut(this.exit(f.now)));
    css(this.group, "opacity", f3(groupA));
    const kk = 1 - Math.exp(-dt / 0.22);
    const removals: number[] = [];
    for (const it of this.items.values()) {
      const rel = it.index - this.current;
      const targetO = rel === 0 ? 1 : rel === -1 ? 0.46 : rel === -2 ? 0.2 : rel === 1 ? 0.2 : 0;
      const targetS = rel === 0 ? 1 : 0.84;
      it.opacity += (targetO - it.opacity) * kk;
      it.scale += (targetS - it.scale) * kk;
      if (dt === 0) {
        it.opacity = targetO;
        it.scale = targetS;
      }
      css(it.el, "opacity", f3(it.opacity));
      css(it.el, "transform", `scale(${f3(it.scale)})`);
      if ((rel < -2 || rel > 1) && it.opacity < 0.01) removals.push(it.index);
    }
    if (removals.length) {
      const cur = this.items.get(this.current)?.el ?? null;
      const before = cur ? cur.offsetTop : 0;
      for (const i of removals) {
        this.items.get(i)?.el.remove();
        this.items.delete(i);
      }
      if (cur) {
        const delta = before - cur.offsetTop;
        this.y += delta;
        this.targetY += delta;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// layer

function contentSignature(project: Project): string {
  const lines = project.lyrics?.lines ?? [];
  let h = 2166136261;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const l of lines) feed(`${l.id}|${l.text}|${l.translation ?? ""}|${l.start}|${l.end}|${l.words?.length ?? 0};`);
  for (const d of project.plan?.lines ?? []) feed(`${d.lineId}|${d.emphasis.join(",")}|${d.styleOverride};`);
  feed(String(project.meta?.duration ?? 0));
  return (h >>> 0).toString(36);
}

export class LyricLayer {
  readonly root: HTMLDivElement;
  private current: LyricView | null = null;
  private leaving: LyricView[] = [];
  private visibleAmt = 1;
  private lastNow = 0;
  private projectRef: Project | null = null;
  private signature = "";
  private colorKey = "";
  private scaleKey = "";
  private familyKey = "";
  private cache = new Map<string, PreparedLine | null>();
  private failed = false;

  constructor(host: HTMLElement) {
    this.root = el("div", styles.layer);
    this.root.setAttribute("aria-hidden", "true");
    host.append(this.root);
  }

  invalidateFit() {
    this.current?.invalidateFit();
    for (const v of this.leaving) v.invalidateFit();
  }

  private prepared(project: Project, index: number, metrics: StyleMetrics, emphasis: string[]): PreparedLine | null {
    const key = `${this.signature}|${index}|${metrics.maxChars}|${metrics.maxLines}|${emphasis.join("\u0001")}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    if (this.cache.size > 256) this.cache.clear();
    const line = prepareLine(project.lyrics?.lines ?? [], index, {
      maxChars: metrics.maxChars,
      maxLines: metrics.maxLines,
      songDuration: project.meta?.duration || project.analysis?.duration || 0,
      emphasis,
    });
    this.cache.set(key, line);
    return line;
  }

  private applyRootStyles(f: LyricFrame) {
    const { look, typography } = f;
    const ck = `${look.lyricColor}|${look.accentColor}|${look.colorway[0]}`;
    if (ck !== this.colorKey) {
      this.colorKey = ck;
      const r = this.root.style;
      const darkText = lightness(look.lyricColor) < 0.45;
      const shadowBase = darkText ? "#ffffff" : shade(look.colorway[0], 0.35);
      r.setProperty("--ly-color", look.lyricColor);
      r.setProperty("--ly-fill", look.lyricColor);
      r.setProperty("--ly-accent", look.accentColor);
      r.setProperty("--ly-dim", rgba(look.lyricColor, 0.5));
      r.setProperty("--ly-accent-dim", rgba(look.accentColor, 0.55));
      r.setProperty("--ly-glow", rgba(look.accentColor, 0.55));
      r.setProperty("--ly-shadow", rgba(shadowBase, darkText ? 0.5 : 0.62));
      r.setProperty("--ly-shadow-soft", rgba(shadowBase, darkText ? 0.3 : 0.38));
      this.current?.setScrim(look.colorway[0]);
      for (const v of this.leaving) v.setScrim(look.colorway[0]);
    }
    const sk = f3(look.lyricScale);
    if (sk !== this.scaleKey) {
      this.scaleKey = sk;
      this.root.style.setProperty("--ly-scale", sk);
      this.invalidateFit();
    }
    if (typography.family !== this.familyKey) {
      this.familyKey = typography.family;
      this.root.style.fontFamily = typography.family;
    }
  }

  update(f: LyricFrame) {
    if (this.failed) return;
    try {
      this.frame(f);
    } catch (e) {
      // never take the output down because of one bad line; log once and stop the layer
      this.failed = true;
      console.error("[Livelyrics] 歌詞圖層發生錯誤，已停用：", e);
      this.root.replaceChildren();
    }
  }

  private frame(f: LyricFrame) {
    const { project, state, look, now } = f;
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastNow || now)) / 1000));
    this.lastNow = now;

    if (project !== this.projectRef) {
      this.projectRef = project;
      const sig = contentSignature(project);
      if (sig !== this.signature) {
        this.signature = sig;
        this.cache.clear();
      }
    }
    this.applyRootStyles(f);

    // lyricsVisible: smooth 0.3 s ramp
    const target = f.visible ? 1 : 0;
    const step = dt / 0.3;
    this.visibleAmt = target > this.visibleAmt ? Math.min(target, this.visibleAmt + step) : Math.max(target, this.visibleAmt - step);
    css(this.root, "opacity", f3(easeInOut(this.visibleAmt)));

    const lines = project.lyrics?.lines ?? [];
    const idx = state.lineIndex;
    const valid = typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < lines.length ? idx : null;
    let key = "none";
    let style: LyricStyleId = "hidden";
    let emphasis: string[] = [];
    let mode: WritingMode = "horizontal";
    if (valid != null) {
      const d = resolveLineDesign(project.plan, lines[valid].id, look.lyricStyle, state.overrides?.lyricStyle);
      style = d.style;
      emphasis = d.emphasis;
      if (style !== "hidden" && (lines[valid].text ?? "").trim()) {
        mode = writingModeFor(style, look.placement);
        const base = `${this.signature}|${f.typography.key}|${look.placement}|${mode}`;
        const cue = lines[valid].start == null ? `|${state.lineStartedAt}` : "";
        key = style === "stack" ? `stack|${look.sectionIndex}|${base}` : `${style}|${valid}|${base}|${emphasis.join("\u0001")}${cue}`;
      }
    }

    if (key !== (this.current?.key ?? "none")) {
      const replacing = this.current != null && key !== "none";
      if (this.current) {
        this.current.startExit(now, replacing);
        this.leaving.push(this.current);
        this.current = null;
      }
      if (key !== "none" && valid != null) {
        this.current = this.createView(key, style, mode, valid, emphasis, f);
        if (this.current && replacing && style !== "impact") this.current.delayEnter(90);
      }
    }
    if (this.current instanceof StackView && valid != null) this.current.setIndex(valid);

    const vf: ViewFrame = { now, t: f.t, nowEpoch: f.nowEpoch, pulse: f.pulse };
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const v = this.leaving[i];
      if (v.isDone(now)) {
        v.destroy();
        this.leaving.splice(i, 1);
      } else v.render(vf);
    }
    // keep at most a couple of outgoing views alive (fast cueing)
    while (this.leaving.length > 3) this.leaving.shift()?.destroy();
    this.current?.render(vf);
  }

  private createView(key: string, style: LyricStyleId, mode: WritingMode, index: number, emphasis: string[], f: LyricFrame): LyricView | null {
    const { project, look, state } = f;
    const metrics = STYLE_METRICS[style];
    const spec: ViewSpec = {
      style,
      placement: look.placement,
      mode,
      box: placementBox(look.placement, mode),
      metrics,
      typography: f.typography,
    };
    const lines = project.lyrics?.lines ?? [];
    let view: LyricView | null = null;
    if (style === "stack") {
      const section = look.section;
      const sameSection = (i: number) => {
        const l = lines[i];
        if (!l) return false;
        const d = resolveLineDesign(project.plan, l.id, look.lyricStyle, state.overrides?.lyricStyle);
        if (d.style !== "stack") return false;
        if (!section || l.start == null) return true;
        return l.start >= section.start - 0.05 && l.start < section.end;
      };
      const prepare = (i: number) => {
        const l = lines[i];
        if (!l) return null;
        const d = resolveLineDesign(project.plan, l.id, look.lyricStyle, state.overrides?.lyricStyle);
        return this.prepared(project, i, metrics, d.emphasis);
      };
      view = new StackView(key, spec, this.root, f.now, prepare, sameSection);
    } else {
      const line = this.prepared(project, index, metrics, emphasis);
      if (!line || line.rows.length === 0) return null;
      const startedAt = Number.isFinite(state.lineStartedAt) ? state.lineStartedAt : f.nowEpoch;
      if (style === "impact") view = new ImpactView(key, spec, this.root, f.now, line, startedAt);
      else {
        let next: PreparedLine | null = null;
        if (metrics.showNext && lines[index + 1]) {
          const nd = resolveLineDesign(project.plan, lines[index + 1].id, look.lyricStyle, state.overrides?.lyricStyle);
          if (nd.style === style) next = this.prepared(project, index + 1, metrics, nd.emphasis);
        }
        view = new LineView(key, spec, this.root, f.now, line, startedAt, next);
      }
    }
    view.setScrim(look.colorway[0]);
    return view;
  }

  destroy() {
    this.current?.destroy();
    for (const v of this.leaving) v.destroy();
    this.current = null;
    this.leaving = [];
    this.root.remove();
  }
}
