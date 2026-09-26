"use client";

// SegmentedControl (UI-AUDIT §3.3, UI-09): the one segmented control (TRACK/LIVE, the side-panel
// tabs, lyrics source, import method, playback speed, timeline zoom).
//
//   <SegmentedControl label="模式" value={mode} onChange={setMode}
//     options={[{ value: "track", label: "TRACK" }, { value: "live", label: "LIVE" }]} />
//   <SegmentedControl kind="tabs" fullWidth label="側欄" value={tab} onChange={setTab}
//     options={tabs} getTabId={(v) => `tab-${v}`} getPanelId={(v) => `panel-${v}`} />
//   options[i].caption  -> 12 px label-2 caption under the control, updated with the selection
//
// Look: 28 px, 2 px padding, radius 8, fill-3; equal segments; 13 / 500 labels (600 selected);
// hairlines between unselected neighbours. One thumb element (radius 6, --segment-thumb,
// --shadow-thumb) slides with the CSS critically damped spring; the transform sits on the thumb
// itself. It retargets from where it is when clicked again mid-flight, grows to 1.04 while the
// selected segment is held, and can be dragged across segments (iOS). Reduced motion: no slide.
//
// Semantics: radiogroup / radio (values) or tablist / tab (views); roving tabindex; ← → ↑ ↓
// Home End move and select. `blurOnPointer` gives the keyboard back to page hotkeys after a mouse
// pick (console).

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { rovingIndex, segmentAt } from "./interaction";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** accessible name when the label is an icon */
  ariaLabel?: string;
  /** caption shown under the control while this option is selected */
  caption?: ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  kind = "radio",
  fullWidth = false,
  blurOnPointer = false,
  getTabId,
  getPanelId,
  className,
  disabled = false,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  /** accessible name of the group */
  label: string;
  kind?: "radio" | "tabs";
  fullWidth?: boolean;
  blurOnPointer?: boolean;
  getTabId?: (value: T) => string;
  getPanelId?: (value: T) => string;
  className?: string;
  disabled?: boolean;
}) {
  const n = options.length;
  const selected = options.findIndex((o) => o.value === value);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const dragged = useRef(false);
  const captionId = useId();
  const shown = dragIndex ?? selected;
  const caption = selected >= 0 ? options[selected].caption : undefined;
  const tabbable = selected >= 0 && !options[selected].disabled ? selected : options.findIndex((o) => !o.disabled);
  const isTabs = kind === "tabs";

  const select = (i: number, focus: boolean) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    if (focus) buttons.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = buttons.current.findIndex((b) => b === document.activeElement);
    const next = rovingIndex(e.key, from >= 0 ? from : selected, n, { isDisabled: (i) => !!options[i].disabled });
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    select(next, true);
  };

  // hold the selected segment: the thumb lifts (1.04) and follows the pointer across segments
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (disabled || e.button !== 0 || i !== selected) return;
    dragged.current = false;
    setHeld(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!held) return;
    const r = groupRef.current?.getBoundingClientRect();
    if (!r) return;
    const i = segmentAt(e.clientX, r.left, r.width, n);
    if (options[i]?.disabled) return;
    if (i !== shown) {
      dragged.current = true;
      setDragIndex(i);
    }
  };
  const endHold = (commit: boolean) => {
    if (!held) return;
    if (commit && dragIndex != null && dragIndex !== selected) select(dragIndex, false);
    setHeld(false);
    setDragIndex(null);
  };

  return (
    <div className={cx(fullWidth ? "flex w-full min-w-0 flex-col" : "inline-flex max-w-full min-w-0 flex-col", className)}>
      <div
        ref={groupRef}
        role={isTabs ? "tablist" : "radiogroup"}
        aria-label={label}
        aria-describedby={caption ? captionId : undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className={cx("relative grid h-7 min-w-0 rounded-sm bg-fill-3 p-0.5 select-none", fullWidth ? "w-full" : "w-max max-w-full", disabled && "pointer-events-none opacity-35")}
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {shown >= 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-xs bg-segment-thumb shadow-thumb transition-transform duration-(--dur-spring) ease-spring motion-reduce:transition-none forced-colors:border forced-colors:border-[Highlight]"
            style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${shown * 100}%) scale(${held ? 1.04 : 1})` }}
          />
        )}
        {options.slice(1).map((o, k) => {
          const i = k + 1; // separator between i - 1 and i
          const hidden = i === shown || i - 1 === shown;
          return (
            <span
              key={`sep-${o.value}`}
              aria-hidden="true"
              className={cx("pointer-events-none absolute top-[7px] bottom-[7px] w-(--hairline) bg-separator transition-opacity duration-(--dur-fast) ease-[ease]", hidden && "opacity-0")}
              style={{ left: `calc(2px + (100% - 4px) * ${i} / ${n})` }}
            />
          );
        })}
        {options.map((o, i) => {
          const on = i === selected;
          return (
            <button
              key={o.value}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role={isTabs ? "tab" : "radio"}
              aria-checked={isTabs ? undefined : on}
              aria-selected={isTabs ? on : undefined}
              aria-controls={isTabs && getPanelId ? getPanelId(o.value) : undefined}
              id={getTabId?.(o.value)}
              aria-label={o.ariaLabel}
              disabled={o.disabled || disabled}
              tabIndex={i === tabbable ? 0 : -1}
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={() => endHold(true)}
              onPointerCancel={() => endHold(false)}
              onClick={(e) => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                select(i, false);
                if (blurOnPointer && e.detail > 0) e.currentTarget.blur();
              }}
              className={cx(
                "relative z-[1] flex h-6 min-w-0 items-center justify-center gap-1 rounded-xs px-3 text-[13px] leading-none whitespace-nowrap text-label focus-inset",
                // the hit area covers the control's 2 px padding: 28 px tall
                "before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
                "transition-opacity duration-(--dur-release) ease-out disabled:opacity-35",
                i === shown ? "font-semibold" : "font-medium",
                !on && "active:opacity-60 active:duration-(--dur-press)",
              )}
            >
              <span className="truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
      {caption && (
        <p id={captionId} className="mt-1.5 text-[12px] leading-4 text-label-2">
          {caption}
        </p>
      )}
    </div>
  );
}
