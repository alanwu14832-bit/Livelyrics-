"use client";

// Small form controls shared by the console panels (dark tokens from globals.css).

import { useId, useRef, type ReactNode, type Ref } from "react";
import { cx } from "@/components/ui";

export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-2", className)}>
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-faint uppercase">{children}</h3>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex rounded-md border border-line bg-panel-2 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-[5px] font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-accent",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-xs",
              active ? "bg-fg text-bg shadow" : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  onReset,
  resetValue,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  onReset?: () => void;
  resetValue?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const changed = resetValue != null && Math.abs(value - resetValue) > 1e-6;
  return (
    <div className={cx("flex flex-col gap-1", disabled && "opacity-50")}>
      <div className="flex items-center justify-between text-xs">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <span className={cx("tabular font-mono text-[11px]", changed ? "text-accent" : "text-fg")}>{format ? format(value) : value.toFixed(2)}</span>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={!changed || disabled}
              className="rounded px-1 text-[10px] text-faint hover:text-fg disabled:invisible"
              aria-label={`重設${label}`}
            >
              重設
            </button>
          )}
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-accent"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-[10px] text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  const id = useId();
  // picked with the mouse → give the keyboard back to the show hotkeys; keyboard users keep focus
  const byPointer = useRef(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[10px] font-medium tracking-wide text-faint">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          title={title}
          onPointerDown={() => {
            byPointer.current = true;
          }}
          onKeyDown={() => {
            byPointer.current = false;
          }}
          onChange={(e) => {
            onChange(e.target.value as T);
            if (byPointer.current) e.currentTarget.blur();
          }}
          className="h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-line bg-panel-2 pr-6 pl-2 text-xs text-fg hover:border-faint focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} title={o.title}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-faint" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/** A big latching toggle for show controls (blackout, freeze, …). */
export function ToggleTile({
  label,
  sub,
  hotkey,
  active,
  tone = "accent",
  onClick,
  icon,
}: {
  label: string;
  sub?: string;
  hotkey?: string;
  active: boolean;
  tone?: "accent" | "danger" | "warn" | "ok";
  onClick: () => void;
  icon?: ReactNode;
}) {
  const activeCls = {
    accent: "border-accent bg-accent/20 text-fg shadow-[0_0_0_1px_var(--color-accent)_inset]",
    danger: "border-danger bg-danger/25 text-fg shadow-[0_0_0_1px_var(--color-danger)_inset]",
    warn: "border-warn bg-warn/15 text-fg shadow-[0_0_0_1px_var(--color-warn)_inset]",
    ok: "border-ok bg-ok/15 text-fg shadow-[0_0_0_1px_var(--color-ok)_inset]",
  }[tone];
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "relative flex h-16 flex-col items-start justify-between rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active ? activeCls : "border-line bg-panel-2 text-muted hover:border-faint hover:text-fg",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {label}
        </span>
        {hotkey && <kbd className="rounded border border-line bg-bg/60 px-1 font-mono text-[10px] text-muted">{hotkey}</kbd>}
      </span>
      {sub && <span className={cx("text-[11px]", active ? "text-fg/80" : "text-faint")}>{sub}</span>}
    </button>
  );
}

/** Horizontal 0..1 meter updated imperatively via a ref (see useMeter). */
export function MeterBar({ label, barRef, color = "var(--color-ok)" }: { label: string; barRef: Ref<HTMLDivElement>; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-10 shrink-0 text-faint">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel-3" role="presentation">
        <div ref={barRef} className="absolute inset-y-0 left-0 w-full origin-left rounded-full" style={{ background: color, transform: "scaleX(0)" }} />
      </div>
    </div>
  );
}
