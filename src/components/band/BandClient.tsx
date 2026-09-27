"use client";

// 樂團 page /b/[id]: the band's world in one place. Its visual bible (read-only summary, 「從作品
// 產生視覺聖經」 and a link to the editor), its shows (演出, the setlists), its songs (作品) and the
// shared material every song and show can use (樂團素材).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AssetLibrary } from "@/components/assets/AssetLibrary";
import { BandArt, bandHref } from "@/components/home/BandShelf";
import { ProjectArt, validPalette } from "@/components/home/ProjectArt";
import { PUSH } from "@/components/home/transitions";
import { processHref } from "@/components/process/steps";
import { Alert, AppHeader, Banner, Button, EmptyState, InsetGroup, ListRow, Menu, MenuItem, MenuSeparator, Sheet, Skeleton, SkeletonGroup, Spinner, Tag, TextField, cx, pageContainerClass } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { BookOpenIcon, DotsThreeIcon, MusicNotesPlusIcon, PencilSimpleIcon, PlusIcon, SparkleIcon, TicketIcon, TrashIcon, UploadSimpleIcon, UsersThreeIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { LYRIC_POLICY_INFO, bibleHasContent } from "@/lib/band";
import { SONG_STATUS_INFO, songStatus } from "@/lib/show";
import { formatTimeShort } from "@/lib/timeline";
import type { Band, ProjectSummary, ShowSummary } from "@/lib/types";
import { FontSpecimen, PaletteDots, SceneTags, TreatmentTags, bibleSourceLabel } from "./BibleParts";

export const bibleHref = (id: string) => `/b/${encodeURIComponent(id)}/bible`;
export const showHref = (id: string) => `/s/${encodeURIComponent(id)}`;

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ok"; band: Band; songs: ProjectSummary[]; others: ProjectSummary[]; shows: ShowSummary[] };

function SectionHeader({ id, title, count, actions, description }: { id: string; title: string; count?: number; actions?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-title-2 text-label">
          {title}
          {count != null && count > 0 && <span className="ml-2 font-normal text-label-2 tabular">{count}</span>}
        </h2>
        {description && <p className="mt-0.5 text-[15px] leading-[22px] text-label-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

function showSubtitle(s: ShowSummary): string {
  const parts = [s.date, s.venue].filter(Boolean) as string[];
  parts.push(s.songCount ? `${s.songCount} 首歌` : "還沒有歌");
  return parts.join("，");
}

export function BandClient({ id, initialName }: { id: string; initialName?: string }) {
  const router = useRouter();
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [generating, setGenerating] = useState(false);
  const [genLogs, setGenLogs] = useState<string[] | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [newShow, setNewShow] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const pickerRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const [band, projects, shows] = await Promise.all([api.getBand(id), api.listProjects(), api.listShows(id)]);
      setState({ kind: "ok", band, songs: projects.filter((p) => p.bandId === id), others: projects.filter((p) => !p.bandId), shows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState(/找不到/.test(message) ? { kind: "missing" } : { kind: "error", message });
    }
  }, [id]);

  useEffect(() => {
    // the first load runs after mount (no synchronous state update in the effect body)
    const t = setTimeout(() => void load(), 0);
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const band = state.kind === "ok" ? state.band : null;
  const designed = state.kind === "ok" ? state.songs.filter((s) => s.hasPlan).length : 0;

  const generate = async () => {
    setConfirmGenerate(false);
    setGenerating(true);
    setGenError(null);
    setGenLogs(null);
    try {
      const res = await api.generateBible(id);
      setState((s) => (s.kind === "ok" ? { ...s, band: res.band } : s));
      setGenLogs(res.logs);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const askGenerate = () => {
    if (band && bibleHasContent(band.bible)) setConfirmGenerate(true);
    else void generate();
  };

  const deleteBand = async () => {
    setDeleteBusy(true);
    try {
      await api.deleteBand(id);
      router.push("/", { transitionTypes: ["pop"] });
    } catch {
      setDeleteBusy(false);
      setDeleting(false);
    }
  };

  const title = band?.name ?? initialName ?? "樂團";

  return (
    <div className="min-h-dvh">
      <AppHeader
        back
        title={title}
        subtitle="樂團"
        actions={
          band && (
            <Menu label="樂團的更多動作" placement="bottom-end" trigger={(t) => <Button {...t} variant="quiet" size="icon" icon={<DotsThreeIcon size={20} weight="bold" />} aria-label="樂團的更多動作" />}>
              <MenuItem icon={PencilSimpleIcon} onSelect={() => setRenaming(true)}>
                重新命名…
              </MenuItem>
              <MenuItem icon={BookOpenIcon} href={bibleHref(id)} transitionTypes={PUSH}>
                編輯視覺聖經
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={TrashIcon} destructive onSelect={() => setDeleting(true)}>
                刪除樂團…
              </MenuItem>
            </Menu>
          )
        }
      />
      <main className={cx(pageContainerClass, "pb-32")}>
        {state.kind === "loading" && (
          <SkeletonGroup label="載入樂團" className="pt-10">
            <div className="flex items-center gap-6">
              <Skeleton className="size-28 rounded-full!" />
              <div className="flex-1">
                <Skeleton className="h-9 w-64 rounded-xs!" />
                <Skeleton className="mt-3 h-4 w-40 rounded-xs!" />
              </div>
            </div>
            <Skeleton className="mt-12 h-64 rounded-2xl!" />
          </SkeletonGroup>
        )}
        {state.kind === "missing" && (
          <EmptyState icon={UsersThreeIcon} title="找不到這個樂團" description="它可能已被刪除。" action={<Button href="/" variant="tinted" transitionTypes={["pop"]}>回到作品庫</Button>} className="pt-24" />
        )}
        {state.kind === "error" && <Banner className="mt-10" tone="error" title="無法載入樂團" description={state.message} actions={<Button onClick={() => void load()}>重試</Button>} />}

        {state.kind === "ok" && band && (
          <>
            <header className="flex min-w-0 flex-wrap items-center gap-x-7 gap-y-4 pt-10">
              <BandArt id={band.id} palette={band.bible.palette.map((c) => c.hex)} className="size-28 shrink-0 rounded-full shadow-lift" iconSize={48} />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-large-title text-label">{band.name}</h1>
                <p className="mt-1 text-[15px] leading-[22px] text-label-2 tabular">
                  {[`${state.songs.length} 首歌`, `${state.shows.length} 場演出`, `${band.assets.length} 個樂團素材`].join("・")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="gray" icon={MusicNotesPlusIcon} href={`/?band=${encodeURIComponent(band.id)}`} transitionTypes={["pop"]}>
                  加入新歌
                </Button>
                <Button variant="filled" icon={TicketIcon} onClick={() => setNewShow(true)}>
                  新增演出
                </Button>
              </div>
            </header>

            <BibleSection
              band={band}
              designed={designed}
              songCount={state.songs.length}
              generating={generating}
              logs={genLogs}
              error={genError}
              onGenerate={askGenerate}
              onDismissLogs={() => setGenLogs(null)}
            />

            <section aria-labelledby="shows-title" className="mt-16">
              <SectionHeader
                id="shows-title"
                title="演出"
                count={state.shows.length}
                description="每一場演出是一份歌單：進場、歌曲、串場、散場，和整場的視覺弧線。"
                actions={
                  <Button variant="plain" icon={PlusIcon} onClick={() => setNewShow(true)}>
                    新增演出
                  </Button>
                }
              />
              {state.shows.length ? (
                <InsetGroup>
                  {state.shows.map((s) => (
                    <ListRow key={s.id} leading={TicketIcon} leadingTile="var(--tint-fill)" title={s.name} subtitle={showSubtitle(s)} accessory="disclosure" href={showHref(s.id)} />
                  ))}
                </InsetGroup>
              ) : (
                <div className="rounded-lg bg-surface">
                  <EmptyState
                    icon={TicketIcon}
                    title="還沒有演出"
                    description="建立一場演出，把歌排成歌單，讓設計師規劃整場的能量與配色弧線。"
                    action={
                      <Button variant="tinted" onClick={() => setNewShow(true)}>
                        新增演出
                      </Button>
                    }
                  />
                </div>
              )}
            </section>

            <section aria-labelledby="songs-title" className="mt-16">
              <SectionHeader
                id="songs-title"
                title="作品"
                count={state.songs.length}
                description="這些歌都在樂團的視覺聖經裡設計，也能使用樂團素材。"
                actions={
                  <>
                    {state.others.length > 0 && (
                      <Button variant="plain" icon={PlusIcon} onClick={() => setAdding(true)}>
                        從作品庫加入
                      </Button>
                    )}
                  </>
                }
              />
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">
                {state.songs.map((p) => (
                  <SongCard key={p.id} project={p} />
                ))}
                <li className="min-w-0">
                  <Link
                    href={`/?band=${encodeURIComponent(band.id)}`}
                    transitionTypes={["pop"]}
                    className="press-tile flex aspect-[16/10] w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-fill-4 text-label-2 hover:bg-fill-3"
                  >
                    <MusicNotesPlusIcon size={28} className="text-tint" />
                    <span className="text-[13px] leading-5 font-medium text-tint-text">上傳新歌</span>
                  </Link>
                </li>
              </ul>
            </section>

            <section className="mt-16" aria-labelledby="band-assets-title">
              <SectionHeader
                id="band-assets-title"
                title="樂團素材"
                count={band.assets.length}
                description="logo、專輯封面、照片與 MV 片段。樂團的每首歌與演出畫面都能使用。"
                actions={
                  <Button variant="plain" icon={UploadSimpleIcon} onClick={() => pickerRef.current?.()}>
                    加入素材
                  </Button>
                }
              />
              <AssetLibrary
                owner={{ kind: "band", id: band.id }}
                assets={band.assets}
                heading="none"
                headingId="band-assets-title"
                pickerRef={pickerRef}
                onChange={(assets) => setState((s) => (s.kind === "ok" ? { ...s, band: { ...s.band, assets } } : s))}
              />
            </section>
          </>
        )}
      </main>

      <Alert
        open={confirmGenerate}
        title="重新產生視覺聖經？"
        message={`設計師會重新閱讀 ${designed} 首歌的設計與研究，取代目前的視覺聖經（包括你手動改過的內容）。`}
        confirmLabel="重新產生"
        onConfirm={() => void generate()}
        onCancel={() => setConfirmGenerate(false)}
      />
      <Alert
        open={deleting}
        title={`刪除「${band?.name ?? ""}」？`}
        message="視覺聖經、樂團素材與所有演出清單都會刪除，無法復原。旗下的歌會保留在作品庫，不再屬於任何樂團。"
        confirmLabel="刪除"
        destructive
        busy={deleteBusy}
        onConfirm={() => void deleteBand()}
        onCancel={() => setDeleting(false)}
      />
      <NewShowSheet bandId={id} open={newShow} onClose={() => setNewShow(false)} />
      {band && (
        <RenameSheet
          open={renaming}
          name={band.name}
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            const saved = await api.updateBand(id, { name });
            setState((s) => (s.kind === "ok" ? { ...s, band: saved } : s));
          }}
        />
      )}
      {state.kind === "ok" && (
        <AddSongsSheet
          open={adding}
          candidates={state.others}
          onClose={() => setAdding(false)}
          onAdd={async (ids) => {
            for (const pid of ids) await api.updateProject(pid, { bandId: id });
            await load();
          }}
        />
      )}
    </div>
  );
}

function SongCard({ project: p }: { project: ProjectSummary }) {
  const status = songStatus(p);
  const info = SONG_STATUS_INFO[status];
  const href = p.status === "ready" ? `/p/${encodeURIComponent(p.id)}` : processHref(p.id, p.status === "new" ? { run: true } : undefined);
  return (
    <li className="min-w-0">
      <Link href={href} transitionTypes={PUSH} className="group/song block min-w-0 rounded-xl outline-offset-4">
        <span className="block rounded-xl transition-[transform,box-shadow] duration-200 ease-out group-hover/song:scale-[1.02] group-hover/song:shadow-lift group-active/song:scale-[.98] motion-reduce:group-hover/song:scale-100">
          <ProjectArt id={p.id} palette={validPalette(p.palette)} className="aspect-[16/10] rounded-xl" />
        </span>
        <span className="mt-3 block truncate text-[17px] leading-6 font-semibold text-label">{p.title}</span>
        <span className="flex min-w-0 items-center gap-2 text-[12px] leading-[18px] text-label-2">
          {p.duration > 0 && <span className="tabular">{formatTimeShort(p.duration)}</span>}
          {status === "processing" ? (
            <span className="flex items-center gap-1">
              <Spinner size={14} />
              處理中…
            </span>
          ) : status !== "ready" ? (
            <Tag tone={info.tone === "red" ? "red" : "orange"}>{info.label}</Tag>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function BibleSection({
  band,
  designed,
  songCount,
  generating,
  logs,
  error,
  onGenerate,
  onDismissLogs,
}: {
  band: Band;
  designed: number;
  songCount: number;
  generating: boolean;
  logs: string[] | null;
  error: string | null;
  onGenerate: () => void;
  onDismissLogs: () => void;
}) {
  const b = band.bible;
  const has = bibleHasContent(b);
  const source = bibleSourceLabel(b);
  const generateLabel = has ? "從作品重新產生" : "從作品產生視覺聖經";
  return (
    <section aria-labelledby="bible-title" className="mt-14">
      <SectionHeader
        id="bible-title"
        title="視覺聖經"
        description="樂團的世界觀、配色、字體與禁忌。每首歌的研究與設計都會遵守它。"
        actions={
          has && (
            <>
              <Button variant="plain" icon={SparkleIcon} onClick={onGenerate} loading={generating} disabled={generating}>
                {generateLabel}
              </Button>
              <Button variant="gray" icon={PencilSimpleIcon} href={bibleHref(band.id)} transitionTypes={PUSH}>
                編輯
              </Button>
            </>
          )
        }
      />

      {generating && (
        <Banner
          className="mb-4"
          icon={<Spinner size={20} />}
          title="設計師正在整理視覺聖經…"
          description={designed ? `閱讀 ${designed} 首歌的主視覺、配色、場景與研究簡報，找出樂團的共同語言。` : "還沒有設計好的歌，會先依樂團素材寫一份初稿。"}
        />
      )}
      {error && <Banner className="mb-4" tone="error" title="無法產生視覺聖經" description={error} actions={<Button onClick={onGenerate}>重試</Button>} />}
      {logs && !generating && (
        <Banner
          className="mb-4"
          tone="success"
          title="視覺聖經已更新"
          description={logs[logs.length - 1] ?? "可以再依樂團的想法修改。"}
          actions={
            <>
              <Button variant="plain" onClick={onDismissLogs}>
                好
              </Button>
              <Button variant="gray" href={bibleHref(band.id)} transitionTypes={PUSH}>
                檢查並修改
              </Button>
            </>
          }
        />
      )}

      {!has ? (
        <div className="rounded-2xl bg-surface">
          <EmptyState
            icon={BookOpenIcon}
            title="還沒有視覺聖經"
            description={
              designed
                ? `設計師可以從 ${designed} 首已設計的歌整理出樂團共用的配色、字體、場景與禁忌；也可以自己寫。`
                : songCount
                  ? "樂團的歌還沒有設計完成。可以先自己寫下世界觀，或等歌設計好後再從作品產生。"
                  : "先寫下樂團的世界觀、氣質與禁忌，之後每首歌都會在這個世界裡設計。"
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant={designed ? "filled" : "tinted"} icon={SparkleIcon} onClick={onGenerate} loading={generating} disabled={generating}>
                  從作品產生視覺聖經
                </Button>
                <Button variant="gray" icon={PencilSimpleIcon} href={bibleHref(band.id)} transitionTypes={PUSH}>
                  自己寫
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 rounded-2xl bg-surface p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10 lg:p-8">
          <div className="min-w-0">
            {b.palette.length > 0 && <PaletteDots palette={b.palette} />}
            {b.summary && <Markdown className="mt-5 [&>*:first-child]:mt-0">{b.summary}</Markdown>}
            {source && <p className="mt-4 text-[12px] leading-4 text-label-2">{source}</p>}
          </div>
          <dl className="grid min-w-0 content-start gap-5">
            <div>
              <dt className="mb-1.5 text-[13px] leading-5 text-label-2">字體</dt>
              <dd>
                <FontSpecimen cjkFont={b.fonts.cjkFont} latinFont={b.fonts.latinFont} weight={b.fonts.weight} sample={band.name.length <= 12 ? band.name : "舞台上的每一句歌詞"} />
              </dd>
            </div>
            <div>
              <dt className="mb-1.5 text-[13px] leading-5 text-label-2">偏好場景</dt>
              <dd>
                <SceneTags scenes={b.sceneAffinity} tone="tint" empty="沒有特別偏好" />
              </dd>
            </div>
            <div>
              <dt className="mb-1.5 text-[13px] leading-5 text-label-2">避免場景</dt>
              <dd>
                <SceneTags scenes={b.sceneAvoid} tone="red" empty="沒有" />
              </dd>
            </div>
            <div>
              <dt className="mb-1.5 text-[13px] leading-5 text-label-2">素材處理</dt>
              <dd>
                <TreatmentTags treatments={b.treatments} empty="依每首歌決定" />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-[13px] leading-5 text-label-2">歌詞政策</dt>
              <dd className="text-[15px] leading-[22px] text-label">
                {LYRIC_POLICY_INFO[b.lyricPolicy.mode].label}
                {b.lyricPolicy.note && <span className="block text-[13px] leading-5 text-label-2">{b.lyricPolicy.note}</span>}
              </dd>
            </div>
            {(b.dos.length > 0 || b.donts.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {b.dos.length > 0 && (
                  <div>
                    <dt className="mb-1 text-[13px] leading-5 text-label-2">要</dt>
                    <dd>
                      <ul className="list-disc space-y-0.5 pl-4 text-[13px] leading-5 text-label marker:text-label-2">
                        {b.dos.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {b.donts.length > 0 && (
                  <div>
                    <dt className="mb-1 text-[13px] leading-5 text-label-2">不要</dt>
                    <dd>
                      <ul className="list-disc space-y-0.5 pl-4 text-[13px] leading-5 text-label marker:text-label-2">
                        {b.donts.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

export function NewShowSheet({ bandId, open, onClose }: { bandId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), date: useId(), venue: useId() };
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setDate("");
      setVenue("");
      setError(null);
      setBusy(false);
    }
  }
  const create = async () => {
    if (!name.trim()) {
      setError("請填寫演出名稱。");
      return;
    }
    setBusy(true);
    try {
      const show = await api.createShow({ bandId, name: name.trim(), date: date || undefined, venue: venue.trim() || undefined });
      router.push(showHref(show.id), { transitionTypes: PUSH });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="新增演出"
      width={480}
      dismissible={!busy}
      action={
        <Button variant="filled" onClick={() => void create()} loading={busy}>
          建立
        </Button>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4 px-5 pt-2 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="flex flex-col gap-1.5" htmlFor={ids.name}>
          <span className="text-[13px] leading-5 text-label-2">演出名稱</span>
          <TextField id={ids.name} size="lg" autoFocus value={name} maxLength={80} placeholder="例如：秋季巡演台北場" invalid={!!error} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5" htmlFor={ids.date}>
            <span className="text-[13px] leading-5 text-label-2">日期</span>
            <TextField id={ids.date} size="lg" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5" htmlFor={ids.venue}>
            <span className="text-[13px] leading-5 text-label-2">場地</span>
            <TextField id={ids.venue} size="lg" value={venue} maxLength={80} placeholder="選填" onChange={(e) => setVenue(e.target.value)} />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-[13px] leading-5 text-red-text">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function RenameSheet({ open, name, onClose, onSave }: { open: boolean; name: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(name);
      setError(null);
      setBusy(false);
    }
  }
  const save = async () => {
    if (!value.trim()) return setError("樂團名稱不能是空的。");
    setBusy(true);
    try {
      await onSave(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="重新命名" width={480} dismissible={!busy} action={<Button variant="filled" onClick={() => void save()} loading={busy}>完成</Button>}>
      <form
        className="flex flex-col gap-1.5 px-5 pt-2 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={fieldId} className="text-[13px] leading-5 text-label-2">
          樂團名稱
        </label>
        <TextField id={fieldId} size="lg" autoFocus value={value} maxLength={80} invalid={!!error} onChange={(e) => setValue(e.target.value)} />
        {error && (
          <p role="alert" className="text-[12px] leading-4 text-red-text">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function AddSongsSheet({ open, candidates, onClose, onAdd }: { open: boolean; candidates: ProjectSummary[]; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(new Set());
      setBusy(false);
    }
  }
  const sorted = useMemo(() => [...candidates].sort((a, b) => a.title.localeCompare(b.title, "zh-Hant")), [candidates]);
  const toggle = (pid: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="從作品庫加入"
      width={560}
      dismissible={!busy}
      action={
        <Button
          variant="filled"
          disabled={picked.size === 0}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd([...picked]);
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {picked.size ? `加入 ${picked.size} 首` : "加入"}
        </Button>
      }
    >
      <div className="px-5 pt-2 pb-6">
        <p className="mb-3 text-[13px] leading-5 text-label-2">這些歌還不屬於任何樂團。加入後，重新設計時會遵守這個樂團的視覺聖經。</p>
        <InsetGroup>
          {sorted.map((p) => (
            <ListRow
              key={p.id}
              leading={<ProjectArt id={p.id} palette={validPalette(p.palette)} placeholderIconSize={14} className="size-8 rounded-[7px]" />}
              title={p.title}
              subtitle={[p.artist, p.duration > 0 ? formatTimeShort(p.duration) : null].filter(Boolean).join("，") || undefined}
              accessory={picked.has(p.id) ? "check" : undefined}
              onClick={() => toggle(p.id)}
              aria-selected={picked.has(p.id)}
            />
          ))}
        </InsetGroup>
      </div>
    </Sheet>
  );
}

export { bandHref };
