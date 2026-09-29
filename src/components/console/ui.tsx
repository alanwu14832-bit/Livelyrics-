"use client";

// Console-local building blocks on top of the kit (src/components/ui, docs/UI-AUDIT.md §3.3 and
// §3.5 console): pane chrome, group titles, the macOS pop-up select, the show-control tiles, the
// timeline zoom button group, key-value readouts, and the retargetable spring used for automatic
// list scrolling. The console is always the dark "console" theme, so these assume console density.

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { Kbd, cx } from "@/components/ui";
import { CaretUpDownIcon, type UiIcon } from "@/components/ui/Icon";
import { springState } from "@/components/ui/spring";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";

// ---------------------------------------------------------------- panes

/**
 * One console pane: --surface, radius 12, no border, on the #000 page with a 6 px gap. The panes
 * fade in once, 40 ms apart, when the console first appears (UI-AUDIT 3.4.1 item 6; opacity only,
 * so it also runs under reduced motion); they stay mounted afterwards, so it never plays again.
 */
export function Pane({
  area,
  label,
  order = 0,
  className,
  children,
}: {
  /** grid-area in the console grid (omit inside the centre column) */
  area?: string;
  label: string;
  /** first-load fade order (0..4) */
  order?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-surface",
        "transition-opacity duration-(--dur-base) ease-out starting:opacity-0",
        className,
      )}
      style={{ gridArea: area, transitionDelay: `${order * 40}ms` }}
    >
      {children}
    </section>
  );
}

/** 40 px pane header: 15 / 600 title, 12 px secondary meta, actions on the right. */
export function PaneHeader({
  title,
  meta,
  actions,
  scrolled = false,
  className,
  titleId,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** content scrolls beneath: show the hairline scroll edge */
  scrolled?: boolean;
  className?: string;
  titleId?: string;
}) {
  return (
    <header
      className={cx(
        "relative z-20 flex h-10 shrink-0 items-center gap-2 px-3 transition-shadow duration-(--dur-fast) ease-[ease]",
        scrolled && "scroll-edge",
        className,
      )}
    >
      <h2 id={titleId} className="shrink-0 text-c-headline text-label">
        {title}
      </h2>
      {meta != null && <div className="flex min-w-0 items-center gap-1.5 text-c-footnote text-label-2">{meta}</div>}
      {actions != null && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** True once `ref` has scrolled away from the top (for a header's scroll-edge hairline). */
export function useScrollEdge(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScrolled(el.scrollTop > 0);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
    // deps: re-attach when the scroll container is swapped (keyed tab panels)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
  return scrolled;
}

/** 12 / 600 secondary group title (never uppercase, no tracking), with optional trailing actions. */
export function GroupTitle({ children, actions, className, id }: { children: ReactNode; actions?: ReactNode; className?: string; id?: string }) {
  return (
    <div className={cx("flex min-h-7 items-center justify-between gap-2", className)}>
      <h3 id={id} className="min-w-0 truncate text-c-footnote font-semibold text-label-2">
        {children}
      </h3>
      {actions != null && <div className="-mr-1 flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/**
 * An inset group body inside a pane: --surface-2, radius 10, no border. Inside a sheet (whose
 * --elevated surface is the same grey) it becomes a translucent fill, as the kit's InsetGroup does.
 */
export function Group({ children, className, ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("min-w-0 overflow-hidden rounded-md bg-surface-2 [dialog_&]:bg-fill-4", className)}>
      {children}
    </div>
  );
}

/** 12 px secondary footnote under a group. */
export function Footnote({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <p id={id} className={cx("mt-1.5 text-c-footnote text-label-2", className)}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------- pop-up select

/**
 * The macOS pop-up button: a native <select> (native menu and accessibility) drawn as a 28 px
 * fill-3 control with a CaretUpDown. A mouse pick gives the keyboard back to the show hotkeys;
 * keyboard users keep focus.
 */
export function PopupSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hideLabel = false,
  className,
  id: idProp,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
  id?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const byPointer = useRef(false);
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className={cx("truncate text-c-footnote text-label-2", hideLabel && "sr-only")}>
        {label}
      </label>
      <span className="relative flex min-w-0">
        <select
          id={id}
          value={value}
          disabled={disabled}
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
          className="h-7 w-full min-w-0 cursor-default appearance-none truncate rounded-sm bg-fill-3 pr-7 pl-2.5 text-c-body text-label transition-[background-color] duration-(--dur-fast) ease-[ease] hover:bg-fill-2 focus-visible:outline-offset-0 disabled:pointer-events-none disabled:opacity-35"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <CaretUpDownIcon size={14} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-label-2" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- show-control tiles

/** Text on a soft tint fill (--tint-text-on-soft pulled 15 % toward --label, as the kit does: AA on every surface). */
export const TINT_ON_SOFT = "text-[color-mix(in_srgb,var(--tint-text-on-soft)_85%,var(--label))]";

/**
 * A 56 px latching show control (UI-AUDIT 3.5 控制): off = fill-3 with a label-2 icon and --label
 * text, the hotkey top right; on = solid red for blackout (the only solid tile), tint-soft for the
 * rest. Presses scale to .98 (a large tile).
 */
export function ToggleTile({
  label,
  sub,
  hotkey,
  active,
  tone = "tint",
  icon: Icon,
  onClick,
}: {
  label: string;
  sub?: string;
  hotkey?: string;
  active: boolean;
  tone?: "red" | "tint";
  icon?: UiIcon;
  onClick: () => void;
}) {
  const on = active ? (tone === "red" ? "bg-red-fill text-white" : cx("bg-tint-soft", TINT_ON_SOFT)) : "bg-fill-3 text-label hover:bg-fill-2";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-keyshortcuts={hotkey}
      onClick={onClick}
      className={cx("press-tile relative flex h-14 min-w-0 flex-col justify-between rounded-md px-2.5 py-2 text-left", on)}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        {Icon && <Icon size={16} weight={active ? "fill" : "bold"} className={cx("shrink-0", !active && "text-label-2")} />}
        <span className="min-w-0 truncate text-c-body font-semibold">{label}</span>
        {hotkey && (
          <Kbd className={cx("ml-auto", active && tone === "red" && "bg-white/20 text-white shadow-none", active && tone === "tint" && "bg-tint-soft")}>{hotkey}</Kbd>
        )}
      </span>
      {sub && <span className={cx("min-w-0 truncate text-c-footnote", active ? (tone === "red" ? "text-white" : TINT_ON_SOFT) : "text-label-2")}>{sub}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- button group (timeline zoom)

export interface GroupButton {
  key: string;
  label: ReactNode;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  width?: string;
}

/**
 * A segmented row of momentary buttons ([−][全曲][+]): 28 px, fill-3, radius 8, hairlines between;
 * pressed state appears at once (fill-2), like the kit Stepper.
 */
export function ButtonGroup({ label, buttons, className }: { label: string; buttons: GroupButton[]; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex h-7 shrink-0 items-stretch rounded-sm bg-fill-3", className)}>
      {buttons.map((b, i) => (
        <span key={b.key} className="flex items-stretch">
          {i > 0 && <span aria-hidden="true" className="my-[7px] w-(--hairline) bg-separator" />}
          <button
            type="button"
            aria-label={b.ariaLabel}
            aria-pressed={b.pressed}
            disabled={b.disabled}
            onClick={b.onClick}
            className={cx(
              "flex h-7 min-w-8 items-center justify-center px-2 text-c-footnote font-medium text-label transition-none focus-inset active:bg-fill-2 disabled:text-label-3",
              i === 0 && "rounded-l-sm",
              i === buttons.length - 1 && "rounded-r-sm",
              b.width,
            )}
          >
            {b.label}
          </button>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- key-value readout

/** One line of plain key-value pairs (12 px label-2 keys, 13 px --label values, 16 px apart): no chips, no frames. */
export function KeyValues({ items, className }: { items: ReadonlyArray<{ key: string; value: ReactNode; title?: string; tone?: "default" | "orange" } | false | null | undefined>; className?: string }) {
  return (
    <dl className={cx("flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1", className)}>
      {items.filter(Boolean).map((it) => {
        const item = it as { key: string; value: ReactNode; title?: string; tone?: "default" | "orange" };
        return (
          <div key={item.key} className="flex min-w-0 items-baseline gap-1.5" title={item.title}>
            <dt className="shrink-0 text-c-footnote text-label-2">{item.key}</dt>
            <dd className={cx("min-w-0 truncate text-c-body", item.tone === "orange" ? "text-orange-text" : "text-label")}>{item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------------------------------------------------------------- spring scrolling

/**
 * Automatic scrolling for a list (lyrics follow, cue list): a critically damped spring on
 * scrollTop (response 0.35 s) that retargets from where it is with its current velocity, so
 * rapid line changes never restart from zero. Under reduced motion it jumps. Keyboard-driven
 * scrolling should call `jump` (never animated).
 */
export function useSpringScroll(ref: RefObject<HTMLElement | null>) {
  const reduce = useReducedMotion();
  const state = useRef<{ raf: number; to: number; x0: number; v0: number; t0: number } | null>(null);

  const stop = useCallback(() => {
    const s = state.current;
    if (s) cancelAnimationFrame(s.raf);
    state.current = null;
  }, []);

  const jump = useCallback(
    (top: number) => {
      stop();
      const el = ref.current;
      if (el) el.scrollTop = Math.max(0, top);
    },
    [ref, stop],
  );

  const to = useCallback(
    (top: number) => {
      const el = ref.current;
      if (!el) return;
      const target = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
      if (reduce) {
        jump(target);
        return;
      }
      const now = performance.now();
      let x0 = el.scrollTop - target;
      let v0 = 0;
      const s = state.current;
      if (s) {
        // retarget from the live position with the live velocity (apple-design §3)
        const cur = springState((now - s.t0) / 1000, s.x0, s.v0);
        x0 = s.to + cur.x - target;
        v0 = cur.v;
        cancelAnimationFrame(s.raf);
      }
      if (Math.abs(x0) < 0.5 && Math.abs(v0) < 5) {
        state.current = null;
        return;
      }
      const run: { raf: number; to: number; x0: number; v0: number; t0: number } = { raf: 0, to: target, x0, v0, t0: now };
      const step = (t: number) => {
        if (state.current !== run || !ref.current) return;
        const { x, v } = springState(Math.max(0, (t - run.t0) / 1000), run.x0, run.v0);
        if (Math.abs(x) < 0.5 && Math.abs(v) < 5) {
          ref.current.scrollTop = run.to;
          state.current = null;
          return;
        }
        ref.current.scrollTop = run.to + x;
        run.raf = requestAnimationFrame(step);
      };
      run.raf = requestAnimationFrame(step);
      state.current = run;
    },
    [ref, reduce, jump],
  );

  useEffect(() => stop, [stop]);
  return { to, jump, stop };
}

/** Inline 6 px dot (semantic colour), e.g. the on-air dot before LIVE. */
export function Dot({ className, style, label }: { className?: string; style?: CSSProperties; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx("inline-block size-1.5 shrink-0 rounded-full", className)} style={style} />;
}
