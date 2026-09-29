// MIDI controller mapping (phase 5a, 控制器): which note or CC fires which console action, MIDI
// learn, the two presets (ProPresenter 式: note n → lyric line n + offset; 段落音符: note base + k →
// section k), conflicts, and import / export. Pure (the MidiMapper keeps per-control state).
//
// Safety rules (a pad bounces, a pedal chatters, a fader passes through the middle):
// - note off (and note on with velocity 0) never fires a button action;
// - a CC bound to a button fires when it rises to ≥ 64 and re-arms only below 40 (hysteresis);
// - a button action ignores a repeat within 60 ms, GO and standby within 150 ms (tap never: the
//   tap clock rejects bounces itself);
// - explicit bindings win over the presets for the same note (the UI lists the conflict).
// GO and standby are show-console actions: the per-song console ignores them.

import { noteName, type MidiMessage } from "./parser";

export const BUTTON_TARGETS = [
  "go",
  "standby",
  "togglePlay",
  "next",
  "prev",
  "cueSelected",
  "selectNext",
  "selectPrev",
  "clearLine",
  "mode",
  "sectionNext",
  "sectionPrev",
  "hold",
  "loop",
  "blackout",
  "lyrics",
  "freeze",
  "testPattern",
  "scene1",
  "scene2",
  "scene3",
  "scene4",
  "scene5",
  "scene6",
  "scene7",
  "scene8",
  "scene9",
  "followPlan",
  "tap",
  "offsetDown",
  "offsetUp",
  "manual",
] as const;
export type MidiButtonTarget = (typeof BUTTON_TARGETS)[number];

export const VALUE_TARGETS = ["intensity", "lyricScale", "ledCap"] as const;
export type MidiValueTarget = (typeof VALUE_TARGETS)[number];

export type MidiTarget = MidiButtonTarget | MidiValueTarget;

const BUTTON_SET = new Set<string>(BUTTON_TARGETS);
const VALUE_SET = new Set<string>(VALUE_TARGETS);
export const isButtonTarget = (t: unknown): t is MidiButtonTarget => typeof t === "string" && BUTTON_SET.has(t);
export const isValueTarget = (t: unknown): t is MidiValueTarget => typeof t === "string" && VALUE_SET.has(t);
export const isMidiTarget = (t: unknown): t is MidiTarget => isButtonTarget(t) || isValueTarget(t);

export type TargetGroup = "show" | "transport" | "sections" | "stage" | "sync" | "values";

export const TARGET_GROUPS: ReadonlyArray<{ id: TargetGroup; title: string }> = [
  { id: "show", title: "演出" },
  { id: "transport", title: "播放與提詞" },
  { id: "sections", title: "段落" },
  { id: "stage", title: "畫面控制" },
  { id: "sync", title: "同步" },
  { id: "values", title: "連續控制（推桿、旋鈕）" },
];

export interface TargetInfo {
  target: MidiTarget;
  label: string;
  group: TargetGroup;
  /** the keyboard shortcut of the same action, for the sheet */
  hotkey?: string;
  /** only in the show console (/s/[id]/live) */
  showOnly?: boolean;
}

export const TARGETS: readonly TargetInfo[] = [
  { target: "go", label: "GO：播出待命的項目", group: "show", hotkey: "G", showOnly: true },
  { target: "standby", label: "緊急切到待機畫面", group: "show", hotkey: "S", showOnly: true },
  { target: "togglePlay", label: "播放／暫停（LIVE：下一句）", group: "transport", hotkey: "Space" },
  { target: "next", label: "下一句", group: "transport", hotkey: "→" },
  { target: "prev", label: "上一句", group: "transport", hotkey: "←" },
  { target: "cueSelected", label: "送出待命的歌詞", group: "transport", hotkey: "Enter" },
  { target: "selectNext", label: "待命選取往下", group: "transport", hotkey: "Shift ↓" },
  { target: "selectPrev", label: "待命選取往上", group: "transport", hotkey: "Shift ↑" },
  { target: "clearLine", label: "清除目前歌詞（LIVE）", group: "transport", hotkey: "Esc" },
  { target: "mode", label: "切換 TRACK／LIVE", group: "transport", hotkey: "M" },
  { target: "sectionNext", label: "下一段", group: "sections", hotkey: "PgDn" },
  { target: "sectionPrev", label: "上一段", group: "sections", hotkey: "PgUp" },
  { target: "hold", label: "保持段落", group: "sections", hotkey: "H" },
  { target: "loop", label: "循環段落", group: "sections", hotkey: "R" },
  { target: "blackout", label: "一鍵黑場", group: "stage", hotkey: "B" },
  { target: "lyrics", label: "歌詞顯示／隱藏", group: "stage", hotkey: "L" },
  { target: "freeze", label: "凍結畫面", group: "stage", hotkey: "F" },
  { target: "testPattern", label: "測試圖", group: "stage" },
  ...Array.from({ length: 9 }, (_, i) => ({ target: `scene${i + 1}` as MidiButtonTarget, label: `場景庫第 ${i + 1} 格`, group: "stage" as const, hotkey: String(i + 1) })),
  { target: "followPlan", label: "回到設計方案的場景", group: "stage", hotkey: "0" },
  { target: "tap", label: "Tap tempo", group: "sync", hotkey: "T" },
  { target: "offsetDown", label: "偏移 −0.05 秒", group: "sync", hotkey: "[" },
  { target: "offsetUp", label: "偏移 +0.05 秒", group: "sync", hotkey: "]" },
  { target: "manual", label: "回到手動", group: "sync", hotkey: "X" },
  { target: "intensity", label: "畫面強度", group: "values" },
  { target: "lyricScale", label: "歌詞字級", group: "values" },
  { target: "ledCap", label: "最高亮度（不超過 LED 安全預設）", group: "values" },
];

export function targetInfo(target: MidiTarget): TargetInfo | undefined {
  return TARGETS.find((t) => t.target === target);
}

/** A note or a controller; channel 0..15, or -1 for any channel. */
export interface MidiTrigger {
  kind: "note" | "cc";
  channel: number;
  number: number;
}

export interface MidiBinding extends MidiTrigger {
  target: MidiTarget;
}

/** ProPresenter 式: note n → lyric line n + offset (0-based line index). */
export interface LineNotesPreset {
  enabled: boolean;
  channel: number;
  offset: number;
}

/** 段落音符: note base + k → plan section k. */
export interface SectionNotesPreset {
  enabled: boolean;
  channel: number;
  base: number;
}

export interface MidiMap {
  version: 1;
  bindings: MidiBinding[];
  lineNotes: LineNotesPreset;
  sectionNotes: SectionNotesPreset;
}

export const DEFAULT_MIDI_MAP: MidiMap = {
  version: 1,
  bindings: [],
  lineNotes: { enabled: false, channel: 0, offset: 0 },
  sectionNotes: { enabled: false, channel: 1, base: 0 },
};

export function defaultMidiMap(): MidiMap {
  return { ...DEFAULT_MIDI_MAP, bindings: [], lineNotes: { ...DEFAULT_MIDI_MAP.lineNotes }, sectionNotes: { ...DEFAULT_MIDI_MAP.sectionNotes } };
}

export type MidiCommand =
  | { kind: "button"; target: MidiButtonTarget }
  /** 0..1 (the CC value / 127) */
  | { kind: "value"; target: MidiValueTarget; value: number }
  /** ProPresenter 式: cue this line (0-based) */
  | { kind: "line"; index: number }
  /** 段落音符: jump to this section (0-based) */
  | { kind: "section"; index: number };

export interface MidiLearnResult {
  binding: MidiBinding;
  /** actions that lost this note / controller to the new binding */
  replaced: MidiTarget[];
}

export const CC_ON = 64;
export const CC_OFF = 40;
export const BUTTON_DEBOUNCE_MS = 60;
export const SHOW_DEBOUNCE_MS = 150;

const channelMatches = (want: number, got: number) => want < 0 || want === got;
const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

function sameTrigger(a: MidiTrigger, b: MidiTrigger): boolean {
  return a.kind === b.kind && a.number === b.number && (a.channel < 0 || b.channel < 0 || a.channel === b.channel);
}

function debounceFor(key: string): number {
  if (key === "go" || key === "standby") return SHOW_DEBOUNCE_MS;
  if (key === "tap") return 0;
  return BUTTON_DEBOUNCE_MS;
}

export class MidiMapper {
  private map: MidiMap;
  private learnTarget: MidiTarget | null = null;
  private readonly lastFired = new Map<string, number>();
  private readonly ccHigh = new Map<string, boolean>();
  private readonly lastValue = new Map<string, number>();

  constructor(map: MidiMap = defaultMidiMap()) {
    this.map = map;
  }

  get current(): MidiMap {
    return this.map;
  }

  setMap(map: MidiMap): void {
    this.map = map;
  }

  get learning(): MidiTarget | null {
    return this.learnTarget;
  }

  /** Start (target) or cancel (null) MIDI learn: the next suitable message is bound, not executed. */
  learn(target: MidiTarget | null): void {
    this.learnTarget = target;
  }

  /** Handle one message at `at` (ms). */
  handle(msg: MidiMessage, at: number): { commands: MidiCommand[]; learned?: MidiLearnResult } {
    if (this.learnTarget) {
      const learned = this.tryLearn(this.learnTarget, msg);
      if (learned) return { commands: [], learned };
    }
    const commands: MidiCommand[] = [];
    // (a note on with velocity 0 is a note off even when it did not come through the parser)
    if (msg.type === "noteOn" && msg.velocity > 0) {
      const matches = this.map.bindings.filter((b) => b.kind === "note" && b.number === msg.note && channelMatches(b.channel, msg.channel) && isButtonTarget(b.target));
      if (matches.length) {
        for (const b of matches) this.fire(b.target, at, commands, { kind: "button", target: b.target as MidiButtonTarget });
        return { commands };
      }
      const line = this.map.lineNotes;
      if (line.enabled && channelMatches(line.channel, msg.channel)) {
        const index = msg.note + line.offset;
        if (index >= 0) {
          this.fire(`line:${index}`, at, commands, { kind: "line", index });
          return { commands };
        }
      }
      const sec = this.map.sectionNotes;
      if (sec.enabled && channelMatches(sec.channel, msg.channel)) {
        const index = msg.note - sec.base;
        if (index >= 0) this.fire(`section:${index}`, at, commands, { kind: "section", index });
      }
      return { commands };
    }
    if (msg.type === "cc") {
      for (const b of this.map.bindings) {
        if (b.kind !== "cc" || b.number !== msg.controller || !channelMatches(b.channel, msg.channel)) continue;
        const key = `${b.target}|${msg.channel}:${msg.controller}`;
        if (isValueTarget(b.target)) {
          const value = msg.value / 127;
          if (this.lastValue.get(key) === value) continue;
          this.lastValue.set(key, value);
          commands.push({ kind: "value", target: b.target, value });
          continue;
        }
        const high = this.ccHigh.get(key) ?? false;
        if (!high && msg.value >= CC_ON) {
          this.ccHigh.set(key, true);
          this.fire(b.target, at, commands, { kind: "button", target: b.target });
        } else if (high && msg.value < CC_OFF) this.ccHigh.set(key, false);
      }
    }
    // note off, program change, clock … never fire a button
    return { commands };
  }

  private fire(key: string, at: number, out: MidiCommand[], command: MidiCommand): void {
    const last = this.lastFired.get(key);
    if (last != null && at - last >= 0 && at - last < debounceFor(key)) return;
    this.lastFired.set(key, at);
    out.push(command);
  }

  private tryLearn(target: MidiTarget, msg: MidiMessage): MidiLearnResult | null {
    let trigger: MidiTrigger | null = null;
    if (msg.type === "noteOn" && msg.velocity > 0 && isButtonTarget(target)) trigger = { kind: "note", channel: msg.channel, number: msg.note };
    else if (msg.type === "cc") {
      trigger = { kind: "cc", channel: msg.channel, number: msg.controller };
      // the pad that was just pressed is "high": its release re-arms it
      if (isButtonTarget(target)) this.ccHigh.set(`${target}|${msg.channel}:${msg.controller}`, msg.value >= CC_ON);
    }
    if (!trigger) return null;
    const binding: MidiBinding = { ...trigger, target };
    const replaced = this.map.bindings.filter((b) => b.target !== target && sameTrigger(b, trigger!)).map((b) => b.target);
    const bindings = this.map.bindings.filter((b) => b.target !== target && !sameTrigger(b, trigger!));
    this.map = { ...this.map, bindings: [...bindings, binding] };
    this.learnTarget = null;
    return { binding, replaced };
  }
}

/** The map without `target`'s binding. */
export function clearBinding(map: MidiMap, target: MidiTarget): MidiMap {
  return { ...map, bindings: map.bindings.filter((b) => b.target !== target) };
}

export function bindingFor(map: MidiMap, target: MidiTarget): MidiBinding | undefined {
  return map.bindings.find((b) => b.target === target);
}

function channelText(channel: number): string {
  return channel < 0 ? "任何聲道" : `聲道 ${channel + 1}`;
}

/** 「音符 C3（60）・聲道 1」 / 「CC 7・聲道 1」 */
export function triggerLabel(t: MidiTrigger): string {
  return t.kind === "note" ? `音符 ${noteName(t.number)}（${t.number}）・${channelText(t.channel)}` : `CC ${t.number}・${channelText(t.channel)}`;
}

export type PresetId = "lineNotes" | "sectionNotes";

export interface MidiConflict {
  /** explicit bindings sharing the trigger */
  targets: MidiTarget[];
  /** presets that also claim it (explicit bindings win) */
  presets: PresetId[];
  trigger: MidiTrigger;
}

function inLinePreset(p: LineNotesPreset, t: MidiTrigger): boolean {
  return p.enabled && t.kind === "note" && t.number + p.offset >= 0 && (p.channel < 0 || t.channel < 0 || p.channel === t.channel);
}

function inSectionPreset(p: SectionNotesPreset, t: MidiTrigger): boolean {
  return p.enabled && t.kind === "note" && t.number - p.base >= 0 && (p.channel < 0 || t.channel < 0 || p.channel === t.channel);
}

/** Everything that claims the same note / controller twice. */
export function conflicts(map: MidiMap): MidiConflict[] {
  const out: MidiConflict[] = [];
  const seen = new Set<number>();
  map.bindings.forEach((b, i) => {
    if (seen.has(i)) return;
    const group = [b.target];
    map.bindings.forEach((o, j) => {
      if (j > i && sameTrigger(b, o)) {
        group.push(o.target);
        seen.add(j);
      }
    });
    const presets: PresetId[] = [];
    if (inLinePreset(map.lineNotes, b)) presets.push("lineNotes");
    if (inSectionPreset(map.sectionNotes, b)) presets.push("sectionNotes");
    if (group.length > 1 || presets.length) out.push({ targets: group, presets, trigger: { kind: b.kind, channel: b.channel, number: b.number } });
  });
  const l = map.lineNotes;
  const s = map.sectionNotes;
  // on one channel the lyric notes win: the sections keep the notes below them (base .. -offset - 1)
  if (l.enabled && s.enabled && (l.channel < 0 || s.channel < 0 || l.channel === s.channel) && s.base >= -l.offset) {
    out.push({ targets: [], presets: ["lineNotes", "sectionNotes"], trigger: { kind: "note", channel: l.channel < 0 ? s.channel : l.channel, number: s.base } });
  }
  return out;
}

/** The conflict text for one target's row (null: none). */
export function conflictText(map: MidiMap, target: MidiTarget): string | null {
  const c = conflicts(map).find((x) => x.targets.includes(target));
  if (!c) return null;
  const others = c.targets.filter((t) => t !== target).map((t) => `「${targetInfo(t)?.label ?? t}」`);
  const presets = c.presets.map((p) => (p === "lineNotes" ? "「ProPresenter 式」" : "「段落音符」"));
  const parts = [...others, ...presets];
  return parts.length ? `也被${parts.join("、")}使用${c.presets.length && !others.length ? "（這個對應優先）" : ""}` : null;
}

/** Repair an imported or stored map; anything unusable is dropped. */
export function parseMidiMap(raw: unknown): MidiMap {
  const d = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bindings: MidiBinding[] = [];
  if (Array.isArray(d.bindings)) {
    for (const x of d.bindings.slice(0, 200)) {
      if (!x || typeof x !== "object") continue;
      const b = x as Record<string, unknown>;
      if (!isMidiTarget(b.target) || (b.kind !== "note" && b.kind !== "cc")) continue;
      if (b.kind === "note" && isValueTarget(b.target)) continue;
      const number = clampInt(b.number, -1, 127, -1);
      if (number < 0) continue;
      const binding: MidiBinding = { target: b.target, kind: b.kind, channel: clampInt(b.channel, -1, 15, -1), number };
      // one binding per action (the last one wins)
      const i = bindings.findIndex((o) => o.target === binding.target);
      if (i >= 0) bindings.splice(i, 1);
      bindings.push(binding);
    }
  }
  const line = d.lineNotes && typeof d.lineNotes === "object" ? (d.lineNotes as Record<string, unknown>) : {};
  const sec = d.sectionNotes && typeof d.sectionNotes === "object" ? (d.sectionNotes as Record<string, unknown>) : {};
  return {
    version: 1,
    bindings,
    lineNotes: { enabled: line.enabled === true, channel: clampInt(line.channel, -1, 15, DEFAULT_MIDI_MAP.lineNotes.channel), offset: clampInt(line.offset, -127, 999, 0) },
    sectionNotes: { enabled: sec.enabled === true, channel: clampInt(sec.channel, -1, 15, DEFAULT_MIDI_MAP.sectionNotes.channel), base: clampInt(sec.base, 0, 127, 0) },
  };
}

/** The file 「匯出」 writes (and 「匯入」 reads back with parseMidiMap). */
export function exportMidiMap(map: MidiMap): string {
  return JSON.stringify({ app: "livelyrics", kind: "midi-map", ...map }, null, 2);
}

/** Read an exported file; throws a Traditional Chinese error when it is not one. */
export function importMidiMap(text: string): MidiMap {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("這不是有效的 JSON 檔案。");
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || ((data as Record<string, unknown>).kind !== undefined && (data as Record<string, unknown>).kind !== "midi-map")) {
    throw new Error("這個檔案不是 Livelyrics 的 MIDI 對應。");
  }
  const map = parseMidiMap(data);
  if (!map.bindings.length && !map.lineNotes.enabled && !map.sectionNotes.enabled && !Array.isArray((data as Record<string, unknown>).bindings)) throw new Error("檔案裡沒有任何 MIDI 對應。");
  return map;
}

/** ProPresenter 式 caption: 「音符 36（C1）→ 第 1 句」 */
export function lineNotesCaption(p: LineNotesPreset): string {
  const first = Math.max(0, -p.offset);
  if (first > 127) return "偏移太大：沒有音符會對到歌詞";
  return `音符 ${first}（${noteName(first)}）→ 第 ${first + p.offset + 1} 句，往上依序對應下一句`;
}

/** 段落音符 caption: 「音符 48（C2）→ 第 1 段」 */
export function sectionNotesCaption(p: SectionNotesPreset): string {
  return `音符 ${p.base}（${noteName(p.base)}）→ 第 1 段，往上依序對應下一段`;
}
