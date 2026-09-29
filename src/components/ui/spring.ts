// Tiny spring and tween drivers for the kit's gesture follow-through (sheet drag release, toast
// swipe, slider reset glide). Same physics as motion's { type: "spring", bounce, visualDuration }
// (Apple's damping ratio + response), closed form and velocity-aware, so the kit does not pull
// motion into every page that imports a Button. Pure math is exported for tests.

/**
 * Displacement from the target at time `t` (s) for a spring released at `x0` (px from target)
 * with velocity `v0` (px/s). `response` (s) is Apple's response; `dampingRatio` 1 = critically
 * damped (no overshoot), below 1 overshoots (0.8 ~ motion bounce 0.2).
 */
export function springState(t: number, x0: number, v0: number, response = 0.35, dampingRatio = 1): { x: number; v: number } {
  const w = (2 * Math.PI) / response;
  const z = dampingRatio;
  if (z >= 1) {
    // critically damped: x(t) = (x0 + (v0 + w x0) t) e^{-wt}
    const e = Math.exp(-w * t);
    const b = v0 + w * x0;
    return { x: (x0 + b * t) * e, v: (b - w * (x0 + b * t)) * e };
  }
  const wd = w * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w * t);
  const c = (v0 + z * w * x0) / wd;
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  const x = e * (x0 * cos + c * sin);
  const v = e * (-z * w * (x0 * cos + c * sin) + (-x0 * wd * sin + c * wd * cos));
  return { x, v };
}

export interface Playback {
  stop: () => void;
}

/** Animate a number to `to` on a spring, starting at `from` with `velocity` (units/s). */
export function springTo({
  from,
  to,
  velocity = 0,
  response = 0.35,
  dampingRatio = 1,
  onUpdate,
  onComplete,
}: {
  from: number;
  to: number;
  velocity?: number;
  response?: number;
  dampingRatio?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}): Playback {
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const x0 = from - to;
  const step = (now: number) => {
    if (stopped) return;
    const t = (now - start) / 1000;
    const { x, v } = springState(t, x0, velocity, response, dampingRatio);
    if (Math.abs(x) < 0.05 && Math.abs(v) < 5) {
      onUpdate(to);
      onComplete?.();
      return;
    }
    onUpdate(to + x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1 (Newton + bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - p;
      if (Math.abs(err) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - p) < 1e-6) break;
      if (v < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** --ease-out */
export const easeOutCurve = cubicBezier(0.23, 1, 0.32, 1);

/** Animate a number over `duration` ms with an easing curve. */
export function tweenTo({ from, to, duration, ease = easeOutCurve, onUpdate, onComplete }: { from: number; to: number; duration: number; ease?: (p: number) => number; onUpdate: (v: number) => void; onComplete?: () => void }): Playback {
  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const step = (now: number) => {
    if (stopped) return;
    const p = Math.min(1, (now - start) / duration);
    onUpdate(from + (to - from) * ease(p));
    if (p < 1) raf = requestAnimationFrame(step);
    else onComplete?.();
  };
  raf = requestAnimationFrame(step);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
