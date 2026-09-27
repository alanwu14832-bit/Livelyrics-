"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  Alert,
  AppHeader,
  Banner,
  Button,
  EmptyState,
  Kbd,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  Skeleton,
  SkeletonGroup,
  Switch,
  ToastStack,
  Tooltip,
  useToasts,
} from "@/components/ui";
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CheckIcon,
  DotsThreeIcon,
  ExportIcon,
  FileTextIcon,
  KeyboardIcon,
  MonitorPlayIcon,
  MusicNotesIcon,
  PlusIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@/components/ui/Icon";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { api } from "@/lib/api-client";
import { distributeLines, normalizeLyrics, toLrc } from "@/lib/lyrics/lrc";
import type { Lyrics, Project } from "@/lib/types";
import { formatRelativeTime } from "@/components/home/relative-time";
import { LYRICS_SOURCE_LABEL } from "@/components/process/labels";
import { processHref } from "@/components/process/steps";
import { readAppearance, useAppearance, type Appearance } from "./appearance";
import { MagicWandIcon, SortByTimeIcon } from "./icons";
import { ProjectHeading } from "@/components/home/ProjectHeading";
import { NOT_FOUND_HEADER_TITLE, ProjectNotFound } from "@/components/home/ProjectNotFound";
import { clearDraft, draftToLines, loadDraft, saveDraft, type LyricsDraft } from "./draft";
import {
  clearAllTimes,
  contentKey,
  fromLyrics,
  insertLine,
  lineAt,
  mergeWithNext,
  nudge,
  outOfOrderFlags,
  removeLine,
  setStart,
  sortByTime,
  splitLine,
  timedCount,
  toLyrics,
  updateText,
  type EditorLine,
} from "./editor-model";
import { editorReducer, initialEditorState } from "./editor-state";
import { ImportDialog } from "./ImportDialog";
import { LineTable, type CellField, type RowHandlers } from "./LineTable";
import { Playhead, usePlayheadError, usePlayheadPlaying, usePlayheadSelector } from "./playhead";
import { TapSyncBand, TapSyncCard, TapSyncStart } from "./TapSyncBar";
import { beginTap, DEFAULT_TAP_LATENCY, MAX_TAP_LATENCY, preRollTime, tapSkip, tapUndo, tapMark, type TapSession } from "./tap-sync";
import { Timeline } from "./Timeline";
import { Transport } from "./Transport";

type LoadState = { kind: "loading" } | { kind: "ok" } | { kind: "error"; message: string; notFound: boolean };

const LATENCY_KEY = "livelyrics:tap-latency";
const LEAVE_MESSAGE = "歌詞有尚未儲存的變更，確定要離開嗎？";

function readLatency(): number {
  try {
    const v = Number(window.localStorage.getItem(LATENCY_KEY));
    return Number.isFinite(v) && v >= 0 && v <= MAX_TAP_LATENCY && window.localStorage.getItem(LATENCY_KEY) != null ? v : DEFAULT_TAP_LATENCY;
  } catch {
    return DEFAULT_TAP_LATENCY;
  }
}

interface EditorActions {
  save: () => Promise<void> | void;
  startTap: (from: number) => void;
  exitTap: () => void;
  mark: () => void;
  undoTap: () => void;
  skipTap: () => void;
}

const NOOP_ACTIONS: EditorActions = {
  save: () => {},
  startTap: () => {},
  exitTap: () => {},
  mark: () => {},
  undoTap: () => {},
  skipTap: () => {},
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file"].includes(type);
}

/** Buttons, links, checkboxes, sliders…: Space/arrow keys belong to them. */
function isControlTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" || el.getAttribute("role") === "slider";
}

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "lyrics";
}

function lrcHeaderValue(s: string): string {
  return s.replace(/[\r\n\]]+/g, " ").trim();
}

/** Server-read header info, so the thumbnail and title are in the first paint (shared elements). */
export interface EditorHeaderInfo {
  title: string;
  artist: string;
  palette: string[];
}

export function LyricsEditorClient({ id, initial = null }: { id: string; initial?: EditorHeaderInfo | null }) {
  const [project, setProject] = useState<Project | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditorState);
  const [savedKey, setSavedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedInfo, setSavedInfo] = useState<{ lines: number; removed: number } | null>(null);
  const [draft, setDraft] = useState<LyricsDraft | null>(null);
  const [session, setSession] = useState<TapSession | null>(null);
  const [latency, setLatency] = useState(readLatency);
  const [importOpen, setImportOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const toasts = useToasts();
  const [playhead] = useState(() => new Playhead());
  const [appearance, setAppearance] = useAppearance();
  const reduceMotion = useReducedMotion();
  const router = useRouter();

  const scrollRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef(new Map<string, number | null>());
  const linesRef = useRef<EditorLine[]>([]);
  const stateRef = useRef(state);
  const sessionRef = useRef<TapSession | null>(null);
  const durationRef = useRef(0);
  const latencyRef = useRef(latency);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingFocus = useRef<{ index: number; field: CellField } | null>(null);
  const loadedRef = useRef(false);
  const actionsRef = useRef<EditorActions>(NOOP_ACTIONS);

  const lines = state.lines;
  const duration = project ? project.meta.duration || project.analysis?.duration || 0 : 0;
  const dirty = useMemo(() => load.kind === "ok" && contentKey(lines, state.source) !== savedKey, [load.kind, lines, state.source, savedKey]);
  const flags = useMemo(() => outOfOrderFlags(lines), [lines]);
  const timed = useMemo(() => timedCount(lines), [lines]);
  const anyOutOfOrder = flags.some(Boolean);
  const currentIndex = usePlayheadSelector(playhead, (t) => lineAt(lines, t, duration), null);
  const playing = usePlayheadPlaying(playhead);
  const audioError = usePlayheadError(playhead);

  useEffect(() => {
    linesRef.current = state.lines;
    stateRef.current = state;
    durationRef.current = duration;
    latencyRef.current = latency;
    dirtyRef.current = dirty;
    loadedRef.current = load.kind === "ok";
  });

  const pushToast = toasts.push;
  const showToast = useCallback((message: string, tone: "info" | "ok" | "warn" = "info") => void pushToast({ tone, message, duration: 3200 }), [pushToast]);

  // ---- load -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getProject(id)
      .then((p) => {
        if (cancelled) return;
        const loaded = fromLyrics(p.lyrics);
        setProject(p);
        dispatch({ type: "load", lines: loaded, source: p.lyrics.source, language: p.lyrics.language });
        setSavedKey(contentKey(loaded, p.lyrics.source));
        const d = loadDraft(id);
        if (d && contentKey(draftToLines(d), d.source) !== contentKey(loaded, p.lyrics.source)) setDraft(d);
        else if (d) clearDraft(id);
        setLoad({ kind: "ok" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({ kind: "error", message, notFound: /找不到|404/.test(message) });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => () => playhead.destroy(), [playhead]);
  const audioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      playhead.attach(el);
      return () => playhead.attach(null);
    },
    [playhead],
  );

  // ---- drafts & leave protection ---------------------------------------------
  useEffect(() => {
    if (load.kind !== "ok" || !project || draft) return;
    if (!dirty) {
      clearDraft(id);
      return;
    }
    const t = setTimeout(() => saveDraft(id, { lines: state.lines, source: state.source, baseUpdatedAt: project.updatedAt, savedAt: Date.now() }), 600);
    return () => clearTimeout(t);
  }, [dirty, state.lines, state.source, load.kind, project, draft, id]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const guardLeave = useCallback((e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (dirtyRef.current && !window.confirm(LEAVE_MESSAGE)) e.preventDefault();
  }, []);
  const navigate = useCallback(
    (href: string) => {
      if (dirtyRef.current && !window.confirm(LEAVE_MESSAGE)) return;
      router.push(href, { transitionTypes: ["push"] });
    },
    [router],
  );

  // ---- editing ----------------------------------------------------------------
  const edit = useCallback((fn: (l: EditorLine[]) => EditorLine[], opts: { tag?: string; at?: number; record?: boolean } = {}) => {
    setSavedInfo(null);
    dispatch({ type: "apply", fn, source: "user", ...opts });
  }, []);

  const focusCell = useCallback((index: number, field: CellField) => {
    requestAnimationFrame(() => {
      const root = scrollRef.current;
      const el = root?.querySelector<HTMLInputElement>(`input[data-row="${index}"][data-field="${field}"]`);
      if (!el) return;
      el.focus();
      if (field !== "time") {
        const n = el.value.length;
        el.setSelectionRange(n, n);
      }
    });
  }, []);

  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    focusCell(f.index, f.field);
  }, [lines, focusCell]);

  const handlers = useMemo<RowHandlers>(
    () => ({
      setStart: (i, t) => edit((l) => setStart(l, i, t, durationRef.current)),
      nudge: (i, d) => edit((l) => nudge(l, i, d, durationRef.current)),
      setText: (i, field, value) => {
        const key = linesRef.current[i]?.key ?? String(i);
        edit((l) => updateText(l, i, field, value), { tag: `${field}:${key}`, at: Date.now() });
      },
      setToPlayhead: (i) => {
        const t = playhead.now();
        edit((l) => setStart(l, i, t, durationRef.current));
      },
      playFrom: (i) => {
        const s = linesRef.current[i]?.start;
        if (s == null) return;
        playhead.seek(Math.max(0, s - 0.3));
        void playhead.play();
      },
      insertAt: (pos) => {
        pendingFocus.current = { index: pos, field: "text" };
        edit((l) => insertLine(l, pos, durationRef.current).lines);
      },
      split: (i, caretArg) => {
        const line = linesRef.current[i];
        if (!line) return;
        const remembered = caretArg ?? caretRef.current.get(line.key) ?? null;
        const caret = remembered != null && remembered > 0 && remembered < line.text.length ? remembered : undefined;
        if (!splitLine(linesRef.current, i, caret, durationRef.current)) {
          showToast("這行無法分割：把游標放在要切開的位置再按分割");
          return;
        }
        pendingFocus.current = { index: i + 1, field: "text" };
        edit((l) => splitLine(l, i, caret, durationRef.current)?.lines ?? l);
      },
      mergeNext: (i) => edit((l) => mergeWithNext(l, i)),
      remove: (i) => edit((l) => removeLine(l, i)),
      tapFrom: (i) => actionsRef.current.startTap(i),
      focusCell,
      rememberCaret: (key, caret) => {
        caretRef.current.set(key, caret);
      },
    }),
    [edit, focusCell, playhead, showToast],
  );

  const onDragMarker = useCallback(
    (index: number, t: number, phase: "start" | "move" | "end") => {
      if (sessionRef.current) return;
      if (phase === "start") {
        setSavedInfo(null);
        dispatch({ type: "checkpoint" });
        return;
      }
      if (phase === "move") dispatch({ type: "apply", fn: (l) => setStart(l, index, t, durationRef.current), record: false, source: "user" });
    },
    [],
  );

  // ---- tap-sync ----------------------------------------------------------------
  const setTap = useCallback((next: TapSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const startTap = useCallback(
    (from: number) => {
      if (!loadedRef.current || linesRef.current.length === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      setSavedInfo(null);
      dispatch({ type: "checkpoint" });
      const next = beginTap(linesRef.current, from);
      setTap(next);
      playhead.seek(preRollTime(linesRef.current, next.pointer));
      void playhead.play();
    },
    [playhead, setTap],
  );

  const exitTap = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    setTap(null);
    playhead.pause();
    if (cur.marked.length) showToast(`已標記 ${cur.marked.length} 句的開始時間`, "ok");
  }, [playhead, setTap, showToast]);

  const markTap = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const r = tapMark(linesRef.current, cur, playhead.now(), latencyRef.current, durationRef.current);
    if (r.session === cur) return;
    linesRef.current = r.lines;
    dispatch({ type: "edit", lines: r.lines, record: false, source: "user" });
    setTap(r.session);
    // one sweep of tint over the row that was just marked (never a loop)
    const markedIndex = cur.pointer;
    requestAnimationFrame(() => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[role="row"][data-row="${markedIndex}"]`);
      if (!row || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const tint = getComputedStyle(row).getPropertyValue("--tint").trim() || "#0071e3";
      row.animate([{ backgroundColor: `color-mix(in srgb, ${tint} 22%, transparent)` }, { backgroundColor: "transparent" }], { duration: 700, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    });
  }, [playhead, setTap]);

  const undoTap = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const r = tapUndo(linesRef.current, cur);
    if (r.lines !== linesRef.current) {
      linesRef.current = r.lines;
      dispatch({ type: "edit", lines: r.lines, record: false, source: "user" });
    }
    setTap(r.session);
    // replay the lead-in to the line that has to be tapped again
    playhead.seek(preRollTime(r.lines, r.session.pointer));
    if (!playhead.isPlaying()) void playhead.play();
  }, [playhead, setTap]);

  const skipTap = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    setTap(tapSkip(linesRef.current, cur));
  }, [setTap]);

  // keep the row being tapped / played in view
  const tapPointer = session ? session.pointer : null;
  useEffect(() => {
    const target = tapPointer ?? (follow && playing ? currentIndex : null);
    if (target == null) return;
    const root = scrollRef.current;
    const row = root?.querySelector<HTMLElement>(`[role="row"][data-row="${target}"]`);
    if (!root || !row) return;
    const r = row.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    // the sticky column captions cover the top ~72 px of the scroller
    if (r.top < box.top + 88 || r.bottom > box.bottom - 24) {
      // tap-sync moves with the keyboard (Space): no animated scroll; playback follow glides
      const behavior = tapPointer != null || reduceMotion ? "auto" : "smooth";
      root.scrollTo({ top: root.scrollTop + (r.top - box.top) - box.height / 3, behavior });
    }
  }, [tapPointer, currentIndex, follow, playing, reduceMotion]);

  // ---- save / import / export ------------------------------------------------------
  const save = useCallback(async () => {
    if (savingRef.current || !loadedRef.current) return;
    const before = stateRef.current;
    const lyrics = normalizeLyrics(toLyrics(before.lines, { source: before.source, language: before.language }));
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.updateProject(id, { lyrics });
      setProject(saved);
      const savedLines = fromLyrics(saved.lyrics);
      const key = contentKey(savedLines, saved.lyrics.source);
      const beforeKey = contentKey(before.lines, before.source);
      const latest = stateRef.current;
      // replace the rows with the normalized result unless the user kept typing meanwhile
      if (contentKey(latest.lines, latest.source) === beforeKey && key !== beforeKey) {
        dispatch({ type: "replace", lines: savedLines, source: saved.lyrics.source, language: saved.lyrics.language });
      }
      setSavedKey(key);
      setDraft(null);
      clearDraft(id);
      setSavedInfo({ lines: saved.lyrics.lines.length, removed: Math.max(0, before.lines.length - saved.lyrics.lines.length) });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [id]);

  const importLyrics = (lyrics: Lyrics) => {
    if (sessionRef.current) setTap(null);
    setSavedInfo(null);
    dispatch({ type: "edit", lines: fromLyrics(lyrics), source: lyrics.source === "none" ? "user" : lyrics.source });
    showToast(`已匯入 ${lyrics.lines.length} 行${lyrics.synced ? "（含時間碼）" : ""}`, "ok");
  };

  const distribute = (mode: "untimed" | "all") => {
    const cur = stateRef.current;
    const base = mode === "all" ? clearAllTimes(cur.lines) : cur.lines;
    const result = distributeLines(toLyrics(base, { source: cur.source, language: cur.language }), project?.analysis ?? null, duration);
    setSavedInfo(null);
    dispatch({ type: "edit", lines: fromLyrics(result), source: "user" });
    setDistributeOpen(false);
    showToast(project?.analysis ? "已依音訊能量粗略分配時間，建議再對拍校正" : "已平均分配時間（沒有音訊分析），建議再對拍校正");
  };

  const exportLrc = () => {
    if (!project) return;
    const cur = stateRef.current;
    const lyrics = normalizeLyrics(toLyrics(cur.lines, { source: cur.source, language: cur.language }));
    const m = project.meta;
    const header = [
      `[ti:${lrcHeaderValue(m.title)}]`,
      m.artist ? `[ar:${lrcHeaderValue(m.artist)}]` : "",
      m.album ? `[al:${lrcHeaderValue(m.album)}]` : "",
      duration > 0 ? `[length:${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}]` : "",
      "[re:Livelyrics]",
    ].filter(Boolean);
    const blob = new Blob([header.join("\n") + "\n" + toLrc(lyrics)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileName(m.artist ? `${m.artist} - ${m.title}` : m.title)}.lrc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  useEffect(() => {
    actionsRef.current = { save, startTap, exitTap, mark: markTap, undoTap, skipTap };
  });

  // ---- keyboard ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const a = actionsRef.current;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void a.save();
        return;
      }
      const typing = isTypingTarget(e.target);
      if (sessionRef.current) {
        if (typing) return;
        switch (e.key) {
          case " ":
          case "Spacebar":
            e.preventDefault();
            // a focused button/checkbox would otherwise also react to this Space
            if (isControlTarget(e.target)) (e.target as HTMLElement).blur();
            if (!e.repeat) a.mark();
            return;
          case "Backspace":
            e.preventDefault();
            a.undoTap();
            return;
          case "ArrowDown":
          case "Enter":
            e.preventDefault();
            a.skipTap();
            return;
          case "Escape":
            e.preventDefault();
            a.exitTap();
            return;
          case "ArrowLeft":
          case "ArrowRight":
            e.preventDefault();
            playhead.seek(playhead.getTime() + (e.key === "ArrowLeft" ? -3 : 3));
            return;
        }
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (mod || e.altKey) return;
      const control = isControlTarget(e.target);
      if (e.key === " " || e.key === "Spacebar") {
        if (control) return;
        e.preventDefault();
        playhead.toggle();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !control) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 2;
        playhead.seek(playhead.getTime() + (e.key === "ArrowLeft" ? -step : step));
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        a.startTap(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead]);

  const changeLatency = (v: number) => {
    const clamped = Math.min(MAX_TAP_LATENCY, Math.max(0, Math.round(v * 100) / 100));
    setLatency(clamped);
    try {
      window.localStorage.setItem(LATENCY_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  };

  // ---------------------------------------------------------------------------------

  const themeAttr = appearance === "system" ? undefined : appearance;

  if (load.kind === "loading") {
    return (
      <EditorRoot theme={themeAttr}>
        <AppHeader
          back
          width="full"
          heading={initial ? <ProjectHeading id={id} title={initial.title} subtitle={initial.artist || undefined} palette={initial.palette} /> : undefined}
          title={initial ? undefined : <span className="text-label-2">載入中…</span>}
        />
        <SkeletonGroup label="載入歌詞" className="flex min-h-0 flex-1 flex-col gap-4 px-(--page-gutter) pt-2">
          <Skeleton className="h-[188px] rounded-lg" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="min-h-0 flex-1 rounded-lg" />
        </SkeletonGroup>
      </EditorRoot>
    );
  }
  if (load.kind === "error" || !project) {
    const notFound = load.kind === "error" && load.notFound;
    return (
      <EditorRoot theme={themeAttr}>
        <AppHeader back width="full" title={notFound ? NOT_FOUND_HEADER_TITLE : "無法載入"} />
        {notFound ? (
          <ProjectNotFound />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center pb-[52px]">
            <EmptyState
              icon={<WarningCircleIcon size={44} />}
              title="無法載入歌詞"
              description={load.kind === "error" ? load.message : ""}
              action={
                <Button variant="tinted" href="/" transitionTypes={["pop"]}>
                  回到作品庫
                </Button>
              }
            />
          </div>
        )}
      </EditorRoot>
    );
  }

  const tapActive = session != null;
  const redesignHref = processHref(id, { run: true, steps: project.research ? ["design"] : ["research", "design"] });
  const analysisPeaks = project.analysis?.peaks ?? [];
  const canSave = dirty || !!saveError;
  const untimed = lines.length - timed;
  const summary = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] leading-5 text-label-2">
      <span>
        共 <span className="t-latin tabular">{lines.length}</span> 行，
        {timed === lines.length ? "全部已定時" : timed === 0 ? "都還沒有時間" : `${timed} 行已定時，${untimed} 行未定時`}
      </span>
      <span>歌詞來源：{LYRICS_SOURCE_LABEL[state.source] ?? state.source}</span>
    </div>
  );

  const banners: ReactNode[] = [];
  if (project.status === "processing") {
    banners.push(
      <Banner key="processing" tone="warning" title="這首歌正在處理中" description="處理的歌詞步驟可能會覆寫你在這裡儲存的內容，建議等處理完成再儲存。" />,
    );
  }
  if (draft) {
    banners.push(
      <Banner
        key="draft"
        tone="info"
        title="找到尚未儲存的編輯"
        description={`${formatRelativeTime(new Date(draft.savedAt).toISOString())}留下的 ${draft.lines.length} 行${draft.baseUpdatedAt !== project.updatedAt ? "；之後歌詞在別處被更新過，恢復前請確認" : ""}。`}
        actions={
          <>
            <Button
              variant="plain"
              onClick={() => {
                clearDraft(id);
                setDraft(null);
              }}
            >
              捨棄
            </Button>
            <Button
              variant="tinted"
              onClick={() => {
                dispatch({ type: "edit", lines: draftToLines(draft), source: draft.source });
                setDraft(null);
              }}
            >
              恢復草稿
            </Button>
          </>
        }
      />,
    );
  }
  if (saveError) {
    banners.push(
      <Banner
        key="save-error"
        tone="error"
        title="儲存失敗"
        description={saveError}
        actions={
          <Button variant="gray" onClick={() => void save()}>
            重試
          </Button>
        }
      />,
    );
  }
  if (savedInfo) {
    banners.push(
      <Banner
        key="saved"
        tone="success"
        animateIn
        title={`已儲存 ${savedInfo.lines} 行`}
        description={`${savedInfo.removed > 0 ? `移除了 ${savedInfo.removed} 個空白行。` : ""}${project.plan ? "目前的主視覺與段落是依照舊歌詞設計的，可以用新歌詞重新設計。" : "還沒有設計方案，可以開始設計。"}`}
        actions={
          <>
            <Button variant="gray" icon={MonitorPlayIcon} href={`/p/${encodeURIComponent(id)}`} transitionTypes={["push"]}>
              進入控制台
            </Button>
            <Button variant="tinted" icon={SparkleIcon} href={redesignHref} transitionTypes={["push"]}>
              {project.plan ? "用新歌詞重新設計" : "開始設計"}
            </Button>
            <Button variant="quiet" size="icon-sm" aria-label="關閉提示" icon={<XIcon size={16} />} onClick={() => setSavedInfo(null)} />
          </>
        }
      />,
    );
  }
  if (anyOutOfOrder && !tapActive) {
    banners.push(
      <Banner
        key="order"
        tone="warning"
        title="有幾行的時間早於前一行"
        description="標著紅色圓點的行。儲存時會自動依時間排序，也可以現在就整理。"
        actions={
          <Button variant="gray" icon={SortByTimeIcon} onClick={() => edit((l) => sortByTime(l))}>
            依時間排序
          </Button>
        }
      />,
    );
  }

  const appearanceItem = (value: Appearance, label: string) => (
    <MenuItem checked={appearance === value} onSelect={() => setAppearance(value)} textValue={label}>
      {label}
    </MenuItem>
  );

  return (
    <EditorRoot theme={themeAttr}>
      <AppHeader
        back={{ onNavigate: guardLeave }}
        width="full"
        heading={
          <ProjectHeading
            id={project.id}
            title={project.meta.title}
            subtitle={project.meta.artist || undefined}
            palette={project.plan?.keyVisual.palette.map((c) => c.hex)}
            accessory={dirty ? <span className="shrink-0 text-[12px] leading-4 text-label-2">尚未儲存</span> : undefined}
          />
        }
        actions={
          <>
            <UndoRedo
              canUndo={!tapActive && state.past.length > 0}
              canRedo={!tapActive && state.future.length > 0}
              onUndo={() => dispatch({ type: "undo" })}
              onRedo={() => dispatch({ type: "redo" })}
            />
            <Button variant="gray" icon={FileTextIcon} onClick={() => setImportOpen(true)} disabled={tapActive}>
              匯入
            </Button>
            <Tooltip content="依音訊能量粗略分配開始時間">
              <Button variant="gray" icon={MagicWandIcon} onClick={() => setDistributeOpen(true)} disabled={tapActive || lines.length === 0}>
                自動分配
              </Button>
            </Tooltip>
            <Tooltip content="下載 .lrc 檔">
              <Button variant="gray" icon={ExportIcon} onClick={exportLrc} disabled={lines.length === 0}>
                匯出 .lrc
              </Button>
            </Tooltip>
            {canSave || saving ? (
              <Tooltip content="儲存" shortcut="Meta+S">
                <Button variant="filled" onClick={() => void save()} loading={saving} disabled={saving || tapActive} className="min-w-[4.5rem]">
                  儲存
                </Button>
              </Tooltip>
            ) : (
              <span className="inline-flex h-8 min-w-[4.5rem] items-center justify-center gap-1 px-2 text-[13px] leading-[18px] font-medium text-label-2" role="status">
                <CheckIcon size={14} />
                已儲存
              </span>
            )}
            <Menu
              label="更多"
              placement="bottom-end"
              trigger={(p) => <Button {...p} variant="quiet" size="icon" aria-label="更多" icon={<DotsThreeIcon size={20} />} />}
            >
              <MenuItem onSelect={() => navigate(processHref(id))} textValue="設計總覽">
                設計總覽
              </MenuItem>
              <MenuItem onSelect={() => navigate(`/p/${encodeURIComponent(id)}`)} textValue="進入控制台">
                進入控制台
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>外觀</MenuLabel>
              {appearanceItem("system", "跟隨系統")}
              {appearanceItem("light", "淺色")}
              {appearanceItem("dark", "深色")}
            </Menu>
          </>
        }
      />

      <audio ref={audioRef} src={api.audioUrl(id)} crossOrigin="anonymous" preload="auto" className="hidden" />

      <TapSyncBand
        session={session}
        lines={lines}
        latency={latency}
        onLatency={changeLatency}
        onMark={markTap}
        onUndo={undoTap}
        onSkip={skipTap}
        onExit={exitTap}
      />

      <section aria-label="播放與時間軸" className="mx-(--page-gutter) mt-3 shrink-0 space-y-3 rounded-lg bg-surface px-4 pt-3 pb-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Transport playhead={playhead} duration={duration} disabled={!!audioError} />
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            {audioError && (
              <span className="flex items-center gap-1.5 text-[13px] leading-5 text-red-text" role="alert">
                <WarningCircleIcon size={16} weight="fill" className="text-red" />
                {audioError}
              </span>
            )}
            <label htmlFor="lyrics-follow" className="flex cursor-pointer items-center gap-2.5 text-[13px] leading-5 text-label select-none">
              表格跟著播放捲動
              <Switch id="lyrics-follow" checked={follow} onChange={setFollow} />
            </label>
            {!tapActive && <TapSyncStart onStart={() => startTap(0)} latency={latency} onLatency={changeLatency} disabled={!!audioError || lines.length === 0} />}
            <ShortcutsPopover />
          </div>
        </div>
        <Timeline
          playhead={playhead}
          peaks={analysisPeaks}
          duration={duration}
          lines={lines}
          plan={project.plan}
          window="full"
          tapPointer={tapPointer}
          onDragMarker={tapActive ? undefined : onDragMarker}
          className="h-12"
          label="全曲時間軸：點擊跳轉，拖曳標記調整該行開始時間"
        />
        <Timeline
          playhead={playhead}
          peaks={analysisPeaks}
          duration={duration}
          lines={lines}
          plan={project.plan}
          window={14}
          tapPointer={tapPointer}
          labels
          onDragMarker={tapActive ? undefined : onDragMarker}
          className="h-20"
          label="局部時間軸（跟著播放位置）：拖曳標記精細調整，按住 Alt 更精細"
        />
      </section>

      <TapSyncCard
        session={session}
        lines={lines}
        latency={latency}
        onLatency={changeLatency}
        onMark={markTap}
        onUndo={undoTap}
        onSkip={skipTap}
        onExit={exitTap}
      />

      {banners.length > 0 && <div className="mx-(--page-gutter) mt-3 flex shrink-0 flex-col gap-2">{banners}</div>}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-(--page-gutter) pb-6">
        <LineTable
          lines={lines}
          currentIndex={currentIndex}
          tapPointer={tapPointer}
          outOfOrder={flags}
          handlers={handlers}
          summary={summary}
          empty={
            <EmptyState
              className="mt-8"
              icon={MusicNotesIcon}
              title="還沒有歌詞"
              description="貼上 LRC 或純文字、到 LRCLIB 搜尋，或一行一行輸入。"
              action={
                <div className="flex items-center gap-2">
                  <Button variant="plain" icon={PlusIcon} onClick={() => handlers.insertAt(0)}>
                    新增一行
                  </Button>
                  <Button variant="tinted" icon={FileTextIcon} onClick={() => setImportOpen(true)}>
                    匯入歌詞
                  </Button>
                </div>
              }
            />
          }
        />
      </div>

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} placement="bottom-center" />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importLyrics}
        title={project.meta.title}
        artist={project.meta.artist}
        duration={duration}
        hasLines={lines.length > 0}
      />

      <DistributeAlert
        open={distributeOpen}
        onCancel={() => setDistributeOpen(false)}
        onConfirm={distribute}
        hasAnalysis={!!project.analysis}
        timed={timed}
        total={lines.length}
      />
    </EditorRoot>
  );
}

/** The editor's theme scope: follows the system unless the 外觀 menu picked light or dark. */
function EditorRoot({ theme, children }: { theme?: "light" | "dark"; children: ReactNode }) {
  // mirror the choice on <html> (the pre-paint script set it for the first paint), so the page
  // background and overscroll match too. During hydration `theme` is still the server "system"
  // snapshot, so fall back to the stored value instead of clearing what the script set.
  useEffect(() => {
    const html = document.documentElement;
    const next = theme ?? (readAppearance() === "system" ? undefined : readAppearance());
    if (next) html.setAttribute("data-theme", next);
    else html.removeAttribute("data-theme");
  }, [theme]);
  useEffect(() => () => document.documentElement.removeAttribute("data-theme"), []);
  return (
    <div
      data-theme={theme}
      className="flex h-screen flex-col overflow-hidden bg-bg text-label transition-[background-color] duration-200 ease-[ease]"
    >
      {children}
    </div>
  );
}

/** 復原 / 重做 as one two-segment control (macOS toolbar). */
function UndoRedo({ canUndo, canRedo, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  const seg =
    "press-fade focus-inset inline-flex h-8 w-9 items-center justify-center text-label hover:bg-fill-4 disabled:pointer-events-none disabled:text-label-3";
  return (
    <div role="group" aria-label="復原與重做" className="relative inline-flex overflow-hidden rounded-sm bg-fill-3">
      <Tooltip content="復原" shortcut="Meta+Z">
        <button type="button" className={seg} onClick={onUndo} disabled={!canUndo} aria-label="復原">
          <ArrowUUpLeftIcon size={16} />
        </button>
      </Tooltip>
      <span aria-hidden="true" className="my-[7px] w-(--hairline) bg-separator" />
      <Tooltip content="重做" shortcut="Meta+Shift+Z">
        <button type="button" className={seg} onClick={onRedo} disabled={!canRedo} aria-label="重做">
          <ArrowUUpRightIcon size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ["播放或暫停", ["Space"]],
  ["跳 2 秒（Shift 5 秒）", ["ArrowLeft", "ArrowRight"]],
  ["開始對拍", ["T"]],
  ["時間欄微調 0.1 秒（Shift 1 秒、Alt 0.01 秒）", ["ArrowUp", "ArrowDown"]],
  ["歌詞欄移到下一行", ["Enter"]],
  ["在下方插入一行", ["Ctrl+Enter"]],
  ["儲存", ["Meta+S"]],
  ["復原", ["Meta+Z"]],
];

function ShortcutsPopover() {
  return (
    <Popover
      label="鍵盤快捷鍵"
      placement="bottom-end"
      width={340}
      trigger={(p) => (
        <Tooltip content="鍵盤快捷鍵">
          <Button {...p} variant="quiet" size="icon" aria-label="鍵盤快捷鍵" icon={<KeyboardIcon size={20} />} />
        </Tooltip>
      )}
    >
      <div className="p-3">
        <p className="mb-2 text-[12px] leading-4 font-semibold text-label-2">鍵盤快捷鍵</p>
        <ul className="space-y-1.5">
          {SHORTCUTS.map(([label, keys]) => (
            <li key={label} className="flex items-center justify-between gap-3 text-[13px] leading-5 text-label">
              {label}
              <span className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <Kbd key={k} keys={k} />
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-4 text-label-2">Ctrl 與 ⌘ 都可以用。拖曳時間軸上的標記可以改時間，按住 Alt 會更精細。</p>
      </div>
    </Popover>
  );
}

/** Auto-distribute: a yes/no Alert; a Switch decides whether already timed lines are redone. */
function DistributeAlert({
  open,
  onCancel,
  onConfirm,
  hasAnalysis,
  timed,
  total,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (mode: "untimed" | "all") => void;
  hasAnalysis: boolean;
  timed: number;
  total: number;
}) {
  const [redoAll, setRedoAll] = useState(false);
  const untimed = total - timed;
  const mixed = timed > 0 && untimed > 0;
  const all = untimed === 0 || (mixed && redoAll);
  const how = hasAnalysis ? "依音訊的能量起伏找出有人聲的段落，按每行的長短粗略分配開始時間。" : "這首歌沒有音訊分析資料，會在整首歌裡平均分配。";
  return (
    <Alert
      open={open}
      title="自動分配時間"
      message={`${how}${untimed === 0 ? "所有行都已定時，會清除後重新分配。" : ""}之後建議用對拍或拖曳標記校正。`}
      confirmLabel={all ? `重新分配全部 ${total} 行` : `分配 ${untimed} 行`}
      onCancel={onCancel}
      onConfirm={() => onConfirm(all ? "all" : "untimed")}
    >
      {mixed && (
        <label htmlFor="distribute-all" className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-md bg-fill-4 px-3 py-2 text-left text-[13px] leading-5 text-label">
          同時清除已定時的 {timed} 行
          <Switch id="distribute-all" checked={redoAll} onChange={setRedoAll} />
        </label>
      )}
    </Alert>
  );
}
