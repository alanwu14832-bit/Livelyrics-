"use client";

// 指定樂團: move a song into a band (or out of any band) from its card menu. A song in a band is
// designed inside that band's visual bible and can use the band's shared material; leaving a
// band clears the sections that showed the old band's material.

import { useEffect, useState } from "react";
import { Button, InsetGroup, ListRow, Sheet, Spinner } from "@/components/ui";
import { api } from "@/lib/api-client";
import type { BandSummary } from "@/lib/types";
import { BANDS_CHANGED, BandArt } from "./BandShelf";

export function AssignBandSheet({
  open,
  songTitle,
  projectId,
  currentBandId,
  onClose,
  onAssigned,
}: {
  open: boolean;
  songTitle: string;
  projectId: string | null;
  currentBandId?: string;
  onClose: () => void;
  onAssigned: (bandId: string | null) => void;
}) {
  const [bands, setBands] = useState<BandSummary[] | null>(null);
  const [choice, setChoice] = useState<string | null>(currentBandId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoice(currentBandId ?? null);
      setError(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .listBands()
      .then((list) => alive && setBands(list))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [open]);

  const save = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateProject(projectId, { bandId: choice });
      onAssigned(choice);
      // the band shelf above the library shows song counts
      window.dispatchEvent(new Event(BANDS_CHANGED));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const changed = (currentBandId ?? null) !== choice;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="指定樂團"
      width={480}
      dismissible={!busy}
      action={
        <Button variant="filled" onClick={() => void save()} loading={busy} disabled={!changed}>
          完成
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-5 pt-2 pb-6">
        <p className="text-[13px] leading-5 text-label-2">〈{songTitle}〉會在樂團的視覺聖經裡設計，也能用樂團共用的素材。</p>
        {bands == null && !error ? (
          <p className="flex items-center gap-2 text-[13px] leading-5 text-label-2">
            <Spinner size={16} />
            載入樂團…
          </p>
        ) : (
          <InsetGroup>
            {(bands ?? []).map((b) => (
              <ListRow
                key={b.id}
                leading={<BandArt id={b.id} palette={b.palette} className="size-7 rounded-full" iconSize={14} />}
                title={b.name}
                subtitle={`${b.songCount} 首歌`}
                accessory={choice === b.id ? "check" : undefined}
                onClick={() => setChoice(b.id)}
                aria-current={choice === b.id ? "true" : undefined}
              />
            ))}
            <ListRow title="不屬於任何樂團" accessory={choice == null ? "check" : undefined} onClick={() => setChoice(null)} />
          </InsetGroup>
        )}
        {bands?.length === 0 && <p className="text-[12px] leading-4 text-label-2">還沒有樂團。回到首頁的「樂團」建立一個。</p>}
        {error && (
          <p role="alert" className="text-[13px] leading-5 text-red-text">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
