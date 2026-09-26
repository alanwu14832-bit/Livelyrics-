"use client";

// HUD (UI-AUDIT UI-19, §3.5 console): keyboard feedback like the macOS volume HUD, in the lower
// third of the console preview. UI chrome only: it lives in the console DOM and is never sent to
// or rendered in the projection window.
//
//   const hud = useRef<HudHandle>(null);
//   <div className="relative">{preview}<HUD ref={hud} /></div>
//   hud.current?.show({ icon: MoonIcon, label: "黑場", value: "開" });
//
// Timing: fully opaque in the same frame as the key (0 ms), holds 900 ms, fades out in 250 ms.
// A repeated key only updates the content and restarts the hold; it never re-enters. The first
// appearance settles from scale .94 with the snappy spring (readable from frame one); reduced
// motion drops the scale. --material-thick with its blur (the only backdrop-filter allowed over
// the preview: about 280 x 56 px for a second), radius 14, padding 12 18, 20 px icon, 15 / 600
// label, 15 tabular label-2 value. role="status" announces it.

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import type { UiIcon } from "./Icon";
import { HUD_FADE_MS, HUD_HOLD_MS } from "./interaction";
import { renderIcon } from "./render-icon";

export interface HudContent {
  icon?: UiIcon | ReactNode;
  label: ReactNode;
  value?: ReactNode;
  /** red icon (blackout on) */
  tone?: "default" | "red";
}

export interface HudHandle {
  show: (content: HudContent) => void;
  hide: () => void;
}

function HudSurface({ content, className }: { content: HudContent; className?: string }) {
  return (
    <div className={cx("flex min-w-[200px] items-center justify-center gap-3 rounded-xl px-[18px] py-3 text-label shadow-overlay material-thick", className)}>
      {content.icon != null && <span className={cx("flex shrink-0", content.tone === "red" ? "text-red" : "text-label")}>{renderIcon(content.icon, 20)}</span>}
      <span className="text-[15px] leading-5 font-semibold whitespace-nowrap">{content.label}</span>
      {content.value != null && <span className="text-[15px] leading-5 whitespace-nowrap text-label-2-on-material tabular">{content.value}</span>}
    </div>
  );
}

/** Static HUD for /ui-lab. */
export function HudPreview({ content }: { content: HudContent }) {
  return <HudSurface content={content} className="w-max" />;
}

export function HUD({ ref, className, holdMs = HUD_HOLD_MS }: { ref?: Ref<HudHandle>; className?: string; holdMs?: number }) {
  const [content, setContent] = useState<HudContent | null>(null);
  const [phase, setPhase] = useState<"hidden" | "shown" | "fading">("hidden");
  const timers = useRef<{ hold?: ReturnType<typeof setTimeout>; gone?: ReturnType<typeof setTimeout> }>({});

  useImperativeHandle(
    ref,
    () => ({
      show(c) {
        clearTimeout(timers.current.hold);
        clearTimeout(timers.current.gone);
        setContent(c);
        setPhase("shown");
        timers.current.hold = setTimeout(() => {
          setPhase("fading");
          timers.current.gone = setTimeout(() => setPhase("hidden"), HUD_FADE_MS);
        }, holdMs);
      },
      hide() {
        clearTimeout(timers.current.hold);
        clearTimeout(timers.current.gone);
        setPhase("hidden");
      },
    }),
    [holdMs],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.hold);
      clearTimeout(t.gone);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      data-phase={phase}
      className={cx(
        "pointer-events-none absolute inset-x-0 bottom-[16%] z-40 mx-auto w-max max-w-[90%]",
        // shown: opacity snaps to 1 (no opacity transition), the scale settles on the snappy spring
        "transition-[scale] duration-(--dur-spring-snappy) ease-spring-snappy",
        "data-[phase=hidden]:invisible data-[phase=hidden]:scale-94 data-[phase=hidden]:opacity-0 data-[phase=hidden]:transition-none",
        "data-[phase=fading]:opacity-0 data-[phase=fading]:[transition:opacity_var(--hud-fade)_var(--ease-out)]",
        "motion-reduce:transition-none",
        className,
      )}
      style={{ ["--hud-fade" as string]: `${HUD_FADE_MS}ms` }}
    >
      {content && <HudSurface content={content} />}
    </div>
  );
}
