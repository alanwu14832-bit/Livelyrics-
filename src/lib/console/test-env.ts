// A fake browser for the console controller tests in Node: an <audio> stand-in, in-memory
// storage and a window stub. Node's global BroadcastChannel carries the real messages.

import { vi } from "vitest";

export class FakeAudio {
  static last: FakeAudio | null = null;
  static all: FakeAudio[] = [];
  preload = "";
  src = "";
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = 40;
  paused = true;
  ended = false;
  readyState = 4;
  volume = 1;
  muted = false;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  error: { code: number } | null = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.last = this;
    FakeAudio.all.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  play() {
    this.paused = false;
    this.emit("play");
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }
}

export function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

/** Stub window / Audio / fetch; `serve(url, init)` answers fetch (null = 404). */
export function stubBrowser(serve: (url: string, init?: RequestInit) => unknown | null) {
  FakeAudio.last = null;
  FakeAudio.all = [];
  const win = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    open: vi.fn(() => null),
    confirm: vi.fn(() => true),
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    devicePixelRatio: 1,
    location: { href: "http://localhost/s/show1/live" },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("Audio", FakeAudio);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = serve(String(url), init);
    if (body == null) return new Response(JSON.stringify({ error: "找不到" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { win, fetchMock };
}

export const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
