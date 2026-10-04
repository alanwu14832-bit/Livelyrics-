"use client";

// 研究找到的素材 (phase 8): the band's real material the research collected — the album / single
// cover (Cover Art Archive), official MV stills, key visual / poster, logo, live photos. Each card:
// the image, its kind, where it came from (a link), the colours measured on it, and the per-item
// choice 可以上台 / 只當參考 / 移除. Until the band's one-time acknowledgement that its material may be
// used (stored on the band, or on a band-less song) everything stays 只當參考 and 可以上台 is locked.
// Used on the design overview (full) and in the console's research tab (compact).

import { useEffect, useId, useState } from "react";
import { Alert, Button, SegmentedControl, cx } from "@/components/ui";
import { ArrowSquareOutIcon, ImagesIcon, ShieldCheckIcon, TrashIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { extractMoodStats } from "@/lib/moodboard";
import type { CollectedVisual, DesignPlan, MaterialAuthorization } from "@/lib/types";
import { AUTHORIZATION_NOTE, collectedSummary, VISUAL_FINDER_LABEL, VISUAL_KIND_LABEL } from "@/lib/visuals";

function hostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Colours of an image the server could not decode (WebP): measured here once, then saved. */
async function measureInBrowser(url: string): Promise<CollectedVisual["stats"] | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const w = 96;
  const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  try {
    return extractMoodStats(g.getImageData(0, 0, w, h).data);
  } catch {
    return null;
  }
}

function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  return (
    <span className="flex items-center gap-1" aria-label={`主色：${colors.join("、")}`}>
      {colors.slice(0, 5).map((c) => (
        <span key={c} className="size-3 rounded-full shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ background: c }} />
      ))}
    </span>
  );
}

function Thumb({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="absolute inset-0 flex items-center justify-center bg-fill-3 text-label-2">
        <WarningCircleIcon size={20} aria-label="無法顯示縮圖" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- stored file (cloud: redirect to Blob), no optimizer
  return <img src={url} crossOrigin="anonymous" alt={alt} decoding="async" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 size-full bg-fill-3 object-cover" />;
}

export interface CollectedVisualsProps {
  projectId: string;
  items: CollectedVisual[];
  /** the collection changed (a toggle clears sections that showed an item: `plan` is the server's) */
  onChange: (items: CollectedVisual[], plan?: DesignPlan | null) => void;
  /** the console's research tab: a narrower grid, no heading block */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export function CollectedVisuals({ projectId, items, onChange, compact = false, disabled = false, className }: CollectedVisualsProps) {
  const headingId = useId();
  const [authorization, setAuthorization] = useState<MaterialAuthorization | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CollectedVisual | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .listCollected(projectId)
      .then((r) => {
        if (live) setAuthorization(r.authorization);
      })
      .catch(() => {
        if (live) setAuthorization(null);
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  // colours for images the server could not measure (WebP): once per item, best effort
  useEffect(() => {
    const missing = items.filter((c) => !c.stats);
    if (!missing.length) return;
    let live = true;
    void (async () => {
      for (const item of missing) {
        const stats = await measureInBrowser(api.collectedUrl(projectId, item.id));
        if (!live || !stats) continue;
        try {
          const r = await api.updateCollected(projectId, item.id, { stats });
          if (live) onChange(r.items);
        } catch {
          /* the palette is a nicety */
        }
      }
    })();
    return () => {
      live = false;
    };
    // only when the set of unmeasured items changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, items.filter((c) => !c.stats).map((c) => c.id).join(",")]);

  if (!items.length) return null;
  const authorized = !!authorization;
  const summary = collectedSummary(items);

  const setUse = async (item: CollectedVisual, use: "stage" | "reference") => {
    if (use === item.use) return;
    if (use === "stage" && !authorized) {
      setAsking(true);
      return;
    }
    setBusy(item.id);
    setError(null);
    try {
      const r = await api.updateCollected(projectId, item.id, { use });
      onChange(r.items, r.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: CollectedVisual) => {
    setBusy(item.id);
    setError(null);
    try {
      const r = await api.deleteCollected(projectId, item.id);
      onChange(r.items, r.plan);
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const authorize = async () => {
    setBusy("authorize");
    setError(null);
    try {
      const r = await api.authorizeMaterial(projectId);
      setAuthorization(r.authorization);
      onChange(r.items, r.project.plan);
      setAsking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={headingId} className={cx("min-w-0", !compact && "rounded-lg bg-surface p-5", className)} data-testid="collected-visuals">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 id={headingId} className={cx("font-semibold text-label", compact ? "text-[13px] leading-5" : "text-[17px] leading-6")}>
          研究找到的素材
        </h2>
        {summary && <span className="text-[13px] leading-5 text-label-2">{summary.replace(/^找到/, "")}</span>}
      </div>
      {!compact && <p className="mt-1 text-[13px] leading-5 text-label-2">研究時從 Cover Art Archive、官方頁面與 MV 找到的樂團真實素材。設計會從它們取配色、母題與構圖；標「可以上台」的也能成為段落的素材。</p>}

      <div className={cx("mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2.5", authorized ? "bg-fill-4" : "bg-orange-soft")} data-testid="collected-authorization">
        {authorized ? (
          <>
            <ShieldCheckIcon size={16} className="shrink-0 text-label-2" />
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-label">樂團已授權使用自己的素材（{authorization!.at.slice(0, 10)} 確認）</span>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-label">
              {authorization === undefined ? "讀取授權狀態…" : "還沒確認樂團授權：素材先只當設計參考，不會上台。"}
            </span>
            <Button size="sm" variant="gray" onClick={() => setAsking(true)} disabled={disabled || authorization === undefined}>
              確認樂團授權…
            </Button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[13px] leading-5 text-red-text">
          {error}
        </p>
      )}

      {/* phone and the console's narrow tab: one row per item (picture beside its controls); wider: a grid of cards */}
      <ul className={cx("mt-3 grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3")}>
        {items.map((item) => {
          const source = item.provenance.sourceUrl ?? item.provenance.imageUrl;
          const kind = VISUAL_KIND_LABEL[item.provenance.kind];
          return (
            <li
              key={item.id}
              className={cx("flex min-w-0 overflow-hidden rounded-md bg-surface-2", compact ? "flex-row" : "max-sm:flex-row sm:flex-col")}
              data-testid="collected-card"
              data-kind={item.provenance.kind}
              data-use={item.use}
            >
              <span className={cx("relative block aspect-square shrink-0 overflow-hidden", compact ? "w-24 self-start" : "max-sm:w-28 max-sm:self-start sm:w-full")}>
                <Thumb url={api.collectedUrl(projectId, item.id)} alt={item.name} />
                <span className="absolute top-1.5 left-1.5 rounded-xs bg-black/65 px-1.5 py-0.5 text-[12px] leading-none font-semibold text-white">{kind}</span>
                {item.use === "stage" && <span className="absolute top-1.5 right-1.5 rounded-xs bg-black/65 px-1.5 py-0.5 text-[12px] leading-none font-medium text-white">上台</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2.5">
                <span className="line-clamp-2 text-[13px] leading-[18px] font-medium text-label">{item.name}</span>
                <Swatches colors={item.stats?.palette ?? []} />
                {!compact && item.provenance.why && <span className="line-clamp-2 text-[12px] leading-4 text-label-2">{item.provenance.why}</span>}
                <a href={source} target="_blank" rel="noreferrer noopener" className="focus-inset inline-flex min-w-0 items-center gap-1 text-[12px] leading-4 text-tint-text hover:underline">
                  <span className="truncate">
                    {VISUAL_FINDER_LABEL[item.provenance.foundBy]}・{hostname(source)}
                  </span>
                  <ArrowSquareOutIcon size={12} className="shrink-0" />
                </a>
                <span className="mt-auto flex min-w-0 flex-col gap-1.5 pt-1">
                  <SegmentedControl
                    label={`${item.name}的用途`}
                    value={item.use}
                    fullWidth
                    disabled={disabled || busy === item.id}
                    onChange={(v) => void setUse(item, v)}
                    options={[
                      { value: "stage", label: "可以上台" },
                      { value: "reference", label: "只當參考" },
                    ]}
                  />
                  <Button size="sm" variant="destructive" icon={TrashIcon} onClick={() => setConfirm(item)} disabled={disabled || busy === item.id} aria-label={`移除 ${item.name}`}>
                    移除
                  </Button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {!compact && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] leading-4 text-label-2">
          <ImagesIcon size={14} className="shrink-0" />
          重新研究會更新這裡：已有的素材保留你的選擇，移除的不會再加回來。
        </p>
      )}

      <Alert
        open={confirm != null}
        title="移除這個素材？"
        message={confirm ? `「${confirm.name}」會從設計參考與舞台上一起移除（用到它的段落會改回只用場景），重新研究也不會再把它加回來。` : ""}
        confirmLabel="移除"
        destructive
        busy={busy === confirm?.id}
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <Alert
        open={asking}
        title="確認樂團授權"
        message={`${AUTHORIZATION_NOTE}確認後，這個樂團${compact ? "" : "（沒有樂團的歌則是這首歌）"}研究找到的素材預設「可以上台」；每一張仍可改成只當參考或移除。這個確認只需要做一次。`}
        confirmLabel="樂團已授權"
        busy={busy === "authorize"}
        onConfirm={() => void authorize()}
        onCancel={() => setAsking(false)}
      />
    </section>
  );
}
