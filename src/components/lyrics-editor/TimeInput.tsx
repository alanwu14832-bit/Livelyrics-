"use client";

import { useState, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";
import { formatTimeInput, parseTimeInput } from "./editor-model";

/**
 * m:ss.cc time cell. Type a time and press Enter (empty = untimed); ↑/↓ nudge by 0.1 s
 * (Shift ±1 s, Alt ±0.01 s); Esc reverts.
 */
export function TimeInput({
  value,
  onCommit,
  onNudge,
  onEnter,
  invalidHint,
  warn,
  className,
  "aria-label": ariaLabel,
  ...data
}: {
  value: number | null;
  onCommit: (t: number | null) => void;
  onNudge: (delta: number) => void;
  /** after Enter committed (e.g. move to the next row) */
  onEnter?: (shift: boolean) => void;
  invalidHint?: string;
  warn?: boolean;
  className?: string;
  "aria-label": string;
  [key: `data-${string}`]: string | number | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const shown = draft ?? formatTimeInput(value);
  const parsed = draft != null ? parseTimeInput(draft) : value;
  const invalid = draft != null && parsed === undefined;

  const commit = () => {
    if (draft == null) return true;
    const t = parseTimeInput(draft);
    if (t === undefined) {
      setError(true);
      return false;
    }
    setDraft(null);
    setError(false);
    if (t !== value) onCommit(t);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (value == null && draft == null) return;
      const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1;
      if (draft != null && !commit()) return;
      onNudge(e.key === "ArrowUp" ? step : -step);
      setDraft(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (commit()) onEnter?.(e.shiftKey);
    } else if (e.key === "Escape") {
      if (draft != null) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(null);
        setError(false);
      }
      e.currentTarget.blur();
    }
  };

  return (
    <input
      {...data}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      aria-invalid={invalid || error || undefined}
      title={invalid || error ? invalidHint ?? "時間格式：分:秒.百分秒，例如 1:23.45；清空代表未定時" : "↑/↓ 微調 0.1 秒（Shift 1 秒、Alt 0.01 秒），Enter 確認"}
      placeholder="未定時"
      value={shown}
      onFocus={(e) => {
        setDraft(formatTimeInput(value));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        setError(false);
      }}
      onBlur={() => {
        if (!commit()) {
          // invalid text: fall back to the stored value
          setDraft(null);
        }
      }}
      onKeyDown={onKeyDown}
      className={cx(
        "h-8 w-[5.5rem] rounded-md border bg-transparent px-2 text-right font-mono text-[13px] tabular outline-none transition-colors",
        "placeholder:text-left placeholder:font-sans placeholder:text-xs placeholder:text-warn/80",
        "focus:border-accent focus:bg-panel-2",
        invalid || error ? "border-danger text-danger" : warn ? "border-danger/40 text-danger" : "border-transparent text-fg hover:border-line",
        className,
      )}
    />
  );
}
