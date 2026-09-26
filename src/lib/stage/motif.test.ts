import { describe, expect, it } from "vitest";
import { hashString, prepareMotifSvg, svgToDataUrl } from "./motif";

describe("prepareMotifSvg", () => {
  it("adds xmlns and size, replaces currentColor", () => {
    const out = prepareMotifSvg('<svg viewBox="0 0 100 100" width="10"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>', "#ffffff", 256)!;
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="256" height="256"');
    expect(out).not.toContain('width="10"');
    expect(out).not.toMatch(/currentColor/i);
    expect(out).toContain('fill="#ffffff"');
  });

  it("adds a default viewBox and strips the xml declaration", () => {
    const out = prepareMotifSvg('<?xml version="1.0"?>\n<svg><rect width="10" height="10" fill="currentcolor"/></svg>')!;
    expect(out.startsWith("<svg")).toBe(true);
    expect(out).toContain('viewBox="0 0 100 100"');
    // child attributes are untouched
    expect(out).toContain('<rect width="10" height="10"');
  });

  it("rejects non-SVG input", () => {
    expect(prepareMotifSvg("")).toBeNull();
    expect(prepareMotifSvg("<div></div>")).toBeNull();
    expect(prepareMotifSvg("<svg><circle/>")).toBeNull();
    expect(prepareMotifSvg(undefined)).toBeNull();
  });

  it("encodes a data URL and hashes deterministically", () => {
    expect(svgToDataUrl("<svg/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
