"use client";

// 樂團 on the home page (Apple Music's artist row): round artwork from the band's bible palette,
// the name, and one quiet meta line (songs, shows). The last tile creates a band. Opening a band
// goes to /b/[id], where its visual bible, shows and songs live.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Banner, Button, Sheet, Skeleton, SkeletonGroup, TextField, cx } from "@/components/ui";
import { PlusIcon, UsersThreeIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import type { BandSummary } from "@/lib/types";
import { ProjectArt } from "./ProjectArt";
import { PUSH } from "./transitions";

type LoadState = { kind: "loading" } | { kind: "ok"; bands: BandSummary[] } | { kind: "error"; message: string };

export const bandHref = (id: string) => `/b/${encodeURIComponent(id)}`;

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7";

function bandMeta(b: BandSummary): string {
  const parts = [`${b.songCount} 首歌`];
  if (b.showCount) parts.push(`${b.showCount} 場演出`);
  return parts.join("・");
}

/** Round band artwork: the bible palette, or a quiet placeholder with the band icon. */
export function BandArt({ id, palette, className, iconSize = 40 }: { id: string; palette?: readonly string[]; className?: string; iconSize?: number }) {
  if (!palette?.length) {
    return (
      <div aria-hidden="true" className={cx("flex items-center justify-center bg-fill-3 text-label-3", className)}>
        <UsersThreeIcon size={iconSize} />
      </div>
    );
  }
  return <ProjectArt id={id} palette={palette} className={className} placeholderIconSize={0} />;
}

export function NewBandSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setError(null);
      setBusy(false);
    }
  }
  const create = async () => {
    if (!name.trim()) {
      setError("請填寫樂團名稱。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const band = await api.createBand(name.trim());
      onCreated?.(band.id);
      router.push(bandHref(band.id), { transitionTypes: PUSH });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="新樂團"
      width={480}
      dismissible={!busy}
      action={
        <Button variant="filled" onClick={() => void create()} loading={busy}>
          建立
        </Button>
      }
    >
      <form
        className="flex flex-col gap-2 px-5 pt-2 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor={fieldId} className="text-[13px] leading-5 text-label-2">
          樂團名稱
        </label>
        <TextField id={fieldId} size="lg" value={name} autoFocus maxLength={80} placeholder="例如：落日飛車" onChange={(e) => setName(e.target.value)} invalid={!!error} aria-describedby={`${fieldId}-hint`} />
        <p id={`${fieldId}-hint`} className={cx("text-[12px] leading-4", error ? "text-red-text" : "text-label-2")} role={error ? "alert" : undefined}>
          {error ?? "樂團有自己的視覺聖經、共用素材與演出清單，旗下每首歌都在同一個世界裡設計。"}
        </p>
      </form>
    </Sheet>
  );
}

export function BandShelf({ className }: { className?: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api
      .listBands()
      .then((bands) => setState({ kind: "ok", bands }))
      .catch((err: unknown) => setState((s) => (s.kind === "ok" ? s : { kind: "error", message: err instanceof Error ? err.message : String(err) })));
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  const bands = state.kind === "ok" ? state.bands : [];

  return (
    <section aria-labelledby="bands-title" className={className}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id="bands-title" className="text-title-1 text-label">
            樂團
            {bands.length > 0 && (
              <span className="ml-2.5 font-normal text-label-2 tabular">
                {bands.length}
                <span className="sr-only"> 個樂團</span>
              </span>
            )}
          </h2>
          <p className="mt-1 text-[15px] leading-[22px] text-label-2">一個樂團一本視覺聖經：整場演出的每首歌都活在同一個世界。</p>
        </div>
      </div>

      {state.kind === "loading" && (
        <SkeletonGroup label="載入樂團" className={GRID}>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col items-center">
              <Skeleton className="aspect-square w-full rounded-full!" />
              <Skeleton className="mt-3 h-4 w-2/3 rounded-xs!" />
            </div>
          ))}
        </SkeletonGroup>
      )}

      {state.kind === "error" && <Banner tone="error" title="無法載入樂團" description={state.message} actions={<Button onClick={load}>重試</Button>} />}

      {state.kind === "ok" && (
        <ul className={GRID} aria-label="樂團列表">
          {bands.map((b) => (
            <li key={b.id} className="min-w-0">
              <Link href={bandHref(b.id)} transitionTypes={PUSH} className="group/band flex min-w-0 flex-col items-center rounded-xl text-center outline-offset-4">
                <span className="block w-full rounded-full transition-[transform,box-shadow] duration-200 ease-out group-hover/band:scale-[1.02] group-hover/band:shadow-lift group-active/band:scale-[.98] group-active/band:duration-(--dur-press) motion-reduce:transition-[box-shadow] motion-reduce:group-hover/band:scale-100">
                  <BandArt id={b.id} palette={b.palette} className="aspect-square w-full rounded-full" />
                </span>
                <span className="mt-3 w-full truncate text-[17px] leading-6 font-semibold text-label" title={b.name}>
                  {b.name}
                </span>
                <span className="w-full truncate text-[12px] leading-[18px] text-label-2 tabular">{bandMeta(b)}</span>
              </Link>
            </li>
          ))}
          <li className="min-w-0">
            <button type="button" onClick={() => setCreating(true)} className="group/new flex w-full min-w-0 flex-col items-center rounded-xl text-center outline-offset-4">
              <span className="press-tile flex aspect-square w-full items-center justify-center rounded-full bg-fill-4 text-tint transition-[background-color] duration-(--dur-fast) ease-[ease] group-hover/new:bg-fill-3">
                <PlusIcon size={32} />
              </span>
              <span className="mt-3 w-full truncate text-[17px] leading-6 font-semibold text-tint-text">新樂團</span>
              <span className="w-full truncate text-[12px] leading-[18px] text-label-2">{bands.length ? "另一個樂團" : "從這裡開始"}</span>
            </button>
          </li>
        </ul>
      )}

      <NewBandSheet open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
