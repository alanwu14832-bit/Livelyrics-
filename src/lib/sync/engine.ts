// The console's sync layer (phase 5a, 同步與控制器): one per console window. It owns the MIDI input
// (Web MIDI: controllers, MIDI clock, MTC), the LTC audio input, the timecode chase and the beat
// clock, and tells the console three things:
//   - the sync source the operator chose (手動 / MIDI clock / MTC / LTC) and its lock state
//     (等待訊號, 鎖定, 已定位, 自由運轉, 中斷), with the frame rate;
//   - live readings for the frame loop: timecode(now) (the chased position, MTC / LTC) and beat(now)
//     (tempo and phase of a MIDI clock) — never through React state;
//   - the mapped controller commands (MIDI learn, the presets), to whoever listens (the console view
//     that is on screen: it runs them like its hotkeys, with the HUD).
// The per-song console (/p/[id]) makes its own engine; the show console (/s/[id]/live) makes one for
// the whole show and hands it to every song it takes. Manual operation never needs any of this: the
// default source is 手動, and MIDI / audio permission is only asked for when the operator turns
// something on. Framework-agnostic (subscribe / getSnapshot for React).

import { listAudioInputs, type AudioInputDevice } from "@/lib/audio/live";
import { MIDI_UNSUPPORTED, MidiAccessError, MidiHub, midiSupported, type MidiPort } from "@/lib/midi/access";
import { MidiClock, type ClockStatus } from "@/lib/midi/clock";
import { MidiMapper, clearBinding as withoutBinding, type LineNotesPreset, type MidiCommand, type MidiLearnResult, type MidiMap, type MidiTarget, type SectionNotesPreset } from "@/lib/midi/mapping";
import { MtcAssembler } from "@/lib/midi/mtc";
import { MidiParser, describeMidi, type MidiMessage } from "@/lib/midi/parser";
import { loadMidiPrefs, saveMidiPrefs, type MidiPrefs } from "@/lib/midi/prefs";
import { TimecodeChase, type ChaseStatus } from "./chase";
import { LtcInput, type LtcInputFrame } from "./ltc-input";
import { DEFAULT_SYNC_SETTINGS, parseSyncSettings, type SyncSettings, type SyncSource } from "./settings";
import { secondsToTc, type FrameRate, type Timecode } from "./timecode";

export { DEFAULT_SYNC_SETTINGS, FREEWHEEL_MAX_SECONDS, FREEWHEEL_MIN_SECONDS, SYNC_SOURCES, SYNC_SOURCE_LABELS, parseSyncSettings, type SyncSettings, type SyncSource } from "./settings";

/** off = manual; the rest is the chosen source's state. */
export type LockState = "off" | "waiting" | "locked" | "stopped" | "freewheel" | "lost";

export interface MidiState {
  status: "off" | "starting" | "on" | "error";
  message: string | null;
  supported: boolean;
  ports: MidiPort[];
  input: string;
  sysex: boolean;
  /** the operator turned MIDI on (remembered in this browser) */
  enabled: boolean;
}

export interface LtcState {
  status: "off" | "starting" | "on" | "error";
  message: string | null;
  devices: AudioInputDevice[];
  /** the input channel the timecode is on (0-based) */
  channel: number | null;
  /** the audio engine waits for a click (autoplay policy) */
  suspended: boolean;
}

export interface SyncSnapshot {
  settings: SyncSettings;
  lock: LockState;
  rate: FrameRate | null;
  midi: MidiState;
  map: MidiMap;
  learning: MidiTarget | null;
  /** the last learn (for the sheet's feedback); seq changes with every learn */
  learned: (MidiLearnResult & { seq: number }) | null;
  ltc: LtcState;
}

export interface TimecodeReading {
  /** real seconds since 00:00:00:00 now */
  position: number;
  label: Timecode;
  rate: FrameRate;
  status: ChaseStatus;
  running: boolean;
  direction: 1 | -1;
}

export type BeatReading = ClockStatus;

export interface SyncEngineOptions {
  settings?: Partial<SyncSettings>;
  /** the sync settings changed (the owner stores them per project / show) */
  onSettings?: (settings: SyncSettings) => void;
}

const LOCK_POLL_MS = 100;

export class SyncEngine {
  private snapshot: SyncSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(cmd: MidiCommand) => void>();
  private onSettings: ((s: SyncSettings) => void) | null;
  private prefs: MidiPrefs;
  private attached = false;
  private readonly hub: MidiHub;
  private readonly parsers = new Map<string, MidiParser>();
  private readonly mapper = new MidiMapper();
  private readonly clock = new MidiClock();
  private readonly mtc = new MtcAssembler();
  private readonly chase = new TimecodeChase();
  private clockEverLocked = false;
  private ltc: LtcInput | null = null;
  private ltcSeq = 0;
  private level = { peak: 0, at: 0 };
  private lastActivity: { at: number; text: string } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private learnSeq = 0;
  private deviceCleanup: (() => void) | null = null;

  constructor(opts: SyncEngineOptions = {}) {
    this.onSettings = opts.onSettings ?? null;
    this.prefs = { enabled: false, input: "all", sysex: false, map: this.mapper.current };
    const settings = parseSyncSettings({ ...DEFAULT_SYNC_SETTINGS, ...opts.settings });
    this.chase.setFreewheel(settings.freewheelSeconds * 1000);
    this.hub = new MidiHub({
      onMessage: (bytes, at, port) => this.receive(bytes, at, port),
      onPorts: (ports) => this.set({ midi: { ...this.snapshot.midi, ports } }),
    });
    this.snapshot = {
      settings,
      lock: settings.source === "manual" ? "off" : "waiting",
      rate: null,
      midi: { status: "off", message: null, supported: midiSupported(), ports: [], input: "all", sysex: false, enabled: false },
      map: this.mapper.current,
      learning: null,
      learned: null,
      ltc: { status: "off", message: null, devices: [], channel: null, suspended: false },
    };
  }

  // ---------------------------------------------------------------- React binding

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SyncSnapshot => this.snapshot;

  private set(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (err) {
        console.error("[Livelyrics] 同步狀態更新失敗：", err);
      }
    }
  }

  /** Mapped controller commands; returns the unsubscribe. */
  onCommand(listener: (cmd: MidiCommand) => void): () => void {
    this.commandListeners.add(listener);
    return () => {
      this.commandListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- lifecycle

  /** Settings loaded after construction (before attach): the per-song console reads them in attach. */
  configure(settings: Partial<SyncSettings>, onSettings?: (s: SyncSettings) => void): void {
    if (onSettings) this.onSettings = onSettings;
    const next = parseSyncSettings({ ...this.snapshot.settings, ...settings });
    this.chase.setFreewheel(next.freewheelSeconds * 1000);
    this.set({ settings: next, lock: next.source === "manual" ? "off" : this.snapshot.lock });
    if (this.attached) this.applySource(null, next.source);
  }

  attach(): void {
    if (this.attached || typeof window === "undefined") return;
    this.attached = true;
    this.prefs = loadMidiPrefs();
    this.mapper.setMap(this.prefs.map);
    this.set({ map: this.prefs.map, midi: { ...this.snapshot.midi, supported: midiSupported(), input: this.prefs.input, sysex: this.prefs.sysex, enabled: this.prefs.enabled } });
    this.hub.setInput(this.prefs.input);
    const source = this.snapshot.settings.source;
    if (this.prefs.enabled || source === "clock" || source === "mtc") void this.openMidi();
    if (source === "ltc") void this.startLtc();
    this.timer = setInterval(() => this.poll(), LOCK_POLL_MS);
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const onChange = () => void this.refreshDevices();
    media?.addEventListener?.("devicechange", onChange);
    this.deviceCleanup = () => media?.removeEventListener?.("devicechange", onChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deviceCleanup?.();
    this.deviceCleanup = null;
    this.hub.close();
    this.parsers.clear();
    this.stopLtc();
    this.mapper.learn(null);
    this.set({ midi: { ...this.snapshot.midi, status: "off", ports: [] }, learning: null });
  }

  // ---------------------------------------------------------------- settings

  get settings(): SyncSettings {
    return this.snapshot.settings;
  }

  get source(): SyncSource {
    return this.snapshot.settings.source;
  }

  private saveSettings(next: SyncSettings): void {
    this.set({ settings: next });
    try {
      this.onSettings?.(next);
    } catch (err) {
      console.error("[Livelyrics] 同步設定儲存失敗：", err);
    }
  }

  /** Choose what drives the console (回到手動 = "manual"). */
  setSource(source: SyncSource): void {
    const prev = this.snapshot.settings.source;
    if (source === prev) return;
    this.saveSettings({ ...this.snapshot.settings, source });
    this.applySource(prev, source);
  }

  private applySource(prev: SyncSource | null, source: SyncSource): void {
    this.chase.reset();
    this.mtc.reset();
    this.clockEverLocked = false;
    if (prev === "ltc" || (prev == null && source !== "ltc")) this.stopLtc();
    if (source === "ltc" && !this.ltc) void this.startLtc();
    if ((source === "clock" || source === "mtc") && this.snapshot.midi.status !== "on" && this.snapshot.midi.status !== "starting") void this.openMidi();
    this.poll(true);
  }

  setFreewheel(seconds: number): void {
    const next = parseSyncSettings({ ...this.snapshot.settings, freewheelSeconds: seconds });
    if (next.freewheelSeconds === this.snapshot.settings.freewheelSeconds) return;
    this.chase.setFreewheel(next.freewheelSeconds * 1000);
    this.saveSettings(next);
  }

  setLtcDevice(deviceId: string): void {
    if (deviceId === this.snapshot.settings.ltcDeviceId) return;
    this.saveSettings({ ...this.snapshot.settings, ltcDeviceId: deviceId });
    if (this.source === "ltc") {
      this.stopLtc();
      this.chase.reset();
      void this.startLtc();
    }
  }

  // ---------------------------------------------------------------- MIDI

  private savePrefs(patch: Partial<MidiPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    saveMidiPrefs(this.prefs);
  }

  /** Turn MIDI on (a permission prompt the first time) and remember it in this browser. */
  async enableMidi(): Promise<void> {
    this.savePrefs({ enabled: true });
    this.set({ midi: { ...this.snapshot.midi, enabled: true } });
    await this.openMidi();
  }

  /** Turn MIDI off; a MIDI source falls back to manual. */
  disableMidi(): void {
    this.savePrefs({ enabled: false });
    this.hub.close();
    this.parsers.clear();
    this.mapper.learn(null);
    this.set({ midi: { ...this.snapshot.midi, status: "off", message: null, ports: [], enabled: false }, learning: null });
    if (this.source === "clock" || this.source === "mtc") this.setSource("manual");
  }

  setMidiInput(id: string): void {
    const input = id || "all";
    this.savePrefs({ input });
    this.hub.setInput(input);
    this.parsers.clear();
    this.set({ midi: { ...this.snapshot.midi, input } });
  }

  /** MTC locate: SysEx needs its own permission, so it is asked for only when this is turned on. */
  async setMtcLocate(on: boolean): Promise<void> {
    this.savePrefs({ sysex: on });
    this.set({ midi: { ...this.snapshot.midi, sysex: on } });
    if (on && this.snapshot.midi.status === "on" && !this.hub.sysexEnabled) await this.openMidi();
  }

  private async openMidi(): Promise<void> {
    if (!this.attached) return;
    if (!midiSupported()) {
      this.set({ midi: { ...this.snapshot.midi, status: "error", supported: false, message: MIDI_UNSUPPORTED } });
      return;
    }
    this.set({ midi: { ...this.snapshot.midi, status: "starting", message: null } });
    try {
      await this.hub.open({ sysex: this.prefs.sysex });
      if (!this.attached) {
        this.hub.close();
        return;
      }
      this.set({ midi: { ...this.snapshot.midi, status: "on", message: null, ports: this.hub.ports(), sysex: this.prefs.sysex } });
    } catch (err) {
      if (!this.attached) return;
      const message = err instanceof MidiAccessError ? err.message : `無法開啟 MIDI${err instanceof Error && err.message ? `（${err.message}）` : ""}。`;
      const sysexDenied = this.prefs.sysex && err instanceof MidiAccessError && err.code === "denied";
      this.set({ midi: { ...this.snapshot.midi, status: "error", message, supported: midiSupported() } });
      // without SysEx the quarter frames still work: try again without it
      if (sysexDenied) {
        this.savePrefs({ sysex: false });
        this.set({ midi: { ...this.snapshot.midi, sysex: false } });
        try {
          await this.hub.open({ sysex: false });
          if (this.attached) this.set({ midi: { ...this.snapshot.midi, status: "on", message: "SysEx 權限被拒絕：MTC 定位已關閉，四分之一格照常使用。", ports: this.hub.ports() } });
        } catch {
          /* the first message stays */
        }
      }
    }
  }

  private receive(bytes: Uint8Array, at: number, port: string): void {
    let parser = this.parsers.get(port);
    if (!parser) {
      parser = new MidiParser();
      this.parsers.set(port, parser);
    }
    parser.feed(bytes, (msg) => this.handle(msg, at));
  }

  /** One parsed message (also the test hook: MIDI without a device). */
  handle(msg: MidiMessage, at: number): void {
    switch (msg.type) {
      case "clock":
        this.clock.tick(at);
        return;
      case "start":
        this.clock.start();
        return;
      case "continue":
        this.clock.continue();
        return;
      case "stop":
        this.clock.stop();
        return;
      case "songPosition":
        this.clock.songPosition(msg.beats);
        return;
      case "mtcQuarterFrame": {
        if (this.source !== "mtc") return;
        const f = this.mtc.quarterFrame(msg.piece, msg.value, at);
        if (f) this.chase.push({ position: f.position, at: f.at, rate: f.rate, direction: f.direction });
        return;
      }
      case "sysex": {
        if (this.source !== "mtc") return;
        const f = this.mtc.fullFrame(msg.data, at);
        if (f) {
          this.chase.locate(f.position, f.at, f.rate);
          this.poll(true);
        }
        return;
      }
      case "reset":
        return;
      default:
        break;
    }
    this.lastActivity = { at, text: describeMidi(msg) };
    const { commands, learned } = this.mapper.handle(msg, at);
    if (learned) {
      this.savePrefs({ map: this.mapper.current });
      this.set({ map: this.mapper.current, learning: null, learned: { ...learned, seq: ++this.learnSeq } });
    }
    // (a snapshot: a command can mount another console view that subscribes while this runs)
    const listeners = [...this.commandListeners];
    for (const cmd of commands) {
      for (const l of listeners) {
        try {
          l(cmd);
        } catch (err) {
          console.error("[Livelyrics] MIDI 指令執行失敗：", err);
        }
      }
    }
  }

  /** The last note / controller message (the activity light and readout), never clock or timecode. */
  activity(): { at: number; text: string } | null {
    return this.lastActivity;
  }

  // ---------------------------------------------------------------- mapping

  learn(target: MidiTarget | null): void {
    this.mapper.learn(target);
    this.set({ learning: target, learned: target ? null : this.snapshot.learned });
  }

  clearBinding(target: MidiTarget): void {
    this.replaceMap(withoutBinding(this.mapper.current, target));
  }

  setLineNotes(patch: Partial<LineNotesPreset>): void {
    this.replaceMap({ ...this.mapper.current, lineNotes: { ...this.mapper.current.lineNotes, ...patch } });
  }

  setSectionNotes(patch: Partial<SectionNotesPreset>): void {
    this.replaceMap({ ...this.mapper.current, sectionNotes: { ...this.mapper.current.sectionNotes, ...patch } });
  }

  /** A whole map (匯入, 全部清除). */
  replaceMap(map: MidiMap): void {
    this.mapper.setMap(map);
    this.savePrefs({ map });
    this.set({ map });
  }

  // ---------------------------------------------------------------- LTC

  private async startLtc(): Promise<void> {
    if (!this.attached || this.ltc) return;
    const seq = ++this.ltcSeq;
    this.set({ ltc: { ...this.snapshot.ltc, status: "starting", message: null, channel: null } });
    try {
      const input = await LtcInput.start(this.snapshot.settings.ltcDeviceId, {
        onFrame: (f: LtcInputFrame) => this.chase.push({ position: f.position, at: f.at, rate: f.rate, direction: f.direction }),
        onLevel: (peak) => {
          this.level = { peak, at: Date.now() };
        },
        onEnded: (message) => {
          this.stopLtc();
          this.set({ ltc: { ...this.snapshot.ltc, status: "error", message } });
        },
      });
      if (seq !== this.ltcSeq || !this.attached || this.source !== "ltc") {
        input.stop();
        return;
      }
      this.ltc = input;
      this.set({ ltc: { ...this.snapshot.ltc, status: "on", message: null, suspended: input.suspended } });
      void this.refreshDevices();
    } catch (err) {
      if (seq !== this.ltcSeq) return;
      this.set({ ltc: { ...this.snapshot.ltc, status: "error", message: err instanceof Error ? err.message : "無法開啟 LTC 音訊輸入。" } });
    }
  }

  private stopLtc(): void {
    this.ltcSeq++;
    this.ltc?.stop();
    this.ltc = null;
    this.level = { peak: 0, at: 0 };
    if (this.snapshot.ltc.status !== "off") this.set({ ltc: { ...this.snapshot.ltc, status: "off", message: null, channel: null, suspended: false } });
  }

  /** Try the LTC input again (after an error). */
  retryLtc(): void {
    this.stopLtc();
    if (this.source === "ltc") void this.startLtc();
  }

  async refreshDevices(): Promise<void> {
    const devices = await listAudioInputs();
    if (this.attached) this.set({ ltc: { ...this.snapshot.ltc, devices } });
  }

  /** The LTC input's peak level (0..1) of the last tenth of a second. */
  ltcLevel(now: number = Date.now()): number {
    return now - this.level.at < 500 ? this.level.peak : 0;
  }

  // ---------------------------------------------------------------- readings

  /** The chased timecode now (MTC / LTC sources), or null before any lock. */
  timecode(now: number = Date.now()): TimecodeReading | null {
    if (this.source !== "mtc" && this.source !== "ltc") return null;
    const s = this.chase.state(now);
    if (s.position == null || s.rate == null) return null;
    return { position: s.position, label: secondsToTc(s.position, s.rate), rate: s.rate, status: s.status, running: s.running, direction: s.direction };
  }

  /** The MIDI clock now (whatever the source: the readout shows the tempo of any clock that comes in). */
  beat(now: number = Date.now()): BeatReading {
    return this.clock.status(now);
  }

  private lockAt(now: number): { lock: LockState; rate: FrameRate | null } {
    switch (this.source) {
      case "manual":
        return { lock: "off", rate: null };
      case "clock": {
        const s = this.clock.status(now);
        if (s.locked) this.clockEverLocked = true;
        return { lock: s.locked ? "locked" : this.clockEverLocked ? "lost" : "waiting", rate: null };
      }
      default: {
        const s = this.chase.state(now);
        return { lock: s.status, rate: s.rate };
      }
    }
  }

  /** Recompute the lock state (the poll timer; `force` after a change the operator made). */
  private poll(force = false): void {
    const { lock, rate } = this.lockAt(Date.now());
    const suspended = this.ltc ? this.ltc.suspended : false;
    const channel = this.ltc ? this.ltc.channel : null;
    const s = this.snapshot;
    if (force || lock !== s.lock || rate !== s.rate || suspended !== s.ltc.suspended || channel !== s.ltc.channel) {
      this.set({ lock, rate, ...(suspended !== s.ltc.suspended || channel !== s.ltc.channel ? { ltc: { ...s.ltc, suspended, channel } } : {}) });
    }
  }
}
