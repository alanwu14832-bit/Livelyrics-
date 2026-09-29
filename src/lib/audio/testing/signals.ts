// Deterministic synthetic signals + a tiny WAV reader for the audio unit tests.
// Not imported by application code.

/** mulberry32 PRNG: deterministic noise for reproducible tests */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClickOptions {
  /** seconds before the first click */
  offset?: number;
  amplitude?: number;
  /** click length in seconds */
  length?: number;
  seed?: number;
}

/** Decaying noise-burst clicks on every beat. */
export function clickTrack(bpm: number, duration: number, sampleRate: number, opts: ClickOptions = {}): { samples: Float32Array; clicks: number[] } {
  const { offset = 0.25, amplitude = 0.8, length = 0.03, seed = 1 } = opts;
  const n = Math.round(duration * sampleRate);
  const samples = new Float32Array(n);
  const rand = prng(seed);
  const clicks: number[] = [];
  const period = 60 / bpm;
  for (let t = offset; t < duration - length; t += period) {
    clicks.push(t);
    const i0 = Math.round(t * sampleRate);
    const len = Math.round(length * sampleRate);
    for (let k = 0; k < len && i0 + k < n; k++) {
      samples[i0 + k] += (rand() * 2 - 1) * amplitude * Math.exp((-k / sampleRate) * 120);
    }
  }
  return { samples, clicks };
}

export function whiteNoise(duration: number, sampleRate: number, amplitude = 0.3, seed = 3): Float32Array {
  const n = Math.round(duration * sampleRate);
  const out = new Float32Array(n);
  const rand = prng(seed);
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * amplitude;
  return out;
}

export interface SectionSpec {
  seconds: number;
  /** linear gain of the section */
  gain: number;
  /** add a kick+hat groove */
  drums: boolean;
}

/**
 * A simple "song": sustained chord pad under optional drums, with per-section gain, at `bpm`.
 * Returns samples and the true section boundaries (seconds).
 */
export function sectionedSong(bpm: number, sections: SectionSpec[], sampleRate: number, seed = 5): { samples: Float32Array; boundaries: number[] } {
  const total = sections.reduce((s, x) => s + x.seconds, 0);
  const n = Math.round(total * sampleRate);
  const out = new Float32Array(n);
  const rand = prng(seed);
  const beat = 60 / bpm;
  const boundaries: number[] = [];
  let t0 = 0;
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    if (si > 0) boundaries.push(t0);
    const i0 = Math.round(t0 * sampleRate);
    const i1 = Math.min(n, Math.round((t0 + s.seconds) * sampleRate));
    for (let i = i0; i < i1; i++) {
      const t = i / sampleRate;
      const pad = Math.sin(2 * Math.PI * 220 * t) + 0.7 * Math.sin(2 * Math.PI * 277.18 * t) + 0.6 * Math.sin(2 * Math.PI * 329.63 * t);
      out[i] += 0.08 * pad * s.gain;
    }
    if (s.drums) {
      for (let bt = t0; bt < t0 + s.seconds - 1e-6; bt += beat) {
        const k0 = Math.round(bt * sampleRate);
        const kickLen = Math.round(0.15 * sampleRate);
        for (let k = 0; k < kickLen && k0 + k < n; k++) {
          const tt = k / sampleRate;
          const f = 50 + 100 * Math.exp(-tt * 30);
          out[k0 + k] += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 20) * 0.7 * s.gain;
        }
        const h0 = Math.round((bt + beat / 2) * sampleRate);
        const hatLen = Math.round(0.04 * sampleRate);
        for (let k = 0; k < hatLen && h0 + k < n; k++) out[h0 + k] += (rand() * 2 - 1) * Math.exp((-k / sampleRate) * 90) * 0.2 * s.gain;
      }
    }
    t0 += s.seconds;
  }
  return { samples: out, boundaries };
}

/** Minimal RIFF/WAVE reader: PCM 8/16/24/32-bit or IEEE float 32, any channel count → mono. */
export function readWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      if (!channels || !sampleRate) throw new Error("data chunk before fmt chunk");
      const bytesPer = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bytesPer * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytesPer;
          let v: number;
          if (format === 3 && bits === 32) v = view.getFloat32(p, true);
          else if (bits === 16) v = view.getInt16(p, true) / 32768;
          else if (bits === 8) v = (view.getUint8(p) - 128) / 128;
          else if (bits === 24) v = ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) as number) / 8388608;
          else if (bits === 32) v = view.getInt32(p, true) / 2147483648;
          else throw new Error(`unsupported WAV bit depth ${bits}`);
          sum += v;
        }
        out[i] = sum / channels;
      }
      return { samples: out, sampleRate };
    }
    offset = body + size + (size & 1);
  }
  throw new Error("no data chunk");
}

/** 16-bit PCM WAV bytes; `info` adds a LIST/INFO chunk (e.g. { INAM: title, IART: artist }), raw bytes allowed. */
export function buildWav(channels: Float32Array[], sampleRate: number, info: Record<string, string | Uint8Array> = {}): Uint8Array<ArrayBuffer> {
  const frames = channels[0]?.length ?? 0;
  const nch = Math.max(1, channels.length);
  const dataBytes = frames * nch * 2;
  const infoChunks = Object.entries(info).map(([id, value]) => {
    const raw = typeof value === "string" ? new TextEncoder().encode(value) : value;
    const body = new Uint8Array(raw.length + 1); // null terminated
    body.set(raw);
    return { id, body };
  });
  const infoSize = infoChunks.length ? 4 + infoChunks.reduce((s, c) => s + 8 + c.body.length + (c.body.length & 1), 0) : 0;
  const total = 12 + 24 + (infoSize ? 8 + infoSize : 0) + 8 + dataBytes;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let o = 0;
  const str = (s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
    o += 4;
  };
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  const u16 = (v: number) => {
    view.setUint16(o, v, true);
    o += 2;
  };
  str("RIFF");
  u32(total - 8);
  str("WAVE");
  str("fmt ");
  u32(16);
  u16(1);
  u16(nch);
  u32(sampleRate);
  u32(sampleRate * nch * 2);
  u16(nch * 2);
  u16(16);
  if (infoSize) {
    str("LIST");
    u32(infoSize);
    str("INFO");
    for (const c of infoChunks) {
      str(c.id);
      u32(c.body.length);
      out.set(c.body, o);
      o += c.body.length + (c.body.length & 1);
    }
  }
  str("data");
  u32(dataBytes);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return out;
}

/** Per-channel reader (for fake AudioBuffers in tests). */
export function readWavChannels(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let offset = 12;
  let nch = 0;
  let sampleRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      nch = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === "data") {
      const frames = Math.floor(size / (2 * nch));
      const channels = Array.from({ length: nch }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) channels[c][i] = view.getInt16(body + (i * nch + c) * 2, true) / 32768;
      return { channels, sampleRate };
    }
    offset = body + size + (size & 1);
  }
  throw new Error("no data chunk");
}
