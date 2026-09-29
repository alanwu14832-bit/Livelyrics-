// The AudioWorklet around the LTC decoder (phase 5a, 時間碼模式). It runs LtcDecoder on the first
// two input channels in the audio thread (LTC often sits on one channel of an interface: the
// channel that decodes wins, and the other takes over when it stays silent) and posts to the main
// thread the decoded frames with their sample positions, plus the input peak ten times a second.
//
// Never imported by the app. scripts/build-worklets.mjs compiles this file and ltc.ts into the
// static public/worklets/ltc-decoder.js (Next serves the public folder at the site root), which
// ltc-input.ts loads with audioWorklet.addModule("/worklets/ltc-decoder.js"). A unit test checks the
// generated file is up to date and runs it on encoded LTC.

import { LtcDecoder, type LtcFrame } from "./ltc";

declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** Posted to the main thread. `frame` is the context sample index at the end of the block. */
export type LtcWorkletMessage =
  | { type: "frames"; channel: number; frames: LtcFrame[]; frame: number; sampleRate: number }
  | { type: "level"; peak: number; frame: number; sampleRate: number };

class LtcProcessor extends AudioWorkletProcessor {
  private readonly decoders: LtcDecoder[] = [];
  private readonly lastFrameAt: number[] = [];
  private active = -1;
  private peak = 0;
  private levelAt = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const now = currentFrame;
    const channels = input ? Math.min(2, input.length) : 0;
    for (let c = 0; c < channels; c++) {
      const data = input[c];
      if (!data || data.length === 0) continue;
      for (let i = 0; i < data.length; i++) {
        const a = data[i] < 0 ? -data[i] : data[i];
        if (a > this.peak) this.peak = a;
      }
      let decoder = this.decoders[c];
      if (!decoder) {
        decoder = new LtcDecoder(sampleRate);
        this.decoders[c] = decoder;
      }
      const frames = decoder.process(data, now);
      if (frames.length === 0) continue;
      this.lastFrameAt[c] = now;
      const quiet = this.active < 0 || now - (this.lastFrameAt[this.active] ?? -Infinity) > sampleRate / 2;
      if (quiet) this.active = c;
      if (this.active === c) this.port.postMessage({ type: "frames", channel: c, frames, frame: now + data.length, sampleRate } satisfies LtcWorkletMessage);
    }
    if (now - this.levelAt >= sampleRate / 10) {
      this.levelAt = now;
      this.port.postMessage({ type: "level", peak: this.peak, frame: now, sampleRate } satisfies LtcWorkletMessage);
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor("livelyrics-ltc", LtcProcessor);
