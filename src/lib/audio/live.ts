// Real-time audio features for the stage: from the console's <audio> element (track mode) or
// from a microphone / line-in (live band mode), plus tap tempo.
//
// Web Audio rules this module works around:
//  - one AudioContext for the whole app (browsers limit them; nodes cannot cross contexts)
//  - a media element can be wrapped by createMediaElementSource only ONCE, and from then on
//    its sound only comes out through the graph — so the source is cached per element and is
//    always routed to the destination, even after every analyser handle is disposed
//  - contexts start "suspended" until a user gesture; playback through a suspended context is
//    silent, so we resume on the first gesture and whenever the element starts playing

import type { LiveAudioFeatures } from "../stage/protocol";
import { LiveFeatureExtractor } from "./live-features";

export { TapTempo, LiveFeatureExtractor, AdaptiveRange } from "./live-features";

export interface LiveAnalyser {
  /** sample current features (call once per animation frame / publish tick) */
  getFeatures(): LiveAudioFeatures;
  /** set the tempo used for beatPhase when no beat grid applies (tap tempo / analysis bpm) */
  setBpm(bpm: number): void;
  /** register a manual beat (tap tempo); re-anchors beatPhase to now */
  tap(): void;
  dispose(): void;
  /** current tempo driving beatPhase (tap tempo or setBpm), 0 when none */
  getBpm?(): number;
}

export type LiveAudioErrorCode = "unsupported" | "insecure" | "denied" | "not-found" | "busy" | "aborted" | "failed";

export class LiveAudioError extends Error {
  readonly code: LiveAudioErrorCode;
  constructor(code: LiveAudioErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LiveAudioError";
    this.code = code;
  }
}

type AudioGlobals = typeof globalThis & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

const FFT_SIZE = 2048;
const GESTURES = ["pointerdown", "keydown", "touchend", "mousedown"] as const;

let sharedContext: AudioContext | null = null;
let gestureListening = false;

const nowSeconds = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

function onGesture(): void {
  const ctx = sharedContext;
  if (!ctx || ctx.state === "running" || ctx.state === "closed") {
    stopGestureListening();
    return;
  }
  ctx.resume().then(
    () => {
      if (ctx.state === "running") stopGestureListening();
    },
    () => {
      /* not allowed yet: keep listening */
    },
  );
}

function startGestureListening(): void {
  if (gestureListening || typeof window === "undefined") return;
  gestureListening = true;
  for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
}

function stopGestureListening(): void {
  if (!gestureListening || typeof window === "undefined") return;
  gestureListening = false;
  for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
}

/** The app-wide AudioContext (created lazily; null outside the browser or without Web Audio). */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  const g = globalThis as AudioGlobals;
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (typeof Ctor !== "function") return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  sharedContext = ctx;
  // Safari may also "interrupt" a running context (phone call, other app): resume on the next gesture
  ctx.addEventListener?.("statechange", () => {
    if (ctx.state !== "running" && ctx.state !== "closed") startGestureListening();
  });
  if (ctx.state !== "running") startGestureListening();
  return ctx;
}

/** Resume the shared context (call from a user gesture, e.g. the play button). Never throws. */
export async function resumeAudioContext(): Promise<boolean> {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
  } catch {
    /* needs a gesture */
  }
  // re-read: the state changed asynchronously (TypeScript still has the narrowed value)
  return (ctx.state as AudioContextState) === "running";
}

function createAnalyserNode(ctx: BaseAudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // smoothing happens in LiveFeatureExtractor
  analyser.minDecibels = -100;
  analyser.maxDecibels = -10;
  return analyser;
}

/** Wrap an analyser node into a LiveAnalyser handle. `release` runs once on dispose. */
function createHandle(analyser: AnalyserNode, release: () => void): LiveAnalyser {
  const extractor = new LiveFeatureExtractor({ sampleRate: analyser.context.sampleRate, fftSize: analyser.fftSize });
  const timeDomain = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  let disposed = false;
  return {
    getFeatures() {
      const now = nowSeconds();
      if (disposed || analyser.context.state === "closed") return extractor.silent(now);
      try {
        analyser.getFloatTimeDomainData(timeDomain);
        analyser.getFloatFrequencyData(spectrum);
      } catch {
        return extractor.silent(now);
      }
      return extractor.process(timeDomain, spectrum, now);
    },
    setBpm: (bpm: number) => extractor.setBpm(bpm, nowSeconds()),
    tap: () => extractor.tap(nowSeconds()),
    getBpm: () => extractor.bpm,
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        release();
      } catch {
        /* already disconnected */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Media element (track mode)
// ---------------------------------------------------------------------------

interface ElementChain {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  users: number;
}

const chains = new WeakMap<HTMLMediaElement, ElementChain>();

function silentHandle(): LiveAnalyser {
  const extractor = new LiveFeatureExtractor({ sampleRate: 48000, fftSize: FFT_SIZE });
  return {
    getFeatures: () => extractor.silent(nowSeconds()),
    setBpm: (bpm: number) => extractor.setBpm(bpm, nowSeconds()),
    tap: () => extractor.tap(nowSeconds()),
    getBpm: () => extractor.bpm,
    dispose: () => {},
  };
}

/** Analyse an <audio> element's output. Safe to call repeatedly for the same element (cached per element). */
export function createMediaElementAnalyser(el: HTMLMediaElement): LiveAnalyser {
  const ctx = getSharedAudioContext();
  if (!ctx || !el) return silentHandle();
  let chain = chains.get(el);
  if (!chain) {
    let source: MediaElementAudioSourceNode;
    try {
      source = ctx.createMediaElementSource(el);
    } catch (err) {
      // e.g. already wrapped by another context: playback is unaffected, we just cannot listen
      if (typeof console !== "undefined") console.warn("[livelyrics] 無法分析播放器音訊：", err);
      return silentHandle();
    }
    chain = { ctx, source, analyser: createAnalyserNode(ctx), users: 0 };
    chains.set(el, chain);
    // starting playback is (almost always) a user gesture: make sure the graph is running
    el.addEventListener("play", () => {
      if (ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {});
    });
  }
  const c = chain;
  if (c.users === 0) {
    // (re)insert the analyser: source -> analyser -> destination (the analyser passes audio through)
    try {
      c.source.disconnect();
    } catch {
      /* not connected */
    }
    c.source.connect(c.analyser);
    c.analyser.connect(c.ctx.destination);
  }
  c.users++;
  if (c.ctx.state !== "running" && !el.paused) c.ctx.resume().catch(() => {});
  return createHandle(c.analyser, () => {
    c.users = Math.max(0, c.users - 1);
    if (c.users > 0) return;
    // nobody listens any more: bypass the analyser but keep the element audible
    try {
      c.source.disconnect();
      c.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    c.source.connect(c.ctx.destination);
  });
}

// ---------------------------------------------------------------------------
// Microphone / line-in (live band mode)
// ---------------------------------------------------------------------------

function micError(err: unknown): LiveAudioError {
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name ?? "") : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new LiveAudioError("denied", "麥克風權限被拒絕。請在瀏覽器網址列左側的網站設定中允許使用麥克風後再試一次。", { cause: err });
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new LiveAudioError("not-found", "找不到音訊輸入裝置，請確認麥克風或錄音介面已連接。", { cause: err });
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new LiveAudioError("not-found", "找不到指定的輸入裝置，它可能已被拔除，請重新選擇。", { cause: err });
    case "NotReadableError":
    case "TrackStartError":
      return new LiveAudioError("busy", "輸入裝置無法開啟，可能正被其他程式使用。", { cause: err });
    case "AbortError":
      return new LiveAudioError("aborted", "開啟輸入裝置時被中斷，請再試一次。", { cause: err });
    default: {
      const detail = err instanceof Error && err.message ? `（${err.message}）` : "";
      return new LiveAudioError("failed", `無法開啟音訊輸入${detail}。`, { cause: err });
    }
  }
}

/** Analyse the microphone / line-in (live band mode). Rejects if permission is denied. */
export async function createMicAnalyser(deviceId?: string): Promise<LiveAnalyser> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new LiveAudioError("insecure", "瀏覽器只允許在 localhost 或 HTTPS 下使用麥克風，請改用 http://localhost 開啟。");
  }
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media || typeof media.getUserMedia !== "function") {
    throw new LiveAudioError("unsupported", "此瀏覽器不支援麥克風輸入。");
  }
  const ctx = getSharedAudioContext();
  if (!ctx) throw new LiveAudioError("unsupported", "此瀏覽器不支援 Web Audio，無法分析現場音訊。");
  // resume inside the caller's gesture, before the permission prompt consumes it
  const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});

  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        // raw signal: processing meant for calls would flatten dynamics and kill transients
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  } catch (err) {
    throw micError(err);
  }
  await resumed;
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = createAnalyserNode(ctx);
    // deliberately NOT connected to the destination: no monitoring, no feedback
    source.connect(analyser);
  } catch (err) {
    for (const track of stream.getTracks()) track.stop();
    throw micError(err);
  }
  return createHandle(analyser, () => {
    try {
      source.disconnect();
      analyser.disconnect();
    } finally {
      for (const track of stream.getTracks()) track.stop();
    }
  });
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/** Audio inputs for a device picker. Labels are only available after mic permission was granted once. */
export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media || typeof media.enumerateDevices !== "function") return [];
  try {
    const devices = await media.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || (d.deviceId === "default" ? "預設輸入裝置" : `音訊輸入 ${i + 1}`) }));
  } catch {
    return [];
  }
}

export function silentAnalyser(): LiveAnalyser {
  return {
    getFeatures: () => ({ level: 0, bass: 0, onset: 0, beatPhase: 0 }),
    setBpm: () => {},
    tap: () => {},
    dispose: () => {},
    getBpm: () => 0,
  };
}
