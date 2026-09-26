import { describe, expect, it } from "vitest";
import {
  clampView,
  followPlayhead,
  fullView,
  peaksForView,
  tickLabel,
  ticks,
  tickStep,
  timeToX,
  viewForZoom,
  xToTime,
  zoomAround,
} from "./timeline-geom";

describe("timeline geometry", () => {
  it("converts time <-> x", () => {
    const v = { start: 10, span: 20 };
    expect(timeToX(20, v, 200)).toBe(100);
    expect(xToTime(100, v, 200)).toBe(20);
    expect(xToTime(5, v, 0)).toBe(10);
  });

  it("clamps views into the song", () => {
    expect(clampView({ start: -5, span: 10 }, 60)).toEqual({ start: 0, span: 10 });
    expect(clampView({ start: 55, span: 10 }, 60)).toEqual({ start: 50, span: 10 });
    expect(clampView({ start: 0, span: 1 }, 60).span).toBe(4);
    expect(clampView({ start: 0, span: 500 }, 60)).toEqual({ start: 0, span: 60 });
    expect(fullView(0)).toEqual({ start: 0, span: 1 });
  });

  it("zooms around an anchor", () => {
    const v = zoomAround({ start: 0, span: 60 }, 2, 30, 60);
    expect(v).toEqual({ start: 15, span: 30 });
    expect(viewForZoom(4, 30, 60)).toEqual({ start: 22.5, span: 15 });
    expect(viewForZoom(1, 30, 60)).toEqual({ start: 0, span: 60 });
  });

  it("pages to follow the playhead", () => {
    const v = { start: 0, span: 10 };
    expect(followPlayhead(v, 5, 60)).toBe(v);
    expect(followPlayhead(v, 9, 60)).toEqual({ start: 7.5, span: 10 });
    expect(followPlayhead({ start: 0, span: 60 }, 59, 60)).toEqual({ start: 0, span: 60 });
  });

  it("picks readable ruler steps", () => {
    expect(tickStep({ start: 0, span: 60 }, 1200)).toBe(5);
    expect(tickStep({ start: 0, span: 240 }, 1200)).toBe(15);
    expect(ticks({ start: 3, span: 10 }, 5)).toEqual([5, 10]);
    expect(tickLabel(65, 5)).toBe("1:05");
    expect(tickLabel(65.5, 0.5)).toBe("1:05.5");
  });

  it("downsamples peaks per column", () => {
    const peaks = [0.1, 0.9, 0.2, 0.3];
    const cols = peaksForView(peaks, 4, { start: 0, span: 4 }, 2);
    expect(Array.from(cols).map((x) => Math.round(x * 10) / 10)).toEqual([0.9, 0.3]);
    expect(peaksForView([], 4, { start: 0, span: 4 }, 3)).toEqual(new Float32Array(3));
  });
});
