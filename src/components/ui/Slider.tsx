"use client";

// Slider (UI-AUDIT §3.3 Slider, UI-17, UI-33): a styled native <input type="range"> (native
// accessibility kept) with a 28 px hit area, 4 px track filled up to --p, 20 px white knob.
//
//   <Slider label="亮度" value={v} min={0} max={1.5} step={0.05} onChange={setV}
//     format={(v) => `${Math.round(v * 100)}%`} resetValue={1} />
//
// - The value sits right of the label, 12 px tabular label-2; once changed from `resetValue` it
//   turns --label (never the accent). 「重設」 is a 12 px plain button just before it.
// - Dragging is 1:1 with zero transition; the knob grows while held; dragging past either end
//   rubber-bands the control towards the pointer and springs back on release (apple-design §9).
// - Only 「重設」 animates: the knob and fill glide back in 200 ms ease-out (the value itself is
//   committed at once, so the stage gets one update).
// - Keys: arrows one step (native), Shift + arrows ten steps, Home / End, Page Up / Down (native).
//   Navigation keys do not bubble to page hotkeys.
// Reduced motion: no glide, no rubber band.

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { rubberband } from "@/lib/motion";
import { cx } from "./cx";
import { tweenTo, type Playback } from "./spring";
import { useReducedMotion } from "./use-reduced-motion";
import { percentOf, sliderKeyDelta, stepValue } from "./interaction";

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format,
  resetValue,
  onReset,
  disabled = false,
  hint,
  showValue = true,
  hideLabel = false,
  bigStepMultiplier = 10,
  id,
  className,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  /** shows 「重設」 while the value differs from it */
  resetValue?: number;
  /** custom reset (defaults to onChange(resetValue)) */
  onReset?: () => void;
  disabled?: boolean;
  hint?: string;
  showValue?: boolean;
  hideLabel?: boolean;
  bigStepMultiplier?: number;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const reduce = useReducedMotion();
  const [glide, setGlide] = useState<number | null>(null);
  const glideRef = useRef<Playback | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const shown = glide ?? value;
  const changed = resetValue != null && Math.abs(value - resetValue) > 1e-9;
  const text = format ? format(shown) : String(Number(shown.toFixed(4)));

  useEffect(() => () => glideRef.current?.stop(), []);

  const reset = () => {
    if (resetValue == null) return;
    const from = value;
    if (onReset) onReset();
    else onChange(resetValue);
    glideRef.current?.stop();
    if (reduce) return;
    glideRef.current = tweenTo({
      from,
      to: resetValue,
      duration: 200,
      onUpdate: (v) => setGlide(v),
      onComplete: () => setGlide(null),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.stopPropagation();
    glideRef.current?.stop();
    setGlide(null);
    if (!e.shiftKey) return;
    const delta = sliderKeyDelta(e.key, true, step, bigStepMultiplier);
    if (delta == null) return;
    e.preventDefault();
    onChange(stepValue(value, delta, { min, max, precisionStep: step }));
  };

  // rubber band past the ends while dragging (transform on the wrapper only, never the value)
  const onPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    glideRef.current?.stop();
    setGlide(null);
    if (reduce || disabled || e.button !== 0) return;
    const input = e.currentTarget;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const move = (ev: globalThis.PointerEvent) => {
      const r = input.getBoundingClientRect();
      const over = ev.clientX > r.right ? ev.clientX - r.right : ev.clientX < r.left ? ev.clientX - r.left : 0;
      wrap.style.transition = "none";
      wrap.style.transform = over ? `translateX(${rubberband(over, r.width, 0.18).toFixed(2)}px)` : "";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      wrap.style.transition = "transform var(--dur-spring) var(--ease-spring)";
      wrap.style.transform = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className={cx("flex min-w-0 flex-col", className)}>
      <div className={cx("flex min-h-7 items-center justify-between gap-2", disabled && "opacity-35", hideLabel && !showValue && resetValue == null && "hidden")}>
        <label htmlFor={inputId} className={cx("min-w-0 truncate text-[13px] leading-[18px] font-medium text-label", hideLabel && "sr-only")}>
          {label}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          {resetValue != null && (
            <button
              type="button"
              onClick={reset}
              disabled={!changed || disabled}
              aria-label={`重設${label}`}
              className="press-fade h-7 rounded-xs px-1.5 text-[12px] leading-4 text-tint-text hover:bg-fill-4 disabled:invisible"
            >
              重設
            </button>
          )}
          {showValue && (
            <output htmlFor={inputId} className={cx("tabular text-[12px] leading-4", changed ? "text-label" : "text-label-2")}>
              {text}
            </output>
          )}
        </div>
      </div>
      <div ref={wrapRef}>
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-valuetext={text}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            glideRef.current?.stop();
            setGlide(null);
            onChange(Number(e.target.value));
          }}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          className={cx(
            "ui-slider block w-full",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-(--dur-spring-snappy) [&::-webkit-slider-thumb]:ease-spring-snappy active:[&::-webkit-slider-thumb]:scale-115",
            "[&::-moz-range-thumb]:transition-transform [&::-moz-range-thumb]:duration-(--dur-spring-snappy) active:[&::-moz-range-thumb]:scale-115",
            "motion-reduce:active:[&::-webkit-slider-thumb]:scale-100 motion-reduce:active:[&::-moz-range-thumb]:scale-100",
          )}
          style={{ "--p": `${percentOf(shown, min, max)}%` } as CSSProperties}
        />
      </div>
      {hint && (
        <p id={hintId} className="text-[12px] leading-4 text-label-2">
          {hint}
        </p>
      )}
    </div>
  );
}
