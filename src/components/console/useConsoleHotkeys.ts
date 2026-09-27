"use client";

// Keyboard-first operation for a console view (the song console, and the show console's look and
// pre-show views): window-level hotkeys (hotkeys.ts), Space kept for the transport on keyup, and a
// mouse click never leaving focus on a control (Enter or the arrows would re-trigger it).

import { useEffect } from "react";
import { hotkeyAction, targetOwnsKey, type HotkeyAction, type TargetLike } from "@/lib/console/hotkeys";

export function asTarget(t: EventTarget | null): TargetLike | null {
  if (!t || typeof (t as Element).tagName !== "string") return null;
  const el = t as HTMLElement;
  return { tagName: el.tagName, type: (el as HTMLInputElement).type, isContentEditable: el.isContentEditable, role: el.getAttribute("role") };
}

/**
 * `onAction` runs a hotkey and returns false when this view does not handle it (the key then
 * keeps its default). `paused`: a modal sheet is open and passes its own keys through.
 */
export function useConsoleHotkeys({ active, paused, onAction }: { active: boolean; paused: boolean; onAction: (action: HotkeyAction) => boolean }): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (paused) return; // the sheets are modal and pass through their own keys
      const target = asTarget(e.target);
      if (targetOwnsKey(target, e.code)) return;
      const action = hotkeyAction(e);
      if (!action) return;
      if (!onAction(action)) return;
      e.preventDefault();
      // a hotkey answers with the HUD: dismiss the focused control's tooltip (e.g. the one shown
      // when a sheet returned focus to its opener). Non-bubbling, so no hotkey handler sees it.
      if (e.target instanceof HTMLElement && e.target !== document.body) e.target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: false }));
    };
    // Space on a focused button would also "click" it on keyup: Space belongs to the transport
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || paused) return;
      if (!targetOwnsKey(asTarget(e.target), e.code)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, onAction, paused]);

  // A mouse click must not leave focus on a control: Enter (cue) or arrows (next line) would
  // otherwise re-trigger that button / move that slider. Keyboard (Tab) focus is kept.
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return; // keyboard activation
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body || el.closest('dialog, [role="dialog"]')) return;
      const tag = el.tagName;
      if (tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable) return;
      if (tag === "INPUT" && !["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type)) return;
      el.blur();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [active]);
}
