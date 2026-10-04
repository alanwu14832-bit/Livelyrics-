// Browser-only: WebCodecs capability checks and one mediabunny muxer per exported clip.
// H.264 (MP4) is preferred for festival media servers; the level is chosen from the frame size
// and macroblock rate (4K needs 5.1 / 5.2) and confirmed with VideoEncoder.isConfigSupported,
// falling back to higher levels, Main profile, then VP9 (WebM) with a note for the operator.
// Clips stream to disk through a FileSystemWritableFileStream when the page got a folder, else
// they are kept in memory and offered as downloads.

import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat, canEncodeAudio } from "mediabunny";
import { type FrameRate, frameOffset } from "./frames";
import { avcCandidates, vp9Candidate, type CodecCandidate, type VideoCodecChoice } from "./settings";

export interface VideoPlan {
  codec: VideoCodecChoice;
  codecString: string;
  /** "H.264 High 4.2" */
  label: string;
  container: "mp4" | "webm";
  alpha: boolean;
  bitrate: number;
  /** set when the preferred codec was not available */
  fallback: string | null;
}

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

async function supported(c: CodecCandidate, width: number, height: number, fps: number, bitrate: number, alpha: boolean): Promise<boolean> {
  try {
    const cfg: VideoEncoderConfig = { codec: c.codecString, width, height, bitrate, framerate: fps, latencyMode: "quality" };
    if (alpha) cfg.alpha = "keep";
    const r = await VideoEncoder.isConfigSupported(cfg);
    return !!r.supported;
  } catch {
    return false;
  }
}

/**
 * The codec to use for a clip, or null when nothing can encode it here. `alpha` asks for a
 * transparent clip (VP9 in WebM only).
 */
export async function planVideoCodec(pref: VideoCodecChoice, width: number, height: number, fps: number, bitrateFor: (codec: VideoCodecChoice) => number, alpha = false): Promise<VideoPlan | null> {
  if (!webCodecsAvailable()) return null;
  const vp9 = vp9Candidate(width, height, fps);
  const make = (c: CodecCandidate, fallback: string | null): VideoPlan => ({
    codec: c.codec,
    codecString: c.codecString,
    label: c.label,
    container: c.codec === "avc" ? "mp4" : "webm",
    alpha,
    bitrate: bitrateFor(c.codec),
    fallback,
  });
  if (alpha) return (await supported(vp9, width, height, fps, bitrateFor("vp9"), true)) ? make(vp9, null) : null;
  const tryAvc = async () => {
    for (const c of avcCandidates(width, height, fps, bitrateFor("avc"))) if (await supported(c, width, height, fps, bitrateFor("avc"), false)) return c;
    return null;
  };
  if (pref === "avc") {
    const avc = await tryAvc();
    if (avc) return make(avc, null);
    if (await supported(vp9, width, height, fps, bitrateFor("vp9"), false)) return make(vp9, `這個瀏覽器做不出這個尺寸（${width} × ${height}）的 MP4，改存成 WebM 影片（VP9 編碼）；大部分媒體伺服器都能播。一定要 MP4 時，請改用 Chrome 或 Edge 正式版。`);
    return null;
  }
  if (await supported(vp9, width, height, fps, bitrateFor("vp9"), false)) return make(vp9, null);
  const avc = await tryAvc();
  return avc ? make(avc, `這個瀏覽器做不出這個尺寸（${width} × ${height}）的 WebM，改存成 MP4 影片（H.264 編碼）。`) : null;
}

/** Whether the transparent (VP9 alpha) lyric layer can be encoded at this size. */
export async function alphaSupported(width: number, height: number, fps: number, bitrate: number): Promise<boolean> {
  if (!webCodecsAvailable()) return false;
  return supported(vp9Candidate(width, height, fps), width, height, fps, bitrate, true);
}

export type AudioCodecChoice = "aac" | "opus";

/** AAC in MP4 when the browser can encode it, else Opus (MP4 or WebM); null = no audio encoder. */
export async function planAudioCodec(container: "mp4" | "webm"): Promise<AudioCodecChoice | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const opts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 192_000 }) };
  if (container === "mp4") {
    try {
      if (await canEncodeAudio("aac", opts)) return "aac";
    } catch {
      /* try opus */
    }
  }
  try {
    if (await canEncodeAudio("opus", opts)) return "opus";
  } catch {
    /* none */
  }
  return null;
}

export type ClipSink = { kind: "stream"; writable: FileSystemWritableFileStream } | { kind: "buffer" };

export interface ClipOptions {
  width: number;
  height: number;
  rate: FrameRate;
  plan: VideoPlan;
  audio: AudioCodecChoice | null;
  sink: ClipSink;
  /** seconds between key frames (media servers scrub better with short GOPs) */
  keyFrameInterval?: number;
  title?: string;
}

/** One output file: a canvas the caller composes each frame into, encoded and muxed by mediabunny. */
export class ClipWriter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private output: Output;
  private video: CanvasSource;
  private audioSource: AudioBufferSource | null = null;
  private target: BufferTarget | StreamTarget;
  private started = false;
  private done = false;
  private packets = 0;

  constructor(private readonly o: ClipOptions) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = o.width;
    this.canvas.height = o.height;
    const ctx = this.canvas.getContext("2d", { alpha: o.plan.alpha, willReadFrequently: false });
    if (!ctx) throw new Error("無法建立畫布");
    this.ctx = ctx;
    const sink = o.sink;
    const stream = sink.kind === "stream";
    this.target = sink.kind === "stream" ? new StreamTarget(sink.writable as unknown as WritableStream, { chunked: true }) : new BufferTarget();
    const format = o.plan.container === "mp4" ? new Mp4OutputFormat({ fastStart: stream ? false : "in-memory" }) : new WebMOutputFormat();
    this.output = new Output({ format, target: this.target });
    this.video = new CanvasSource(this.canvas, {
      codec: o.plan.codec,
      fullCodecString: o.plan.codecString,
      quality: new Quality({ bitrate: o.plan.bitrate }),
      keyFrameInterval: o.keyFrameInterval ?? 1,
      latencyMode: "quality",
      alpha: o.plan.alpha ? "keep" : "discard",
      onEncodedPacket: () => {
        this.packets++;
      },
    });
    this.output.addVideoTrack(this.video, { frameRate: o.rate.num / o.rate.den, canBeTransparent: o.plan.alpha });
    if (o.audio) {
      this.audioSource = new AudioBufferSource({ codec: o.audio, quality: new Quality({ bitrate: 192_000 }) });
      this.output.addAudioTrack(this.audioSource);
    }
    if (o.title) this.output.setMetadataTags({ title: o.title, comment: "Livelyrics" });
  }

  get encodedPackets(): number {
    return this.packets;
  }

  async start() {
    await this.output.start();
    this.started = true;
  }

  /** Encode the canvas as frame i (timestamps are exact multiples of den / num seconds). */
  async addFrame(i: number) {
    const ts = frameOffset(i, this.o.rate);
    const dur = frameOffset(i + 1, this.o.rate) - ts;
    await this.video.add(ts, dur);
  }

  /** Append the next piece of audio (placed right after the previous one). */
  async addAudio(buffer: AudioBuffer) {
    if (this.audioSource) await this.audioSource.add(buffer);
  }

  /** Finish the file. Buffer sinks resolve with the file as a Blob, stream sinks with null. */
  async finish(): Promise<Blob | null> {
    if (this.done) return null;
    this.done = true;
    await this.output.finalize();
    if (this.target instanceof BufferTarget && this.target.buffer) return new Blob([this.target.buffer], { type: this.o.plan.container === "mp4" ? "video/mp4" : "video/webm" });
    return null;
  }

  async cancel() {
    if (this.done) return;
    this.done = true;
    try {
      if (this.started) await this.output.cancel();
    } catch {
      /* already closed */
    }
  }
}

/** Decode the song audio for [start, end) at 48 kHz (the first sample sits at the first frame). */
export async function decodeSongAudio(url: string, start: number, end: number): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const full = await ctx.decodeAudioData(data);
    const sr = full.sampleRate;
    const from = Math.max(0, Math.round(start * sr));
    const to = Math.min(full.length, Math.round(end * sr));
    const length = Math.max(1, to - from);
    const out = new AudioBuffer({ length, numberOfChannels: Math.min(2, full.numberOfChannels) || 1, sampleRate: sr });
    for (let c = 0; c < out.numberOfChannels; c++) out.copyToChannel(full.getChannelData(c).subarray(from, from + length), c);
    return out;
  } catch {
    return null;
  }
}

/** A [from, to) sample slice of an AudioBuffer. */
export function sliceAudio(buffer: AudioBuffer, from: number, to: number): AudioBuffer | null {
  const a = Math.max(0, Math.min(buffer.length, from));
  const b = Math.max(a, Math.min(buffer.length, to));
  if (b <= a) return null;
  const out = new AudioBuffer({ length: b - a, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(a, b), c);
  return out;
}
