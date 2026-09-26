"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Badge, Button, Kbd, cx } from "@/components/ui";
import { api } from "@/lib/api-client";
import { distributeLines, normalizeLyrics, toLrc } from "@/lib/lyrics/lrc";
import type { Lyrics, Project } from "@/lib/types";
import { Dialog } from "@/components/home/Dialog";
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  FileIcon,
  InfoIcon,
  MonitorIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  SortIcon,
  SparklesIcon,
  SpinnerIcon,
  UndoIcon,
  WandIcon,
  XIcon,
} from "@/components/home/icons";
import { formatRelativeTime } from "@/components/home/relative-time";
import { TopBar } from "@/components/home/TopBar";
import { LYRICS_SOURCE_LABEL } from "@/components/process/labels";
import { processHref } from "@/components/process/steps";
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
import { TapSyncBar } from "./TapSyncBar";
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

export function LyricsEditorClient({ id }: { id: string }) {
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
  const [toast, setToast] = useState<string | null>(null);
  const [playhead] = useState(() => new Playhead());

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

  const showToast = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

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
    if (cur.marked.length) showToast(`已標記 ${cur.marked.length} 句的開始時間`);
  }, [playhead, setTap, showToast]);

  const markTap = useCallback(() => {
    const cur = sessionRef.current;
    if (!cur) return;
    const r = tapMark(linesRef.current, cur, playhead.now(), latencyRef.current, durationRef.current);
    if (r.session === cur) return;
    linesRef.current = r.lines;
    dispatch({ type: "edit", lines: r.lines, record: false, source: "user" });
    setTap(r.session);
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
    if (r.top < box.top + 48 || r.bottom > box.bottom - 24) {
      root.scrollTo({ top: root.scrollTop + (r.top - box.top) - box.height / 3, behavior: "smooth" });
    }
  }, [tapPointer, currentIndex, follow, playing]);

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
    showToast(`已匯入 ${lyrics.lines.length} 行${lyrics.synced ? "（含時間碼）" : ""}`);
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

  if (load.kind === "loading") {
    return (
      <div className="flex h-screen flex-col">
        <TopBar crumbs={[{ label: "作品庫", href: "/" }]} title="載入中…" />
        <div className="m-5 h-40 animate-pulse rounded-xl border border-line bg-panel" aria-busy="true" />
      </div>
    );
  }
  if (load.kind === "error" || !project) {
    const notFound = load.kind === "error" && load.notFound;
    return (
      <div className="min-h-screen">
        <TopBar crumbs={[{ label: "作品庫", href: "/" }]} title={notFound ? "找不到作品" : "無法載入"} />
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-panel p-6 text-center">
          <AlertIcon size={28} className="mx-auto text-danger" />
          <p className="mt-3 text-base font-semibold text-fg">{notFound ? "找不到這個作品" : "無法載入歌詞"}</p>
          <p className="mt-1 text-sm text-muted">{notFound ? "它可能已經被刪除了。" : load.kind === "error" ? load.message : ""}</p>
          <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-md border border-line bg-panel-3 px-3.5 text-sm text-fg hover:bg-line">
            回作品庫
          </Link>
        </div>
      </div>
    );
  }

  const tapActive = session != null;
  const redesignHref = processHref(id, { run: true, steps: project.research ? ["design"] : ["research", "design"] });
  const analysisPeaks = project.analysis?.peaks ?? [];
  const toolBtn =
    "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        crumbs={[
          { label: "作品庫", href: "/" },
          { label: "設計總覽", href: processHref(id) },
          { label: "歌詞編輯" },
        ]}
        onNavigate={guardLeave}
        title={project.meta.title}
        subtitle={project.meta.artist}
        status={
          <span className="ml-1 flex items-center gap-1.5">
            <Badge tone={lines.length > 0 && timed === lines.length ? "ok" : timed > 0 ? "warn" : "neutral"} title="已定時的行數">
              {timed}/{lines.length} 行已定時
            </Badge>
            <Badge title="歌詞來源">{LYRICS_SOURCE_LABEL[state.source] ?? state.source}</Badge>
            {dirty && <Badge tone="accent">未儲存</Badge>}
          </span>
        }
        actions={
          <>
            <button type="button" className={toolBtn} onClick={() => dispatch({ type: "undo" })} disabled={tapActive || state.past.length === 0} aria-label="復原" title="復原（Ctrl+Z）">
              <UndoIcon size={15} />
            </button>
            <button type="button" className={toolBtn} onClick={() => dispatch({ type: "redo" })} disabled={tapActive || state.future.length === 0} aria-label="重做" title="重做（Ctrl+Shift+Z）">
              <RedoIcon size={15} />
            </button>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
            <button type="button" className={toolBtn} onClick={() => setImportOpen(true)} disabled={tapActive}>
              <FileIcon size={15} />
              匯入
            </button>
            <button type="button" className={toolBtn} onClick={() => setDistributeOpen(true)} disabled={tapActive || lines.length === 0} title="依音訊能量粗略分配時間">
              <WandIcon size={15} />
              自動分配
            </button>
            <button type="button" className={toolBtn} onClick={exportLrc} disabled={lines.length === 0} title="下載 .lrc 檔">
              <DownloadIcon size={15} />
              匯出 .lrc
            </button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || tapActive || (!dirty && !saveError)} title="儲存（Ctrl+S）">
              {saving ? <SpinnerIcon size={15} /> : <SaveIcon size={15} />}
              {saving ? "儲存中…" : "儲存"}
            </Button>
          </>
        }
      />

      <audio ref={audioRef} src={api.audioUrl(id)} preload="auto" className="hidden" />

      <section aria-label="播放與時間軸" className="shrink-0 space-y-2 border-b border-line bg-panel px-5 pb-3 pt-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Transport playhead={playhead} duration={duration} disabled={!!audioError} />
          <div className="flex items-center gap-3 text-xs text-muted">
            {audioError && (
              <span className="flex items-center gap-1 text-danger" role="alert">
                <AlertIcon size={13} />
                {audioError}
              </span>
            )}
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--color-accent)]" />
              表格跟著播放捲動
            </label>
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
          label="局部時間軸（跟著播放位置）：拖曳標記精細調整"
        />
      </section>

      <TapSyncBar
        session={session}
        lines={lines}
        latency={latency}
        onLatency={changeLatency}
        onStart={() => startTap(0)}
        onMark={markTap}
        onUndo={undoTap}
        onSkip={skipTap}
        onExit={exitTap}
        disabled={!!audioError}
      />

      <div className="shrink-0 space-y-0 empty:hidden">
        {project.status === "processing" && (
          <Notice tone="warn" icon={<InfoIcon size={15} />}>
            這首歌正在處理中；處理的歌詞步驟可能會覆寫你在這裡儲存的內容，建議等處理完成再儲存。
          </Notice>
        )}
        {draft && (
          <Notice tone="accent" icon={<InfoIcon size={15} />}>
            <span className="flex-1">
              找到 {formatRelativeTime(new Date(draft.savedAt).toISOString())}未儲存的編輯（{draft.lines.length} 行）
              {draft.baseUpdatedAt !== project.updatedAt && "；之後歌詞在別處被更新過，恢復前請確認"}。
            </span>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                dispatch({ type: "edit", lines: draftToLines(draft), source: draft.source });
                setDraft(null);
              }}
            >
              恢復草稿
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(id);
                setDraft(null);
              }}
            >
              捨棄
            </Button>
          </Notice>
        )}
        {saveError && (
          <Notice tone="danger" icon={<AlertIcon size={15} />}>
            <span className="flex-1">儲存失敗：{saveError}</span>
            <Button size="sm" onClick={() => void save()}>
              重試
            </Button>
          </Notice>
        )}
        {savedInfo && (
          <Notice tone="ok" icon={<CheckIcon size={15} />}>
            <span className="flex-1">
              已儲存 {savedInfo.lines} 行{savedInfo.removed > 0 && `（移除了 ${savedInfo.removed} 個空白行）`}。
              {project.plan ? "目前的主視覺與段落是依照舊歌詞設計的，可以用新歌詞重新設計。" : "還沒有設計方案，可以開始設計。"}
            </span>
            <Link href={redesignHref} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-semibold text-white hover:brightness-110">
              <SparklesIcon size={13} />
              {project.plan ? "用新歌詞重新設計" : "開始設計"}
            </Link>
            <Link href={`/p/${encodeURIComponent(id)}`} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-panel-3 px-2.5 text-xs text-fg hover:bg-line">
              <MonitorIcon size={13} />
              進入控制台
            </Link>
            <button type="button" onClick={() => setSavedInfo(null)} aria-label="關閉提示" className="rounded p-1 text-muted hover:text-fg">
              <XIcon size={13} />
            </button>
          </Notice>
        )}
        {anyOutOfOrder && !tapActive && (
          <Notice tone="warn" icon={<AlertIcon size={15} />}>
            <span className="flex-1">有幾行的時間早於前面的行（紅色）。儲存時會自動依時間排序，或現在就整理。</span>
            <Button size="sm" onClick={() => edit((l) => sortByTime(l))}>
              <SortIcon size={13} />
              依時間排序
            </Button>
          </Notice>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <LineTable
          lines={lines}
          currentIndex={currentIndex}
          tapPointer={tapPointer}
          outOfOrder={flags}
          handlers={handlers}
          empty={
            <div className="mx-auto mt-16 max-w-md text-center">
              <p className="text-base font-semibold text-fg">還沒有歌詞</p>
              <p className="mt-1 text-sm text-muted">貼上 LRC 或純文字、到 LRCLIB 搜尋，或一行一行輸入。</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  <FileIcon size={15} />
                  匯入歌詞
                </Button>
                <Button onClick={() => handlers.insertAt(0)}>
                  <PlusIcon size={15} />
                  新增一行
                </Button>
              </div>
            </div>
          }
        />
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel px-5 py-2 text-[11px] text-faint">
        <span>
          <Kbd>Space</Kbd> 播放／暫停
        </span>
        <span>
          <Kbd>←</Kbd>
          <Kbd className="ml-0.5">→</Kbd> 跳 2 秒
        </span>
        <span>
          <Kbd>T</Kbd> 開始對拍
        </span>
        <span>
          時間欄 <Kbd>↑</Kbd>
          <Kbd className="ml-0.5">↓</Kbd> 微調 0.1 秒
        </span>
        <span>
          歌詞欄 <Kbd>Enter</Kbd> 下一行、<Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> 插入
        </span>
        <span>
          <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> 儲存、<Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> 復原
        </span>
        {toast && (
          <span role="status" className="ml-auto rounded-md bg-panel-3 px-2.5 py-1 text-xs text-fg shadow">
            {toast}
          </span>
        )}
      </footer>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={importLyrics}
        title={project.meta.title}
        artist={project.meta.artist}
        duration={duration}
        hasLines={lines.length > 0}
      />

      <Dialog
        open={distributeOpen}
        onClose={() => setDistributeOpen(false)}
        title="自動分配時間"
        description={
          project.analysis
            ? "依音訊的能量起伏找出像是有人聲的段落，按每行的長短粗略分配開始時間。之後建議用對拍或拖曳標記校正。"
            : "這首歌沒有音訊分析資料，會在整首歌裡平均分配。"
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDistributeOpen(false)}>
              取消
            </Button>
            <Button onClick={() => distribute("all")}>清除全部時間後重新分配</Button>
            <Button variant="primary" onClick={() => distribute("untimed")} disabled={timed === lines.length}>
              {timed === lines.length ? "所有行都已定時" : `只分配 ${lines.length - timed} 行未定時的歌詞`}
            </Button>
          </>
        }
      />
    </div>
  );
}

function Notice({ tone, icon, children }: { tone: "ok" | "warn" | "danger" | "accent"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-2 border-b px-5 py-2 text-sm",
        tone === "ok" && "border-ok/25 bg-ok/[0.07] text-fg [&>svg:first-child]:text-ok",
        tone === "warn" && "border-warn/25 bg-warn/[0.06] text-fg [&>svg:first-child]:text-warn",
        tone === "danger" && "border-danger/30 bg-danger/[0.07] text-fg [&>svg:first-child]:text-danger",
        tone === "accent" && "border-accent-2/30 bg-accent-2/[0.08] text-fg [&>svg:first-child]:text-accent-2",
      )}
    >
      {icon}
      {children}
    </div>
  );
}
