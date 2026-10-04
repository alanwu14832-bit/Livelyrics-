// Undoable editor state (useReducer).

import type { LyricsSource } from "@/lib/types";
import type { EditorLine } from "./editor-model";

interface Snapshot {
  lines: EditorLine[];
  source: LyricsSource;
  /** the times are spread by 自動分配 (Lyrics.timing "estimated"), not tapped / imported */
  estimated: boolean;
}

export interface EditorState {
  lines: EditorLine[];
  source: LyricsSource;
  estimated: boolean;
  language?: string;
  past: Snapshot[];
  future: Snapshot[];
  /** consecutive edits with the same tag (typing in one cell) share one undo step */
  lastTag: string | null;
  lastTagAt: number;
}

export type EditorAction =
  | { type: "load"; lines: EditorLine[]; source: LyricsSource; language?: string; estimated?: boolean }
  /** replace the lines (after saving) without touching history */
  | { type: "replace"; lines: EditorLine[]; source: LyricsSource; language?: string; estimated?: boolean }
  | { type: "edit"; lines: EditorLine[]; source?: LyricsSource; estimated?: boolean; tag?: string; at?: number; record?: boolean }
  /** like "edit", computed from the current lines (fn must be pure) */
  | { type: "apply"; fn: (lines: EditorLine[]) => EditorLine[]; source?: LyricsSource; estimated?: boolean; tag?: string; at?: number; record?: boolean }
  /** push an undo checkpoint without changing anything (start of a tap-sync session) */
  | { type: "checkpoint" }
  | { type: "undo" }
  | { type: "redo" };

const MAX_HISTORY = 200;
/** typing pauses longer than this start a new undo step */
const TAG_WINDOW_MS = 1500;

export function initialEditorState(): EditorState {
  return { lines: [], source: "none", estimated: false, past: [], future: [], lastTag: null, lastTagAt: 0 };
}

function snapshot(s: EditorState): Snapshot {
  return { lines: s.lines, source: s.source, estimated: s.estimated };
}

function pushPast(past: Snapshot[], snap: Snapshot): Snapshot[] {
  const out = [...past, snap];
  return out.length > MAX_HISTORY ? out.slice(out.length - MAX_HISTORY) : out;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load":
      return { ...initialEditorState(), lines: action.lines, source: action.source, language: action.language, estimated: action.estimated === true };
    case "replace":
      return { ...state, lines: action.lines, source: action.source, language: action.language ?? state.language, estimated: action.estimated ?? state.estimated, lastTag: null };
    case "apply": {
      const { fn, ...rest } = action;
      return editorReducer(state, { ...rest, type: "edit", lines: fn(state.lines) });
    }
    case "edit": {
      const estimated = action.estimated ?? state.estimated;
      if (action.lines === state.lines && (action.source ?? state.source) === state.source && estimated === state.estimated) return state;
      const at = action.at ?? 0;
      const coalesce = action.tag != null && action.tag === state.lastTag && at - state.lastTagAt < TAG_WINDOW_MS;
      const record = action.record !== false && !coalesce;
      return {
        ...state,
        lines: action.lines,
        source: action.source ?? state.source,
        estimated,
        past: record ? pushPast(state.past, snapshot(state)) : state.past,
        future: [],
        lastTag: action.tag ?? null,
        lastTagAt: at,
      };
    }
    case "checkpoint":
      return { ...state, past: pushPast(state.past, snapshot(state)), future: [], lastTag: null };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        lines: prev.lines,
        source: prev.source,
        estimated: prev.estimated,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, MAX_HISTORY),
        lastTag: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        lines: next.lines,
        source: next.source,
        estimated: next.estimated,
        past: pushPast(state.past, snapshot(state)),
        future: state.future.slice(1),
        lastTag: null,
      };
    }
  }
  return state;
}
