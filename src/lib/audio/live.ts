// STUB — owned by the AUDIO module. Replace the implementation, keep the exports.
import type { LiveAudioFeatures } from "../stage/protocol";

export interface LiveAnalyser {
  /** sample current features (call once per animation frame / publish tick) */
  getFeatures(): LiveAudioFeatures;
  /** set the tempo used for beatPhase when no beat grid applies (tap tempo / analysis bpm) */
  setBpm(bpm: number): void;
  /** register a manual beat (tap tempo); re-anchors beatPhase to now */
  tap(): void;
  dispose(): void;
}

/** Analyse an <audio> element's output. Safe to call repeatedly for the same element (cached per element). */
export function createMediaElementAnalyser(el: HTMLMediaElement): LiveAnalyser {
  void el;
  return silentAnalyser();
}

/** Analyse the microphone / line-in (live band mode). Rejects if permission is denied. */
export async function createMicAnalyser(deviceId?: string): Promise<LiveAnalyser> {
  void deviceId;
  return silentAnalyser();
}

export function silentAnalyser(): LiveAnalyser {
  return {
    getFeatures: () => ({ level: 0, bass: 0, onset: 0, beatPhase: 0 }),
    setBpm: () => {},
    tap: () => {},
    dispose: () => {},
  };
}
