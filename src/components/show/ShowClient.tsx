"use client";

// 演出 /s/[id]: the setlist editor. The set is an ordered list (Apple Music playlist in edit mode):
// songs from the band plus the moments between them (進場, 串場, 待機, 散場) with their own look.
// Drag the grip (or ↑ ↓ on it) to reorder; everything saves on its own. The side column holds the
// show's details and canvas (套用到所有歌曲), and 整場弧線: the designer's per-song energy and palette
// notes for the whole set, which can re-design one song or all of them to follow the arc.

import { AnimatePresence, MotionConfig, Reorder, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BandArt, bandHref } from "@/components/home/BandShelf";
import { ProjectArt, validPalette } from "@/components/home/ProjectArt";
import { Alert, AppHeader, Banner, Button, EmptyState, FormRow, InsetGroup, ListRow, Menu, MenuItem, ProgressBar, Select, Sheet, Skeleton, SkeletonGroup, Spinner, TextArea, cx, rowInputClass } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { ChartLineUpIcon, CheckCircleIcon, MusicNotesPlusIcon, PlusIcon, SparkleIcon, TicketIcon, TrashIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { useJobPolling } from "@/components/band/use-job-polling";
import { spring } from "@/lib/motion";
import { OUTPUT_PRESETS, aspectLabel } from "@/lib/output";
import { ARC_ROLE_INFO, LOOK_KINDS, LOOK_KIND_INFO, SONG_STATUS_INFO, arcDirectiveFor, defaultLook, formatRunningTime, moveItem, newSetItemId, setlistTotals, songItems, songStatus } from "@/lib/show";
import { formatTimeShort } from "@/lib/timeline";
import type { Band, LookItemKind, ProjectSummary, SetItem, Show } from "@/lib/types";
import { LookSheet } from "./LookSheet";
import { LOOK_ICONS, SetlistRow } from "./SetlistRow";

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ok" };
type SaveState = "idle" | "saving" | "saved" | "error";
type ShowPatch = Parameters<typeof api.updateShow>[1];
type LookItem = Extract<SetItem, { kind: LookItemKind }>;

interface ArcRun {
  total: number;
  done: number;
  current: string | null;
  cancelled: boolean;
  error: string | null;
}

export function ShowClient({ id, initialName }: { id: string; initialName?: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [show, setShow] = useState<Show | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const [songs, setSongs] = useState<ProjectSummary[]>([]);
  const [save, setSave] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LookItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmCanvas, setConfirmCanvas] = useState(false);
  const [canvasNote, setCanvasNote] = useState<string | null>(null);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [arcBusy, setArcBusy] = useState(false);
  const [arcError, setArcError] = useState<string | null>(null);
  // cloud mode: an arc recorded on the show keeps running on the server (refresh, other tab);
  // only the arc is taken from the server so setlist edits in progress stay
  const arcJob = show?.arcJob;
  const arcJobRunning = arcJob?.status === "running";
  useJobPolling(arcJobRunning && !arcBusy, async () => {
    const next = await api.getShow(id);
    setShow((s) => (s ? { ...s, arc: next.arc, arcJob: next.arcJob } : next));
    // a "busy" answer this page got while the job ran is over now
    if (next.arcJob?.status !== "running") setArcError(null);
  });
  const arcWorking = arcBusy || arcJobRunning;
  const arcProblem = arcWorking ? null : (arcError ?? (arcJob?.status === "error" ? arcJob.message || "上次規劃整場弧線沒有完成，請重試。" : null));
  const [run, setRun] = useState<ArcRun | null>(null);
  const [designing, setDesigning] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [announce, setAnnounce] = useState("");
  const showRef = useRef<Show | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const runRef = useRef<{ cancelled: boolean; abort: AbortController | null }>({ cancelled: false, abort: null });

  useEffect(() => {
    showRef.current = show;
  }, [show]);

  const refreshSongs = useCallback(async (bandId: string) => {
    const list = await api.listProjects();
    setSongs(list.filter((p) => p.bandId === bandId));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api.getShow(id);
        const [b, list] = await Promise.all([api.getBand(s.bandId), api.listProjects()]);
        if (!alive) return;
        setShow(s);
        setBand(b);
        setSongs(list.filter((p) => p.bandId === s.bandId));
        setLoad({ kind: "ok" });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad(/找不到/.test(message) ? { kind: "missing" } : { kind: "error", message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /** Apply locally at once, save in order (latest wins on the server). */
  const persist = useCallback(
    (patch: ShowPatch, local: (s: Show) => Show) => {
      setShow((s) => (s ? local(s) : s));
      setSave("saving");
      queue.current = queue.current.then(async () => {
        try {
          const saved = await api.updateShow(id, patch);
          // keep local edits that happened meanwhile; take server-side derived fields (arc positions)
          setShow((s) => (s ? { ...s, arc: saved.arc, updatedAt: saved.updatedAt } : saved));
          setSave("saved");
          setSaveError(null);
        } catch (err) {
          setSave("error");
          setSaveError(err instanceof Error ? err.message : String(err));
        }
      });
    },
    [id],
  );

  const setItems = useCallback((items: SetItem[]) => persist({ items }, (s) => ({ ...s, items })), [persist]);

  const songMap = useMemo(() => new Map(songs.map((p) => [p.id, p])), [songs]);
  const totals = useMemo(() => (show ? setlistTotals(show.items, songMap) : null), [show, songMap]);
  const inSet = useMemo(() => new Set(show?.items.filter((i) => i.kind === "song").map((i) => (i as { projectId: string }).projectId)), [show]);

  const move = (from: number, to: number) => {
    if (!show) return;
    const next = moveItem(show.items, from, to);
    if (next.every((it, i) => it === show.items[i])) return;
    setItems(next);
    const it = show.items[from];
    setAnnounce(`已移到第 ${Math.max(1, Math.min(show.items.length, to + 1))} 個位置：${it.kind === "song" ? (songMap.get(it.projectId)?.title ?? "") : it.title}`);
  };

  const addLook = (kind: LookItemKind) => {
    if (!show || !band) return;
    const item: LookItem = { id: newSetItemId(), kind, title: LOOK_KIND_INFO[kind].defaultTitle, look: defaultLook(kind, band.bible, band.name, band.assets) };
    // walk-in goes first, walk-out last, the rest at the end
    const items = kind === "walk-in" ? [item, ...show.items] : [...show.items, item];
    setItems(items);
    setEditing(item);
  };

  const addSongs = (ids: string[]) => {
    if (!show) return;
    const fresh: SetItem[] = ids.map((projectId) => ({ id: newSetItemId(), kind: "song", projectId }));
    const walkOut = show.items.findIndex((i) => i.kind === "walk-out");
    const items = walkOut >= 0 ? [...show.items.slice(0, walkOut), ...fresh, ...show.items.slice(walkOut)] : [...show.items, ...fresh];
    setItems(items);
  };

  const planArc = async () => {
    setArcBusy(true);
    setArcError(null);
    try {
      const res = await api.planArc(id);
      setShow((s) => (s ? { ...s, arc: res.show.arc, arcJob: res.show.arcJob } : res.show));
    } catch (err) {
      setArcError(err instanceof Error ? err.message : String(err));
      // it may be running elsewhere (cloud mode answers 409): pick up the show's recorded job
      void api
        .getShow(id)
        .then((next) => setShow((s) => (s ? { ...s, arcJob: next.arcJob } : next)))
        .catch(() => {});
    } finally {
      setArcBusy(false);
    }
  };

  const markApplied = (itemId: string) => {
    const s = showRef.current;
    if (!s?.arc) return;
    const arc = { ...s.arc, songs: s.arc.songs.map((n) => (n.itemId === itemId ? { ...n, appliedAt: new Date().toISOString() } : n)) };
    persist({ arc }, (x) => ({ ...x, arc }));
  };

  const redesignOne = async (itemId: string, signal?: AbortSignal) => {
    const s = showRef.current;
    if (!s) return;
    const directive = arcDirectiveFor(s, itemId);
    const item = s.items.find((i) => i.id === itemId);
    if (!directive || !item || item.kind !== "song") return;
    setDesigning((d) => new Set(d).add(itemId));
    try {
      await api.process(item.projectId, { steps: ["design"], arc: directive }, () => {}, signal);
      markApplied(itemId);
    } finally {
      setDesigning((d) => {
        const n = new Set(d);
        n.delete(itemId);
        return n;
      });
      if (s.bandId) void refreshSongs(s.bandId);
    }
  };

  const redesignAll = async () => {
    const s = showRef.current;
    if (!s?.arc) return;
    const order = songItems(s.items).filter((it) => s.arc!.songs.some((n) => n.itemId === it.id) && songMap.has(it.projectId));
    runRef.current = { cancelled: false, abort: null };
    setRun({ total: order.length, done: 0, current: null, cancelled: false, error: null });
    for (let i = 0; i < order.length; i++) {
      if (runRef.current.cancelled) break;
      const it = order[i];
      setRun((r) => (r ? { ...r, current: songMap.get(it.projectId)?.title ?? "" } : r));
      const abort = new AbortController();
      runRef.current.abort = abort;
      try {
        await redesignOne(it.id, abort.signal);
      } catch (err) {
        if (runRef.current.cancelled) break;
        setRun((r) => (r ? { ...r, error: `〈${songMap.get(it.projectId)?.title ?? ""}〉：${err instanceof Error ? err.message : String(err)}` } : r));
      }
      setRun((r) => (r ? { ...r, done: i + 1 } : r));
    }
    setRun((r) => (r ? { ...r, current: null, cancelled: runRef.current.cancelled } : r));
  };

  const applyCanvas = async () => {
    setConfirmCanvas(false);
    setCanvasBusy(true);
    try {
      const res = await api.applyShowOutput(id);
      setCanvasNote(`已把 ${res.show.output.width} × ${res.show.output.height} 套用到 ${res.updated} 首歌。`);
    } catch (err) {
      setCanvasNote(`套用失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCanvasBusy(false);
    }
  };

  const running = run != null && run.current != null;
  const status = save === "saving" ? "儲存中…" : save === "saved" ? "已儲存" : save === "error" ? "儲存失敗" : "";

  return (
    <div className="min-h-dvh">
      <AppHeader
        back={{ href: band ? bandHref(band.id) : "/", label: band?.name ?? "樂團" }}
        title={show?.name ?? initialName ?? "演出"}
        subtitle={show ? [show.date, show.venue].filter(Boolean).join("，") || "演出" : "演出"}
        titleAccessory={
          status ? (
            <span className={cx("text-[12px] leading-4", save === "error" ? "text-red-text" : "text-label-2")} role="status">
              {status}
            </span>
          ) : null
        }
        actions={
          show && (
            <Button variant="tinted" icon={ChartLineUpIcon} onClick={() => void planArc()} loading={arcWorking} disabled={arcWorking || running || !show.items.some((i) => i.kind === "song")}>
              {show.arc ? "重新規劃弧線" : "整場弧線"}
            </Button>
          )
        }
      />
      <main className="mx-auto w-full max-w-[1200px] px-(--page-gutter) pb-32">
        {load.kind === "loading" && (
          <SkeletonGroup label="載入演出" className="grid gap-8 pt-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <Skeleton className="h-10 w-72 rounded-xs!" />
              <Skeleton className="mt-6 h-[420px] rounded-lg!" />
            </div>
            <Skeleton className="h-80 rounded-lg!" />
          </SkeletonGroup>
        )}
        {load.kind === "missing" && <EmptyState icon={TicketIcon} title="找不到這場演出" description="它可能已被刪除。" action={<Button href="/" variant="tinted" transitionTypes={["pop"]}>回到作品庫</Button>} className="pt-24" />}
        {load.kind === "error" && <Banner className="mt-10" tone="error" title="無法載入演出" description={load.message} />}

        {load.kind === "ok" && show && band && totals && (
          <div className="grid min-w-0 gap-10 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <header className="flex min-w-0 items-center gap-5">
                <BandArt id={band.id} palette={band.bible.palette.map((c) => c.hex)} className="size-16 shrink-0 rounded-full" iconSize={28} />
                <div className="min-w-0">
                  <h1 className="truncate text-large-title text-label">{show.name}</h1>
                  <p className="truncate text-[17px] leading-6 text-label-2">{[band.name, show.date, show.venue].filter(Boolean).join("，")}</p>
                </div>
              </header>

              <dl className="mt-6 grid max-w-[560px] grid-cols-3 gap-4 px-1">
                <Stat label="總長度">{totals.total > 0 ? formatRunningTime(totals.total) : "未知"}</Stat>
                <Stat label="歌曲">{totals.songs}</Stat>
                <Stat label={totals.songs ? "可上台" : "可上台的歌"}>
                  {totals.ready}
                  <span className="text-[15px] font-normal text-label-2">／{totals.songs}</span>
                </Stat>
              </dl>
              {totals.unknown > 0 && <p className="mt-2 px-1 text-[12px] leading-4 text-label-2">有 {totals.unknown} 個項目沒有長度，沒有算進總長度。</p>}

              {saveError && <Banner className="mt-6" tone="error" title="儲存失敗" description={saveError} />}

              {run && <ArcRunBanner run={run} onCancel={() => { runRef.current.cancelled = true; runRef.current.abort?.abort(); }} onDismiss={() => setRun(null)} />}

              <section aria-labelledby="setlist-title" className="mt-8">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-3 px-(--row-pad-x)">
                  <h2 id="setlist-title" className="text-[13px] leading-5 text-label-2">
                    歌單（{show.items.length}）
                  </h2>
                  <div className="-mr-2 flex items-center gap-1">
                    <Button variant="plain" icon={MusicNotesPlusIcon} onClick={() => setAdding(true)} disabled={songs.length === 0}>
                      加入歌曲
                    </Button>
                    <Menu label="加入畫面" placement="bottom-end" trigger={(t) => <Button {...t} variant="plain" icon={PlusIcon}>加入畫面</Button>}>
                      {LOOK_KINDS.map((k) => (
                        <MenuItem key={k} icon={LOOK_ICONS[k]} onSelect={() => addLook(k)}>
                          {LOOK_KIND_INFO[k].label}
                        </MenuItem>
                      ))}
                    </Menu>
                  </div>
                </div>
                {show.items.length === 0 ? (
                  <div className="rounded-lg bg-surface">
                    <EmptyState
                      icon={TicketIcon}
                      title="歌單是空的"
                      description={songs.length ? "加入樂團的歌，再放上進場、串場與散場的畫面。" : "這個樂團還沒有歌。先回到樂團頁上傳歌曲。"}
                      action={
                        songs.length ? (
                          <Button variant="tinted" icon={MusicNotesPlusIcon} onClick={() => setAdding(true)}>
                            加入歌曲
                          </Button>
                        ) : (
                          <Button variant="tinted" href={`/?band=${encodeURIComponent(band.id)}`} transitionTypes={["pop"]}>
                            上傳歌曲
                          </Button>
                        )
                      }
                    />
                  </div>
                ) : (
                  <MotionConfig reducedMotion="user">
                    <Reorder.Group axis="y" as="ol" values={show.items} onReorder={(items) => setShow((s) => (s ? { ...s, items } : s))} className="rounded-lg bg-surface" aria-describedby="setlist-hint">
                      <AnimatePresence initial={false}>
                        {show.items.map((it, index) => {
                          const songNumber = it.kind === "song" ? songItems(show.items.slice(0, index + 1)).length : null;
                          const note = show.arc?.songs.find((n) => n.itemId === it.id);
                          return (
                            <SetlistRow
                              key={it.id}
                              item={it}
                              index={index}
                              count={show.items.length}
                              songNumber={songNumber}
                              song={it.kind === "song" ? songMap.get(it.projectId) : undefined}
                              arc={note}
                              busy={designing.has(it.id)}
                              disabled={running}
                              onMove={(to) => move(index, to)}
                              onRemove={() => setItems(show.items.filter((x) => x.id !== it.id))}
                              onEditLook={it.kind !== "song" ? () => setEditing(it) : undefined}
                              onApplyArc={note && it.kind === "song" ? () => void redesignOne(it.id).catch((err) => setArcError(err instanceof Error ? err.message : String(err))) : undefined}
                              onDragEnd={() => {
                                const s = showRef.current;
                                if (s) setItems(s.items);
                              }}
                            />
                          );
                        })}
                      </AnimatePresence>
                    </Reorder.Group>
                  </MotionConfig>
                )}
                <p id="setlist-hint" className="mt-1.5 px-(--row-pad-x) text-[12px] leading-4 text-label-2">
                  拖曳右側的把手調整順序；鍵盤可以聚焦把手後按上下鍵。變更會自動儲存。
                </p>
                <p className="sr-only" aria-live="polite">
                  {announce}
                </p>
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-(--group-gap)" aria-label="演出設定">
              <DetailsGroup show={show} onChange={(patch) => persist(patch, (s) => ({ ...s, ...(patch as Partial<Show>), date: patch.date === null ? undefined : (patch.date ?? s.date), venue: patch.venue === null ? undefined : (patch.venue ?? s.venue) }))} />
              <CanvasGroup
                show={show}
                songCount={new Set(songItems(show.items).map((s) => s.projectId)).size}
                busy={canvasBusy}
                note={canvasNote}
                onPreset={(presetId) => {
                  const p = OUTPUT_PRESETS.find((x) => x.id === presetId);
                  if (!p) return;
                  const output = { ...show.output, width: p.width, height: p.height, preset: p.id };
                  setCanvasNote(null);
                  persist({ output: { width: p.width, height: p.height, preset: p.id } }, (s) => ({ ...s, output }));
                }}
                onApply={() => setConfirmCanvas(true)}
              />
              <ArcPanel show={show} busy={arcWorking} error={arcProblem} running={running} onPlan={() => void planArc()} onApplyAll={() => void redesignAll()} />
              <NotesGroup value={show.notes} onChange={(notes) => persist({ notes }, (s) => ({ ...s, notes }))} />
              <div className="px-(--row-pad-x)">
                <Button variant="destructive" icon={TrashIcon} onClick={() => setConfirmDelete(true)}>
                  刪除這場演出
                </Button>
              </div>
            </aside>
          </div>
        )}
      </main>

      {show && band && (
        <>
          <LookSheet
            item={editing}
            band={band}
            output={show.output}
            showId={show.id}
            onClose={() => setEditing(null)}
            onSave={(item) => {
              setItems(show.items.map((x) => (x.id === item.id ? item : x)));
              setEditing(null);
            }}
          />
          <AddSongSheet open={adding} songs={songs} inSet={inSet} onClose={() => setAdding(false)} onAdd={(ids) => { addSongs(ids); setAdding(false); }} />
          <Alert
            open={confirmCanvas}
            title="套用到所有歌曲？"
            message={`歌單裡每首歌的輸出畫面都會改成 ${show.output.width} × ${show.output.height}（${aspectLabel(show.output.width, show.output.height)}），包括歌詞安全區。`}
            confirmLabel="套用"
            onConfirm={() => void applyCanvas()}
            onCancel={() => setConfirmCanvas(false)}
          />
          <Alert
            open={confirmDelete}
            title={`刪除「${show.name}」？`}
            message="只會刪除這份歌單與它的弧線，歌曲本身不受影響。"
            confirmLabel="刪除"
            destructive
            onConfirm={async () => {
              await api.deleteShow(show.id).catch(() => {});
              window.location.assign(bandHref(band.id));
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="truncate text-[12px] leading-4 text-label-2">{label}</dt>
      <dd className="truncate text-[20px] leading-7 font-semibold text-label tabular">{children}</dd>
    </div>
  );
}

function ArcRunBanner({ run, onCancel, onDismiss }: { run: ArcRun; onCancel: () => void; onDismiss: () => void }) {
  const active = run.current != null;
  return (
    <motion.div initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="mt-6 rounded-lg bg-surface px-4 py-3.5" role="status">
      <div className="flex items-center gap-3">
        {active ? <Spinner size={20} /> : run.error ? null : <CheckCircleIcon size={20} weight="fill" className="text-green" />}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5 font-semibold text-label">{active ? `依弧線重新設計〈${run.current}〉…` : run.cancelled ? "已停止重新設計" : "整場依弧線重新設計完成"}</p>
          <p className="text-[13px] leading-5 text-label-2 tabular">
            {run.done}／{run.total} 首{run.error ? `，${run.error}` : ""}
          </p>
        </div>
        {active ? (
          <Button variant="gray" onClick={onCancel}>
            停止
          </Button>
        ) : (
          <Button variant="plain" onClick={onDismiss}>
            好
          </Button>
        )}
      </div>
      {active && <ProgressBar className="mt-3" value={run.total ? run.done / run.total : 0} aria-label="重新設計進度" />}
    </motion.div>
  );
}

function DetailsGroup({ show, onChange }: { show: Show; onChange: (patch: ShowPatch) => void }) {
  const ids = { name: useId(), date: useId(), venue: useId() };
  const [name, setName] = useState(show.name);
  const [venue, setVenue] = useState(show.venue ?? "");
  return (
    <InsetGroup header="演出資訊" headerLevel={2}>
      <FormRow label="名稱" htmlFor={ids.name} labelWidth={56}>
        <input
          id={ids.name}
          value={name}
          maxLength={80}
          className={rowInputClass}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== show.name) onChange({ name: name.trim() });
            else setName(show.name);
          }}
        />
      </FormRow>
      <FormRow label="日期" htmlFor={ids.date} labelWidth={56}>
        <input id={ids.date} type="date" value={show.date ?? ""} className={rowInputClass} onChange={(e) => onChange({ date: e.target.value || null })} />
      </FormRow>
      <FormRow label="場地" htmlFor={ids.venue} labelWidth={56}>
        <input
          id={ids.venue}
          value={venue}
          maxLength={80}
          placeholder="選填"
          className={rowInputClass}
          onChange={(e) => setVenue(e.target.value)}
          onBlur={() => {
            if (venue.trim() !== (show.venue ?? "")) onChange({ venue: venue.trim() || null });
          }}
        />
      </FormRow>
    </InsetGroup>
  );
}

function CanvasGroup({ show, songCount, busy, note, onPreset, onApply }: { show: Show; songCount: number; busy: boolean; note: string | null; onPreset: (id: string) => void; onApply: () => void }) {
  const selectId = useId();
  const o = show.output;
  const known = OUTPUT_PRESETS.some((p) => p.id === o.preset);
  return (
    <InsetGroup header="輸出畫面" headerLevel={2} footer={note ?? "這個場地的 LED 或投影尺寸。套用後，歌單裡每首歌的控制台、投影與匯出都用這個畫面。"}>
      <ListRow
        title={<label htmlFor={selectId}>畫面尺寸</label>}
        accessory={
          <Select id={selectId} value={known ? o.preset : "custom"} onChange={(e) => onPreset(e.target.value)} className="w-40">
            {OUTPUT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {!known && <option value="custom">自訂</option>}
          </Select>
        }
      />
      <div className="flex items-center justify-between gap-3 px-(--row-pad-x) py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-8 w-16 shrink-0 items-center justify-center">
            <span className="block max-h-full max-w-full rounded-[3px] border-[1.5px] border-label-2 bg-tint-soft" style={{ aspectRatio: `${o.width} / ${o.height}`, width: o.width >= o.height * 2 ? "100%" : undefined, height: o.width >= o.height * 2 ? undefined : "100%" }} />
          </span>
          <span className="truncate text-[13px] leading-5 text-label-2 tabular">
            {o.width} × {o.height}，{aspectLabel(o.width, o.height)}
          </span>
        </div>
        <Button variant="gray" size="sm" onClick={onApply} loading={busy} disabled={songCount === 0}>
          套用到所有歌曲
        </Button>
      </div>
    </InsetGroup>
  );
}

function ArcPanel({ show, busy, error, running, onPlan, onApplyAll }: { show: Show; busy: boolean; error: string | null; running: boolean; onPlan: () => void; onApplyAll: () => void }) {
  const arc = show.arc;
  const hasSongs = show.items.some((i) => i.kind === "song");
  const applied = arc?.songs.filter((s) => s.appliedAt).length ?? 0;
  return (
    <section aria-labelledby="arc-title" className="min-w-0">
      <h2 id="arc-title" className="mb-1.5 px-(--row-pad-x) text-[13px] leading-5 text-label-2">
        整場弧線
      </h2>
      <div className="overflow-hidden rounded-lg bg-surface">
        {error && <p className="px-4 pt-3 text-[13px] leading-5 text-red-text" role="alert">{error}</p>}
        {!arc ? (
          <div className="px-4 py-4">
            <p className="text-[15px] leading-[22px] text-label">一場 40 分鐘的演出要有起伏，而不是十二個高潮。</p>
            <p className="mt-1 text-[13px] leading-5 text-label-2">設計師會依歌單順序與每首歌的能量，排出開場、推進、喘息、高峰與壓軸，並把最大的畫面留到最後。</p>
            <Button className="mt-3" variant="tinted" icon={ChartLineUpIcon} onClick={onPlan} loading={busy} disabled={busy || !hasSongs}>
              規劃整場弧線
            </Button>
          </div>
        ) : (
          <>
            <ArcChart show={show} />
            <div className="px-4 pt-3 pb-4">
              <Markdown className="text-[13px]! leading-5! [&_h2]:mt-3! [&_h2]:text-[13px]! [&>*:first-child]:mt-0">{arc.overview}</Markdown>
              <p className="mt-2 text-[12px] leading-4 text-label-2">
                {arc.engine === "claude" ? `Claude${arc.model ? `（${arc.model}）` : ""}規劃` : "離線設計師規劃"}，已依弧線設計 {applied}／{arc.songs.length} 首
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="filled" icon={SparkleIcon} onClick={onApplyAll} disabled={running || busy || arc.songs.length === 0}>
                  依弧線重新設計全部
                </Button>
              </div>
              <p className="mt-2 text-[12px] leading-4 text-label-2">也可以在歌單每首歌的 ⋯ 選單逐首重新設計。</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** The arc as a small energy line across the set (one dot per song), in the tint colour. */
function ArcChart({ show }: { show: Show }) {
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const notes = show.arc?.songs ?? [];
  if (notes.length < 2) return null;
  const W = 320;
  const H = 104;
  const padX = 24;
  const top = 14;
  const bottom = 30;
  const x = (i: number) => padX + (i / (notes.length - 1)) * (W - padX * 2);
  const y = (e: number) => top + (1 - e) * (H - top - bottom);
  const d = notes.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n.energy).toFixed(1)}`).join(" ");
  const area = `${d} L${x(notes.length - 1).toFixed(1)} ${H - bottom} L${x(0).toFixed(1)} ${H - bottom} Z`;
  return (
    <figure className="px-2 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`整場能量：${notes.map((n, i) => `第 ${i + 1} 首 ${ARC_ROLE_INFO[n.role].label} ${Math.round(n.energy * 100)}%`).join("、")}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--tint)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--tint)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} x2={W - padX} y1={H - bottom} y2={H - bottom} stroke="var(--separator)" strokeWidth="1" />
        <path d={area} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke="var(--tint)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {notes.map((n, i) => (
          <g key={n.itemId}>
            <circle cx={x(i)} cy={y(n.energy)} r={n.role === "finale" || n.role === "peak" ? 4.5 : 3.2} fill={n.role === "breather" ? "var(--surface)" : "var(--tint)"} stroke="var(--tint)" strokeWidth="1.5" />
            <text x={x(i)} y={H - bottom + 14} textAnchor="middle" fontSize="11" fill="var(--label-2)" className="tabular">
              {i + 1}
            </text>
            {(n.role === "finale" || n.role === "peak" || n.role === "breather" || notes.length <= 6) && (
              <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--label-2)">
                {ARC_ROLE_INFO[n.role].label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

function NotesGroup({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fid = useId();
  const [text, setText] = useState(value);
  return (
    <InsetGroup header={<label htmlFor={fid}>備註</label>} headerLevel={2}>
      <TextArea
        id={fid}
        rows={4}
        value={text}
        placeholder="給操作員的備註：換場時間、MC 的位置、突發狀況的備案…"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) onChange(text);
        }}
        className="rounded-none! bg-transparent! px-(--row-pad-x)! py-3! hover:bg-transparent!"
      />
    </InsetGroup>
  );
}

function AddSongSheet({ open, songs, inSet, onClose, onAdd }: { open: boolean; songs: ProjectSummary[]; inSet: Set<string>; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked([]);
  }
  const toggle = (pid: string) => setPicked((p) => (p.includes(pid) ? p.filter((x) => x !== pid) : [...p, pid]));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="加入歌曲"
      width={560}
      action={
        <Button variant="filled" disabled={!picked.length} onClick={() => onAdd(picked)}>
          {picked.length ? `加入 ${picked.length} 首` : "加入"}
        </Button>
      }
    >
      <div className="px-5 pt-2 pb-6">
        <p className="mb-3 text-[13px] leading-5 text-label-2">依點選的順序加入歌單。同一首歌可以出現不只一次（例如安可）。</p>
        <InsetGroup>
          {songs.map((p) => {
            const order = picked.indexOf(p.id);
            const status = songStatus(p);
            return (
              <ListRow
                key={p.id}
                leading={<ProjectArt id={p.id} palette={validPalette(p.palette)} placeholderIconSize={14} className="size-8 rounded-[7px]" />}
                title={p.title}
                subtitle={[p.duration > 0 ? formatTimeShort(p.duration) : null, inSet.has(p.id) ? "已在歌單中" : null, status !== "ready" ? SONG_STATUS_INFO[status].label : null].filter(Boolean).join("，") || undefined}
                accessory={
                  order >= 0 ? (
                    <span className="flex size-6 items-center justify-center rounded-full bg-tint-fill text-[12px] leading-none font-semibold text-on-tint tabular">{order + 1}</span>
                  ) : undefined
                }
                onClick={() => toggle(p.id)}
                aria-selected={order >= 0}
              />
            );
          })}
        </InsetGroup>
      </div>
    </Sheet>
  );
}

