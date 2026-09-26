// Audio playhead as an external store: components subscribe with useSyncExternalStore
// (only the ones that need the time re-render), canvases redraw from subscribe().

import { useSyncExternalStore } from "react";

type Listener = () => void;

export class Playhead {
  private el: HTMLAudioElement | null = null;
  private listeners = new Set<Listener>();
  private raf = 0;
  private time = 0;
  private duration = 0;
  private playing = false;
  private rate = 1;
  private error: string | null = null;
  private detach: (() => void) | null = null;

  /** Bind to an <audio> element (null to unbind). */
  attach(el: HTMLAudioElement | null): void {
    if (el === this.el) return;
    this.detach?.();
    this.detach = null;
    this.el = el;
    if (!el) return;
    const sync = () => {
      this.time = el.currentTime || 0;
      this.duration = Number.isFinite(el.duration) ? el.duration : this.duration;
      this.playing = !el.paused && !el.ended;
      this.rate = el.playbackRate || 1;
      if (this.playing) this.loop();
      this.emit();
    };
    const onError = () => {
      const code = el.error?.code;
      this.error =
        code === 4
          ? "瀏覽器無法播放這個音檔格式"
          : code === 2
            ? "載入音訊時網路中斷"
            : code === 3
              ? "音訊解碼失敗"
              : "無法載入音訊";
      this.playing = false;
      this.emit();
    };
    const onOk = () => {
      if (this.error) {
        this.error = null;
      }
      sync();
    };
    const events = ["play", "pause", "seeked", "seeking", "timeupdate", "durationchange", "ratechange", "ended", "emptied"] as const;
    for (const e of events) el.addEventListener(e, sync);
    el.addEventListener("loadedmetadata", onOk);
    el.addEventListener("error", onError);
    this.detach = () => {
      for (const e of events) el.removeEventListener(e, sync);
      el.removeEventListener("loadedmetadata", onOk);
      el.removeEventListener("error", onError);
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    };
    sync();
  }

  private loop(): void {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      const el = this.el;
      if (!el || el.paused || el.ended) {
        this.playing = false;
        this.emit();
        return;
      }
      this.time = el.currentTime;
      this.emit();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private emit(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* a broken subscriber must not stop playback updates */
      }
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getTime = (): number => this.time;
  getDuration = (): number => this.duration;
  isPlaying = (): boolean => this.playing;
  getRate = (): number => this.rate;
  getError = (): string | null => this.error;

  /** Live time straight from the element (tap-sync reads this at key-press time). */
  now(): number {
    return this.el ? this.el.currentTime : this.time;
  }

  async play(): Promise<void> {
    const el = this.el;
    if (!el) return;
    try {
      await el.play();
    } catch (err) {
      // NotAllowedError (autoplay policy) / AbortError (a pause raced the play) are not fatal
      if (!(err instanceof DOMException)) throw err;
    }
  }

  pause(): void {
    this.el?.pause();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number): void {
    const el = this.el;
    if (!el || !Number.isFinite(t)) return;
    const max = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
    const clamped = Math.min(Math.max(0, t), max);
    try {
      el.currentTime = clamped;
    } catch {
      return;
    }
    this.time = clamped;
    this.emit();
  }

  setRate(rate: number): void {
    if (this.el) this.el.playbackRate = rate;
  }

  destroy(): void {
    this.detach?.();
    this.detach = null;
    this.el = null;
    this.listeners.clear();
  }
}

export function usePlayheadTime(ph: Playhead): number {
  return useSyncExternalStore(ph.subscribe, ph.getTime, () => 0);
}

export function usePlayheadPlaying(ph: Playhead): boolean {
  return useSyncExternalStore(ph.subscribe, ph.isPlaying, () => false);
}

export function usePlayheadDuration(ph: Playhead): number {
  return useSyncExternalStore(ph.subscribe, ph.getDuration, () => 0);
}

export function usePlayheadRate(ph: Playhead): number {
  return useSyncExternalStore(ph.subscribe, ph.getRate, () => 1);
}

export function usePlayheadError(ph: Playhead): string | null {
  return useSyncExternalStore(ph.subscribe, ph.getError, () => null);
}

/** Subscribe to a derived primitive (re-renders only when it changes). */
export function usePlayheadSelector<T extends string | number | boolean | null>(ph: Playhead, select: (t: number) => T, fallback: T): T {
  return useSyncExternalStore(
    ph.subscribe,
    () => select(ph.getTime()),
    () => fallback,
  );
}
