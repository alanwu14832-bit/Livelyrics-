"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { readTokens, subscribeAppearance } from "@/lib/ui/canvas-tokens";
import { drawWaveform, fitCanvas } from "./waveform";

/**
 * Static mini waveform (analysis.peaks) with optional section boundaries. Colours default to
 * the design tokens of the surrounding theme (bars --label-2, boundaries --tint).
 */
export function Waveform({
  peaks,
  duration,
  boundaries = [],
  color,
  accent,
  className,
  label = "音訊波形",
}: {
  peaks: readonly number[];
  duration: number;
  /** seconds, e.g. detected section starts */
  boundaries?: readonly number[];
  /** any canvas colour; defaults to the --label-2 token */
  color?: string;
  /** boundary colour; defaults to the --tint token */
  accent?: string;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const tokens = readTokens(canvas, { bar: ["--label-2", "#6e6e73"], mark: ["--tint", "#0071e3"] });
      const { width, height, dpr } = fitCanvas(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawWaveform(ctx, peaks, { x: 0, y: 0, width, height, color: color ?? tokens.bar, bar: 2, gap: 1 });
      if (duration > 0) {
        ctx.fillStyle = accent ?? tokens.mark;
        for (const b of boundaries) {
          if (!(b > 0 && b < duration)) continue;
          const x = Math.round((b / duration) * width);
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x, 0, 1, height);
          ctx.globalAlpha = 1;
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    const unsub = subscribeAppearance(draw);
    return () => {
      ro.disconnect();
      unsub();
    };
  }, [peaks, duration, boundaries, color, accent]);

  return <canvas ref={ref} role="img" aria-label={label} className={cx("block h-14 w-full", className)} />;
}
