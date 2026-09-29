// The console side of the projection link: one BroadcastChannel (or none at all: a show item that
// is armed and preloaded but not on air stays silent), the output windows answering its pings,
// and "another console is driving this channel" detection.
//
// Every controller of one console window shares its `consoleId` (the show console hands the same
// id to all of its item controllers) and stamps it on what it sends as `sender`, so messages of
// the same window never count as another console: a take can briefly overlap two controllers of
// the show console, a second show console tab (another id) is still reported.

import { parseStageMessage, type LimiterReport, type RemoteKey, type StageMessage } from "@/lib/stage/protocol";
import type { DesignPlan } from "@/lib/types";

export interface OutputStatus {
  connected: boolean;
  /** number of projection windows answering pings */
  count: number;
  /** device pixels of the most recently heard output */
  width: number;
  height: number;
  fullscreen: boolean;
  /** LED 安全模式: the most recently heard output's flash limiter (absent from older outputs) */
  limiter?: LimiterReport;
}

export const DISCONNECTED: OutputStatus = { connected: false, count: 0, width: 0, height: 0, fullscreen: false };

/** Consoles ping once a second; an output (or another console) unheard for 3 s is gone. */
export const HEARTBEAT_MS = 1000;
export const OUTPUT_TIMEOUT_MS = 3000;

export interface LinkHandlers {
  /** an output window opened or asks for a full resync: send it the project and the state */
  onHello: () => void;
  /** the output status or the other-console flag changed */
  onStatus: (output: OutputStatus, otherConsole: boolean) => void;
  /** 字體藝術: the 排版 editor (another window) changed and saved this song's plan */
  onPlan?: (projectId: string, plan: DesignPlan) => void;
  /** a key pressed in a projection window (a presentation clicker), once per press per console window */
  onRemoteKey?: (key: RemoteKey) => void;
}

/**
 * Remote keys already handled by this console window: every controller of the show console shares
 * the window, and a take can briefly overlap two of them on the show channel.
 */
const seenRemoteKeys: string[] = [];
function firstSight(id: string): boolean {
  if (seenRemoteKeys.includes(id)) return false;
  seenRemoteKeys.push(id);
  if (seenRemoteKeys.length > 64) seenRemoteKeys.shift();
  return true;
}

/** A short random id for a console window or an output window. */
export function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

function sameLimiter(a: LimiterReport | undefined, b: LimiterReport | undefined): boolean {
  if (!a || !b) return a === b;
  return a.on === b.on && a.damping === b.damping && a.engaged === b.engaged;
}

function sameStatus(a: OutputStatus, b: OutputStatus): boolean {
  return a.connected === b.connected && a.count === b.count && a.width === b.width && a.height === b.height && a.fullscreen === b.fullscreen && sameLimiter(a.limiter, b.limiter);
}

export class ProjectionLink {
  private channel: BroadcastChannel | null = null;
  private channelName: string | null = null;
  private readonly outputs = new Map<string, { at: number; width: number; height: number; fullscreen: boolean; limiter?: LimiterReport }>();
  private lastOtherAt = 0;
  private output: OutputStatus = DISCONNECTED;
  private other = false;

  constructor(
    readonly consoleId: string,
    private readonly handlers: LinkHandlers,
  ) {}

  /** The open channel's name (null = silent). */
  get name(): string | null {
    return this.channelName;
  }

  get isOpen(): boolean {
    return this.channel != null;
  }

  get outputStatus(): OutputStatus {
    return this.output;
  }

  get otherConsole(): boolean {
    return this.other;
  }

  /** Talk on `name` (closing any other channel first). False when BroadcastChannel is unsupported. */
  open(name: string): boolean {
    if (this.channel && this.channelName === name) return true;
    this.close();
    if (typeof BroadcastChannel === "undefined") return false;
    const channel = new BroadcastChannel(name);
    channel.onmessage = (ev: MessageEvent<unknown>) => this.receive(ev.data);
    this.channel = channel;
    this.channelName = name;
    return true;
  }

  /** Go silent: close the channel and forget the outputs heard on it. */
  close(): void {
    const channel = this.channel;
    this.channel = null;
    this.channelName = null;
    if (channel) {
      channel.onmessage = null;
      try {
        channel.close();
      } catch {
        /* already closed */
      }
    }
    this.outputs.clear();
    this.lastOtherAt = 0;
    this.setStatus(DISCONNECTED, false);
  }

  /** Send on the open channel (a no-op while silent). Console messages carry this window's id. */
  post(msg: StageMessage): void {
    const channel = this.channel;
    if (!channel) return;
    const stamped = msg.type === "project" || msg.type === "state" || msg.type === "ping" || msg.type === "preload" || msg.type === "plan" ? { ...msg, sender: this.consoleId } : msg;
    try {
      channel.postMessage(stamped);
    } catch (err) {
      console.warn("[Livelyrics] 無法傳送到投影視窗：", err);
    }
  }

  /** Once a second: ping the outputs, drop the ones that went quiet, expire the other-console flag. */
  heartbeat(now: number = Date.now()): void {
    this.post({ type: "ping", at: now });
    this.refresh(now);
  }

  private receive(raw: unknown): void {
    const msg = parseStageMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case "hello":
        this.handlers.onHello();
        break;
      case "pong": {
        const known = this.outputs.has(msg.outputId);
        this.outputs.set(msg.outputId, { at: Date.now(), width: msg.width, height: msg.height, fullscreen: msg.fullscreen, ...(msg.limiter ? { limiter: msg.limiter } : {}) });
        const o = this.output;
        if (!known || !o.connected || o.width !== msg.width || o.height !== msg.height || o.fullscreen !== msg.fullscreen || !sameLimiter(o.limiter, msg.limiter)) this.refresh();
        break;
      }
      case "state":
      case "ping":
        // only consoles send these: someone else is driving this projection too (unless it is
        // another controller of this very console window)
        if (msg.sender && msg.sender === this.consoleId) return;
        this.lastOtherAt = Date.now();
        if (!this.other) this.setStatus(this.output, true);
        break;
      case "plan":
        if (msg.sender && msg.sender === this.consoleId) return;
        try {
          this.handlers.onPlan?.(msg.projectId, msg.plan);
        } catch (err) {
          console.error("[Livelyrics] 套用排版的修改失敗：", err);
        }
        break;
      case "key":
        if (!this.handlers.onRemoteKey || !firstSight(`${msg.outputId}:${msg.id}`)) return;
        try {
          this.handlers.onRemoteKey(msg.key);
        } catch (err) {
          console.error("[Livelyrics] 投影視窗的按鍵處理失敗：", err);
        }
        break;
      default:
        break;
    }
  }

  private refresh(now: number = Date.now()): void {
    let latest: { at: number; width: number; height: number; fullscreen: boolean; limiter?: LimiterReport } | null = null;
    for (const [id, o] of this.outputs) {
      if (now - o.at > OUTPUT_TIMEOUT_MS) this.outputs.delete(id);
      else if (!latest || o.at > latest.at) latest = o;
    }
    const next: OutputStatus = latest
      ? { connected: true, count: this.outputs.size, width: latest.width, height: latest.height, fullscreen: latest.fullscreen, ...(latest.limiter ? { limiter: latest.limiter } : {}) }
      : DISCONNECTED;
    this.setStatus(next, now - this.lastOtherAt < OUTPUT_TIMEOUT_MS);
  }

  private setStatus(output: OutputStatus, other: boolean): void {
    if (sameStatus(output, this.output) && other === this.other) return;
    this.output = sameStatus(output, this.output) ? this.output : output;
    this.other = other;
    try {
      this.handlers.onStatus(this.output, this.other);
    } catch (err) {
      console.error("[Livelyrics] 投影連線狀態更新失敗：", err);
    }
  }
}

/** Where 「開啟投影視窗」 goes: the per-song output, or the show's output in show mode. */
export interface OutputTarget {
  url: string;
  /** window name, so a second press focuses the same window */
  name: string;
}

/**
 * Open (or focus) a projection window. Must run inside a user gesture. `current` is the window
 * this caller opened before (null when unknown); returns the window or null when the browser
 * blocked the popup. An already open window with that name is kept (no reload): e.g. after a
 * console reload, or a show item that did not open it itself.
 */
export function openProjectionWindow(target: OutputTarget, current: Window | null): Window | null {
  if (typeof window === "undefined") return null;
  if (current && !current.closed) {
    try {
      current.focus();
    } catch {
      /* focus is best effort */
    }
    return current;
  }
  let win: Window | null = null;
  try {
    // "" keeps an already-open output (e.g. after a console reload) instead of reloading it
    win = window.open("", target.name, "popup,width=1280,height=720");
  } catch {
    win = null;
  }
  if (!win) return null;
  try {
    const path = win.location.pathname;
    if (win.location.href === "about:blank" || path !== new URL(target.url, window.location.href).pathname) win.location.replace(target.url);
  } catch {
    win.location.href = target.url;
  }
  try {
    win.focus();
  } catch {
    /* focus is best effort */
  }
  return win;
}
