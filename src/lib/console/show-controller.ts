// The show console's engine (演出控制台, /s/[id]/live, phase 2b). One show, one projection window:
// the item on air (a song's ConsoleController or a look's LookController) is the only one that
// talks on showChannelName(showId); the armed item is preloaded silently beside it (project JSON,
// the audio element with preload="auto") and announced to the output with `preload` so its fonts
// and media are warm; GO takes the armed item (the output fades through black by itself), S
// takes the standby look at any time. Before the first GO an idle link answers the output's
// heartbeat, so the operator sees 「投影已連線」 before the show starts.
//
// What survives a reload of the console tab: the item on air, the armed item, the take time and
// the toggles (sessionStorage, show-live.ts); the song itself restores its overrides, position
// and hold / loop through session.ts, a look its overrides.
//
// Framework-agnostic: React binds through subscribe()/getSnapshot().

import { api } from "@/lib/api-client";
import { lookToProject } from "@/lib/show";
import { DEFAULT_TAKE_TRANSITION, showChannelName, type StageTransition } from "@/lib/stage/protocol";
import type { Band, LookItemKind, Project, ProjectSummary, SetItem, Show } from "@/lib/types";
import { ConsoleController, type LoadState } from "./controller";
import { DISCONNECTED, HEARTBEAT_MS, openProjectionWindow, ProjectionLink, randomId, type OutputStatus, type OutputTarget } from "./link";
import { LookController } from "./look-controller";
import {
  AUTO_STANDBY_ID,
  GO_LOCK_MS,
  arm as armLive,
  go as goLive,
  initialLive,
  loadPrefs,
  loadShowLiveSession,
  railItems,
  reconcileLive,
  saveShowLiveSession,
  savePrefs,
  standbyItem,
  take as takeLive,
  takeStandby,
  type LiveState,
  type RailItem,
  type TakeTransition,
} from "./show-live";

type LookItem = Extract<SetItem, { kind: LookItemKind }>;

/** One item's controller; `seq` is unique per controller (a React key: a re-take is a fresh console). */
export type ItemControl =
  | { kind: "song"; itemId: string; seq: number; controller: ConsoleController }
  | { kind: "look"; itemId: string; seq: number; controller: LookController; item: LookItem };

export interface ShowLiveSnapshot {
  load: LoadState;
  show: Show | null;
  band: Band | null;
  rail: RailItem[];
  live: LiveState;
  /** the item on air (null before the first GO) */
  onAir: ItemControl | null;
  /** the armed item, preloaded (null when nothing is armed) */
  next: ItemControl | null;
  /** the armed song finished loading its project (GO will be instant) */
  nextReady: boolean;
  /** the standby target (the show's own standby look or one made from the bible) */
  standby: LookItem | null;
  transition: TakeTransition;
  autoPlay: boolean;
  /** before the first GO: the output heard through the idle link */
  output: OutputStatus;
  otherConsole: boolean;
  /** GO was pressed again too soon after a take */
  goLockedUntil: number;
}

const TAKE_TRANSITIONS: Record<TakeTransition, StageTransition> = {
  fade: DEFAULT_TAKE_TRANSITION,
  cut: { kind: "cut", ms: 0 },
};

/** How long to wait for a song taken without its project yet before 「GO 後自動播放」 gives up. */
const AUTOPLAY_WAIT_MS = 15000;

export class ShowLiveController {
  readonly showId: string;
  readonly channel: string;
  readonly consoleId: string;
  readonly outputTarget: OutputTarget;

  private snapshot: ShowLiveSnapshot;
  private readonly listeners = new Set<() => void>();
  private attached = false;
  private loadAbort: AbortController | null = null;
  private readonly idle: ProjectionLink;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private idlePreload: Project | null = null;
  private outputWindow: Window | null = null;
  private nextSub: (() => void) | null = null;
  private autoplaySub: (() => void) | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(showId: string) {
    this.showId = showId;
    this.channel = showChannelName(showId);
    this.consoleId = randomId();
    this.outputTarget = { url: `/s/${encodeURIComponent(showId)}/output`, name: `livelyrics-output-show-${showId}` };
    this.idle = new ProjectionLink(this.consoleId, {
      onHello: () => {
        if (this.idlePreload) this.idle.post({ type: "preload", project: this.idlePreload });
      },
      onStatus: (output, otherConsole) => this.set({ output, otherConsole }),
    });
    this.snapshot = {
      load: { status: "loading" },
      show: null,
      band: null,
      rail: [],
      live: { current: null, armed: null, takenAt: null },
      onAir: null,
      next: null,
      nextReady: false,
      standby: null,
      transition: "fade",
      autoPlay: false,
      output: DISCONNECTED,
      otherConsole: false,
      goLockedUntil: 0,
    };
  }

  // ---------------------------------------------------------------- React binding

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ShowLiveSnapshot => this.snapshot;

  private set(patch: Partial<ShowLiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.error("[Livelyrics] 演出控制台更新失敗：", err);
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle

  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    const prefs = loadPrefs(this.showId);
    this.set({ transition: prefs.transition, autoPlay: prefs.autoPlay });
    this.openIdle();
    if (this.snapshot.show) this.start(this.snapshot.show, this.snapshot.band, null);
    else void this.load();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.saveSession();
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.clearAutoplay();
    this.nextSub?.();
    this.nextSub = null;
    const { onAir, next } = this.snapshot;
    next?.controller.detach();
    onAir?.controller.detach();
    this.closeIdle();
    this.set({ onAir: null, next: null, nextReady: false });
  }

  private async load(): Promise<void> {
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    this.set({ load: { status: "loading" } });
    try {
      const show = await api.getShow(this.showId);
      const [band, list] = await Promise.all([api.getBand(show.bandId).catch(() => null), api.listProjects().catch(() => [] as ProjectSummary[])]);
      if (abort.signal.aborted || !this.attached) return;
      const songs = list.filter((p) => p.bandId === show.bandId || show.items.some((i) => i.kind === "song" && i.projectId === p.id));
      this.start(show, band, songs);
    } catch (err) {
      if (abort.signal.aborted || !this.attached) return;
      const message = err instanceof Error && err.message ? err.message : "無法載入演出";
      this.set({ load: /^404\b|找不到/.test(message) ? { status: "not-found" } : { status: "error", message } });
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
  }

  /** Retry after a load error. */
  reload(): void {
    if (this.attached && !this.snapshot.show) void this.load();
  }

  private start(show: Show, band: Band | null, songs: ProjectSummary[] | null): void {
    const map = songs ? new Map(songs.map((s) => [s.id, s])) : this.songMap;
    this.songMap = map;
    const standby = standbyItem(show, band);
    // a reloaded tab comes back to the same item (the output resyncs through hello)
    const session = loadShowLiveSession(this.showId);
    const restored = session ? reconcileLive(session, show.items) : initialLive(show.items);
    this.set({
      load: { status: "ready" },
      show,
      band,
      rail: railItems(show, map),
      standby,
      live: { ...restored, current: null },
      ...(session ? { transition: session.transition, autoPlay: session.autoPlay } : {}),
    });
    if (restored.current) this.takeItem(restored.current, { recover: { takenAt: restored.takenAt }, armed: restored.armed });
    else this.syncNext();
  }

  private songMap = new Map<string, ProjectSummary>();

  // ---------------------------------------------------------------- idle link (nothing on air)

  private openIdle(): void {
    if (this.snapshot.onAir || this.idle.isOpen) return;
    if (!this.idle.open(this.channel)) return;
    this.idle.heartbeat();
    if (!this.idleTimer) this.idleTimer = setInterval(() => this.idle.heartbeat(), HEARTBEAT_MS);
  }

  private closeIdle(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.idle.close();
  }

  // ---------------------------------------------------------------- items

  private findItem(id: string): SetItem | null {
    if (id === AUTO_STANDBY_ID) return this.snapshot.standby;
    return this.snapshot.show?.items.find((i) => i.id === id) ?? null;
  }

  private lookProject(item: LookItem): Project {
    const show = this.snapshot.show;
    return lookToProject(item, { band: this.snapshot.band, output: show?.output ?? null, showId: this.showId });
  }

  private createControl(item: SetItem, opts: { resume: boolean; takenAt?: number | null }): ItemControl {
    if (item.kind === "song") {
      const controller = new ConsoleController(item.projectId, { channel: null, consoleId: this.consoleId, output: this.outputTarget, resume: opts.resume });
      controller.attach();
      return { kind: "song", itemId: item.id, seq: ++this.seq, controller };
    }
    const controller = new LookController(this.lookProject(item), {
      channel: null,
      consoleId: this.consoleId,
      output: this.outputTarget,
      takenAt: opts.takenAt ?? null,
      resume: opts.resume,
      durationHint: item.look.durationHint ?? null,
      sessionKey: `show-${this.showId}-${item.id}`,
    });
    controller.attach();
    return { kind: "look", itemId: item.id, seq: ++this.seq, controller, item };
  }

  private projectOf(control: ItemControl | null): Project | null {
    return control?.controller.getSnapshot().project ?? null;
  }

  /** Preload the armed item beside the one on air (silent), and announce it to the output. */
  private syncNext(): void {
    const armed = this.snapshot.live.armed;
    let next = this.snapshot.next;
    if (next && next.itemId !== armed) {
      this.nextSub?.();
      this.nextSub = null;
      next.controller.detach();
      next = null;
    }
    if (!next && armed) {
      const item = this.findItem(armed);
      if (item) next = this.createControl(item, { resume: false });
    }
    this.set({ next, nextReady: !!this.projectOf(next) });
    this.announce(this.projectOf(next));
    if (next?.kind === "song" && !this.snapshot.nextReady) {
      const controller = next.controller;
      this.nextSub?.();
      this.nextSub = controller.subscribe(() => {
        const project = controller.getSnapshot().project;
        if (!project || this.snapshot.next?.controller !== controller) return;
        this.nextSub?.();
        this.nextSub = null;
        this.set({ nextReady: true });
        this.announce(project);
      });
    }
  }

  /** Tell the output about the armed item (through whatever is on air, else the idle link). */
  private announce(project: Project | null): void {
    const onAir = this.snapshot.onAir;
    if (onAir) onAir.controller.setPreload(project);
    else {
      this.idlePreload = project;
      if (project) this.idle.post({ type: "preload", project });
    }
  }

  // ---------------------------------------------------------------- operator actions

  /** Click in the rail: arm that item for GO. */
  arm(itemId: string): void {
    const live = armLive(this.snapshot.live, this.snapshot.show?.items ?? [], itemId);
    if (live === this.snapshot.live) return;
    this.set({ live });
    this.syncNext();
    this.saveSession();
  }

  /** GO: take the armed item (ignored right after a take: double-GO protection). True when it took. */
  go(now: number = Date.now()): boolean {
    if (!this.snapshot.show || now < this.snapshot.goLockedUntil) return false;
    const next = goLive(this.snapshot.live, this.snapshot.show.items, now);
    if (!next || !next.current) return false;
    this.takeItem(next.current, { now });
    return true;
  }

  /** S: put the standby look on air now (never locked). True when it took. */
  standby(now: number = Date.now()): boolean {
    const show = this.snapshot.show;
    const standby = this.snapshot.standby;
    if (!show || !standby) return false;
    const live = takeStandby(this.snapshot.live, show.items, standby.id, now);
    if (!live) return false;
    this.takeItem(standby.id, { now, armed: live.armed });
    return true;
  }

  /**
   * Put an item on air. `recover`: a reloaded console tab continues the item that was on air
   * (position and overrides restored, no transition). `armed` overrides what gets armed next.
   */
  private takeItem(itemId: string, opts: { now?: number; recover?: { takenAt: number | null }; armed?: string | null } = {}): void {
    const show = this.snapshot.show;
    const item = this.findItem(itemId);
    if (!show || !item) return;
    const now = opts.now ?? Date.now();
    const prev = this.snapshot.onAir;
    let control = this.snapshot.next?.itemId === itemId && !opts.recover ? this.snapshot.next : null;
    if (control) {
      this.nextSub?.();
      this.nextSub = null;
    } else control = this.createControl(item, { resume: !!opts.recover, takenAt: opts.recover?.takenAt ?? null });
    // blackout is the show's master: a GO under black stays black until B
    if (!opts.recover) control.controller.setOverrides({ blackout: prev ? prev.controller.getOverrides().blackout : false });
    this.clearAutoplay();
    // the old item goes quiet first (its audio stops, the output holds its last frame), then the
    // new one talks: the show channel never carries two items at once
    prev?.controller.detach();
    if (!prev) this.closeIdle();
    const transition = opts.recover ? null : TAKE_TRANSITIONS[this.snapshot.transition];
    control.controller.setChannel(this.channel, { transition });
    const base = takeLive(this.snapshot.live, show.items, itemId, now);
    const live: LiveState = opts.recover
      ? { current: itemId, armed: opts.armed !== undefined ? opts.armed : base.armed, takenAt: opts.recover.takenAt ?? now }
      : { ...base, armed: opts.armed !== undefined ? opts.armed : base.armed };
    this.set({ onAir: control, next: this.snapshot.next === control ? null : this.snapshot.next, nextReady: false, live, goLockedUntil: opts.recover ? 0 : now + GO_LOCK_MS });
    if (!opts.recover && control.kind === "song" && this.snapshot.autoPlay) this.autoplay(control.controller);
    this.syncNext();
    this.saveSession();
  }

  /** 「GO 後自動播放」: start TRACK playback as soon as the taken song can play. */
  private autoplay(controller: ConsoleController): void {
    const tryPlay = (): boolean => {
      const snap = controller.getSnapshot();
      if (this.snapshot.onAir?.controller !== controller) return true;
      if (!snap.project || snap.audio.status === "idle") return false;
      if (snap.mode === "track" && !snap.playing) void controller.play();
      return true;
    };
    if (tryPlay()) return;
    this.autoplaySub = controller.subscribe(() => {
      if (tryPlay()) this.clearAutoplay();
    });
    this.autoplayTimer = setTimeout(() => this.clearAutoplay(), AUTOPLAY_WAIT_MS);
  }

  private clearAutoplay(): void {
    this.autoplaySub?.();
    this.autoplaySub = null;
    if (this.autoplayTimer) clearTimeout(this.autoplayTimer);
    this.autoplayTimer = null;
  }

  setTransition(transition: TakeTransition): void {
    if (transition === this.snapshot.transition) return;
    this.set({ transition });
    savePrefs(this.showId, { transition, autoPlay: this.snapshot.autoPlay });
    this.saveSession();
  }

  setAutoPlay(autoPlay: boolean): void {
    if (autoPlay === this.snapshot.autoPlay) return;
    this.set({ autoPlay });
    savePrefs(this.showId, { transition: this.snapshot.transition, autoPlay });
    this.saveSession();
  }

  /** 「開啟投影視窗」 / O: the show's projection window (one for the whole show). */
  openOutput(): boolean {
    const onAir = this.snapshot.onAir;
    if (onAir) {
      onAir.controller.openOutput();
      return true;
    }
    const win = openProjectionWindow(this.outputTarget, this.outputWindow);
    if (win) this.outputWindow = win;
    return !!win;
  }

  /**
   * Leaving the show console stops the item on air (the projection holds its last frame). While
   * the show is live, ask first. True = go ahead.
   */
  confirmLeave(): boolean {
    const onAir = this.snapshot.onAir;
    if (onAir?.kind === "song") return onAir.controller.confirmLeave();
    const connected = onAir ? onAir.controller.getSnapshot().output.connected : this.snapshot.output.connected;
    if (!connected) return true;
    try {
      return window.confirm("演出進行中：離開演出控制台後投影畫面會停在最後一格。確定要離開嗎？");
    } catch {
      return true;
    }
  }

  private saveSession(): void {
    if (!this.snapshot.show) return;
    const { live, transition, autoPlay } = this.snapshot;
    saveShowLiveSession(this.showId, { ...live, transition, autoPlay });
  }
}
