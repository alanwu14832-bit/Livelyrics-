"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { drawWaveform, fitCanvas } from "./waveform";

/** Static mini waveform (analysis.peaks) with optional section boundaries. */
export function Waveform({
  peaks,
  duration,
  boundaries = [],
  color = "#8d93a3",
  accent = "#ff5a36",
  className,
  label = "音訊波形",
}: {
  peaks: readonly number[];
  duration: number;
  /** seconds, e.g. detected section starts */
  boundaries?: readonly number[];
  color?: string;
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
      const { width, height, dpr } = fitCanvas(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawWaveform(ctx, peaks, { x: 0, y: 0, width, height, color, bar: 2, gap: 1 });
      if (duration > 0) {
        ctx.fillStyle = accent;
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
    return () => ro.disconnect();
  }, [peaks, duration, boundaries, color, accent]);

  return <canvas ref={ref} role="img" aria-label={label} className={cx("block h-14 w-full", className)} />;
}
