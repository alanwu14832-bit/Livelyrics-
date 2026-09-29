// The static AudioWorklet module (public/worklets/ltc-decoder.js) is generated from ltc.ts and
// ltc-worklet.ts: it must be up to date, and it must work when evaluated the way an AudioWorklet
// evaluates it (a script with AudioWorkletProcessor, registerProcessor, sampleRate and currentFrame
// as globals, called with 128-sample render quanta).

import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildLtcWorklet, WORKLET_OUT } from "../../../scripts/build-worklets.mjs";
import type { LtcWorkletMessage } from "./ltc-worklet";
import { encodeLtc } from "./testing/ltc-encoder";
import { formatTc } from "./timecode";

interface Processor {
  process(inputs: Float32Array[][]): boolean;
}

function loadWorklet(sampleRate: number) {
  const messages: LtcWorkletMessage[] = [];
  const registered: Record<string, new () => Processor> = {};
  const sandbox: Record<string, unknown> = {
    sampleRate,
    currentFrame: 0,
    registerProcessor: (name: string, cls: new () => Processor) => {
      registered[name] = cls;
    },
    AudioWorkletProcessor: class {
      port = { postMessage: (m: LtcWorkletMessage) => messages.push(m) };
    },
    Math,
    Uint8Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(WORKLET_OUT, "utf8"), sandbox);
  const Cls = registered["livelyrics-ltc"];
  expect(Cls).toBeTypeOf("function");
  const node = new Cls();
  /** feed channel blocks as the audio thread does */
  const run = (channels: Float32Array[]) => {
    const length = channels[0].length;
    for (let i = 0; i < length; i += 128) {
      sandbox.currentFrame = i;
      node.process([channels.map((c) => c.subarray(i, Math.min(length, i + 128)))]);
    }
  };
  return { messages, run };
}

describe("LTC AudioWorklet module", () => {
  it("is generated from the TypeScript sources (run node scripts/build-worklets.mjs)", () => {
    expect(fs.readFileSync(WORKLET_OUT, "utf8")).toBe(buildLtcWorklet());
  });

  it("decodes in the worklet and posts frames with their sample positions", () => {
    const enc = encodeLtc({ sampleRate: 48000, rate: 25, start: { hours: 1, minutes: 0, seconds: 10, frames: 0 }, frames: 50 });
    const { messages, run } = loadWorklet(48000);
    run([enc.samples]);
    const frames = messages.filter((m): m is Extract<LtcWorkletMessage, { type: "frames" }> => m.type === "frames").flatMap((m) => m.frames.map((f) => ({ f, m })));
    expect(frames.length).toBeGreaterThanOrEqual(48);
    expect(formatTc(frames[0].f)).toBe("01:00:10:00");
    for (const { f, m } of frames) {
      expect(m.sampleRate).toBe(48000);
      expect(f.end).toBeLessThanOrEqual(m.frame);
      expect(f.end).toBeGreaterThan(m.frame - 128 - 1);
    }
    expect(messages.some((m) => m.type === "level" && m.peak > 0.4)).toBe(true);
  });

  it("finds LTC on the second channel of a stereo input", () => {
    const enc = encodeLtc({ sampleRate: 44100, rate: 30, start: { hours: 2, minutes: 0, seconds: 0, frames: 0 }, frames: 40 });
    const music = Float32Array.from(enc.samples, (_, i) => Math.sin(i * 0.05) * 0.3);
    const { messages, run } = loadWorklet(44100);
    run([music, enc.samples]);
    const posts = messages.filter((m): m is Extract<LtcWorkletMessage, { type: "frames" }> => m.type === "frames");
    expect(posts.length).toBeGreaterThan(30);
    expect(posts.every((m) => m.channel === 1)).toBe(true);
  });
});
