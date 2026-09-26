// End-to-end check on the repository's synthetic demo song:
// 120 BPM, intro 0-8 s, verse 8-24, chorus 24-40, breakdown 40-48, chorus 48-64, outro 64-73.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSamples } from "./analysis";
import { readWav } from "./testing/signals";

const wav = readWav(readFileSync(path.join(__dirname, "../../../fixtures/demo-song.wav")));
const a = analyzeSamples(wav.samples, wav.sampleRate);

describe("fixtures/demo-song.wav", () => {
  it("reads the fixture", () => {
    expect(wav.sampleRate).toBe(22050);
    expect(a.duration).toBeGreaterThan(72);
    expect(a.duration).toBeLessThan(74);
  });

  it("finds 120 BPM with high confidence and beats on the 0.5 s grid", () => {
    expect(Math.abs(a.bpm - 120)).toBeLessThanOrEqual(1);
    expect(a.bpmConfidence).toBeGreaterThan(0.7);
    const onGrid = a.beats.filter((b) => Math.abs(b / 0.5 - Math.round(b / 0.5)) * 0.5 <= 0.05);
    expect(onGrid.length / a.beats.length).toBeGreaterThan(0.95);
    // one beat per grid slot over the whole song
    expect(a.beats.length).toBeGreaterThanOrEqual(140);
    expect(a.beats.length).toBeLessThanOrEqual(147);
  });

  it("finds the section boundaries 8 / 24 / 40 / 48 / 64 s", () => {
    const starts = a.sections.slice(1).map((s) => s.start);
    expect(starts).toHaveLength(5);
    [8, 24, 40, 48, 64].forEach((t, i) => expect(Math.abs(starts[i] - t)).toBeLessThan(1));
  });

  it("orders section energies like the arrangement", () => {
    const [intro, verse, chorus1, breakdown, chorus2, outro] = a.sections.map((s) => s.energy);
    expect(chorus1).toBeGreaterThan(verse);
    expect(chorus2).toBeGreaterThan(verse);
    expect(verse).toBeGreaterThan(breakdown);
    expect(breakdown).toBeGreaterThan(intro);
    expect(verse).toBeGreaterThan(outro);
  });

  it("produces an energy envelope that follows the arrangement", () => {
    const at = (t: number) => a.energy[Math.round(t * a.envelopeRate)];
    expect(at(32)).toBeGreaterThan(at(16));
    expect(at(16)).toBeGreaterThan(at(44));
    expect(at(44)).toBeGreaterThan(at(4));
    expect(at(4)).toBeGreaterThan(0);
  });
});
