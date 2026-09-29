"use client";

// The 同步 panel's sync sections (phase 5a): what drives the console (手動 / MIDI clock / MTC / LTC),
// its lock tile and readouts, the source's own settings (MTC 定位, the LTC input with its level, the
// song's start timecode, how long to freewheel), 回到手動 (X), and the MIDI input that the
// controllers, the MIDI clock and MTC share, with the way into the 控制器 sheet. The song console
// shows it at the top of its 同步 tab; the show console's look and pre-show views show it without a
// song in the 同步 sheet. Nothing here asks for MIDI or audio permission until the operator picks a
// source or turns MIDI on.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Kbd, SegmentedControl, Spinner, Stepper, Switch, TextField, cx, type SegmentOption } from "@/components/ui";
import { FadersIcon, HandTapIcon, PianoKeysIcon, WaveSquareIcon } from "@/components/ui/Icon";
import { resumeAudioContext } from "@/lib/audio/live";
import type { ConsoleController, ConsoleSnapshot } from "@/lib/console/controller";
import { MANUAL_KEY } from "@/lib/console/hotkeys";
import { MIDI_UNSUPPORTED } from "@/lib/midi/access";
import type { MidiMap } from "@/lib/midi/mapping";
import { FREEWHEEL_MAX_SECONDS, FREEWHEEL_MIN_SECONDS, type SyncEngine, type SyncSnapshot, type SyncSource } from "@/lib/sync/engine";
import { DEFAULT_START_TC, normalizeTcInput } from "@/lib/sync/timecode";
import { Footnote, Group, GroupTitle, PopupSelect } from "../ui";
import { useRafLoop } from "../useRaf";
import { useSyncSnapshot } from "./hooks";
import { LockTile, MidiActivity } from "./SyncStatus";

/** A 32 px console row: label on the left, control on the right, hairline below (not after the last). */
export function SyncRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "relative flex min-h-(--row-min-h) items-center gap-3 px-3 py-1.5",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-3 after:h-(--hairline) after:bg-separator last:after:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

const SOURCE_CAPTIONS: Record<SyncSource, string> = {
  manual: "由你操作：鍵盤、MIDI 控制器或踏板逐句、逐段送出，不跟隨外部訊號。",
  clock: "跟著播放端（Ableton Live、Logic、QLab…）的 MIDI clock 律動：只帶拍子，歌詞仍由你或音檔決定。",
  mtc: "跟著 MIDI Time Code：歌詞與畫面跟著播放端的時間碼走。一首歌一小時，01:00:00:00 是第 1 首的開頭。",
  ltc: "從音訊輸入解碼 LTC 時間碼（錄音介面的一個聲道）：歌詞與畫面跟著時間碼走。一首歌一小時。",
};

function sourceOptions(supported: boolean): SegmentOption<SyncSource>[] {
  return [
    { value: "manual", label: "手動", caption: SOURCE_CAPTIONS.manual },
    { value: "clock", label: <span className="t-latin">MIDI clock</span>, ariaLabel: "MIDI clock", caption: SOURCE_CAPTIONS.clock, disabled: !supported },
    { value: "mtc", label: <span className="t-latin">MTC</span>, ariaLabel: "MTC", caption: SOURCE_CAPTIONS.mtc, disabled: !supported },
    { value: "ltc", label: <span className="t-latin">LTC</span>, ariaLabel: "LTC", caption: SOURCE_CAPTIONS.ltc },
  ];
}

/** The LTC input's peak level, a 3 px bar per frame (no track). */
function LtcLevel({ engine }: { engine: SyncEngine }) {
  const bar = useRef<HTMLDivElement>(null);
  useRafLoop(() => {
    const el = bar.current;
    if (!el) return;
    const peak = engine.ltcLevel();
    // -40 dBFS .. 0 dBFS across the bar: LTC sits around -10 dBFS
    const v = peak > 0 ? Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / 40)) : 0;
    el.style.transform = `scaleX(${v.toFixed(3)})`;
  });
  return (
    <div className="flex h-5 items-center gap-2" title="LTC 輸入電平">
      <span className="w-14 shrink-0 text-c-footnote text-label-2">輸入電平</span>
      <div className="relative h-[3px] flex-1" role="presentation">
        <div ref={bar} className="absolute inset-0 origin-left rounded-full bg-tint" style={{ transform: "scaleX(0)" }} data-ltc-level="" />
      </div>
    </div>
  );
}

function LtcStatus({ engine, snap }: { engine: SyncEngine; snap: SyncSnapshot }) {
  const ltc = snap.ltc;
  if (ltc.status === "starting")
    return (
      <p className="flex items-center gap-1.5 text-c-footnote text-label-2">
        <Spinner size={12} />
        開啟音訊輸入…
      </p>
    );
  if (ltc.status === "error")
    return (
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-c-footnote text-red-text" role="alert">
          {ltc.message ?? "無法開啟 LTC 音訊輸入。"}
        </p>
        <Button size="sm" variant="gray" onClick={() => engine.retryLtc()}>
          重試
        </Button>
      </div>
    );
  if (ltc.status === "on" && ltc.suspended)
    return (
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-c-footnote text-orange-text">瀏覽器的音訊引擎還在等你按一下：按「啟用音訊」（或頁面任何地方）才會開始解碼。</p>
        <Button size="sm" variant="tinted" onClick={() => void resumeAudioContext()}>
          啟用音訊
        </Button>
      </div>
    );
  if (ltc.status === "on")
    return (
      <p className="text-c-footnote text-label-2" data-ltc-status="on">
        {ltc.channel != null ? `正在解碼：時間碼在第 ${ltc.channel + 1} 聲道。` : "音訊輸入已開啟，等待 LTC 訊號。"}
      </p>
    );
  return null;
}

/** The song's start timecode: editable in the song console, the setlist's in the show. */
function StartTimecodeRow({ controller, snap }: { controller: ConsoleController; snap: ConsoleSnapshot }) {
  const tc = snap.timecode;
  const id = useId();
  const [draft, setDraft] = useState(tc.start);
  const [prev, setPrev] = useState(tc.start);
  const [invalid, setInvalid] = useState(false);
  if (tc.start !== prev) {
    setPrev(tc.start);
    setDraft(tc.start);
    setInvalid(false);
  }
  if (tc.from === "setlist") {
    return (
      <SyncRow>
        <span className="min-w-0 flex-1 text-c-body text-label">起點時間碼</span>
        <span className="font-numeric text-c-body text-label tabular" data-start-tc="">
          {tc.start}
        </span>
        <span className="shrink-0 text-c-footnote text-label-2">在演出頁設定</span>
      </SyncRow>
    );
  }
  const commit = () => {
    const text = draft.trim();
    if (!text) {
      setInvalid(false);
      controller.setTimecodeStart(null);
      return;
    }
    const normalized = normalizeTcInput(text);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (normalized !== tc.start) controller.setTimecodeStart(normalized);
    else setDraft(normalized);
  };
  return (
    <>
      <SyncRow>
        <label htmlFor={id} className="min-w-0 flex-1 text-c-body text-label">
          起點時間碼
        </label>
        {tc.from === "project" && (
          <Button size="sm" variant="plain" onClick={() => controller.setTimecodeStart(null)}>
            預設
          </Button>
        )}
        <TextField
          id={id}
          value={draft}
          invalid={invalid}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          className="w-[128px] font-numeric tabular"
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(tc.start);
              setInvalid(false);
              e.currentTarget.blur();
            }
          }}
          data-start-tc-input=""
        />
      </SyncRow>
      <p id={`${id}-hint`} className={cx("px-3 pb-2 text-c-footnote", invalid ? "text-red-text" : "text-label-2")}>
        {invalid ? "時間碼格式是 HH:MM:SS:FF（例如 02:00:00:00），也可以只填小時（2）。" : tc.from === "project" ? `這首歌從 ${tc.start} 開始。` : `預設 ${DEFAULT_START_TC}：時間碼進入這一小時就是這首歌。`}
      </p>
    </>
  );
}

/**
 * 同步來源: the source, the lock tile and the source's settings. `song`: the song console (its
 * start timecode, song position and offset); without it, the show's view of the same engine.
 */
export function SyncSourceSection({
  engine,
  song,
  onManual,
}: {
  engine: SyncEngine;
  song?: { controller: ConsoleController; snap: ConsoleSnapshot } | null;
  /** 回到手動 (the song console lets its controller hand over first) */
  onManual: () => void;
}) {
  const snap = useSyncSnapshot(engine);
  const src = snap.settings.source;
  const timecode = src === "mtc" || src === "ltc";
  const fwId = useId();
  const ltcId = useId();
  const mtcId = useId();

  useEffect(() => {
    if (src === "ltc") void engine.refreshDevices();
  }, [engine, src]);

  const devices = snap.ltc.devices.filter((d) => d.deviceId && d.deviceId !== "default");
  const songTime = song ? () => song.controller.songTime() : undefined;

  return (
    <section aria-labelledby="sync-source" data-sync-panel="">
      <GroupTitle
        id="sync-source"
        actions={
          src !== "manual" ? (
            <Button size="sm" variant="plain" icon={HandTapIcon} onClick={onManual} aria-keyshortcuts={MANUAL_KEY}>
              回到手動
              <Kbd className="ml-1">{MANUAL_KEY}</Kbd>
            </Button>
          ) : undefined
        }
      >
        同步來源
      </GroupTitle>
      <SegmentedControl label="同步來源" fullWidth blurOnPointer value={src} onChange={(s) => engine.setSource(s)} className="mt-1" options={sourceOptions(snap.midi.supported)} />
      {!snap.midi.supported && <Footnote className="text-orange-text">{MIDI_UNSUPPORTED}。LTC 用音訊輸入，不受影響。</Footnote>}

      {src !== "manual" && (
        <div className="mt-2.5">
          <LockTile engine={engine} songTime={songTime} showTimecode={timecode} offset={timecode && song && song.snap.mode === "track" ? song.snap.offset : null} />
        </div>
      )}

      {src === "ltc" && (
        <Group className="mt-2">
          <SyncRow>
            <PopupSelect
              id={ltcId}
              label="LTC 音訊輸入"
              className="flex-1"
              value={snap.settings.ltcDeviceId}
              onChange={(v) => engine.setLtcDevice(v)}
              options={[{ value: "", label: "預設輸入裝置" }, ...devices.map((d) => ({ value: d.deviceId, label: d.label }))]}
            />
          </SyncRow>
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <LtcLevel engine={engine} />
            <LtcStatus engine={engine} snap={snap} />
          </div>
        </Group>
      )}

      {timecode && (
        <Group className="mt-2">
          {src === "mtc" && (
            <SyncRow>
              <label htmlFor={mtcId} className="min-w-0 flex-1">
                <span className="block text-c-body text-label">MTC 定位（SysEx）</span>
                <span className="block text-c-footnote text-label-2">播放端停下或跳位時用完整時間碼立刻定位；需要另一個 MIDI 權限。</span>
              </label>
              <Switch id={mtcId} checked={snap.midi.sysex} onChange={(on) => void engine.setMtcLocate(on)} />
            </SyncRow>
          )}
          {song && <StartTimecodeRow controller={song.controller} snap={song.snap} />}
          <SyncRow>
            <span id={fwId} className="min-w-0 flex-1">
              <span className="block text-c-body text-label">自由運轉</span>
              <span className="block text-c-footnote text-label-2">時間碼中斷後先照內部時鐘走，超過就切回手動。</span>
            </span>
            <Stepper
              label="自由運轉秒數"
              value={snap.settings.freewheelSeconds}
              step={0.5}
              min={FREEWHEEL_MIN_SECONDS}
              max={FREEWHEEL_MAX_SECONDS}
              onChange={(v) => engine.setFreewheel(v)}
              format={(v) => `${v.toFixed(1)} 秒`}
              showValue
              decrementLabel="自由運轉減 0.5 秒"
              incrementLabel="自由運轉加 0.5 秒"
            />
          </SyncRow>
        </Group>
      )}

      {timecode && (
        <Footnote className="leading-5">
          {song?.snap.mode === "live"
            ? "LIVE 模式：時間碼直接帶動時間與有時間碼的歌詞，不播放音檔。"
            : "TRACK 模式：控制台的音檔跟著時間碼走（誤差超過 0.08 秒就重新對齊），歌詞偏移照常套用。"}{" "}
          跟隨時間碼時，手動換句要先按 <Kbd className="align-middle">{MANUAL_KEY}</Kbd> 回到手動。
        </Footnote>
      )}
      {src === "clock" && <Footnote>MIDI clock 鎖定時，畫面的拍點優先跟著它，其次才是麥克風與 Tap tempo。超過半秒沒有訊號就視為中斷。</Footnote>}
    </section>
  );
}

function mapSummary(map: MidiMap): string {
  const parts: string[] = [];
  if (map.bindings.length) parts.push(`${map.bindings.length} 個對應`);
  if (map.lineNotes.enabled) parts.push("ProPresenter 式");
  if (map.sectionNotes.enabled) parts.push("段落音符");
  return parts.length ? parts.join("・") : "還沒有對應";
}

function midiStatusText(snap: SyncSnapshot): { text: string; tone: "label-2" | "red" | "green" } {
  const m = snap.midi;
  if (!m.supported) return { text: "不支援", tone: "label-2" };
  switch (m.status) {
    case "starting":
      return { text: "開啟中…", tone: "label-2" };
    case "on": {
      const connected = m.ports.filter((p) => p.connected).length;
      return connected ? { text: `${connected} 個輸入裝置`, tone: "green" } : { text: "沒有偵測到 MIDI 裝置", tone: "label-2" };
    }
    case "error":
      return { text: "無法開啟", tone: "red" };
    default:
      return { text: m.enabled ? "已關閉" : "未啟用", tone: "label-2" };
  }
}

/** The MIDI input (shared by the controllers, MIDI clock and MTC) and the way into the 控制器 sheet. */
export function MidiSection({ engine, onOpenControllers }: { engine: SyncEngine; onOpenControllers: () => void }) {
  const snap = useSyncSnapshot(engine);
  const m = snap.midi;
  const id = useId();
  const on = m.status === "on" || m.status === "starting" || m.enabled;
  const status = midiStatusText(snap);
  return (
    <section aria-labelledby="sync-midi">
      <GroupTitle id="sync-midi" actions={m.status === "on" ? <MidiActivity engine={engine} /> : undefined}>
        MIDI
      </GroupTitle>
      <Group className="mt-1">
        <SyncRow>
          <label htmlFor={id} className="flex min-w-0 flex-1 items-center gap-2 text-c-body text-label">
            <PianoKeysIcon size={16} className={m.status === "on" ? "text-green" : "text-label-2"} />
            MIDI 裝置
            <span className={cx("min-w-0 truncate text-c-footnote", status.tone === "red" ? "text-red-text" : "text-label-2")} data-midi-status={m.status}>
              {m.status === "starting" ? <Spinner size={12} label={status.text} /> : status.text}
            </span>
          </label>
          <Switch id={id} checked={on} disabled={!m.supported || m.status === "starting"} onChange={(v) => (v ? void engine.enableMidi() : engine.disableMidi())} />
        </SyncRow>
        {m.supported && on && (
          <SyncRow>
            <PopupSelect
              label="MIDI 輸入"
              hideLabel
              className="flex-1"
              value={m.input}
              disabled={m.status !== "on"}
              onChange={(v) => engine.setMidiInput(v)}
              options={[
                { value: "all", label: "所有 MIDI 輸入" },
                ...m.ports.map((p) => ({ value: p.id, label: `${p.name || "MIDI 輸入"}${p.connected ? "" : "（未連接）"}` })),
                // a remembered input that is not plugged in right now
                ...(m.input !== "all" && !m.ports.some((p) => p.id === m.input) ? [{ value: m.input, label: "上次的輸入（未連接）" }] : []),
              ]}
            />
          </SyncRow>
        )}
        <SyncRow>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <FadersIcon size={16} className="shrink-0 text-label-2" />
            <span className="min-w-0">
              <span className="block text-c-body text-label">控制器</span>
              <span className="block truncate text-c-footnote text-label-2" data-midi-summary="">
                {mapSummary(snap.map)}
              </span>
            </span>
          </span>
          <Button size="md" variant="gray" onClick={onOpenControllers} data-open-controllers="">
            控制器…
          </Button>
        </SyncRow>
      </Group>
      {m.status === "error" && m.message && <Footnote className="text-red-text">{m.message}</Footnote>}
      {m.status === "on" && m.message && <Footnote className="text-orange-text">{m.message}</Footnote>}
      {!m.supported ? (
        <Footnote className="text-orange-text">{MIDI_UNSUPPORTED}。</Footnote>
      ) : (
        <Footnote>
          <WaveSquareIcon size={12} className="mr-1 inline align-[-1px]" />
          按鍵、踏板與推桿都可以對應到控制台的動作；MIDI 設定記在這台電腦的瀏覽器裡，可以匯出帶到別台。
        </Footnote>
      )}
    </section>
  );
}
