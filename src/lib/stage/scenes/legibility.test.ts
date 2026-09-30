import { describe, expect, it } from "vitest";
import { DEFAULT_SAFETY, capGain } from "../safety";
import {
  LEGIBILITY_GLSL,
  LEGIBLE_MIN,
  LEGIBLE_TARGET,
  afterSafety,
  contrastRatio,
  legibleBackground,
  legibleInk,
  relativeLuminance,
  type PostSafety,
  type Rgb,
} from "./legibility";
import { TYPE_FRAGMENT } from "./type";

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// inks the voices and palettes use, plus the awkward ones (mid-greys, a mid pink, saturated primaries, dark ink)
const INKS = ["#ffffff", "#f4efe6", "#ffe9a8", "#9ff3ff", "#ff3a6e", "#35e0d0", "#c8402f", "#767676", "#8a8a8a", "#5e5e5e", "#111111", "#2b2233", "#0033cc", "#00ff00"].map(hex);
// the pictures a scene program can put behind them: full-bleed stripes, white, saturated fills
const STEPS = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
const BGS: Rgb[] = [];
for (const r of STEPS) for (const g of STEPS) for (const b of STEPS) BGS.push([r, g, b]);

/** The worst output contrast over every ink × picture, after the safety pass `post`. */
function worstOver(post: PostSafety): number {
  let worst = Infinity;
  for (const raw of INKS) {
    const ink = legibleInk(raw, post);
    const inkOut = afterSafety(ink, post);
    for (const bg of BGS) worst = Math.min(worst, contrastRatio(inkOut, afterSafety(legibleBackground(bg, ink, LEGIBLE_TARGET, post), post)));
  }
  return worst;
}

describe("legibility guarantee (mirror of the type pass)", () => {
  it("meets the contrast minimum for every ink over every picture (no safety pass)", () => {
    const worst = worstOver({ soften: 0, gain: 1 });
    expect(worst).toBeGreaterThanOrEqual(LEGIBLE_TARGET - 0.01);
    expect(worst).toBeGreaterThan(LEGIBLE_MIN);
  });

  it("aims at the contrast after the LED safety pass (the default, a softer and a dimmer wall)", () => {
    const def: PostSafety = { soften: DEFAULT_SAFETY.soften, gain: capGain(DEFAULT_SAFETY.brightness) };
    for (const post of [def, { soften: 0.6, gain: capGain(0.7) }, { soften: 0.25, gain: capGain(0.5) }]) {
      expect(worstOver(post), JSON.stringify(post)).toBeGreaterThan(LEGIBLE_MIN);
    }
  });

  it("leaves a picture that already reads untouched", () => {
    const white = hex("#ffffff");
    const dark: Rgb = [0.05, 0.03, 0.08];
    expect(legibleBackground(dark, white).every((v, i) => Math.abs(v - dark[i]) < 1e-6)).toBe(true);
    for (const v of legibleBackground([1, 1, 1], hex("#111111"))) expect(v).toBeCloseTo(1, 6);
  });

  it("darkens behind light ink and lifts behind dark ink", () => {
    const stripe = hex("#35e0d0");
    expect(relativeLuminance(legibleBackground(stripe, [1, 1, 1]))).toBeLessThan(relativeLuminance(stripe));
    expect(relativeLuminance(legibleBackground([0.1, 0.1, 0.1], hex("#111111")))).toBeGreaterThan(relativeLuminance([0.1, 0.1, 0.1]));
  });

  it("lifts only the inks no background could make legible", () => {
    expect(legibleInk([1, 1, 1])).toEqual([1, 1, 1]);
    expect(legibleInk(hex("#111111"))).toEqual(hex("#111111"));
    const grey = hex("#767676");
    expect(relativeLuminance(legibleInk(grey))).toBeGreaterThan(relativeLuminance(grey));
  });

  it("is what the type pass runs", () => {
    expect(TYPE_FRAGMENT).toContain(LEGIBILITY_GLSL.trim().slice(0, 60));
    expect(TYPE_FRAGMENT).toContain("legibleBg(col, inkC, uSoften, uGain)");
    expect(TYPE_FRAGMENT).toContain("inkC = legibleInk(inkC, uSoften, uGain)");
    expect(LEGIBILITY_GLSL).toContain(String(LEGIBLE_TARGET));
  });
});
