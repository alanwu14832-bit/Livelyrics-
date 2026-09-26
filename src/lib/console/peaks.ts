// Waveform fallback for the timeline when the project has no stored analysis
// (e.g. created by a script): decode the stored audio once in the browser and
// reduce it to peak buckets. Never throws; resolves null when decoding is impossible.

export const FALLBACK_BUCKETS = 2000;

/** max |sample| per bucket across channels, normalized so the loudest bucket is 1. */
export function peaksFromChannels(channels: readonly Float32Array[], buckets = FALLBACK_BUCKETS): number[] {
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const n = Math.max(1, Math.min(buckets, length));
  const out = new Array<number>(length === 0 ? 0 : n).fill(0);
  if (length === 0) return out;
  const size = length / n;
  let max = 0;
  for (let b = 0; b < n; b++) {
    const i0 = Math.floor(b * size);
    const i1 = Math.max(i0 + 1, Math.floor((b + 1) * size));
    let m = 0;
    for (const ch of channels) {
      const end = Math.min(i1, ch.length);
      for (let i = i0; i < end; i++) {
        const v = Math.abs(ch[i]);
        if (v > m) m = v;
      }
    }
    out[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < n; b++) out[b] = Math.round((out[b] / max) * 1000) / 1000;
  return out;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Fetch + decode `url` and compute peaks. Resolves null on any failure or abort. */
export async function computeWaveformPeaks(url: string, signal?: AbortSignal, buckets = FALLBACK_BUCKETS): Promise<number[] | null> {
  try {
    const g = globalThis as typeof globalThis & { webkitOfflineAudioContext?: OfflineCtor };
    const Ctor: OfflineCtor | undefined = typeof OfflineAudioContext === "function" ? OfflineAudioContext : g.webkitOfflineAudioContext;
    if (!Ctor) return null;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    if (signal?.aborted) return null;
    // an offline context decodes without needing a user gesture
    const ctx = new Ctor(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(data);
    if (signal?.aborted) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
    return peaksFromChannels(channels, buckets);
  } catch {
    return null;
  }
}
