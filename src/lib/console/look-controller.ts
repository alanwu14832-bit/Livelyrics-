// A show look on air (進場 / 串場 / 待機 / 散場, phase 2b): the synthetic one-section project of
// lookToProject(), a clock that counts up from the take and never ends (a look loops until the
// next GO), and the safety controls (blackout, text on / off, freeze, intensity, scene and style
// overrides). No audio and no lyric navigation: the look's text is its only line, shown the whole
// time. Like a song's ConsoleController it talks on the show channel only while it is on air.
//
// Framework-agnostic (subscribe / getSnapshot for React, `store` for the preview's StageView).

import { sceneBank } from "@/lib/console/plan-edit";
import {
  DEFAULT_OVERRIDES,
  createStageStore,
  initialStageState,
  type StageOverrides,
  type StageState,
  type StageTransition,
  type WritableStageStore,
} from "@/lib/stage/protocol";
import type { Project, SceneId } from "@/lib/types";
import type { Notice, NoticeTone } from "./controller";
import { DISCONNECTED, HEARTBEAT_MS, openProjectionWindow, ProjectionLink, randomId, type OutputStatus, type OutputTarget } from "./link";
import { loadSession, saveSession } from "./session";

export interface LookSnapshot {
  project: Project;
  /** epoch ms of the take (null while armed / preloaded) */
  takenAt: number | null;
  output: OutputStatus;
  otherConsole: boolean;
  notices: Notice[];
}

export interface LookControllerOptions {
  /** the show channel once on air; default null (silent until setChannel) */
  channel?: string | null;
  consoleId?: string;
  output?: OutputTarget;
  /** a console reload: the take time to continue from (elapsed keeps counting) */
  takenAt?: number | null;
  /** restore the overrides this tab saved for the look (a reload); a fresh take starts clean */
  resume?: boolean;
  /** the look's durationHint (the countdown); lookToProject cannot tell it from its default length */
  durationHint?: number | null;
  /**
   * The key of the overrides saved in this tab's session; default the project id. The show
   * console names the show too, so two shows' looks (e.g. both auto standbys) never share one.
   */
  sessionKey?: string;
}

const NOTICE_MS = 4500;
/** a look has no music: no level, no beat */
const NO_AUDIO = { level: 0, bass: 0, onset: 0, beatPhase: 1 };

export class LookController {
  readonly id: string;
  readonly store: WritableStageStore;
  readonly consoleId: string;

  private snapshot: LookSnapshot;
  private readonly listeners = new Set<() => void>();
  private overrides: StageOverrides = { ...DEFAULT_OVERRIDES };
  private readonly link: ProjectionLink;
  private channelTarget: string | null;
  private pendingTransition: StageTransition | null = null;
  private preloadProject: Project | null = null;
  private readonly outputTarget: OutputTarget | null;
  private readonly resume: boolean;
  private readonly hint: number | null;
  private readonly sessionKey: string;
  private attached = false;
  private restored = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private outputWindow: Window | null = null;
  private noticeSeq = 0;
  private readonly noticeTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private noticeAutoDismiss = true;

  constructor(project: Project, opts: LookControllerOptions = {}) {
    this.id = project.id;
    this.store = createStageStore(initialStageState(project.id));
    this.consoleId = opts.consoleId || randomId();
    this.channelTarget = opts.channel ?? null;
    this.outputTarget = opts.output ?? null;
    this.resume = opts.resume ?? false;
    this.sessionKey = opts.sessionKey || project.id;
    const hint = opts.durationHint;
    this.hint = typeof hint === "number" && Number.isFinite(hint) && hint > 0 ? hint : null;
    this.link = new ProjectionLink(this.consoleId, {
      onHello: () => {
        this.broadcastProject();
        this.publish();
        if (this.preloadProject) this.link.post({ type: "preload", project: this.preloadProject });
      },
      onStatus: (output, otherConsole) => this.set({ output, otherConsole }),
    });
    this.snapshot = { project, takenAt: opts.takenAt ?? null, output: DISCONNECTED, otherConsole: false, notices: [] };
  }

  // ---------------------------------------------------------------- React binding

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): LookSnapshot => this.snapshot;

  private set(patch: Partial<LookSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.error("[Livelyrics] 控制台更新失敗：", err);
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle

  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    if (!this.restored) {
      this.restored = true;
      const session = this.resume ? loadSession(this.sessionKey) : null;
      if (session) {
        this.overrides = session.overrides;
        if (session.overrides.blackout) this.notify("已還原重新整理前的黑場狀態（按 B 解除）", "warn");
      }
    }
    if (this.channelTarget) this.goOnAir(this.channelTarget);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.publish();
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.persist();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.link.close();
    for (const t of this.noticeTimers.values()) clearTimeout(t);
    this.noticeTimers.clear();
  }

  /**
   * Put the look on air on `channel` (its project goes out with `transition`; the clock starts
   * now unless a reload handed over the take time), or take it off (null).
   */
  setChannel(channel: string | null, opts: { transition?: StageTransition | null } = {}): void {
    if (channel == null) {
      this.link.close();
      this.channelTarget = null;
      this.pendingTransition = null;
      return;
    }
    if (channel === this.channelTarget && this.link.isOpen) return;
    this.channelTarget = channel;
    this.pendingTransition = opts.transition ?? null;
    if (this.attached) this.goOnAir(channel);
  }

  private goOnAir(channel: string): void {
    if (this.snapshot.takenAt == null) this.set({ takenAt: Date.now() });
    if (!this.link.open(channel)) {
      this.notify("此瀏覽器不支援 BroadcastChannel，投影視窗無法同步。", "error");
      return;
    }
    this.broadcastProject();
    this.publish();
    if (this.preloadProject) this.link.post({ type: "preload", project: this.preloadProject });
  }

  /** Show mode: announce the armed item so the output warms its fonts and media. */
  setPreload(project: Project | null): void {
    this.preloadProject = project;
    if (project) this.link.post({ type: "preload", project });
  }

  private broadcastProject(): void {
    if (!this.link.isOpen) return;
    const transition = this.pendingTransition;
    this.pendingTransition = null;
    const project = this.snapshot.project;
    this.link.post(transition ? { type: "project", project, transition } : { type: "project", project });
  }

  private heartbeat(): void {
    this.link.heartbeat();
    this.persist();
    // the state carries no per-frame data: once a second heals a missed message
    this.publish();
  }

  private persist(): void {
    if (this.channelTarget == null) return;
    saveSession(this.sessionKey, { overrides: this.overrides, audioTime: 0 });
  }

  // ---------------------------------------------------------------- clock + state

  /** Seconds on air (0 before the take). A look never ends on its own. */
  elapsed(now: number = Date.now()): number {
    const at = this.snapshot.takenAt;
    return at == null ? 0 : Math.max(0, (now - at) / 1000);
  }

  /** The look's planned length (its durationHint, seconds), or null for an open-ended look. */
  get durationHint(): number | null {
    return this.hint;
  }

  private publish(): void {
    const project = this.snapshot.project;
    const now = Date.now();
    const takenAt = this.snapshot.takenAt;
    const state: StageState = {
      projectId: project.id,
      mode: "track",
      t: this.elapsed(now),
      playing: true,
      sentAt: now,
      lineIndex: (project.lyrics?.lines.length ?? 0) > 0 ? 0 : null,
      lineStartedAt: takenAt ?? now,
      sectionIndex: (project.plan?.sections.length ?? 0) > 0 ? 0 : null,
      overrides: this.overrides,
      audio: NO_AUDIO,
    };
    this.store.set(state);
    this.link.post({ type: "state", state });
  }

  // ---------------------------------------------------------------- overrides

  getOverrides(): StageOverrides {
    return this.overrides;
  }

  setOverrides(patch: Partial<StageOverrides>): void {
    const next: StageOverrides = { ...this.overrides, ...patch };
    next.intensity = Math.min(1.5, Math.max(0, Number.isFinite(next.intensity) ? next.intensity : 1));
    next.lyricScale = Math.min(2, Math.max(0.5, Number.isFinite(next.lyricScale) ? next.lyricScale : 1));
    this.overrides = next;
    this.persist();
    this.publish();
  }

  toggleBlackout(): void {
    this.setOverrides({ blackout: !this.overrides.blackout });
  }

  toggleLyrics(): void {
    this.setOverrides({ lyricsVisible: !this.overrides.lyricsVisible });
  }

  toggleFreeze(): void {
    this.setOverrides({ freeze: !this.overrides.freeze });
  }

  toggleTestPattern(): void {
    this.setOverrides({ testPattern: !this.overrides.testPattern });
  }

  setSceneOverride(scene: SceneId | null): void {
    this.setOverrides({ scene });
  }

  /** Keys 1–9: scene bank slot (the look's scene first). */
  sceneSlot(slot: number): void {
    const scene = sceneBank(this.snapshot.project.plan)[slot - 1];
    if (scene) this.setSceneOverride(scene);
  }

  resetOverrides(): void {
    this.overrides = { ...DEFAULT_OVERRIDES };
    this.persist();
    this.publish();
  }

  // ---------------------------------------------------------------- projection window

  openOutput(): void {
    if (!this.outputTarget) return;
    const win = openProjectionWindow(this.outputTarget, this.outputWindow);
    if (!win) {
      this.notify("瀏覽器封鎖了彈出視窗。請允許此網站開啟彈出視窗後再試一次。", "error");
      return;
    }
    this.outputWindow = win;
  }

  requestOutputFullscreen(): void {
    this.link.post({ type: "fullscreen" });
    this.notify("已要求投影視窗全螢幕；若沒有反應，請在投影視窗按 F 或雙擊畫面。", "info");
  }

  // ---------------------------------------------------------------- notices

  notify(message: string, tone: NoticeTone = "info"): void {
    const id = ++this.noticeSeq;
    const keep = this.noticeAutoDismiss ? 4 : 3;
    const notices = [...this.snapshot.notices.filter((n) => n.message !== message), { id, tone, message }].slice(-keep);
    this.set({ notices });
    if (typeof window === "undefined" || !this.noticeAutoDismiss) return;
    const timer = setTimeout(() => this.dismissNotice(id), tone === "error" ? NOTICE_MS * 2 : NOTICE_MS);
    this.noticeTimers.set(id, timer);
  }

  setNoticeAutoDismiss(enabled: boolean): void {
    if (enabled === this.noticeAutoDismiss) return;
    this.noticeAutoDismiss = enabled;
    if (!enabled) {
      for (const t of this.noticeTimers.values()) clearTimeout(t);
      this.noticeTimers.clear();
    }
  }

  dismissNotice(id: number): void {
    const timer = this.noticeTimers.get(id);
    if (timer) clearTimeout(timer);
    this.noticeTimers.delete(id);
    if (this.snapshot.notices.some((n) => n.id === id)) this.set({ notices: this.snapshot.notices.filter((n) => n.id !== id) });
  }
}
