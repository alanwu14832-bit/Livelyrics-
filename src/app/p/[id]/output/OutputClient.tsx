"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StageView } from "@/components/stage/StageView";
import { api } from "@/lib/api-client";
import { DEFAULT_OUTPUT, fitCanvas, type Rect } from "@/lib/output";
import {
  DEFAULT_OVERRIDES,
  channelName,
  createStageStore,
  initialStageState,
  type StageMessage,
  type StageState,
} from "@/lib/stage/protocol";
import type { Project } from "@/lib/types";

type LoadStatus = "loading" | "ready" | "missing";

const CURSOR_IDLE_MS = 2000;
const HELLO_RETRY_MS = 2000;
/** re-announce ourselves when the console has been silent this long (e.g. it reloaded) */
const SILENCE_MS = 5000;

function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Accept a state snapshot defensively: fill anything missing with safe defaults. */
function sanitizeState(id: string, raw: StageState): StageState {
  const base = initialStageState(id);
  return {
    ...base,
    ...raw,
    projectId: id,
    t: Number.isFinite(raw.t) ? raw.t : 0,
    sentAt: Number.isFinite(raw.sentAt) ? raw.sentAt : Date.now(),
    lineStartedAt: Number.isFinite(raw.lineStartedAt) ? raw.lineStartedAt : Date.now(),
    overrides: { ...DEFAULT_OVERRIDES, ...(raw.overrides ?? {}) },
    audio: { ...base.audio, ...(raw.audio ?? {}) },
  };
}

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

export function OutputClient({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [connected, setConnected] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const [store] = useState(() => createStageStore(initialStageState(id)));
  const [outputId] = useState(randomId);
  const fromChannel = useRef(false);

  // ---- console link -------------------------------------------------------
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(channelName(id));
    const post = (msg: StageMessage) => {
      try {
        channel.postMessage(msg);
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

    channel.onmessage = (ev: MessageEvent<StageMessage>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
      lastHeard = Date.now();
      switch (msg.type) {
        case "project":
          if (msg.project && msg.project.id === id) {
            gotProject = true;
            fromChannel.current = true;
            setProject(msg.project);
            setStatus("ready");
          }
          break;
        case "state":
          if (msg.state && msg.state.projectId === id) {
            store.set(sanitizeState(id, msg.state));
            if (!gotState) {
              gotState = true;
              setConnected(true);
            }
          }
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
      channel.onmessage = null;
      channel.close();
    };
  }, [id, outputId, store]);

  // ---- API fallback: show the key visual before the console connects --------
  useEffect(() => {
    let cancelled = false;
    api
      .getProject(id)
      .then((p) => {
        if (cancelled || fromChannel.current) return;
        setProject(p);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled && !fromChannel.current) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
    document.title = project?.meta?.title ? `${project.meta.title}｜投影輸出` : "投影輸出｜Livelyrics";
  }, [project]);

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
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) {
          lock = await navigator.wakeLock.request("screen");
          if (disposed) void lock.release();
        }
      } catch {
        /* not supported / denied: harmless */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

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

      {status === "missing" && !project && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-center text-xs leading-relaxed text-white/35">
            找不到專案「{id}」
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
