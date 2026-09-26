// Motion presets for the operator UI (UI-AUDIT §3.4). The CSS side lives in
// src/app/globals.css (--ease-*, --dur-*, --ease-spring); these are the motion (v13)
// equivalents for the few places that animate from JS: the console timeline window
// (animate()), exits that need AnimatePresence, and home/process layout + stagger.
//
// Rules: springs are critically damped (bounce 0) unless a gesture carried momentum;
// keyboard-triggered changes never animate; with reduced motion use `fadeReduced`
// (opacity only, no layout, no stagger). On the console, animate full `transform`
// strings (WAAPI, off the main thread), not the x / y / scale shorthands.

import type { Transition } from "motion/react";

/** Default spring: damping 1.0, response ~0.35 s (Apple's "move / reposition"). */
export const spring = { type: "spring", bounce: 0, visualDuration: 0.35 } as const satisfies Transition;

/** Small elements (chips, thumbs, icons): damping 1.0, response ~0.25 s. */
export const springSnappy = { type: "spring", bounce: 0, visualDuration: 0.25 } as const satisfies Transition;

/** Only for a drag / flick release that carried momentum. */
export const springMomentum = { type: "spring", bounce: 0.2, visualDuration: 0.4 } as const satisfies Transition;

/** Cubic-bezier control points matching the CSS tokens. */
export const easeOut = [0.23, 1, 0.32, 1] as const;
export const easeInOut = [0.77, 0, 0.175, 1] as const;
export const easeDrawer = [0.32, 0.72, 0, 1] as const;

/** Replacement for any movement when the user prefers reduced motion. */
export const fadeReduced = { duration: 0.15, ease: easeOut } as const satisfies Transition;

/** Durations in seconds, mirroring --dur-* in globals.css. */
export const durations = {
  press: 0.08,
  release: 0.16,
  fast: 0.15,
  base: 0.2,
  exit: 0.15,
  toast: 0.25,
} as const;

/** Stagger for rare "just finished" reveals: 40 ms apart, at most 12 items. */
export const STAGGER_S = 0.04;
export const STAGGER_MAX = 12;
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX - 1) * STAGGER_S;
}

/** Pick the transition to use: the requested one, or a short fade under reduced motion. */
export function motionFor(reduce: boolean | null | undefined, transition: Transition = spring): Transition {
  return reduce ? fadeReduced : transition;
}

/**
 * `behavior` for element.scrollTo / scrollIntoView. Keyboard-driven scrolling is always
 * instant; smooth is only for playback follow and pointer jumps, never with reduced motion.
 */
export function scrollBehavior(reduce: boolean | null | undefined, source: "keyboard" | "follow" | "pointer" = "follow"): ScrollBehavior {
  if (reduce || source === "keyboard") return "auto";
  return "smooth";
}

/** Non-React check for code outside components (controllers, canvas loops). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
