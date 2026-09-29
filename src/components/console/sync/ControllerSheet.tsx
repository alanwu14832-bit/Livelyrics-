"use client";

// 控制器 (phase 5a, MIDI learn): every console action a pad, pedal, key or fader can run. Press
// 「學習」 on a row and hit the pad: it is bound (a note or a CC, with its channel); a fader row takes
// a CC and moves the value continuously (最高亮度 never above the LED safety preset). The two
// presets map many notes at once (ProPresenter 式: note n → lyric line n + offset; 段落音符: note
// base + k → section k). Conflicts are listed on the rows, every binding can be cleared, the last
// message shows live, and the whole map moves between computers as a JSON file. Esc cancels a
// learn (a second Esc closes the sheet), B still blacks out. GO and standby only appear in the show
// console. The mapping lives in this browser (localStorage), shared by every song and show.

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button, Kbd, Sheet, Stepper, Switch, cx } from "@/components/ui";
import { DownloadSimpleIcon, TrashIcon, UploadSimpleIcon } from "@/components/ui/Icon";
import { SOFT_TEXT } from "@/components/ui/Tag";
import { MIDI_UNSUPPORTED } from "@/lib/midi/access";
import {
  TARGETS,
  TARGET_GROUPS,
  bindingFor,
  conflictText,
  conflicts,
  defaultMidiMap,
  exportMidiMap,
  importMidiMap,
  isValueTarget,
  lineNotesCaption,
  sectionNotesCaption,
  targetInfo,
  triggerLabel,
  type MidiTarget,
  type TargetInfo,
} from "@/lib/midi/mapping";
import { noteName } from "@/lib/midi/parser";
import type { SyncEngine } from "@/lib/sync/engine";
import { Footnote, Group, GroupTitle, PopupSelect } from "../ui";
import { useSyncSnapshot } from "./hooks";
import { MidiActivity, MidiLastMessage } from "./SyncStatus";
import { SyncRow } from "./SyncPanel";

const CHANNEL_OPTIONS = [{ value: "-1", label: "任何聲道" }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: `聲道 ${i + 1}` }))];

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TargetRow({
  engine,
  info,
  learning,
  justLearned,
  disabled,
  onLearn,
}: {
  engine: SyncEngine;
  info: TargetInfo;
  learning: boolean;
  justLearned: boolean;
  disabled: boolean;
  onLearn: (target: MidiTarget) => void;
}) {
  const snap = useSyncSnapshot(engine);
  const binding = bindingFor(snap.map, info.target);
  const conflict = binding ? conflictText(snap.map, info.target) : null;
  const value = isValueTarget(info.target);
  return (
    <div
      className={cx(
        "relative flex min-h-10 items-center gap-3 px-3 py-1.5",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-3 after:h-(--hairline) after:bg-separator last:after:hidden",
        learning && "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]",
        justLearned && !learning && "bg-[color-mix(in_srgb,var(--green)_14%,transparent)]",
      )}
      data-midi-target={info.target}
      data-bound={binding ? "1" : "0"}
      data-learning={learning ? "1" : undefined}
    >
      <span className="flex w-[210px] min-w-0 shrink-0 items-center gap-2">
        <span className="min-w-0 truncate text-c-body text-label">{info.label}</span>
        {info.hotkey && <Kbd className="shrink-0">{info.hotkey}</Kbd>}
      </span>
      <span className="min-w-0 flex-1">
        {learning ? (
          <span className={cx("block text-c-footnote font-semibold", SOFT_TEXT.tint)} role="status">
            {value ? "轉動控制器上的推桿或旋鈕…" : "按下控制器上的按鍵、打擊墊或踏板…"}
          </span>
        ) : binding ? (
          <span className="block truncate text-c-body text-label tabular" data-binding="">
            {triggerLabel(binding)}
          </span>
        ) : (
          <span className="block text-c-footnote text-label-3">未對應</span>
        )}
        {conflict && !learning && <span className="block truncate text-c-footnote text-orange-text" data-conflict="">{conflict}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {learning ? (
          <Button size="md" variant="tinted" onClick={() => engine.learn(null)} aria-label={`取消學習「${info.label}」`}>
            取消
          </Button>
        ) : (
          <Button size="md" variant="gray" disabled={disabled} onClick={() => onLearn(info.target)} aria-label={`學習「${info.label}」`} data-learn={info.target}>
            學習
          </Button>
        )}
        <Button size="md" variant="quiet" disabled={!binding || learning} onClick={() => engine.clearBinding(info.target)} aria-label={`清除「${info.label}」的對應`} className={cx(!binding && "invisible")}>
          清除
        </Button>
      </span>
    </div>
  );
}

function PresetRows({ engine }: { engine: SyncEngine }) {
  const snap = useSyncSnapshot(engine);
  const line = snap.map.lineNotes;
  const sec = snap.map.sectionNotes;
  const lineId = useId();
  const secId = useId();
  const presetClash = conflicts(snap.map).some((c) => c.targets.length === 0 && c.presets.length === 2);
  return (
    <>
      <Group className="mt-1">
        <SyncRow>
          <label htmlFor={lineId} className="min-w-0 flex-1">
            <span className="block text-c-body text-label">ProPresenter 式：音符對應歌詞</span>
            <span className="block text-c-footnote text-label-2">音符 n 送出第 n 句（加上偏移），適合從播放軟體或鍵盤逐句送歌詞。</span>
          </label>
          <Switch id={lineId} checked={line.enabled} onChange={(on) => engine.setLineNotes({ enabled: on })} data-preset="lineNotes" />
        </SyncRow>
        {line.enabled && (
          <SyncRow className="flex-wrap gap-y-2">
            <PopupSelect label="聲道" className="w-[132px]" value={String(line.channel)} options={CHANNEL_OPTIONS} onChange={(v) => engine.setLineNotes({ channel: Number(v) })} />
            <div className="flex flex-col gap-1">
              <span className="text-c-footnote text-label-2">偏移</span>
              <Stepper label="音符偏移" value={line.offset} step={1} min={-127} max={127} onChange={(v) => engine.setLineNotes({ offset: v })} format={(v) => (v > 0 ? `+${v}` : String(v))} showValue decrementLabel="偏移減 1" incrementLabel="偏移加 1" />
            </div>
            <span className="min-w-0 flex-1 self-end pb-1 text-c-footnote text-label-2" data-preset-caption="lineNotes">
              {lineNotesCaption(line)}
            </span>
          </SyncRow>
        )}
      </Group>
      <Group className="mt-2">
        <SyncRow>
          <label htmlFor={secId} className="min-w-0 flex-1">
            <span className="block text-c-body text-label">段落音符：音符對應段落</span>
            <span className="block text-c-footnote text-label-2">從起始音符往上，每個音符跳到設計方案的一個段落（主歌、副歌…）。</span>
          </label>
          <Switch id={secId} checked={sec.enabled} onChange={(on) => engine.setSectionNotes({ enabled: on })} data-preset="sectionNotes" />
        </SyncRow>
        {sec.enabled && (
          <SyncRow className="flex-wrap gap-y-2">
            <PopupSelect label="聲道" className="w-[132px]" value={String(sec.channel)} options={CHANNEL_OPTIONS} onChange={(v) => engine.setSectionNotes({ channel: Number(v) })} />
            <div className="flex flex-col gap-1">
              <span className="text-c-footnote text-label-2">起始音符</span>
              <Stepper label="起始音符" value={sec.base} step={1} min={0} max={127} onChange={(v) => engine.setSectionNotes({ base: v })} format={(v) => `${noteName(v)}（${v}）`} showValue decrementLabel="起始音符減 1" incrementLabel="起始音符加 1" />
            </div>
            <span className="min-w-0 flex-1 self-end pb-1 text-c-footnote text-label-2" data-preset-caption="sectionNotes">
              {sectionNotesCaption(sec)}
            </span>
          </SyncRow>
        )}
      </Group>
      {presetClash && <Footnote className="text-orange-text">兩個預設用同一個聲道而且音符重疊：重疊的音符會送出歌詞。請換一個聲道或把段落的起始音符移到歌詞音符下方。</Footnote>}
    </>
  );
}

export function ControllerSheet({
  open,
  onClose,
  engine,
  show = false,
  onBlackout,
}: {
  open: boolean;
  onClose: () => void;
  engine: SyncEngine;
  /** the show console: GO and standby can be learned too */
  show?: boolean;
  /** B inside the sheet (a pass-through: blackout must always work) */
  onBlackout?: () => void;
}) {
  const snap = useSyncSnapshot(engine);
  const m = snap.midi;
  const midiId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileNote, setFileNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const on = m.status === "on" || m.status === "starting" || m.enabled;

  // closing the sheet ends a learn that was still waiting
  useEffect(() => {
    if (!open) engine.learn(null);
  }, [engine, open]);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const learned = snap.learned;
  const learnedInfo = learned ? targetInfo(learned.binding.target) : undefined;
  const learningInfo = snap.learning ? targetInfo(snap.learning) : undefined;

  const startLearn = (target: MidiTarget) => {
    if (!on && m.supported) void engine.enableMidi();
    engine.learn(target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && engine.getSnapshot().learning) {
      // the first Esc only cancels the learn
      e.preventDefault();
      engine.learn(null);
      return;
    }
    const t = e.target as HTMLElement;
    const typing = t.tagName === "TEXTAREA" || t.isContentEditable || (t.tagName === "INPUT" && !["checkbox", "radio", "button", "range", "file"].includes((t as HTMLInputElement).type));
    if (e.code === "KeyB" && !typing && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && onBlackout) {
      e.preventDefault();
      onBlackout();
    }
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error("檔案太大，不像是 MIDI 對應檔。");
      const map = importMidiMap(await file.text());
      engine.replaceMap(map);
      const parts = [`${map.bindings.length} 個對應`, map.lineNotes.enabled ? "ProPresenter 式" : "", map.sectionNotes.enabled ? "段落音符" : ""].filter(Boolean);
      setFileNote({ tone: "ok", text: `已匯入「${file.name}」：${parts.join("、")}。` });
    } catch (err) {
      setFileNote({ tone: "error", text: err instanceof Error ? err.message : "無法讀取這個檔案。" });
    }
  };

  const groups = TARGET_GROUPS.filter((g) => show || g.id !== "show");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="控制器"
      width={680}
      cancelLabel={null}
      action={
        <Button variant="plain" onClick={onClose} className="font-semibold">
          完成
        </Button>
      }
      onKeyDown={onKeyDown}
    >
      <div data-controller-sheet="">
        {/* the live readout: what the controller just sent, and the learn state */}
        <div
          className={cx(
            // opaque (rows scroll under it): the state's hue mixed into the sheet surface
            // (-top-2: flush with the scroll edge over the body's 8 px top padding)
            "sticky -top-2 z-10 -mx-5 mb-3 px-5 py-2.5 shadow-[0_0.5px_0_var(--separator)]",
            learningInfo ? "bg-[color-mix(in_srgb,var(--tint)_22%,var(--elevated))]" : learned && learnedInfo ? "bg-[color-mix(in_srgb,var(--green)_16%,var(--elevated))]" : "bg-elevated",
          )}
          role="status"
          aria-live="polite"
          data-learn-banner={learningInfo ? "learning" : learned ? "learned" : "idle"}
        >
          {learningInfo ? (
            <p className={cx("text-c-body font-semibold", SOFT_TEXT.tint)}>
              學習中：{isValueTarget(learningInfo.target) ? "轉動" : "按下"}要對應「{learningInfo.label}」的{isValueTarget(learningInfo.target) ? "推桿或旋鈕" : "按鍵"}，按 Esc 取消。
            </p>
          ) : learned && learnedInfo ? (
            <p className="text-c-body text-label">
              <span className="font-semibold">已對應「{learnedInfo.label}」</span>：{triggerLabel(learned.binding)}
              {learned.replaced.length > 0 && <span className="text-label-2">（原本對應{learned.replaced.map((t) => `「${targetInfo(t)?.label ?? t}」`).join("、")}的已改到這裡）</span>}
            </p>
          ) : (
            <p className="text-c-body text-label-2">按「學習」，再按控制器上的按鍵、踏板或推桿就完成對應。</p>
          )}
          <p className="mt-1 flex min-w-0 items-center gap-2 text-c-footnote text-label-2">
            <MidiActivity engine={engine} label="最近的訊息" />
            <MidiLastMessage engine={engine} className="text-label" />
          </p>
        </div>

        <section aria-labelledby="ctl-midi">
          <GroupTitle id="ctl-midi">MIDI 輸入</GroupTitle>
          <Group className="mt-1">
            <SyncRow>
              <label htmlFor={midiId} className="min-w-0 flex-1 text-c-body text-label">
                使用 MIDI 控制器
                {m.status === "error" && m.message && <span className="block text-c-footnote text-red-text">{m.message}</span>}
                {!m.supported && <span className="block text-c-footnote text-orange-text">{MIDI_UNSUPPORTED}</span>}
              </label>
              <Switch id={midiId} checked={on} disabled={!m.supported || m.status === "starting"} onChange={(v) => (v ? void engine.enableMidi() : engine.disableMidi())} data-midi-switch="" />
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
                    ...(m.input !== "all" && !m.ports.some((p) => p.id === m.input) ? [{ value: m.input, label: "上次的輸入（未連接）" }] : []),
                  ]}
                />
              </SyncRow>
            )}
          </Group>
          <Footnote>按鍵只在按下時動作（放開不算），同一個鍵連按會被過濾；CC 當按鍵用時，數值超過 64 才觸發。</Footnote>
        </section>

        <section aria-labelledby="ctl-presets" className="mt-5">
          <GroupTitle id="ctl-presets">預設對應</GroupTitle>
          <PresetRows engine={engine} />
          <Footnote>自己學習的對應優先於預設：同一個音符兩邊都有時，會執行學習的動作。</Footnote>
        </section>

        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`ctl-${g.id}`} className="mt-5">
            <GroupTitle id={`ctl-${g.id}`}>{g.title}</GroupTitle>
            <Group className="mt-1">
              {TARGETS.filter((t) => t.group === g.id).map((info) => (
                <TargetRow
                  key={info.target}
                  engine={engine}
                  info={info}
                  learning={snap.learning === info.target}
                  justLearned={!!learned && learned.binding.target === info.target}
                  disabled={!m.supported}
                  onLearn={startLearn}
                />
              ))}
            </Group>
            {g.id === "show" && <Footnote>GO 與待機只在演出控制台有效，會多等 0.15 秒過濾連按，避免誤跳兩首。</Footnote>}
            {g.id === "values" && <Footnote>最高亮度只會在 LED 安全預設的上限以下調整，推到頂也不會更亮；安全模式關閉時不作用。</Footnote>}
          </section>
        ))}

        <section aria-labelledby="ctl-file" className="mt-5">
          <GroupTitle id="ctl-file">對應檔</GroupTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button variant="gray" icon={DownloadSimpleIcon} onClick={() => download(exportMidiMap(snap.map), "livelyrics-midi.json")} data-midi-export="">
              匯出 JSON
            </Button>
            <Button variant="gray" icon={UploadSimpleIcon} onClick={() => fileRef.current?.click()}>
              匯入 JSON…
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onImport(e)} data-midi-import="" />
            <span className="flex-1" />
            {confirmClear ? (
              <Button
                variant="destructive"
                icon={TrashIcon}
                onClick={() => {
                  setConfirmClear(false);
                  engine.learn(null);
                  engine.replaceMap(defaultMidiMap());
                  setFileNote({ tone: "ok", text: "已清除所有對應。" });
                }}
              >
                確定全部清除
              </Button>
            ) : (
              <Button variant="plain" icon={TrashIcon} onClick={() => setConfirmClear(true)} disabled={!snap.map.bindings.length && !snap.map.lineNotes.enabled && !snap.map.sectionNotes.enabled}>
                全部清除
              </Button>
            )}
          </div>
          {fileNote && (
            <Footnote className={fileNote.tone === "error" ? "text-red-text" : "text-label-2"} id="ctl-file-note">
              {fileNote.text}
            </Footnote>
          )}
          <Footnote>對應記在這台電腦的瀏覽器裡，所有歌曲與演出共用；換電腦時用匯出的檔案帶過去。</Footnote>
        </section>
      </div>
    </Sheet>
  );
}
