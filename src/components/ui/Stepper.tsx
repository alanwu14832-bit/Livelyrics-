"use client";

// Stepper (UI-AUDIT §3.3 Stepper): [− | +] for the console offset (±0.05 s, Shift 0.01) and the
// editor nudge (±0.1 s). 28 px high, 36 px per segment, radius 8, fill-3, hairline between;
// Minus / Plus 14 bold. Acts on pointer-down (fill-2 at once), auto-repeats after 400 ms every
// 80 ms while held (iOS); Shift makes the fine step. The value (optional) sits beside it, 17 / 600
// tabular (15 / 600 in the console).
//
//   <Stepper label="偏移" value={offset} onChange={setOffset} step={0.05} fineStep={0.01}
//     min={-5} max={5} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} 秒`} showValue />

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { MinusIcon, PlusIcon } from "./Icon";
import { AUTO_REPEAT_DELAY_MS, AUTO_REPEAT_INTERVAL_MS, stepValue } from "./interaction";

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  fineStep,
  min = -Infinity,
  max = Infinity,
  format,
  showValue = false,
  valuePosition = "before",
  disabled = false,
  decrementLabel,
  incrementLabel,
  className,
}: {
  /** accessible name of the value, e.g. 偏移 */
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  /** step while Shift is held */
  fineStep?: number;
  min?: number;
  max?: number;
  format?: (value: number) => ReactNode;
  showValue?: boolean;
  valuePosition?: "before" | "after";
  disabled?: boolean;
  decrementLabel?: string;
  incrementLabel?: string;
  className?: string;
}) {
  // the latest value for repeats (a held button keeps stepping from the new value)
  const valueRef = useRef(value);
  const timer = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const pointerFired = useRef(false);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    const t = timer.current;
    return () => {
      clearTimeout(t.t);
      clearInterval(t.i);
    };
  }, []);

  const stop = () => {
    clearTimeout(timer.current.t);
    clearInterval(timer.current.i);
    timer.current.t = undefined;
    timer.current.i = undefined;
  };
  const apply = (dir: 1 | -1, fine: boolean) => {
    const s = fine && fineStep ? fineStep : step;
    const next = stepValue(valueRef.current, dir * s, { min, max, precisionStep: Math.min(step, fineStep ?? step) });
    if (next === valueRef.current) return false;
    valueRef.current = next;
    onChange(next);
    return true;
  };
  const press = (e: PointerEvent<HTMLButtonElement>, dir: 1 | -1) => {
    if (e.button !== 0 || disabled) return;
    pointerFired.current = true;
    const fine = e.shiftKey;
    apply(dir, fine);
    stop();
    timer.current.t = setTimeout(() => {
      timer.current.i = setInterval(() => {
        if (!apply(dir, fine)) stop();
      }, AUTO_REPEAT_INTERVAL_MS);
    }, AUTO_REPEAT_DELAY_MS);
  };

  const atMin = value <= min;
  const atMax = value >= max;
  const segment = (dir: 1 | -1) => {
    const isInc = dir === 1;
    return (
      <button
        type="button"
        aria-label={isInc ? (incrementLabel ?? `增加${label}`) : (decrementLabel ?? `減少${label}`)}
        disabled={disabled || (isInc ? atMax : atMin)}
        onPointerDown={(e) => press(e, dir)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={(e) => {
          // pointer presses already stepped on pointer-down; keyboard (Enter / Space) steps here
          if (pointerFired.current) {
            pointerFired.current = false;
            return;
          }
          apply(dir, e.shiftKey);
        }}
        className={cx(
          "relative flex h-7 w-9 items-center justify-center text-label transition-none focus-inset active:bg-fill-2 disabled:text-label-3",
          isInc ? "rounded-r-sm" : "rounded-l-sm",
        )}
      >
        {isInc ? <PlusIcon size={14} /> : <MinusIcon size={14} />}
      </button>
    );
  };

  const valueNode = showValue && (
    <output aria-live="polite" className="tabular min-w-[4.5em] text-[17px] leading-[22px] font-semibold text-label in-data-[theme=console]:text-[15px] in-data-[theme=console]:leading-5">
      {format ? format(value) : value}
    </output>
  );

  return (
    <div className={cx("inline-flex items-center gap-3", disabled && "opacity-35", className)}>
      {valuePosition === "before" && valueNode}
      <div role="group" aria-label={label} className="relative inline-flex shrink-0 rounded-sm bg-fill-3">
        {segment(-1)}
        <span aria-hidden="true" className="my-[7px] w-(--hairline) bg-separator" />
        {segment(1)}
      </div>
      {valuePosition === "after" && valueNode}
    </div>
  );
}
