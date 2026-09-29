"use client";

// 排版 (字體藝術, phase 6): the type editor of one song, for a desktop and for a phone. The song's
// typographic system (voice, parameters, fonts, colour treatment, ornaments, 重新生成全部構圖), a
// section's overrides and every line's composition (recipe thumbnails, 換一個構圖, tapped emphasis,
// orientation, motion word, entrance / exit, drag or arrow-pad nudge, size, rotation, colour role,
// lock, reset), with the real renderer as the preview (paused at the line, or playing from it)
// and an A/B against the generated version.
//
// Every change is an undo step (a slider or a drag is one), saved through the plan PATCH like the
// console's edits (debounced, last write wins as there), and posted on the song's channel so an
// open console adopts it and the projection shows it at once. A console's own edits (and a
// re-design) arrive as `project` messages and are taken in when nothing here is unsaved.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppHeader, Banner, Button, EmptyState, Menu, MenuItem, SegmentedControl, Sheet, Skeleton, ToastStack, Tooltip, useToasts } from "@/components/ui";
import { ArrowUUpLeftIcon, ArrowUUpRightIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, DotsThreeIcon, ListNumbersIcon, PauseIcon, PlayIcon, SparkleIcon, TextAaIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { ProjectHeading } from "@/components/home/ProjectHeading";
import { NOT_FOUND_HEADER_TITLE, ProjectNotFound } from "@/components/home/ProjectNotFound";
import { processHref } from "@/components/process/steps";
import { api } from "@/lib/api-client";
import { channelName, parseStageMessage } from "@/lib/stage/protocol";
import { formatTimeShort, lineIndexAt, sectionIndexForLine } from "@/lib/timeline";
import * as E from "@/lib/type/edit";
import { resolveLine } from "@/lib/type/resolve";
import { VOICES } from "@/lib/type/vocab";
import type { DesignPlan, Project, TypeSystem, TypeVoiceId } from "@/lib/types";
import { LineList, LinePanel, SectionPanel, SongPanel, type LineActions, type LineRow, type SongActions } from "./panels";
import { TypePreview } from "./TypePreview";

type Load = { kind: "loading" } | { kind: "ok"; project: Project } | { kind: "error"; message: string; notFound: boolean };

export interface TypeEditorHeaderInfo {
  title: string;
  artist: string;
  palette: string[];
}

const SAVE_DEBOUNCE_MS = 700;
const LEAVE_MESSAGE = "排版有尚未儲存的變更，確定要離開嗎？";

function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function TypeEditorClient({ id, initial }: { id: string; initial: TypeEditorHeaderInfo | null }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    api
      .getProject(id)
      .then((project) => {
        if (live) setLoad({ kind: "ok", project });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({ kind: "error", message, notFound: /找不到|404/.test(message) });
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (load.kind === "ok" && load.project.plan) return <TypeEditor key={load.project.id} initialProject={load.project} />;
  const heading = initial ? <ProjectHeading id={id} title={initial.title || "排版"} subtitle={initial.artist || undefined} palette={initial.palette} /> : undefined;
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-label">
      <AppHeader back={{ href: processHref(id), label: "設計總覽" }} width="full" heading={load.kind === "error" && load.notFound ? undefined : heading} title={load.kind === "error" && load.notFound ? NOT_FOUND_HEADER_TITLE : heading ? undefined : "排版"} />
      <main className="mx-(--page-gutter) mt-4 flex flex-1 flex-col gap-3">
        {load.kind === "loading" && (
          <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_340px]" aria-busy="true" aria-label="載入中">
            <Skeleton className="hidden h-96 rounded-lg lg:block" />
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
          </div>
        )}
        {load.kind === "error" && (load.notFound ? <ProjectNotFound className="mt-10" /> : <EmptyState className="mt-10" icon={WarningCircleIcon} title="無法載入作品" description={load.message} action={<Button variant="plain" onClick={() => window.location.reload()}>重新載入</Button>} />)}
        {load.kind === "ok" && !load.project.plan && (
          <EmptyState
            className="mt-10"
            icon={TextAaIcon}
            title="還沒有設計方案"
            description="先完成設計，每一句歌詞就會排成一張構圖，再回到這裡調整。"
            action={
              <Button variant="tinted" icon={SparkleIcon} href={processHref(id)}>
                前往設計總覽
              </Button>
            }
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the editor
// ---------------------------------------------------------------------------

type HistoryAction = { type: "commit"; next: TypeSystem; merge?: string | null } | { type: "undo" } | { type: "redo" } | { type: "reset"; system: TypeSystem | null };

function historyReducer(h: E.EditorHistory | null, a: HistoryAction): E.EditorHistory | null {
  switch (a.type) {
    case "commit":
      return h ? E.commit(h, a.next, a.merge ?? null) : E.historyOf(a.next);
    case "undo":
      return h ? E.undo(h) : h;
    case "redo":
      return h ? E.redo(h) : h;
    case "reset":
      return a.system ? E.historyOf(a.system) : null;
  }
}

type SaveState = { status: "idle" | "pending" | "saving" | "saved" } | { status: "error"; message: string };
type Tab = "line" | "section" | "song";

function sameSystem(a: TypeSystem | null | undefined, b: TypeSystem | null | undefined): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function TypeEditor({ initialProject }: { initialProject: Project }) {
  const id = initialProject.id;
  const router = useRouter();
  const toasts = useToasts();
  const [editorId] = useState(randomId);
  /** the latest project known here (its plan's non-type parts follow a console's edits) */
  const [base, setBase] = useState(initialProject);
  const [history, dispatch] = useReducer(historyReducer, initialProject.plan?.typeSystem ?? null, (ts) => (ts ? E.historyOf(ts) : null));
  const system = history?.present ?? null;
  const [saved, setSaved] = useState<TypeSystem | null>(initialProject.plan?.typeSystem ?? null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const plan = base.plan as DesignPlan;
  const lines = base.lyrics.lines;
  const duration = base.meta.duration;
  const ctx: E.EditContext = useMemo(() => ({ lines, sections: plan.sections, duration }), [lines, plan.sections, duration]);
  const sung = useMemo(() => lines.map((l, i) => (l.text.trim() ? i : -1)).filter((i) => i >= 0), [lines]);

  const [selected, setSelected] = useState<number | null>(() => sung[0] ?? null);
  const [playing, setPlaying] = useState(false);
  const [ab, setAb] = useState<"edited" | "generated">("edited");
  const [tab, setTab] = useState<Tab>("line");
  const [listOpen, setListOpen] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(() => {
    const idx = sung[0];
    const si = idx != null ? sectionIndexForLine(plan, lines, idx, duration) : null;
    return si != null ? (plan.sections[si]?.id ?? null) : (plan.sections[0]?.id ?? null);
  });

  const dirty = !!system && !sameSystem(system, saved);

  // ---- the project the preview shows ----------------------------------------
  const shownSystem = system && ab === "generated" ? E.generatedVersion(system) : system;
  const previewPlan: DesignPlan = useMemo(() => {
    if (!shownSystem) return plan;
    return { ...plan, typeSystem: shownSystem };
  }, [plan, shownSystem]);
  const previewProject: Project = useMemo(() => ({ ...base, plan: previewPlan }), [base, previewPlan]);

  // ---- saving and the live link ---------------------------------------------
  const baseRef = useRef(base);
  const systemRef = useRef(system);
  const savedRef = useRef(saved);
  useEffect(() => {
    baseRef.current = base;
    systemRef.current = system;
    savedRef.current = saved;
  }, [base, system, saved]);

  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(channelName(id));
    channel.current = ch;
    ch.onmessage = (ev: MessageEvent<unknown>) => {
      const msg = parseStageMessage(ev.data);
      if (!msg || msg.type !== "project" || msg.project.id !== id || !msg.project.plan) return;
      // a console's edit (sections, colours) or a re-design
      const incoming = msg.project;
      setBase((b) => ({ ...b, ...incoming, plan: incoming.plan }));
      const theirs = incoming.plan?.typeSystem ?? null;
      const mine = systemRef.current;
      if (!sameSystem(theirs, mine) && sameSystem(mine, savedRef.current)) {
        // nothing unsaved here: take theirs (a re-design brings a new type system)
        dispatch({ type: "reset", system: theirs });
        setSaved(theirs);
      }
    };
    return () => {
      ch.onmessage = null;
      ch.close();
      channel.current = null;
    };
  }, [id]);

  const post = useCallback(
    (ts: TypeSystem) => {
      const b = baseRef.current;
      if (!b.plan) return;
      try {
        channel.current?.postMessage({ type: "plan", projectId: id, plan: { ...b.plan, typeSystem: ts }, sender: editorId });
      } catch {
        /* channel closed */
      }
    },
    [id, editorId],
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    saving.current = saving.current.then(async () => {
      const ts = systemRef.current;
      const b = baseRef.current;
      if (!ts || !b.plan || sameSystem(ts, savedRef.current)) {
        setSave((s) => (s.status === "pending" || s.status === "saving" ? { status: "saved" } : s));
        return;
      }
      setSave({ status: "saving" });
      try {
        await api.updateProject(id, { plan: { ...b.plan, typeSystem: ts } });
        savedRef.current = ts;
        setSaved(ts);
        setSave(sameSystem(systemRef.current, ts) ? { status: "saved" } : { status: "pending" });
      } catch (err) {
        setSave({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });
    return saving.current;
  }, [id]);

  // every change: shown on the projection at once, saved after a short pause
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!system) return;
    post(system);
    if (sameSystem(system, saved)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [system, saved, post, flush]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!sameSystem(systemRef.current, savedRef.current)) {
        e.preventDefault();
        e.returnValue = LEAVE_MESSAGE;
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // ---- edits -------------------------------------------------------------------
  const apply = useCallback(
    (change: (ts: TypeSystem) => TypeSystem, merge: string | null = null) => {
      const ts = systemRef.current;
      if (!ts) return;
      const next = change(ts);
      if (next === ts) return;
      setAb("edited");
      dispatch({ type: "commit", next, merge });
    },
    [],
  );

  const line = selected != null ? lines[selected] : null;
  const res = useMemo(() => (system && selected != null ? resolveLine({ ...plan, typeSystem: system }, lines, selected, { duration, songTitle: base.meta.title }) : null), [system, plan, lines, selected, duration, base.meta.title]);
  const lineId = line?.id ?? "";

  const songActions: SongActions = {
    voice: (v) => {
      apply((ts) => E.setVoice(ts, v, ctx));
      toasts.push({ message: `字體語言改為「${VOICES[v].label}」，每一句都重新排版`, tone: "ok" });
    },
    param: (k, v, done) => apply((ts) => E.setParam(ts, k, v), done ? null : `param:${k}`),
    fonts: (f) => apply((ts) => E.setFonts(ts, f)),
    weight: (w) => apply((ts) => E.setWeight(ts, w)),
    color: (c) => apply((ts) => E.setColorTreatment(ts, c)),
    ornament: (o) => apply((ts) => E.toggleOrnament(ts, o)),
    seal: (s) => apply((ts) => E.setSeal(ts, s), "seal"),
    regenerate: () => {
      apply((ts) => E.regenerateAll(ts, ctx));
      toasts.push({ message: "已重新生成全部構圖（鎖定的句子不變，可以復原）", tone: "ok" });
    },
  };

  const lineActions: LineActions = {
    recipe: (r) => apply((ts) => E.setRecipe(ts, lineId, r, ctx)),
    reroll: () => apply((ts) => E.reroll(ts, lineId, ctx)),
    emphasis: (i) => apply((ts) => E.toggleEmphasisUnit(ts, lineId, i, res?.hint.emphasis ?? [], ctx)),
    orientation: (o) => apply((ts) => E.setOrientation(ts, lineId, o, ctx)),
    motion: (w) => apply((ts) => E.setMotionWord(ts, lineId, w, ctx)),
    enter: (en) => apply((ts) => E.setEnter(ts, lineId, en, ctx)),
    exit: (ex) => apply((ts) => E.setExit(ts, lineId, ex, ctx)),
    nudge: (dx, dy, done) => apply((ts) => E.nudgeTo(ts, lineId, dx, dy, ctx), done ? null : `nudge:${lineId}`),
    scale: (s, done) => apply((ts) => E.setScale(ts, lineId, s, ctx), done ? null : `scale:${lineId}`),
    rotate: (d, done) => apply((ts) => E.setRotate(ts, lineId, d, ctx), done ? null : `rotate:${lineId}`),
    color: (c) => apply((ts) => E.setColorRole(ts, lineId, c, ctx)),
    lock: (on) => apply((ts) => E.setLocked(ts, lineId, on, ctx)),
    reset: () => apply((ts) => E.resetLine(ts, lineId)),
  };

  const sectionOverride = system && sectionId ? E.sectionOverride(system, sectionId) : null;
  const onSection = (patch: E.SectionPatch, done: boolean) => {
    if (!sectionId) return;
    apply((ts) => E.setSection(ts, sectionId, patch), done ? null : `section:${sectionId}:${Object.keys(patch).join()}`);
  };

  // ---- navigation ----------------------------------------------------------------
  const select = useCallback(
    (index: number | null) => {
      setSelected(index);
      if (index == null) return;
      const si = sectionIndexForLine(plan, lines, index, duration);
      const sid = si != null ? plan.sections[si]?.id : null;
      if (sid) setSectionId(sid);
    },
    [plan, lines, duration],
  );
  const step = useCallback(
    (delta: number) => {
      if (!sung.length) return;
      const at = selected == null ? -1 : sung.indexOf(selected);
      const next = sung[Math.min(sung.length - 1, Math.max(0, at < 0 ? 0 : at + delta))];
      setPlaying(false);
      select(next);
    },
    [sung, selected, select],
  );
  const onPlayLine = useCallback((index: number | null) => {
    if (index != null) setSelected(index);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        return;
      }
      if (typing || mod || e.altKey) return;
      if (el && (el.tagName === "BUTTON" || el.getAttribute("role") === "slider" || el.getAttribute("role") === "radio")) {
        if (e.key === " " || e.key === "Enter") return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        step(-1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, step]);

  // ---- the legacy plan: 建立字體語言 -------------------------------------------------
  const create = (voice: TypeVoiceId) => {
    const ts = E.createTypeSystem(voice, ctx, { cjk: plan.keyVisual.typography.cjkFont, latin: plan.keyVisual.typography.latinFont });
    dispatch({ type: "commit", next: ts });
  };

  const rows: LineRow[] = useMemo(() => {
    if (!system) return [];
    return sung.map((i) => {
      const l = lines[i];
      const r = resolveLine({ ...plan, typeSystem: system }, lines, i, { duration });
      const si = sectionIndexForLine(plan, lines, i, duration);
      const own = system.lines.find((x) => x.lineId === l.id);
      return { index: i, id: l.id, text: l.text, start: l.start, recipe: r?.hint.recipe ?? "title-card", locked: !!own?.locked, edited: !!own?.edit && Object.keys(own.edit).length > 0, section: si != null ? (plan.sections[si]?.label ?? null) : null };
    });
  }, [system, sung, lines, plan, duration]);

  const firstIdx = selected != null ? E.firstOccurrence(lines, selected) : null;
  const repeats = selected != null ? E.repeatCount(lines, selected) : 1;
  const own = system && line ? system.lines.find((l) => l.lineId === line.id) : null;

  // what the header says: saving, an error, unsaved changes waiting for the pause, or saved
  const status = save.status === "saving" || save.status === "error" ? save.status : dirty ? "pending" : save.status === "idle" ? "idle" : "saved";
  const saveLabel = status === "saving" ? "儲存中…" : status === "pending" ? "尚未儲存" : status === "error" ? "沒有存成功" : status === "saved" ? "已儲存" : "";

  const header = (
    <AppHeader
      back={{ href: processHref(id), label: "設計總覽" }}
      width="full"
      heading={
        <ProjectHeading
          id={id}
          title={base.meta.title || base.meta.fileName || "排版"}
          subtitle={<span>排版{system ? `・${VOICES[system.voice].label}` : ""}</span>}
          palette={plan.keyVisual.palette.map((c) => c.hex)}
          accessory={<span className="hidden shrink-0 text-[12px] leading-4 text-label-2 sm:inline" data-testid="save-status" data-status={status}>{saveLabel}</span>}
        />
      }
      actions={
        <>
          <div role="group" aria-label="復原與重做" className="relative inline-flex overflow-hidden rounded-sm bg-fill-3">
            <Tooltip content="復原" shortcut="Meta+Z">
              <button type="button" className="press-fade focus-inset inline-flex h-11 w-11 items-center justify-center text-label hover:bg-fill-4 disabled:pointer-events-none disabled:text-label-3 lg:h-8 lg:w-9" onClick={() => dispatch({ type: "undo" })} disabled={!history?.past.length} aria-label="復原" data-testid="undo">
                <ArrowUUpLeftIcon size={16} />
              </button>
            </Tooltip>
            <span aria-hidden="true" className="my-[7px] w-(--hairline) bg-separator" />
            <Tooltip content="重做" shortcut="Meta+Shift+Z">
              <button type="button" className="press-fade focus-inset inline-flex h-11 w-11 items-center justify-center text-label hover:bg-fill-4 disabled:pointer-events-none disabled:text-label-3 lg:h-8 lg:w-9" onClick={() => dispatch({ type: "redo" })} disabled={!history?.future.length} aria-label="重做" data-testid="redo">
                <ArrowUUpRightIcon size={16} />
              </button>
            </Tooltip>
          </div>
          <Menu label="更多" placement="bottom-end" trigger={(p) => <Button {...p} variant="quiet" size="icon" className="size-11 lg:size-8" aria-label="更多" icon={<DotsThreeIcon size={20} />} />}>
            <MenuItem onSelect={() => router.push(`/p/${encodeURIComponent(id)}`)} textValue="進入控制台">
              進入控制台
            </MenuItem>
            <MenuItem onSelect={() => router.push(processHref(id))} textValue="設計總覽">
              設計總覽
            </MenuItem>
            <MenuItem onSelect={() => router.push(`/p/${encodeURIComponent(id)}/lyrics`)} textValue="編輯歌詞">
              編輯歌詞
            </MenuItem>
          </Menu>
        </>
      }
    />
  );

  if (!system) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg text-label">
        {header}
        <main className="mx-(--page-gutter) mt-4 flex flex-col gap-4 pb-10">
          <Banner
            tone="info"
            title="這個方案還是舊的歌詞樣式"
            description="舊方案的歌詞是一整行的字幕樣式。建立字體語言後，每一句歌詞都會排成一張設計過的構圖，之後可以在這裡逐句調整。"
          />
          <div className="grid gap-3 sm:grid-cols-2" data-testid="create-type-system">
            {(Object.keys(VOICES) as TypeVoiceId[]).map((v) => (
              <button key={v} type="button" onClick={() => create(v)} className="press-fade flex min-h-11 flex-col gap-1 rounded-lg bg-surface p-4 text-left hover:bg-fill-4" data-voice={v}>
                <span className="text-[17px] leading-6 font-semibold text-label">用「{VOICES[v].label}」建立</span>
                <span className="text-[13px] leading-5 text-label-2">{VOICES[v].description}</span>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  const lineHeader = line && (
    <div className="flex min-w-0 items-center gap-2">
      <Button variant="gray" size="icon" className="size-11 shrink-0 lg:size-8" aria-label="上一句" icon={<CaretLeftIcon size={18} />} onClick={() => step(-1)} data-testid="prev-line" />
      <button type="button" onClick={() => setListOpen(true)} className="press-fade flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md bg-fill-4 px-3 text-left lg:pointer-events-none lg:min-h-8 lg:bg-transparent lg:px-1" data-testid="current-line">
        <ListNumbersIcon size={16} className="shrink-0 text-label-2 lg:hidden" />
        <span className="shrink-0 text-[12px] leading-4 text-label-2 tabular-nums">{line.start != null ? formatTimeShort(line.start) : "—"}</span>
        <span className="min-w-0 truncate text-[15px] leading-5 font-semibold">{line.text}</span>
      </button>
      <Button variant="gray" size="icon" className="size-11 shrink-0 lg:size-8" aria-label="下一句" icon={<CaretRightIcon size={18} />} onClick={() => step(1)} data-testid="next-line" />
    </div>
  );

  const transport = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={playing ? "filled" : "gray"} icon={playing ? PauseIcon : PlayIcon} onClick={() => setPlaying((p) => !p)} className="min-h-11 lg:min-h-8" data-testid="play-line">
        {playing ? "停止" : "從這句播放"}
      </Button>
      <SegmentedControl
        touch
        label="比較"
        value={ab}
        onChange={setAb}
        options={[
          { value: "edited", label: "調整後" },
          { value: "generated", label: "生成的" },
        ]}
      />
      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        step={0.1}
        value={line?.start ?? 0}
        onChange={(e) => {
          const t = Number(e.target.value);
          const idx = lineIndexAt(base.lyrics, t, duration) ?? sung.find((i) => (lines[i].start ?? 0) >= t) ?? null;
          setPlaying(false);
          if (idx != null) select(idx);
        }}
        aria-label="拖曳選擇歌詞"
        className="h-11 min-w-32 flex-1 accent-[var(--tint)] lg:h-8"
        data-testid="scrub"
      />
    </div>
  );

  const linePanel =
    line && res ? (
      <LinePanel project={previewProject} system={system} ctx={ctx} lineIndex={selected!} res={res} locked={!!own?.locked} edited={!!own?.edit && Object.keys(own.edit).length > 0} repeats={repeats} isFirst={firstIdx === selected} actions={lineActions} />
    ) : (
      <EmptyState icon={TextAaIcon} title="這首歌沒有歌詞" description="在歌詞編輯器加入歌詞後，每一句都會排成一張構圖。" />
    );
  const sectionPanel = <SectionPanel sections={plan.sections} selected={sectionId} onSelect={setSectionId} override={sectionOverride} onChange={onSection} />;
  const songPanel = <SongPanel system={system} actions={songActions} />;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-label lg:h-dvh lg:overflow-hidden" data-testid="type-editor">
      {header}
      {save.status === "error" && (
        <div className="mx-(--page-gutter) mt-2">
          <Banner
            tone="error"
            title="排版沒有存成功"
            description={save.message}
            actions={
              <Button variant="gray" onClick={() => void flush()}>
                再試一次
              </Button>
            }
          />
        </div>
      )}
      <main className="grid min-h-0 flex-1 gap-3 px-(--page-gutter) pt-2 pb-6 lg:grid-cols-[260px_minmax(0,1fr)_360px] lg:pb-3">
        <aside className="hidden min-h-0 overflow-y-auto rounded-lg bg-surface p-2 lg:block" aria-label="歌詞列表">
          <LineList rows={rows} selected={selected} onSelect={(i) => { setPlaying(false); select(i); }} />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto" aria-label="預覽與這一句">
          <div className="sticky top-[52px] z-10 -mx-(--page-gutter) flex flex-col gap-2 bg-bg px-(--page-gutter) pt-1 pb-2 lg:top-0 lg:mx-0 lg:px-0">
            <TypePreview
              project={previewProject}
              lineIndex={selected}
              playing={playing}
              onPlayingChange={setPlaying}
              onLineChange={onPlayLine}
              nudge={{ dx: res?.hint.dx ?? 0, dy: res?.hint.dy ?? 0 }}
              onNudge={(dx, dy, done) => lineActions.nudge(dx, dy, done)}
              className="h-[min(36vh,56vw)] lg:h-[min(48vh,40vw)]"
            />
            {lineHeader}
          </div>
          {transport}
          <div className="lg:hidden">
            <SegmentedControl<Tab>
              touch
              kind="tabs"
              fullWidth
              label="排版範圍"
              value={tab}
              onChange={setTab}
              options={[
                { value: "line", label: "這一句" },
                { value: "section", label: "段落" },
                { value: "song", label: "整首" },
              ]}
            />
          </div>
          <div className={tab === "line" ? "" : "hidden lg:block"}>{linePanel}</div>
          <div className={tab === "section" ? "lg:hidden" : "hidden"}>{sectionPanel}</div>
          <div className={tab === "song" ? "lg:hidden" : "hidden"}>{songPanel}</div>
        </section>

        <aside className="hidden min-h-0 flex-col gap-6 overflow-y-auto pb-6 lg:flex" aria-label="整首與段落">
          {songPanel}
          {sectionPanel}
        </aside>
      </main>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title="選一句歌詞" width={560}>
        <div className="p-2">
          <LineList
            rows={rows}
            selected={selected}
            onSelect={(i) => {
              setPlaying(false);
              select(i);
              setListOpen(false);
            }}
          />
        </div>
      </Sheet>

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} placement="bottom-center" />
      <span className="sr-only" aria-live="polite">
        {status === "saved" ? <><CheckIcon size={14} /> 已儲存</> : null}
      </span>
    </div>
  );
}
