// Static DOM for the safe-area guides and the projector test pattern.
// Built once per StageView; only visibility and the size label change.

import { aspectLabel, safeRectPercent } from "@/lib/output";
import { ACTION_SAFE, type PlacementBox } from "@/lib/stage/lyrics/layout";
import type { LyricSafeArea } from "@/lib/types";

function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const d = document.createElement("div");
  Object.assign(d.style, style);
  if (text) d.textContent = text;
  return d;
}

const inset = (fraction: number) => `${((1 - fraction) / 2) * 100}%`;

export interface GuidesHandle {
  root: HTMLDivElement;
  setPlacement(box: PlacementBox | null): void;
  /** the lyric safe area and the canvas size (px) it is drawn for */
  setCanvas(safe: LyricSafeArea, width: number, height: number): void;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function buildGuides(): GuidesHandle {
  const root = div({ position: "absolute", inset: "0", pointerEvents: "none", display: "none", fontFamily: "var(--font-sans, sans-serif)" });
  root.setAttribute("aria-hidden", "true");

  const action = div({
    position: "absolute",
    inset: inset(ACTION_SAFE),
    border: "1px dashed rgba(255,255,255,0.35)",
  });
  const title = div({
    position: "absolute",
    inset: "5%",
    border: "1px solid rgba(255,196,72,0.7)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
  });
  const label = div(
    {
      position: "absolute",
      left: "0.6cqh",
      top: "0.4cqh",
      fontSize: "max(9px, 2.1cqh)",
      color: "rgba(255,196,72,0.9)",
      textShadow: "0 1px 2px rgba(0,0,0,0.8)",
      letterSpacing: "0.04em",
    },
    "歌詞安全區",
  );
  title.append(label);
  const sizeLabel = div(
    {
      position: "absolute",
      right: "0.6cqh",
      top: "0.4cqh",
      fontSize: "max(9px, 2.1cqh)",
      color: "rgba(255,255,255,0.85)",
      textShadow: "0 1px 2px rgba(0,0,0,0.8)",
      fontVariantNumeric: "tabular-nums",
    },
    "",
  );
  const cross = div({ position: "absolute", left: "50%", top: "50%", width: "4cqh", height: "4cqh", transform: "translate(-50%, -50%)" });
  cross.append(
    div({ position: "absolute", left: "0", right: "0", top: "50%", height: "1px", background: "rgba(255,255,255,0.45)" }),
    div({ position: "absolute", top: "0", bottom: "0", left: "50%", width: "1px", background: "rgba(255,255,255,0.45)" }),
  );
  const thirds = div({
    position: "absolute",
    inset: "0",
    backgroundImage:
      "linear-gradient(to right, transparent calc(33.333% - 0.5px), rgba(255,255,255,0.12) calc(33.333% - 0.5px), rgba(255,255,255,0.12) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255,255,255,0.12) calc(66.666% - 0.5px), rgba(255,255,255,0.12) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px)), linear-gradient(to bottom, transparent calc(33.333% - 0.5px), rgba(255,255,255,0.12) calc(33.333% - 0.5px), rgba(255,255,255,0.12) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px), transparent calc(66.666% - 0.5px), rgba(255,255,255,0.12) calc(66.666% - 0.5px), rgba(255,255,255,0.12) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px))",
  });
  const lyricBox = div({ position: "absolute", border: "1px dotted rgba(120,200,255,0.75)", display: "none" });
  const lyricLabel = div(
    { position: "absolute", right: "0.5cqh", bottom: "0.3cqh", fontSize: "max(9px, 1.9cqh)", color: "rgba(120,200,255,0.95)", textShadow: "0 1px 2px rgba(0,0,0,0.8)" },
    "歌詞區",
  );
  lyricBox.append(lyricLabel);
  root.append(thirds, action, title, cross, lyricBox, sizeLabel);

  let lastKey = "";
  let canvasKey = "";
  return {
    root,
    setCanvas(safe, width, height) {
      const key = `${safe.top},${safe.right},${safe.bottom},${safe.left},${width},${height}`;
      if (key === canvasKey) return;
      canvasKey = key;
      const r = safeRectPercent(safe);
      Object.assign(title.style, { inset: "auto", left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` });
      const same = safe.top === safe.right && safe.top === safe.bottom && safe.top === safe.left;
      label.textContent = same ? `歌詞安全區 內縮 ${pct(safe.top)}` : `歌詞安全區 上 ${pct(safe.top)} 右 ${pct(safe.right)} 下 ${pct(safe.bottom)} 左 ${pct(safe.left)}`;
      sizeLabel.textContent = `${width} × ${height} px（${aspectLabel(width, height)}）`;
    },
    setPlacement(box) {
      const key = box ? `${box.left},${box.top},${box.width},${box.height}` : "";
      if (key === lastKey) return;
      lastKey = key;
      if (!box) {
        lyricBox.style.display = "none";
        return;
      }
      Object.assign(lyricBox.style, {
        display: "block",
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      });
    },
  };
}

export interface TestPatternHandle {
  root: HTMLDivElement;
  setSize(width: number, height: number): void;
}

const BARS = ["#ffffff", "#ffff00", "#00ffff", "#00ff00", "#ff00ff", "#ff0000", "#0000ff", "#000000"];

export function buildTestPattern(): TestPatternHandle {
  const root = div({
    position: "absolute",
    inset: "0",
    display: "none",
    pointerEvents: "none",
    background: "#161616",
    backgroundImage:
      "linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)",
    backgroundSize: "5% 5%",
    backgroundPosition: "-0.5px -0.5px",
    fontFamily: "var(--font-sans, sans-serif)",
    color: "#fff",
    overflow: "hidden",
  });
  root.setAttribute("aria-hidden", "true");

  const circle = div({
    position: "absolute",
    left: "50%",
    top: "50%",
    height: "min(80cqh, 80cqw)",
    aspectRatio: "1 / 1",
    transform: "translate(-50%, -50%)",
    border: "0.35cqh solid rgba(255,255,255,0.85)",
    borderRadius: "50%",
  });
  const bars = div({ position: "absolute", left: "20%", right: "20%", top: "24%", height: "18%", display: "flex" });
  for (const c of BARS) bars.append(div({ flex: "1", background: c }));
  const ramp = div({ position: "absolute", left: "20%", right: "20%", top: "62%", height: "10%", display: "flex" });
  for (let i = 0; i <= 10; i++) {
    const v = Math.round((i / 10) * 255);
    ramp.append(div({ flex: "1", background: `rgb(${v},${v},${v})` }));
  }
  const text = div({
    position: "absolute",
    left: "0",
    right: "0",
    top: "45%",
    height: "14%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.8cqh",
    textShadow: "0 0 0.6cqh #000",
  });
  const title = div({ fontSize: "4.2cqh", fontWeight: "700", letterSpacing: "0.08em" }, "Livelyrics 投影測試畫面");
  const size = div({ fontSize: "3cqh", fontFamily: "var(--font-mono, monospace)", opacity: "0.9" }, "");
  text.append(title, size);
  const corners = [
    { left: "0", top: "0", borderLeft: "0.6cqh solid #fff", borderTop: "0.6cqh solid #fff" },
    { right: "0", top: "0", borderRight: "0.6cqh solid #fff", borderTop: "0.6cqh solid #fff" },
    { left: "0", bottom: "0", borderLeft: "0.6cqh solid #fff", borderBottom: "0.6cqh solid #fff" },
    { right: "0", bottom: "0", borderRight: "0.6cqh solid #fff", borderBottom: "0.6cqh solid #fff" },
  ].map((s) => div({ position: "absolute", width: "6cqh", height: "6cqh", ...s }));
  root.append(circle, bars, ramp, text, ...corners);

  return {
    root,
    setSize(width, height) {
      size.textContent = `${width} × ${height} px（${aspectLabel(width, height)}）`;
    },
  };
}
