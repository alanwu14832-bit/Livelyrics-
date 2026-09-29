import { describe, expect, it } from "vitest";
import { prng } from "@/lib/audio/testing/signals";
import { CLOCK_LOCK_TIMEOUT_MS, MidiClock } from "./clock";

/** Tick timestamps at `bpm` from t0, each moved by up to ±jitter ms. */
function ticks(bpm: number, count: number, jitter = 0, t0 = 1000, seed = 5): number[] {
  const period = 60000 / (bpm * 24);
  const rand = prng(seed);
  return Array.from({ length: count }, (_, i) => t0 + i * period + (rand() * 2 - 1) * jitter);
}

describe("MIDI clock", () => {
  it("measures 128 BPM through ±2 ms of jitter", () => {
    const clock = new MidiClock();
    clock.start();
    const times = ticks(128, 200, 2);
    for (const t of times) clock.tick(t);
    const s = clock.status(times.at(-1)! + 1);
    expect(s.locked).toBe(true);
    expect(s.bpm).not.toBeNull();
    expect(Math.abs(s.bpm! - 128)).toBeLessThanOrEqual(0.3);
    expect(s.aligned).toBe(true);
  });

  it("keeps a steady readout under jitter (no flicker between readings)", () => {
    const clock = new MidiClock();
    const times = ticks(120, 400, 3, 0, 11);
    const readings = new Set<number>();
    times.forEach((t, i) => {
      clock.tick(t);
      if (i > 120) readings.add(clock.status(t).bpm!);
    });
    expect(readings.size).toBeLessThanOrEqual(3);
    for (const r of readings) expect(Math.abs(r - 120)).toBeLessThanOrEqual(0.4);
  });

  it("follows a tempo change within a few beats", () => {
    const clock = new MidiClock();
    const slow = ticks(100, 150, 1);
    for (const t of slow) clock.tick(t);
    const fast = ticks(140, 150, 1, slow.at(-1)! + 60000 / (140 * 24));
    for (const t of fast.slice(0, 72)) clock.tick(t); // three beats later
    expect(Math.abs(clock.status(fast[71]).bpm! - 140)).toBeLessThanOrEqual(0.5);
  });

  it("ignores a lost or doubled tick", () => {
    const clock = new MidiClock();
    const times = ticks(128, 150);
    times.splice(60, 1); // one tick lost
    times.splice(100, 0, times[100] + 0.5); // one doubled
    for (const t of times) clock.tick(t);
    expect(Math.abs(clock.status(times.at(-1)!).bpm! - 128)).toBeLessThanOrEqual(0.3);
  });

  it("gives the beat phase from Start (the first clock is the downbeat)", () => {
    const clock = new MidiClock();
    clock.start();
    const times = ticks(120, 55, 0); // 2 beats + 7 clocks
    for (const t of times.slice(0, 49)) clock.tick(t);
    // tick 48 is the start of beat 3
    expect(clock.status(times[48]).phase).toBeCloseTo(0, 6);
    const period = 60000 / (120 * 24);
    // between clocks the phase is interpolated (at most one clock ahead)
    expect(clock.status(times[48] + period / 2).phase).toBeCloseTo(0.5 / 24, 6);
    for (const t of times.slice(49)) clock.tick(t);
    expect(clock.status(times[54]).phase).toBeCloseTo(0.25, 6);
  });

  it("resumes from the song position pointer with Continue", () => {
    const clock = new MidiClock();
    clock.songPosition(3); // 3 sixteenths = 18 clocks: three quarters into a beat
    clock.continue();
    const times = ticks(120, 30, 0);
    for (const t of times.slice(0, 1)) clock.tick(t);
    clock.tick(times[1]);
    // position 19 → phase 19/24
    expect(clock.status(times[1]).phase).toBeCloseTo(19 / 24, 6);
  });

  it("stops the phase on Stop and loses the lock after 0.5 s without clocks", () => {
    const clock = new MidiClock();
    clock.start();
    const times = ticks(128, 60);
    for (const t of times) clock.tick(t);
    const last = times.at(-1)!;
    expect(clock.status(last + CLOCK_LOCK_TIMEOUT_MS - 10).locked).toBe(true);
    expect(clock.status(last + CLOCK_LOCK_TIMEOUT_MS + 10)).toMatchObject({ locked: false, phase: null, bpm: null });
    clock.stop();
    expect(clock.status(last + 5)).toMatchObject({ running: false, phase: null });
  });

  it("counts on without transport messages, flagged as not aligned", () => {
    const clock = new MidiClock();
    const times = ticks(90, 50);
    for (const t of times) clock.tick(t);
    const s = clock.status(times.at(-1)!);
    expect(s).toMatchObject({ locked: true, running: true, aligned: false });
    expect(s.phase).not.toBeNull();
  });
});
