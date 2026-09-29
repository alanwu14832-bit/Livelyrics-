// MIDI 1.0 byte-stream parsing (phase 5a, 控制器). Pure: bytes in, messages out.
//
// - Running status: a channel message may omit its status byte when it repeats the previous one.
// - Real-time bytes (F8 clock, FA start, FB continue, FC stop, FF reset) may arrive anywhere, even
//   between the data bytes of another message or inside a SysEx; they are passed on at once and
//   leave the message in progress untouched. FE active sensing is dropped.
// - System common (F1 MTC quarter frame, F2 song position, F3 song select, F6 tune request) cancels
//   running status. SysEx (F0 … F7) is collected whole; any other status byte ends an unterminated
//   one (dropped). Undefined bytes (F4 F5 F9 FD) are ignored, stray data bytes too.
// - Note on with velocity 0 is a note off.
//
// Web MIDI delivers one complete message per event in practice, but nothing in the console
// relies on that: every port gets its own parser and events are fed as byte chunks.

export type MidiMessage =
  | { type: "noteOn"; channel: number; note: number; velocity: number }
  | { type: "noteOff"; channel: number; note: number; velocity: number }
  | { type: "cc"; channel: number; controller: number; value: number }
  | { type: "programChange"; channel: number; program: number }
  | { type: "channelPressure"; channel: number; value: number }
  | { type: "polyPressure"; channel: number; note: number; value: number }
  /** -8192..8191 */
  | { type: "pitchBend"; channel: number; value: number }
  /** F1: data byte 0nnn dddd (piece n, nibble d) */
  | { type: "mtcQuarterFrame"; piece: number; value: number }
  /** F2: position in MIDI beats (sixteenth notes, 6 clocks each) */
  | { type: "songPosition"; beats: number }
  | { type: "songSelect"; song: number }
  | { type: "tuneRequest" }
  /** F0 … F7, both included */
  | { type: "sysex"; data: Uint8Array }
  | { type: "clock" }
  | { type: "start" }
  | { type: "continue" }
  | { type: "stop" }
  | { type: "reset" };

export type RealtimeType = "clock" | "start" | "continue" | "stop";

/** SysEx longer than this is dropped (an MTC full frame is 10 bytes). */
export const MAX_SYSEX_BYTES = 4096;

const REALTIME: Record<number, MidiMessage | null> = {
  0xf8: { type: "clock" },
  0xfa: { type: "start" },
  0xfb: { type: "continue" },
  0xfc: { type: "stop" },
  0xfe: null, // active sensing: ignored
  0xff: { type: "reset" },
};

/** Data bytes that follow a channel status (0x80..0xEF). */
function channelDataLength(status: number): number {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

export class MidiParser {
  private status = 0;
  private data: number[] = [];
  private need = 0;
  private sysex: number[] | null = null;

  /** Feed bytes; `emit` gets every complete message in order. */
  feed(bytes: ArrayLike<number>, emit: (msg: MidiMessage) => void): void {
    for (let i = 0; i < bytes.length; i++) this.byte(bytes[i] & 0xff, emit);
  }

  /** Forget any message in progress (a port was reconnected). */
  reset(): void {
    this.status = 0;
    this.data = [];
    this.need = 0;
    this.sysex = null;
  }

  private byte(b: number, emit: (msg: MidiMessage) => void): void {
    if (b >= 0xf8) {
      // real-time: never interrupts what is being received
      const msg = REALTIME[b];
      if (msg) emit(msg);
      return;
    }
    if (this.sysex) {
      if (b === 0xf7) {
        this.sysex.push(b);
        emit({ type: "sysex", data: Uint8Array.from(this.sysex) });
        this.sysex = null;
        return;
      }
      if (b < 0x80) {
        if (this.sysex.length < MAX_SYSEX_BYTES) this.sysex.push(b);
        else this.sysex = null; // too long: dropped
        return;
      }
      // a status byte ends an unterminated SysEx (dropped); the byte is handled below
      this.sysex = null;
    }
    if (b >= 0x80) {
      this.data = [];
      if (b < 0xf0) {
        this.status = b;
        this.need = channelDataLength(b);
        return;
      }
      // system common: cancels running status
      this.status = 0;
      this.need = 0;
      switch (b) {
        case 0xf0:
          this.sysex = [b];
          return;
        case 0xf1:
        case 0xf3:
          this.status = b;
          this.need = 1;
          return;
        case 0xf2:
          this.status = b;
          this.need = 2;
          return;
        case 0xf6:
          emit({ type: "tuneRequest" });
          return;
        default:
          return; // F4 F5 F7 (stray end of SysEx): nothing
      }
    }
    // a data byte
    if (!this.status) return;
    this.data.push(b);
    if (this.data.length < this.need) return;
    const [d1, d2 = 0] = this.data;
    this.data = [];
    const status = this.status;
    if (status >= 0xf0) {
      // system common messages do not run on
      this.status = 0;
      if (status === 0xf1) emit({ type: "mtcQuarterFrame", piece: (d1 >> 4) & 7, value: d1 & 0x0f });
      else if (status === 0xf2) emit({ type: "songPosition", beats: d1 | (d2 << 7) });
      else emit({ type: "songSelect", song: d1 });
      return;
    }
    const channel = status & 0x0f;
    switch (status & 0xf0) {
      case 0x80:
        emit({ type: "noteOff", channel, note: d1, velocity: d2 });
        break;
      case 0x90:
        emit(d2 === 0 ? { type: "noteOff", channel, note: d1, velocity: 0 } : { type: "noteOn", channel, note: d1, velocity: d2 });
        break;
      case 0xa0:
        emit({ type: "polyPressure", channel, note: d1, value: d2 });
        break;
      case 0xb0:
        emit({ type: "cc", channel, controller: d1, value: d2 });
        break;
      case 0xc0:
        emit({ type: "programChange", channel, program: d1 });
        break;
      case 0xd0:
        emit({ type: "channelPressure", channel, value: d1 });
        break;
      case 0xe0:
        emit({ type: "pitchBend", channel, value: (d1 | (d2 << 7)) - 8192 });
        break;
    }
  }
}

/** Parse a complete byte sequence (tests, fixtures). */
export function parseMidi(bytes: ArrayLike<number>): MidiMessage[] {
  const out: MidiMessage[] = [];
  new MidiParser().feed(bytes, (m) => out.push(m));
  return out;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Note name with middle C (60) = C3, the convention of Ableton, Logic and most DAWs. */
export function noteName(note: number): string {
  const n = Math.max(0, Math.min(127, Math.round(note)));
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`;
}

/** A short Traditional Chinese description of a message (the activity readout). */
export function describeMidi(msg: MidiMessage): string {
  const ch = (c: number) => `聲道 ${c + 1}`;
  switch (msg.type) {
    case "noteOn":
      return `音符 ${noteName(msg.note)}（${msg.note}）按下・力度 ${msg.velocity}・${ch(msg.channel)}`;
    case "noteOff":
      return `音符 ${noteName(msg.note)}（${msg.note}）放開・${ch(msg.channel)}`;
    case "cc":
      return `CC ${msg.controller} = ${msg.value}・${ch(msg.channel)}`;
    case "programChange":
      return `Program ${msg.program}・${ch(msg.channel)}`;
    case "channelPressure":
      return `觸後 ${msg.value}・${ch(msg.channel)}`;
    case "polyPressure":
      return `音符觸後 ${msg.note} = ${msg.value}・${ch(msg.channel)}`;
    case "pitchBend":
      return `滑音 ${msg.value}・${ch(msg.channel)}`;
    case "mtcQuarterFrame":
      return "MTC 四分之一格";
    case "songPosition":
      return `歌曲位置 ${msg.beats}`;
    case "songSelect":
      return `選曲 ${msg.song}`;
    case "tuneRequest":
      return "Tune request";
    case "sysex":
      return `SysEx（${msg.data.length} 位元組）`;
    case "clock":
      return "MIDI clock";
    case "start":
      return "Start";
    case "continue":
      return "Continue";
    case "stop":
      return "Stop";
    case "reset":
      return "Reset";
  }
}
