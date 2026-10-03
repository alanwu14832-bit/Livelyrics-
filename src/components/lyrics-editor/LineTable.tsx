"use client";

import { memo, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button, Menu, MenuItem, MenuSeparator, Tooltip, cx } from "@/components/ui";
import { ArrowsMergeIcon, CrosshairIcon, DotsThreeIcon, HandTapIcon, MinusIcon, PlayIcon, PlusIcon, ScissorsIcon, TrashIcon, WarningCircleIcon, WarningIcon } from "@/components/ui/Icon";
import { SOFT_TEXT } from "@/components/ui/Tag";
import { isLongLine } from "@/lib/type/text";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import type { EditorLine } from "./editor-model";
import { InsertBelowIcon } from "./icons";
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

/** # | − time + | lyric | translation | actions */
// md+: # · time · lyric · translation · actions on one line. Phone: # · time · (space) · actions on
// the first line, the lyric and the translation full width under it (a 390 px row has no room for both).
const GRID = "grid grid-cols-[2.25rem_auto_minmax(0,1fr)_auto] items-center gap-x-2 md:grid-cols-[2.25rem_auto_minmax(0,1.4fr)_minmax(0,1fr)_auto]";

// borderless inline fields: hover fill-4, focused = fill-4 + the inset 2 px tint ring (radius 8)
const FIELD =
  "focus-inset h-8 w-full min-w-0 rounded-sm bg-transparent px-2 text-[15px] leading-5 transition-[background-color,color] duration-(--dur-fast) ease-[ease] placeholder:text-label-2 hover:bg-fill-4 focus-visible:bg-fill-4";

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
  const n = index + 1;
  // while tapping, everything but the target steps back
  const dim = tapActive && !tapTarget;

  return (
    <div
      role="row"
      data-row={index}
      data-key={line.key}
      aria-current={current ? "true" : undefined}
      className={cx(
        GRID,
        "group relative min-h-11 pr-2 pl-2",
        // hairline separator from where the text starts; the last row has none
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-12 after:h-(--hairline) after:bg-separator last:after:hidden",
        tapTarget ? "bg-red-soft font-semibold shadow-[inset_3px_0_0_var(--red)]" : current && !tapActive ? "row-current" : "",
      )}
    >
      <div role="cell" className={cx("t-latin pl-1.5 text-[12px] leading-4 tabular", current && !tapActive ? "text-label" : "text-label-2")}>
        {tapTarget ? (
          <span className={cx("font-semibold", SOFT_TEXT.red)}>
            {n}
            <span className="sr-only">（下一句要標記）</span>
          </span>
        ) : (
          n
        )}
      </div>
      <div role="cell" className="flex items-center">
        <Button variant="quiet" size="icon-sm" aria-label={`第 ${n} 行提早 0.1 秒`} icon={<MinusIcon size={14} />} onClick={() => h.nudge(index, -0.1)} disabled={line.start == null} />
        <TimeInput
          value={line.start}
          aria-label={`第 ${n} 行開始時間`}
          data-row={index}
          data-field="time"
          warn={outOfOrder}
          dim={dim}
          onCommit={(t) => h.setStart(index, t)}
          onNudge={(d) => h.nudge(index, d)}
          onEnter={(shift) => h.focusCell(shift ? index - 1 : index + 1, "time")}
        />
        <Button variant="quiet" size="icon-sm" aria-label={`第 ${n} 行延後 0.1 秒`} icon={<PlusIcon size={14} />} onClick={() => h.nudge(index, 0.1)} disabled={line.start == null} />
      </div>
      <div role="cell" className="relative flex min-w-0 items-center gap-1 max-md:col-span-full max-md:row-start-2 max-md:pl-9">
        {outOfOrder && (
          <span title="時間早於前一行：儲存時會依時間重新排序" className="flex shrink-0 text-red">
            <WarningCircleIcon size={16} weight="fill" aria-label="時間早於前一行" />
          </span>
        )}
        {!outOfOrder && isLongLine(line.text) && (
          <span title="這句太長，建議拆成兩句（超過 14 個字的句子會自動拆成兩段排版）" className={cx("flex shrink-0", SOFT_TEXT.orange)} data-long-line>
            <WarningIcon size={16} weight="fill" aria-label="這句太長，建議拆成兩句" />
          </span>
        )}
        <input
          value={line.text}
          data-row={index}
          data-field="text"
          aria-label={`第 ${n} 行歌詞`}
          placeholder="歌詞（空白的行儲存時會移除）"
          onChange={(e) => h.setText(index, "text", e.target.value)}
          onKeyDown={textKeys("text")}
          onSelect={(e) => caret(e.currentTarget)}
          onBlur={(e) => caret(e.currentTarget)}
          className={cx(FIELD, dim ? "text-label-2" : "text-label", !line.text.trim() && "bg-fill-4")}
        />
      </div>
      <div role="cell" className="min-w-0 max-md:col-span-full max-md:row-start-3 max-md:pb-1 max-md:pl-9">
        <input
          value={line.translation}
          data-row={index}
          data-field="translation"
          aria-label={`第 ${n} 行翻譯`}
          placeholder="翻譯（選填）"
          onChange={(e) => h.setText(index, "translation", e.target.value)}
          onKeyDown={textKeys("translation")}
          className={cx(
            FIELD,
            "font-normal text-label-2 focus-visible:text-label",
            // the placeholder shows on the row under the pointer or keyboard only: 14 identical hints are noise
            "placeholder:opacity-0 group-hover:placeholder:opacity-100 group-focus-within:placeholder:opacity-100",
          )}
        />
      </div>
      <div role="cell" className="flex items-center gap-0.5 max-md:col-start-4 max-md:row-start-1 max-md:justify-self-end">
        <Tooltip content="從這行播放">
          <Button variant="quiet" size="icon-sm" aria-label={`從第 ${n} 行播放`} icon={<PlayIcon size={16} />} onClick={() => h.playFrom(index)} disabled={line.start == null} />
        </Tooltip>
        <Tooltip content="從這行開始對拍">
          <Button variant="quiet" size="icon-sm" aria-label={`從第 ${n} 行開始對拍`} icon={<HandTapIcon size={16} />} onClick={() => h.tapFrom(index)} disabled={tapActive} />
        </Tooltip>
        <Menu
          label={`第 ${n} 行`}
          placement="bottom-end"
          trigger={(p) => <Button {...p} variant="quiet" size="icon-sm" aria-label={`第 ${n} 行的更多動作`} icon={<DotsThreeIcon size={16} />} disabled={tapActive} />}
        >
          <MenuItem icon={CrosshairIcon} onSelect={() => h.setToPlayhead(index)} textValue="設為目前播放位置">
            設為目前播放位置
          </MenuItem>
          <MenuItem icon={InsertBelowIcon} onSelect={() => h.insertAt(index + 1)} shortcut="Ctrl+Enter" textValue="在下方插入一行">
            在下方插入一行
          </MenuItem>
          <MenuItem icon={ScissorsIcon} onSelect={() => h.split(index, null)} disabled={line.text.trim().length < 2} textValue="在游標處分割">
            在游標處分割
          </MenuItem>
          <MenuItem icon={ArrowsMergeIcon} onSelect={() => h.mergeNext(index)} disabled={index + 1 >= count} textValue="與下一行合併">
            與下一行合併
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={TrashIcon} destructive onSelect={() => h.remove(index)} textValue="刪除這行">
            刪除這行
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
});

/** Rows glide to their new place when lines are inserted, removed, merged, split or sorted (FLIP). */
function useRowLayoutMotion(bodyRef: React.RefObject<HTMLDivElement | null>, keys: string) {
  const reduce = useReducedMotion();
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      tops.current = new Map();
      return;
    }
    const rows = Array.from(body.querySelectorAll<HTMLElement>(":scope > [role='row'][data-key]"));
    const next = new Map<string, number>();
    for (const r of rows) next.set(r.dataset.key as string, r.offsetTop);
    const prev = tops.current;
    tops.current = next;
    if (prev.size === 0 || reduce) return;
    const css = getComputedStyle(body);
    const easing = css.getPropertyValue("--ease-spring").trim() || "cubic-bezier(0.23, 1, 0.32, 1)";
    const duration = parseFloat(css.getPropertyValue("--dur-spring")) || 500;
    const added: HTMLElement[] = [];
    for (const r of rows) {
      const before = prev.get(r.dataset.key as string);
      const after = next.get(r.dataset.key as string) as number;
      if (before == null) added.push(r);
      else if (before !== after) r.animate([{ transform: `translateY(${before - after}px)` }, { transform: "none" }], { duration, easing });
    }
    // a wholesale replacement (import) just appears; one or two new rows materialize
    if (added.length > 0 && added.length <= 2) {
      for (const r of added) r.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
  }, [bodyRef, keys, reduce]);
}

export function LineTable({
  lines,
  currentIndex,
  tapPointer,
  outOfOrder,
  handlers,
  empty,
  summary,
}: {
  lines: EditorLine[];
  currentIndex: number | null;
  /** row to mark next in tap-sync mode; null when not tapping */
  tapPointer: number | null;
  outOfOrder: boolean[];
  handlers: RowHandlers;
  empty?: ReactNode;
  /** left of the column captions, e.g. 「14 行，全部已定時」 */
  summary?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useRowLayoutMotion(bodyRef, lines.map((l) => l.key).join("|"));
  if (lines.length === 0) return <>{empty}</>;
  const tapActive = tapPointer != null;
  return (
    <div role="table" aria-label="歌詞行" aria-rowcount={lines.length}>
      <div role="rowgroup" className="sticky top-0 z-10 bg-bg pt-4 pb-1.5">
        {summary && <div className="mb-2 px-4">{summary}</div>}
        {/* the column captions only line up with the one-line rows (md+) */}
        <div role="row" className={cx(GRID, "pr-2 pl-2 text-[13px] leading-5 text-label-2 max-md:hidden")}>
          <span role="columnheader" className="pl-1.5">
            #
          </span>
          <span role="columnheader" className="w-[9.25rem] pr-9 text-right">
            開始時間
          </span>
          <span role="columnheader" className="pl-2">
            歌詞
          </span>
          <span role="columnheader" className="pl-2">
            翻譯
          </span>
          <span role="columnheader" className="w-[5.5rem]">
            <span className="sr-only">操作</span>
          </span>
        </div>
      </div>
      <div ref={bodyRef} role="rowgroup" className="relative overflow-hidden rounded-lg bg-surface">
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
      </div>
      <div className="flex justify-center py-3">
        <Button variant="plain" icon={PlusIcon} onClick={() => handlers.insertAt(lines.length)} disabled={tapActive}>
          在最後新增一行
        </Button>
      </div>
    </div>
  );
}
