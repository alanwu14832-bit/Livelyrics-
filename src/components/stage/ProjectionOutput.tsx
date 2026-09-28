"use client";

// The projection window: fullscreen black, animation + lyrics only (the StageView), driven by a
// console over a BroadcastChannel. One component for both windows:
//
//   per song  /p/[id]/output   channel = channelName(id), projectId fixed: only that project and
//                              its states are accepted, and the project is loaded through the API
//                              first so the key visual shows before the console connects.
//   show      /s/[id]/output   channel = showChannelName(id), no fixed project: whatever item the
//                              show console puts on air. A `project` message with a `transition`
//                              is performed here — fade to black, swap the project under black
//                              (its fonts load and its first frames render there), fade back in —
//                              so a take stays smooth whatever the console's timing; `preload`
//                              warms the next item's fonts and media without showing them.
//
// Everything else is shared: cursor auto-hide, F / double-click fullscreen, the pong heartbeat
// with the viewport size, the 「等待控制台連線…」 hint, defensive message parsing, a screen wake lock.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { randomId } from "@/lib/console/link";
import { DEFAULT_OUTPUT, fitCanvas, type Rect } from "@/lib/output";
import { createStageStore, initialStageState, parseStageMessage, type StageMessage, type StageState, type StageTransition } from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";
import { useWakeLock } from "@/lib/use-wake-lock";
import { StageView } from "./StageView";
import { ProjectWarmer, warmFonts } from "./warm";

type LoadStatus = "loading" | "ready" | "missing";

const CURSOR_IDLE_MS = 2000;
const HELLO_RETRY_MS = 2000;
/** re-announce ourselves when the console has been silent this long (e.g. it reloaded) */
const SILENCE_MS = 5000;
/** a take never stays black longer than this waiting for fonts */
const SWAP_READY_MAX_MS = 1200;
/** a fade-out that lags its timer (busy main thread) gets this long to reach black before the swap */
const SWAP_OPAQUE_MAX_MS = 600;
/** fade curve of a take: the design tokens' --ease-in-out (defined on :root) */
const TAKE_EASE = "var(--ease-in-out, cubic-bezier(0.77, 0, 0.175, 1))";

function isFullscreen(): boolean {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // browsers require a user gesture in this window; the operator can press F / double-click
  }
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/**
 * Resolves once the take overlay is fully black. The fade-out's CSS transition starts at the next
 * style recalc, so on a busy main thread it can still be short of black when its timer fires; a
 * swap then would show through. Capped by a timeout too (rAF stops in a hidden window).
 */
const untilOpaque = (el: HTMLElement | null, maxMs: number) =>
  new Promise<void>((resolve) => {
    if (!el) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(cap);
      resolve();
    };
    const cap = window.setTimeout(finish, maxMs);
    const check = () => {
      if (done) return;
      if (Number(getComputedStyle(el).opacity) >= 0.999) finish();
      else requestAnimationFrame(check);
    };
    check();
  });

export function ProjectionOutput({ channel, projectId, title }: { channel: string; projectId?: string; title?: string }) {
  const fixed = projectId != null;
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [connected, setConnected] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [store] = useState(() => createStageStore(initialStageState(projectId ?? "")));
  const [outputId] = useState(randomId);
  const fromChannel = useRef(false);
  /** the project handed to the StageView (it may not have rendered it yet) */
  const shownRef = useRef<Project | null>(null);
  /** the project id the StageView has adopted: its states may drive the stage */
  const committedRef = useRef<string | null>(null);
  /** show mode: the take in progress (fade out → swap → fade in) */
  const takeRef = useRef<{ project: Project; seq: number; half: number; phase: "out" | "in" } | null>(null);
  const takeSeq = useRef(0);
  const takeTimer = useRef<number | null>(null);
  /** the newest state for a project that is not on stage yet */
  const pendingState = useRef<StageState | null>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const warmer = useRef<ProjectWarmer | null>(null);

  // ---- project swaps and takes --------------------------------------------
  const setFade = useCallback((opacity: 0 | 1, ms: number) => {
    const el = fadeRef.current;
    if (!el) return;
    el.style.transition = ms > 0 ? `opacity ${Math.round(ms)}ms ${TAKE_EASE}` : "none";
    el.style.opacity = String(opacity);
  }, []);

  /** Put `next` on stage now (the StageView gets it; its pending state follows in the effect below). */
  const swap = useCallback((next: Project) => {
    const prev = shownRef.current;
    shownRef.current = next;
    setProject(next);
    setStatus("ready");
    // a new project never renders with the previous one's state: its own (if any came) or a clean one
    if (prev && prev.id !== next.id && pendingState.current?.projectId !== next.id) pendingState.current = { ...initialStageState(next.id), sentAt: Date.now() };
  }, []);

  const finishTake = useCallback(
    (seq: number) => {
      const take = takeRef.current;
      if (!take || take.seq !== seq) return;
      // swap only under full black (a newer project may still replace take.project until then)
      void untilOpaque(fadeRef.current, SWAP_OPAQUE_MAX_MS).then(() => {
        const current = takeRef.current;
        if (!current || current.seq !== seq) return;
        // ends a transition that is still short of black at the cap
        setFade(1, 0);
        const next = current.project;
        swap(next);
        current.phase = "in";
        // under black: the StageView adopts the project, its fonts load, a few frames render
        void warmFonts(next, SWAP_READY_MAX_MS)
          .then(() => frames(3))
          .then(() => {
            const t = takeRef.current;
            if (!t || t.seq !== seq) return;
            setFade(0, t.half);
            takeRef.current = null;
          });
      });
    },
    [setFade, swap],
  );

  const receiveProject = useCallback(
    (next: Project, transition: StageTransition | undefined) => {
      const shown = shownRef.current;
      // only a take carries a transition (edits never do), so a re-take of the same item fades too
      const fade = transition?.kind === "fade" && transition.ms > 0;
      if (!fade) {
        // same project (an edit), a cut, or the first project without a transition: at once
        if (takeRef.current && takeRef.current.project.id !== next.id) {
          takeRef.current = null;
          if (takeTimer.current != null) window.clearTimeout(takeTimer.current);
          setFade(0, 0);
        }
        if (takeRef.current && takeRef.current.project.id === next.id) takeRef.current.project = next;
        else swap(next);
        return;
      }
      const half = transition.ms / 2;
      const current = takeRef.current;
      if (current && current.phase === "out") {
        // still fading out: take the newer project when it is black
        current.project = next;
        current.half = half;
        return;
      }
      const seq = ++takeSeq.current;
      takeRef.current = { project: next, seq, half, phase: "out" };
      if (takeTimer.current != null) window.clearTimeout(takeTimer.current);
      // nothing on stage yet: it is black already
      const outMs = shown ? half : 0;
      setFade(1, outMs);
      takeTimer.current = window.setTimeout(() => finishTake(seq), outMs);
    },
    [finishTake, setFade, swap],
  );

  // the StageView has the new project (child effects run first): now its state may drive it
  useEffect(() => {
    if (!project) return;
    committedRef.current = project.id;
    const pending = pendingState.current;
    if (pending && pending.projectId === project.id) {
      pendingState.current = null;
      store.set(pending);
    }
  }, [project, store]);

  /** Show mode: apply a state now, or keep it until its project is on stage (stale ones are dropped). */
  const receiveState = useCallback(
    (state: StageState) => {
      const take = takeRef.current;
      // fading out towards this project (also a re-take of the one on stage): it starts under black
      if (take?.phase === "out" && state.projectId === take.project.id) {
        pendingState.current = state;
        return;
      }
      if (state.projectId === committedRef.current && shownRef.current?.id === state.projectId) {
        store.set(state);
        return;
      }
      const incoming = take?.project.id;
      const shown = shownRef.current?.id;
      // swapped but not rendered yet, fading towards it, or the first project of the show
      if (state.projectId === shown || state.projectId === incoming || !shown) pendingState.current = state;
      else if (state.projectId === committedRef.current) store.set(state);
    },
    [store],
  );

  // ---- console link -------------------------------------------------------
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(channel);
    const post = (msg: StageMessage) => {
      try {
        ch.postMessage(msg);
      } catch {
        /* channel closed */
      }
    };
    let gotProject = false;
    let gotState = false;
    let lastHeard = 0;
    const hello = () => post({ type: "hello", from: "output", outputId });
    hello();
    const retry = window.setInterval(() => {
      if (!gotProject || !gotState || Date.now() - lastHeard > SILENCE_MS) hello();
    }, HELLO_RETRY_MS);
    if (!warmer.current) warmer.current = new ProjectWarmer();

    ch.onmessage = (ev: MessageEvent<unknown>) => {
      const msg = parseStageMessage(ev.data);
      if (!msg) return;
      lastHeard = Date.now();
      switch (msg.type) {
        case "project":
          if (fixed) {
            if (msg.project.id !== projectId) break;
            gotProject = true;
            fromChannel.current = true;
            shownRef.current = msg.project;
            setProject(msg.project);
            setStatus("ready");
            break;
          }
          gotProject = true;
          fromChannel.current = true;
          receiveProject(msg.project, msg.transition);
          break;
        case "state": {
          const state = msg.state;
          if (fixed) {
            if (state.projectId !== projectId) break;
            store.set(state);
          } else receiveState(state);
          if (!gotState) {
            gotState = true;
            setConnected(true);
          }
          break;
        }
        case "preload":
          if (!fixed) warmer.current?.warm(msg.project);
          break;
        case "ping": {
          const dpr = window.devicePixelRatio || 1;
          post({
            type: "pong",
            outputId,
            at: Date.now(),
            width: Math.round(window.innerWidth * dpr),
            height: Math.round(window.innerHeight * dpr),
            fullscreen: isFullscreen(),
          });
          // a show console that has nothing on air yet only pings: it is connected all the same
          if (!fixed) setConnected(true);
          break;
        }
        case "fullscreen":
          void toggleFullscreen();
          break;
        case "close":
          window.close();
          break;
        default:
          break;
      }
    };
    return () => {
      window.clearInterval(retry);
      ch.onmessage = null;
      ch.close();
    };
  }, [channel, fixed, outputId, projectId, receiveProject, receiveState, store]);

  useEffect(
    () => () => {
      if (takeTimer.current != null) window.clearTimeout(takeTimer.current);
      warmer.current?.destroy();
      warmer.current = null;
    },
    [],
  );

  // ---- API fallback (per song): show the key visual before the console connects --------
  useEffect(() => {
    if (!fixed || !projectId) return;
    let cancelled = false;
    api
      .getProject(projectId)
      .then((p) => {
        if (cancelled || fromChannel.current) return;
        shownRef.current = p;
        setProject(p);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled && !fromChannel.current) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [fixed, projectId]);

  // ---- letterbox / pillarbox: the canvas at exactly its aspect, black bars around it ----
  const canvasW = project?.output?.width || DEFAULT_OUTPUT.width;
  const canvasH = project?.output?.height || DEFAULT_OUTPUT.height;
  const [frame, setFrame] = useState<Rect | null>(null);
  useEffect(() => {
    const update = () => {
      const dpr = window.devicePixelRatio || 1;
      setFrame(fitCanvas(window.innerWidth, window.innerHeight, canvasW, canvasH, dpr));
    };
    update();
    window.addEventListener("resize", update);
    // a devicePixelRatio change (window dragged to another screen) does not always fire resize
    const mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("resize", update);
      mq?.removeEventListener?.("change", update);
    };
  }, [canvasW, canvasH]);

  // ---- document title -----------------------------------------------------
  useEffect(() => {
    if (!fixed) document.title = title ? `${title}｜投影輸出` : "投影輸出｜Livelyrics";
    else document.title = project?.meta?.title ? `${project.meta.title}｜投影輸出` : "投影輸出｜Livelyrics";
  }, [fixed, project, title]);

  // ---- cursor auto-hide, F / double-click fullscreen ------------------------
  const hideTimer = useRef<number | null>(null);
  const hiddenRef = useRef(false);
  const wake = useCallback(() => {
    if (hiddenRef.current) {
      hiddenRef.current = false;
      setCursorHidden(false);
    }
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hiddenRef.current = true;
      setCursorHidden(true);
    }, CURSOR_IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("mousemove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, [wake]);

  // ---- keep the projector awake --------------------------------------------
  useWakeLock();

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black select-none"
      style={{ cursor: cursorHidden ? "none" : "default" }}
      onDoubleClick={() => void toggleFullscreen()}
    >
      {project && frame && (
        <StageView
          project={project}
          store={store}
          className="absolute"
          style={{ aspectRatio: "auto", left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        />
      )}

      {/* show mode: the take's fade through black (above the stage, below the hint) */}
      {!fixed && <div ref={fadeRef} aria-hidden="true" className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} data-take-fade="" />}

      {fixed && status === "missing" && !project && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-center text-xs leading-relaxed text-white/35">
            找不到專案「{projectId}」
            <br />
            請從控制台重新開啟投影視窗
          </p>
        </div>
      )}

      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-[3vh] flex justify-center transition-opacity duration-1000"
        style={{ opacity: connected ? 0 : 1 }}
      >
        <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] tracking-wide text-white/40">等待控制台連線…</span>
      </div>
    </div>
  );
}
