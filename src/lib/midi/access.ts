// Web MIDI access (phase 5a, 控制器): requestMIDIAccess (SysEx only when MTC locate needs it), the
// inputs with hot-plug (MIDIAccess.onstatechange), one input or all of them, and every message
// handed on with its port and a timestamp on the console's clock (Date.now() ms). Browser only: the
// byte parsing and the mapping are pure (parser.ts, mapping.ts).
//
// Support: Chrome and Edge (desktop and Android); Firefox asks for a site permission add-on; Safari
// and every iPhone browser have no Web MIDI at all.

export interface MidiPort {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

export const MIDI_UNSUPPORTED = "這個瀏覽器不支援 MIDI（Safari／iPhone 不支援），請改用 Chrome 或 Edge";

export class MidiAccessError extends Error {
  readonly code: "unsupported" | "insecure" | "denied" | "failed";
  constructor(code: MidiAccessError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MidiAccessError";
    this.code = code;
  }
}

type MidiNavigator = Navigator & { requestMIDIAccess?: (options?: MIDIOptions) => Promise<MIDIAccess> };

export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator as MidiNavigator).requestMIDIAccess === "function";
}

function isFirefox(): boolean {
  return typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent ?? "");
}

function accessError(err: unknown, sysex: boolean): MidiAccessError {
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name ?? "") : "";
  if (name === "SecurityError" || name === "NotAllowedError") {
    if (isFirefox()) return new MidiAccessError("denied", "Firefox 需要先允許這個網站使用 MIDI（網站權限附加元件）；也可以改用 Chrome 或 Edge。", { cause: err });
    return new MidiAccessError(
      "denied",
      sysex ? "MIDI（含 SysEx）權限被拒絕。請在網址列左側的網站設定允許 MIDI 裝置後再試一次；不需要 MTC 定位時可以關閉它。" : "MIDI 權限被拒絕。請在網址列左側的網站設定允許 MIDI 裝置後再試一次。",
      { cause: err },
    );
  }
  const detail = err instanceof Error && err.message ? `（${err.message}）` : "";
  return new MidiAccessError("failed", `無法開啟 MIDI${detail}。`, { cause: err });
}

export interface MidiHubHandlers {
  /** one event's bytes, `at` on the Date.now() clock */
  onMessage(bytes: Uint8Array, at: number, portId: string): void;
  /** the input list changed (a device was plugged in or out) */
  onPorts(ports: MidiPort[]): void;
}

/** The console's one MIDIAccess: opens it, follows hot-plug, listens to one input or all. */
export class MidiHub {
  private access: MIDIAccess | null = null;
  private sysex = false;
  private selected = "all";
  private readonly listening = new Map<string, { port: MIDIInput; fn: (e: Event) => void }>();

  constructor(private readonly handlers: MidiHubHandlers) {}

  get isOpen(): boolean {
    return this.access != null;
  }

  get sysexEnabled(): boolean {
    return this.sysex;
  }

  /** Request access (a permission prompt the first time). Asking for SysEx again re-requests. */
  async open(opts: { sysex: boolean }): Promise<void> {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      throw new MidiAccessError("insecure", "瀏覽器只允許在 localhost 或 HTTPS 下使用 MIDI，請改用 http://localhost 開啟。");
    }
    if (!midiSupported()) throw new MidiAccessError("unsupported", MIDI_UNSUPPORTED);
    if (this.access && (this.sysex || !opts.sysex)) return;
    let access: MIDIAccess;
    try {
      access = await (navigator as MidiNavigator).requestMIDIAccess!({ sysex: opts.sysex });
    } catch (err) {
      throw accessError(err, opts.sysex);
    }
    this.detachAll();
    this.access = access;
    this.sysex = opts.sysex && access.sysexEnabled !== false;
    access.onstatechange = () => this.refresh();
    this.refresh();
  }

  /** Listen to one input (its id) or all of them ("all"). */
  setInput(id: string): void {
    this.selected = id || "all";
    this.refresh();
  }

  close(): void {
    this.detachAll();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.sysex = false;
    this.handlers.onPorts([]);
  }

  ports(): MidiPort[] {
    const out: MidiPort[] = [];
    this.access?.inputs.forEach((port) => out.push({ id: port.id, name: port.name || "MIDI 輸入", manufacturer: port.manufacturer || "", connected: port.state === "connected" }));
    return out;
  }

  private detachAll(): void {
    for (const { port, fn } of this.listening.values()) {
      try {
        port.removeEventListener("midimessage", fn);
      } catch {
        /* gone */
      }
    }
    this.listening.clear();
  }

  private refresh(): void {
    const access = this.access;
    if (!access) return;
    const want = new Set<string>();
    access.inputs.forEach((port) => {
      if (port.state === "connected" && (this.selected === "all" || this.selected === port.id)) want.add(port.id);
    });
    for (const [id, entry] of this.listening) {
      if (want.has(id)) continue;
      try {
        entry.port.removeEventListener("midimessage", entry.fn);
      } catch {
        /* gone */
      }
      this.listening.delete(id);
    }
    access.inputs.forEach((port) => {
      if (!want.has(port.id) || this.listening.has(port.id)) return;
      const fn = (e: Event) => {
        const ev = e as MIDIMessageEvent;
        const data = ev.data;
        if (!data || data.length === 0) return;
        // the event's timestamp (performance clock) moved onto Date.now()
        const stamp = typeof ev.timeStamp === "number" && ev.timeStamp > 0 ? ev.timeStamp : performance.now();
        const at = Date.now() - Math.max(0, performance.now() - stamp);
        try {
          this.handlers.onMessage(data, at, port.id);
        } catch (err) {
          console.error("[Livelyrics] MIDI 訊息處理失敗：", err);
        }
      };
      port.addEventListener("midimessage", fn);
      // addEventListener does not open a port implicitly (setting onmidimessage would)
      port.open?.().catch(() => {});
      this.listening.set(port.id, { port, fn });
    });
    this.handlers.onPorts(this.ports());
  }
}
