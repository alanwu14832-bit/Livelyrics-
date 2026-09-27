"use client";

// 素材: the band's own material (album art, photos, MV clips, logo) for one project. Used on the
// design overview (page density) and in the console's 設計 tab (console density, same markup:
// the kit follows the theme scope). Drag files anywhere onto the tile grid or pick them; each
// file is measured in the browser (size, video length), uploaded with progress, and shown as a
// thumbnail card. A card opens a sheet to rename it, mark an image as the logo, write a note for
// the designer and add tags; delete asks first (Alert). After new material arrives the owner can
// offer 「用素材重新設計」.

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Alert, Button, ProgressBar, SegmentedControl, Sheet, TextArea, TextField, cx } from "@/components/ui";
import { FilmStripIcon, ImageIcon, ImagesIcon, SparkleIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api, type AssetOwner } from "@/lib/api-client";
import { ASSET_ACCEPT, ASSET_FORMATS_LABEL, ASSET_KIND_LABELS, MAX_ASSET_BYTES, formatBytes, formatDuration, isVideoAsset, sanitizeTags } from "@/lib/assets";
import { looksLikeMedia, probeMedia } from "@/lib/media-probe";
import type { Asset, DesignPlan } from "@/lib/types";

interface Upload {
  key: string;
  name: string;
  progress: number;
  error: string | null;
}

export interface AssetLibraryProps {
  /** a song's own library (the band's shared one: pass `owner` instead) */
  projectId?: string;
  /** whose library this is; defaults to the project `projectId` */
  owner?: AssetOwner;
  assets: Asset[];
  /** new list after an upload / edit / delete; `plan` is the server's plan after a delete */
  onChange: (assets: Asset[], plan?: DesignPlan | null) => void;
  density?: "page" | "console";
  /** shows 「用素材重新設計」 once material was added (or always when `alwaysOfferRedesign`) */
  onRedesign?: () => void;
  redesignBusy?: boolean;
  redesignDisabled?: boolean;
  /** 「用素材重新設計」 even when nothing was added in this session */
  alwaysOfferRedesign?: boolean;
  className?: string;
  headingId?: string;
}

let uploadSeq = 0;

function Thumb({ owner, asset, className }: { owner: AssetOwner; asset: Asset; className?: string }) {
  const url = api.ownedAssetUrl(owner, asset.id);
  const [failed, setFailed] = useState(false);
  const video = isVideoAsset(asset);
  if (failed) {
    return (
      <span className={cx("flex items-center justify-center bg-fill-3 text-label-2", className)}>
        <WarningCircleIcon size={20} aria-label="無法顯示縮圖" />
      </span>
    );
  }
  return video ? (
    <video
      src={`${url}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      onError={() => setFailed(true)}
      className={cx("bg-black object-cover", className)}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- local API file, no optimizer
    <img
      src={url}
      alt=""
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cx(asset.kind === "logo" ? "bg-[repeating-conic-gradient(#2a2a2e_0_25%,#1c1c1f_0_50%)] bg-[length:16px_16px] object-contain p-2" : "bg-black object-cover", className)}
    />
  );
}

function KindIcon({ asset }: { asset: Asset }) {
  return isVideoAsset(asset) ? <FilmStripIcon size={14} className="shrink-0" /> : <ImageIcon size={14} className="shrink-0" />;
}

/** Card: thumbnail (16:9, black), name, kind + size / length. The whole card opens the editor. */
function AssetCard({ owner, asset, onOpen, compact }: { owner: AssetOwner; asset: Asset; onOpen: () => void; compact: boolean }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="press-tile group flex w-full min-w-0 flex-col overflow-hidden rounded-md bg-surface-2 text-left in-data-[theme=console]:bg-fill-4"
        aria-label={`${asset.name}（${ASSET_KIND_LABELS[asset.kind]}），編輯`}
      >
        <span className="relative block aspect-video w-full overflow-hidden">
          <Thumb owner={owner} asset={asset} className="absolute inset-0 size-full" />
          {asset.duration ? (
            <span className="absolute right-1.5 bottom-1.5 rounded-xs bg-black/70 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white tabular">
              {formatDuration(asset.duration)}
            </span>
          ) : null}
        </span>
        <span className={cx("flex min-w-0 flex-col gap-0.5 px-2.5", compact ? "py-1.5" : "py-2")}>
          <span className={cx("truncate font-medium text-label", compact ? "text-c-body" : "text-[13px] leading-[18px]")}>{asset.name}</span>
          <span className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-label-2">
            <KindIcon asset={asset} />
            <span className="shrink-0">{ASSET_KIND_LABELS[asset.kind]}</span>
            <span className="truncate tabular">
              {asset.width} × {asset.height}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function EditSheet({
  owner,
  asset,
  onClose,
  onSaved,
  onDelete,
}: {
  owner: AssetOwner;
  asset: Asset | null;
  onClose: () => void;
  onSaved: (assets: Asset[]) => void;
  onDelete: (asset: Asset) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [kind, setKind] = useState<"image" | "logo">("image");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const noteId = useId();
  const tagsId = useId();
  const [shown, setShown] = useState<Asset | null>(null);
  // a newly opened asset resets the form (derived during render; the old one stays shown while closing)
  if (asset && asset !== shown) {
    setShown(asset);
    setName(asset.name);
    setNote(asset.note ?? "");
    setTags((asset.tags ?? []).join("、"));
    setKind(asset.kind === "logo" ? "logo" : "image");
    setError(null);
    setSaving(false);
  }

  const a = asset ?? shown;
  const video = a ? isVideoAsset(a) : false;

  const save = async () => {
    if (!a) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateOwnedAsset(owner, a.id, {
        name,
        note: note.trim() ? note : null,
        tags: sanitizeTags(tags) ?? null,
        ...(video ? {} : { kind }),
      });
      onSaved(res.assets);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={asset != null}
      onClose={onClose}
      title="編輯素材"
      width={560}
      dismissible={!saving}
      action={
        <Button variant="filled" onClick={() => void save()} loading={saving}>
          完成
        </Button>
      }
    >
      {a && (
        <div className="flex flex-col gap-5 px-5 pt-2 pb-5">
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
            <Thumb owner={owner} asset={a} className="absolute inset-0 size-full" />
          </div>
          <p className="-mt-3 text-[12px] leading-4 text-label-2 tabular">
            {ASSET_KIND_LABELS[a.kind]}，{a.width} × {a.height}
            {a.duration ? `，${formatDuration(a.duration)}` : ""}，{formatBytes(a.bytes)}
          </p>
          <label className="flex flex-col gap-1.5" htmlFor={nameId}>
            <span className="text-[13px] leading-5 text-label-2">名稱</span>
            <TextField id={nameId} size="lg" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          {!video && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] leading-5 text-label-2">種類</span>
              <SegmentedControl
                label="種類"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "image", label: "圖片", caption: "專輯封面、樂團照片、海報等畫面素材。" },
                  { value: "logo", label: "標誌", caption: "樂團 logo：設計師只會在開場與結尾節制地使用。" },
                ]}
              />
            </div>
          )}
          <label className="flex flex-col gap-1.5" htmlFor={noteId}>
            <span className="text-[13px] leading-5 text-label-2">給設計師的說明</span>
            <TextArea
              id={noteId}
              rows={3}
              maxLength={500}
              value={note}
              placeholder="例如：第二張專輯封面，副歌想用；或：主唱特寫，只用在橋段。"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5" htmlFor={tagsId}>
            <span className="text-[13px] leading-5 text-label-2">標籤</span>
            <TextField id={tagsId} size="lg" value={tags} placeholder="專輯封面、夜景、現場" onChange={(e) => setTags(e.target.value)} />
            <span className="text-[12px] leading-4 text-label-2">用逗號或頓號分隔。</span>
          </label>
          {error && (
            <p role="alert" className="text-[13px] leading-5 text-red-text">
              {error}
            </p>
          )}
          <Button variant="destructive" icon={TrashIcon} className="self-start" onClick={() => onDelete(a)} disabled={saving}>
            刪除素材
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function AssetLibrary({
  projectId,
  owner: ownerProp,
  assets,
  onChange,
  density = "page",
  onRedesign,
  redesignBusy = false,
  redesignDisabled = false,
  alwaysOfferRedesign = false,
  className,
  headingId,
}: AssetLibraryProps) {
  const compact = density === "console";
  const owner: AssetOwner = ownerProp ?? { kind: "project", id: projectId ?? "" };
  const band = owner.kind === "band";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [confirm, setConfirm] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [added, setAdded] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  const autoId = useId();
  const titleId = headingId ?? autoId;
  const hintId = useId();

  const patchUpload = (key: string, patch: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  const uploadOne = async (file: File) => {
    const key = `u${++uploadSeq}`;
    setUploads((list) => [...list, { key, name: file.name, progress: 0, error: null }]);
    try {
      if (!looksLikeMedia(file)) throw new Error(`不支援這種檔案。支援格式：${ASSET_FORMATS_LABEL}`);
      if (file.size > MAX_ASSET_BYTES) throw new Error(`檔案太大（上限 ${MAX_ASSET_BYTES / 1024 / 1024} MB）`);
      const probe = await probeMedia(file);
      const res = await api.uploadOwnedAsset(
        owner,
        {
          file,
          width: probe.width,
          height: probe.height,
          duration: probe.duration,
          name: file.name.replace(/\.[^.]+$/, ""),
          kind: !probe.video && /logo|標誌|商標/i.test(file.name) ? "logo" : undefined,
        },
        { onProgress: (p) => patchUpload(key, { progress: p }) },
      );
      assetsRef.current = res.assets;
      onChange(res.assets);
      setAdded((n) => n + 1);
      setUploads((list) => list.filter((u) => u.key !== key));
    } catch (err) {
      patchUpload(key, { error: err instanceof Error ? err.message : "上傳失敗", progress: 0 });
    }
  };

  const addFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    // one at a time keeps progress honest and the server's per-project lock short
    void list.reduce<Promise<void>>((chain, f) => chain.then(() => uploadOne(f)), Promise.resolve());
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer?.files ?? null);
  };

  const doDelete = async () => {
    const a = confirm;
    if (!a) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await api.deleteOwnedAsset(owner, a.id);
      if (band || res.plan === undefined) onChange(res.assets);
      else onChange(res.assets, res.plan);
      setConfirm(null);
      setEditing(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setDeleting(false);
    }
  };

  const offerRedesign = onRedesign && assets.length > 0 && (added > 0 || alwaysOfferRedesign);
  const hasDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <section aria-labelledby={titleId} className={cx("min-w-0", className)} data-testid="asset-library">
      <div className={cx("flex min-h-7 items-center justify-between gap-2", compact ? "" : "mb-1.5 px-4")}>
        <h2 id={titleId} className={cx("min-w-0 truncate", compact ? "text-c-footnote font-semibold text-label-2" : "text-[13px] leading-5 text-label-2")}>
          {band ? "樂團素材" : "素材"}
          {assets.length > 0 ? `（${assets.length}）` : ""}
        </h2>
        <Button size="sm" variant="plain" icon={UploadSimpleIcon} onClick={() => inputRef.current?.click()} className="-mr-1">
          加入素材
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ASSET_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="asset-input"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        onDragEnter={(e) => {
          if (hasDrag(e)) setOver(true);
        }}
        onDragOver={(e) => {
          if (!hasDrag(e)) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={onDrop}
        className={cx(
          "relative overflow-hidden rounded-lg bg-surface transition-[background-color,box-shadow] duration-(--dur-fast) ease-[ease] in-data-[theme=console]:rounded-md in-data-[theme=console]:bg-surface-2",
          compact ? "p-2" : "p-3",
          over && "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)] in-data-[theme=console]:bg-tint-soft",
        )}
      >
        {assets.length === 0 && uploads.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-describedby={hintId}
            className={cx("press-fade flex w-full flex-col items-center justify-center rounded-md text-center", compact ? "gap-1.5 px-3 py-6" : "gap-2 px-6 py-10")}
          >
            <span className={cx("flex items-center justify-center rounded-full bg-tint-soft text-tint-text-on-soft", compact ? "size-10" : "size-14")}>
              <ImagesIcon size={compact ? 20 : 28} />
            </span>
            <span className={cx("font-semibold text-label", compact ? "text-c-body" : "text-[15px] leading-5")}>把樂團的素材拖到這裡</span>
            <span id={hintId} className={cx("max-w-[32em] text-label-2", compact ? "text-c-footnote" : "text-[13px] leading-5")}>
              {band
                ? "logo、專輯封面、樂團照片、MV 片段：放在這裡的素材，樂團的每首歌與演出畫面都能用。"
                : "專輯封面、樂團照片、MV 片段或 logo。設計師會用這首歌的配色處理它們，讓畫面一看就是你們。"}
              {ASSET_FORMATS_LABEL}，單檔 500 MB 以內。
            </span>
          </button>
        ) : (
          <ul className={cx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3")} aria-label="素材">
            {assets.map((a) => (
              <AssetCard key={a.id} owner={owner} asset={a} compact={compact} onOpen={() => setEditing(a)} />
            ))}
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="press-tile flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-md bg-fill-4 text-label-2 hover:bg-fill-3"
              >
                <UploadSimpleIcon size={20} />
                <span className="text-[12px] leading-4">拖放或選擇檔案</span>
              </button>
            </li>
          </ul>
        )}

        {uploads.length > 0 && (
          <ul className={cx("flex flex-col gap-2", assets.length > 0 || uploads.length > 0 ? "mt-3" : "")} aria-label="上傳中" aria-live="polite">
            {uploads.map((u) => (
              <li key={u.key} className="min-w-0">
                {u.error ? (
                  <div className="flex items-start gap-2 text-[12px] leading-4">
                    <WarningCircleIcon size={14} className="mt-0.5 shrink-0 text-red" />
                    <span className="min-w-0 flex-1 text-label">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="text-label-2">{u.error}</span>
                    </span>
                    <Button size="sm" variant="plain" onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}>
                      關閉
                    </Button>
                  </div>
                ) : (
                  <ProgressBar value={u.progress} label={`上傳「${u.name}」…`} showValue />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {offerRedesign && (
        <div className={cx("mt-2 flex flex-wrap items-center gap-2", compact ? "" : "px-4")}>
          <Button variant="tinted" size="sm" icon={SparkleIcon} onClick={onRedesign} loading={redesignBusy} disabled={redesignDisabled}>
            用素材重新設計
          </Button>
          <span className="min-w-0 text-[12px] leading-4 text-label-2">設計師會決定每一段要不要放素材、用什麼處理。</span>
        </div>
      )}

      {!compact && assets.length > 0 && (
        <p className="mt-1.5 px-4 text-[12px] leading-4 text-label-2">點素材可以改名、標成 logo，或寫一句說明給設計師（例如哪張是專輯封面）。</p>
      )}

      <EditSheet owner={owner} asset={editing} onClose={() => setEditing(null)} onSaved={(list) => onChange(list)} onDelete={(a) => setConfirm(a)} />

      <Alert
        open={confirm != null}
        title={`刪除「${confirm?.name ?? ""}」？`}
        message={
          <>
            {band ? "檔案會從樂團素材庫移除，所有歌曲與演出畫面中用到它的地方改回只顯示場景。" : "檔案會從這個作品移除，用到它的段落改回只顯示場景。"}
            {deleteError && <span className="mt-1 block text-red-text">{deleteError}</span>}
          </>
        }
        confirmLabel="刪除"
        destructive
        busy={deleting}
        onCancel={() => {
          setConfirm(null);
          setDeleteError(null);
        }}
        onConfirm={() => void doDelete()}
      />
    </section>
  );
}
