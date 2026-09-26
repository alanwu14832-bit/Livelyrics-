"use client";

import { memo, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { AlertIcon, CrosshairIcon, MergeIcon, MinusIcon, PlayIcon, PlusIcon, ScissorsIcon, TapIcon, TrashIcon } from "@/components/home/icons";
import type { EditorLine } from "./editor-model";
import { TimeInput } from "./TimeInput";

export type CellField = "time" | "text" | "translation";

export interface RowHandlers {
  setStart(index: number, t: number | null): void;
  nudge(index: number, delta: number): void;
  setText(index: number, field: "text" | "translation", value: string): void;
  setToPlayhead(index: number): void;
  playFrom(index: number): void;
  insertAt(position: number): void;
  split(index: number, caret: number | null): void;
  mergeNext(index: number): void;
  remove(index: number): void;
  tapFrom(index: number): void;
  focusCell(index: number, field: CellField): void;
  rememberCaret(key: string, caret: number | null): void;
}

function IconButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30",
        danger ? "hover:bg-danger/15 hover:text-danger" : "hover:bg-panel-3 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const textCls =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm text-fg outline-none transition-colors placeholder:text-faint hover:border-line focus:border-accent focus:bg-panel-2";

interface RowProps {
  line: EditorLine;
  index: number;
  count: number;
  current: boolean;
  tapTarget: boolean;
  tapActive: boolean;
  outOfOrder: boolean;
  handlers: RowHandlers;
}

const LineRow = memo(function LineRow({ line, index, count, current, tapTarget, tapActive, outOfOrder, handlers: h }: RowProps) {
  const textKeys = (field: "text" | "translation") => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      h.insertAt(index + 1);
    } else if (e.key === "Enter" || (e.key === "ArrowDown" && !e.altKey)) {
      e.preventDefault();
      if (e.key === "Enter" && e.shiftKey) h.focusCell(index - 1, field);
      else if (index + 1 < count) h.focusCell(index + 1, field);
      else if (e.key === "Enter") h.insertAt(index + 1);
    } else if (e.key === "ArrowUp" && !e.altKey) {
      e.preventDefault();
      h.focusCell(index - 1, field);
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };
  const caret = (el: HTMLInputElement) => h.rememberCaret(line.key, el.selectionStart);

  return (
    <div
      role="row"
      data-row={index}
      aria-current={current ? "true" : undefined}
      className={cx(
        "group relative grid grid-cols-[2.75rem_9.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-line/60 px-3 py-1 transition-colors",
        tapTarget ? "bg-accent/[0.12]" : current ? "bg-accent-2/[0.09]" : "hover:bg-panel-2/60",
      )}
    >
      {(current || tapTarget) && <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-0.5", tapTarget ? "bg-accent" : "bg-accent-2")} />}
      <div role="cell" className="flex items-center gap-1 font-mono text-[11px] text-faint tabular">
        {tapTarget ? <span className="text-accent">待標記</span> : index + 1}
      </div>
      <div role="cell" className="flex items-center gap-0.5">
        <IconButton label="提早 0.1 秒" onClick={() => h.nudge(index, -0.1)} disabled={line.start == null}>
          <MinusIcon size={12} />
        </IconButton>
        <TimeInput
          value={line.start}
          aria-label={`第 ${index + 1} 行開始時間`}
          data-row={index}
          data-field="time"
          warn={outOfOrder}
          onCommit={(t) => h.setStart(index, t)}
          onNudge={(d) => h.nudge(index, d)}
          onEnter={(shift) => h.focusCell(shift ? index - 1 : index + 1, "time")}
        />
        <IconButton label="延後 0.1 秒" onClick={() => h.nudge(index, 0.1)} disabled={line.start == null}>
          <PlusIcon size={12} />
        </IconButton>
      </div>
      <div role="cell" className="flex min-w-0 items-center gap-1">
        {outOfOrder && (
          <span title="時間早於前面的行：儲存時會依時間重新排序" className="shrink-0 text-danger">
            <AlertIcon size={13} />
          </span>
        )}
        <input
          value={line.text}
          data-row={index}
          data-field="text"
          aria-label={`第 ${index + 1} 行歌詞`}
          placeholder="歌詞（空白的行儲存時會移除）"
          onChange={(e) => h.setText(index, "text", e.target.value)}
          onKeyDown={textKeys("text")}
          onSelect={(e) => caret(e.currentTarget)}
          onBlur={(e) => caret(e.currentTarget)}
          className={cx(textCls, "font-medium", !line.text.trim() && "border-dashed border-line")}
        />
      </div>
      <div role="cell" className="min-w-0">
        <input
          value={line.translation}
          data-row={index}
          data-field="translation"
          aria-label={`第 ${index + 1} 行翻譯`}
          placeholder="翻譯／拼音（選填）"
          onChange={(e) => h.setText(index, "translation", e.target.value)}
          onKeyDown={textKeys("translation")}
          className={cx(textCls, "text-muted focus:text-fg")}
        />
      </div>
      <div role="cell" className={cx("flex items-center gap-0.5 transition-opacity", current || tapTarget ? "opacity-100" : "opacity-40 group-hover:opacity-100 group-focus-within:opacity-100")}>
        <IconButton label="從這行播放" onClick={() => h.playFrom(index)} disabled={line.start == null}>
          <PlayIcon size={12} />
        </IconButton>
        <IconButton label="設為目前播放位置" onClick={() => h.setToPlayhead(index)} disabled={tapActive}>
          <CrosshairIcon size={14} />
        </IconButton>
        <IconButton label="從這行開始對拍" onClick={() => h.tapFrom(index)} disabled={tapActive}>
          <TapIcon size={14} />
        </IconButton>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
        <IconButton label="在下方插入一行" onClick={() => h.insertAt(index + 1)} disabled={tapActive}>
          <PlusIcon size={14} />
        </IconButton>
        <IconButton label="在游標處分割（沒有游標時從中間）" onClick={() => h.split(index, null)} disabled={tapActive || line.text.trim().length < 2}>
          <ScissorsIcon size={14} />
        </IconButton>
        <IconButton label="與下一行合併" onClick={() => h.mergeNext(index)} disabled={tapActive || index + 1 >= count}>
          <MergeIcon size={14} />
        </IconButton>
        <IconButton label="刪除這行" onClick={() => h.remove(index)} disabled={tapActive} danger>
          <TrashIcon size={14} />
        </IconButton>
      </div>
    </div>
  );
});

export function LineTable({
  lines,
  currentIndex,
  tapPointer,
  outOfOrder,
  handlers,
  empty,
}: {
  lines: EditorLine[];
  currentIndex: number | null;
  /** row to mark next in tap-sync mode; null when not tapping */
  tapPointer: number | null;
  outOfOrder: boolean[];
  handlers: RowHandlers;
  empty?: ReactNode;
}) {
  if (lines.length === 0) return <>{empty}</>;
  const tapActive = tapPointer != null;
  return (
    <div role="table" aria-label="歌詞行" aria-rowcount={lines.length} className="text-sm">
      <div
        role="row"
        className="sticky top-0 z-10 grid grid-cols-[2.75rem_9.5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px] font-medium text-faint"
      >
        <span role="columnheader">#</span>
        <span role="columnheader" className="pl-8">
          開始時間
        </span>
        <span role="columnheader" className="pl-2">
          歌詞
        </span>
        <span role="columnheader" className="pl-2">
          翻譯
        </span>
        <span role="columnheader" className="w-[15.5rem] text-right">
          操作
        </span>
      </div>
      {lines.map((line, i) => (
        <LineRow
          key={line.key}
          line={line}
          index={i}
          count={lines.length}
          current={currentIndex === i}
          tapTarget={tapPointer === i}
          tapActive={tapActive}
          outOfOrder={outOfOrder[i] ?? false}
          handlers={handlers}
        />
      ))}
      <div className="flex justify-center py-3">
        <button
          type="button"
          onClick={() => handlers.insertAt(lines.length)}
          disabled={tapActive}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-40"
        >
          <PlusIcon size={13} />
          在最後新增一行
        </button>
      </div>
    </div>
  );
}
