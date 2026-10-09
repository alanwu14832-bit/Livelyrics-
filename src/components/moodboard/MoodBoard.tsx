"use client";

// 參考圖 (mood board, phase 4): reference images the band gives the designer, for a song (design
// overview) or for the whole band (band page). Never stage media. Each image is downscaled and
// measured in the browser (src/lib/moodboard-client.ts), uploaded with progress and shown as a
// 4:3 thumbnail with its measured colours and the operator's note (「喜歡這個顏色」). A card opens
// a sheet to edit the note or delete the image. On a song, the band's images are shown first,
// read-only (they are edited on the band page).

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Alert, Button, ProgressBar, Sheet, TextArea, cx } from "@/components/ui";
import { ImagesIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { api, type AssetOwner } from "@/lib/api-client";
import { MAX_MOODBOARD_IMAGES, MOOD_ACCEPT, MOOD_FORMATS_LABEL } from "@/lib/moodboard";
import { prepareMoodImage } from "@/lib/moodboard-client";
import type { MoodImage } from "@/lib/types";

const NOTE_SUGGESTIONS = ["喜歡這個顏色", "這種顆粒感", "構圖留白", "字體的感覺", "燈光氛圍"];
/** big originals are only read in the browser; the upload is the 1024 px copy */
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;

interface Upload {
  key: string;
  name: string;
  progress: number;
  error: string | null;
}

let seq = 0;

function Thumb({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={cx("flex items-center justify-center bg-fill-3 text-label-2", className)}>
        <WarningCircleIcon size={20} aria-label="無法顯示縮圖" />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- stored file (cloud: redirect to Blob), no optimizer
  return <img src={url} crossOrigin="anonymous" alt="" decoding="async" draggable={false} onError={() => setFailed(true)} className={cx("bg-fill-3 object-cover", className)} />;
}

function Swatches({ colors, size = 12 }: { colors: string[]; size?: number }) {
  if (!colors.length) return null;
  return (
    <span className="flex items-center gap-1" aria-label={`主色：${colors.join("、")}`}>
      {colors.slice(0, 5).map((c) => (
        <span key={c} className="rounded-full shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ width: size, height: size, background: c }} />
      ))}
    </span>
  );
}

function Card({ index, image, url, onOpen, readOnly }: { index: number; image: MoodImage; url: string; onOpen?: () => void; readOnly?: boolean }) {
  const body = (
    <>
      <span className="relative block aspect-[4/3] w-full overflow-hidden">
        <Thumb url={url} className="absolute inset-0 size-full" />
        <span className="absolute top-1.5 left-1.5 rounded-xs bg-black/65 px-1.5 py-0.5 text-[12px] leading-none font-semibold text-white tabular">圖 {index}</span>
        {readOnly && <span className="absolute top-1.5 right-1.5 rounded-xs bg-black/65 px-1.5 py-0.5 text-[12px] leading-none font-medium text-white">樂團</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
        <Swatches colors={image.stats?.palette ?? []} />
        <span className={cx("line-clamp-2 min-h-8 text-[12px] leading-4", image.note ? "text-label" : "text-label-2")}>{image.note || (readOnly ? "沒有說明" : "點一下寫下喜歡它的哪裡")}</span>
      </span>
    </>
  );
  return (
    <li className="min-w-0" data-testid="mood-card">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="press-tile flex w-full min-w-0 flex-col overflow-hidden rounded-md bg-surface-2 text-left" aria-label={`圖 ${index}：${image.note || image.name}，編輯說明`}>
          {body}
        </button>
      ) : (
        <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-md bg-surface-2">{body}</div>
      )}
    </li>
  );
}

export interface MoodBoardProps {
  owner: AssetOwner;
  images: MoodImage[];
  /** the band's images on a song's board (read-only, numbered first like the designer sees them) */
  bandImages?: MoodImage[];
  bandId?: string;
  onChange: (images: MoodImage[]) => void;
  className?: string;
  /** the heading is rendered by the page */
  headingId?: string;
}

export function MoodBoard({ owner, images, bandImages = [], bandId, onChange, className, headingId }: MoodBoardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<MoodImage | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<MoodImage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  const noteId = useId();
  const hintId = useId();
  const band = owner.kind === "band";
  const full = images.length + uploads.filter((u) => !u.error).length >= MAX_MOODBOARD_IMAGES;

  const patch = (key: string, p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));

  const uploadOne = async (file: File) => {
    const key = `m${++seq}`;
    setUploads((list) => [...list, { key, name: file.name, progress: 0, error: null }]);
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) throw new Error(`參考圖只接受圖片：${MOOD_FORMATS_LABEL}`);
      if (file.size > MAX_SOURCE_BYTES) throw new Error("圖片太大（上限 60 MB）");
      if (imagesRef.current.length >= MAX_MOODBOARD_IMAGES) throw new Error(`參考圖最多 ${MAX_MOODBOARD_IMAGES} 張`);
      const prepared = await prepareMoodImage(file);
      patch(key, { progress: 0.1 });
      const res = await api.uploadMoodImage(
        owner,
        { file: prepared.file, width: prepared.width, height: prepared.height, name: file.name.replace(/\.[^.]+$/, ""), stats: prepared.stats },
        { onProgress: (p) => patch(key, { progress: 0.1 + p * 0.9 }) },
      );
      imagesRef.current = res.images;
      onChange(res.images);
      setUploads((list) => list.filter((u) => u.key !== key));
    } catch (err) {
      patch(key, { error: err instanceof Error ? err.message : "上傳失敗", progress: 0 });
    }
  };

  const addFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    void list.reduce<Promise<void>>((chain, f) => chain.then(() => uploadOne(f)), Promise.resolve());
  };

  const open = (m: MoodImage) => {
    setEditing(m);
    setNote(m.note ?? "");
    setError(null);
    setSaving(false);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateMoodImage(owner, editing.id, { note: note.trim() ? note : null });
      onChange(res.images);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      const res = await api.deleteMoodImage(owner, confirm.id);
      onChange(res.images);
      setConfirm(null);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setDeleting(false);
    }
  };

  const hasDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer?.files ?? null);
  };
  const empty = images.length === 0 && bandImages.length === 0 && uploads.length === 0;
  const shown = [...bandImages.map((m) => ({ m, readOnly: true })), ...images.map((m) => ({ m, readOnly: false }))];

  return (
    <section aria-labelledby={headingId} className={cx("min-w-0", className)} data-testid="moodboard">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MOOD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="mood-input"
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
          "relative overflow-hidden rounded-lg bg-surface p-3 transition-[background-color,box-shadow] duration-(--dur-fast) ease-[ease]",
          over && "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]",
        )}
      >
        {empty ? (
          <button type="button" onClick={() => inputRef.current?.click()} aria-describedby={hintId} className="press-fade flex w-full flex-col items-center justify-center gap-2 rounded-md px-6 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-tint-soft text-tint-text-on-soft">
              <ImagesIcon size={24} />
            </span>
            <span className="text-[15px] leading-5 font-semibold text-label">把樂團喜歡的參考圖拖到這裡</span>
            <span id={hintId} className="max-w-[34em] text-[13px] leading-5 text-label-2">
              {band ? "放在這裡的參考圖會套用到樂團的每一首歌。" : "專輯、電影劇照、海報、別人的舞台照都可以。"}
              設計師會真的看這些圖，取它們的顏色、質感與構圖；它們不會出現在舞台上。{MOOD_FORMATS_LABEL}，最多 {MAX_MOODBOARD_IMAGES} 張。
            </span>
          </button>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" aria-label="參考圖">
            {shown.map(({ m, readOnly }, i) => (
              <Card key={m.id} index={i + 1} image={m} readOnly={readOnly} url={readOnly && bandId ? api.moodImageUrl({ kind: "band", id: bandId }, m.id) : api.moodImageUrl(owner, m.id)} onOpen={readOnly ? undefined : () => open(m)} />
            ))}
            {!full && (
              <li className="min-w-0">
                <button type="button" onClick={() => inputRef.current?.click()} className="press-tile flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-md bg-fill-4 text-label-2 hover:bg-fill-3">
                  <UploadSimpleIcon size={20} />
                  <span className="text-[12px] leading-4">加入參考圖</span>
                </button>
              </li>
            )}
          </ul>
        )}
        {uploads.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2" aria-label="上傳中" aria-live="polite">
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
      {!empty && (
        <p className="mt-1.5 px-4 text-[12px] leading-4 text-label-2">
          點參考圖寫一句說明（例如「喜歡這個顏色」「這種顆粒感」），設計師會依說明取用。{bandImages.length > 0 && "標著「樂團」的圖在樂團頁管理，每首歌都會用到。"}
        </p>
      )}

      <Sheet
        open={editing != null}
        onClose={() => setEditing(null)}
        title="參考圖說明"
        width={520}
        dismissible={!saving}
        action={
          <Button variant="filled" onClick={() => void save()} loading={saving}>
            完成
          </Button>
        }
      >
        {editing && (
          <div className="flex flex-col gap-4 px-5 pt-2 pb-5">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-fill-3">
              <Thumb url={api.moodImageUrl(owner, editing.id)} className="absolute inset-0 size-full" />
            </div>
            {editing.stats && (
              <p className="-mt-2 flex items-center gap-2 text-[12px] leading-4 text-label-2">
                <Swatches colors={editing.stats.palette} size={16} />
                量到的主色
              </p>
            )}
            <label className="flex flex-col gap-1.5" htmlFor={noteId}>
              <span className="text-[13px] leading-5 text-label-2">給設計師的說明</span>
              <TextArea id={noteId} rows={3} maxLength={500} value={note} placeholder="例如：喜歡這個顏色；或：這種顆粒感，用在主歌。" onChange={(e) => setNote(e.target.value)} />
            </label>
            <ul className="-mt-2 flex flex-wrap gap-1.5" aria-label="常用說明">
              {NOTE_SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setNote((t) => (t.trim() ? `${t.trim()}；${s}` : s))}
                    className="press-fade inline-flex h-7 items-center rounded-pill bg-fill-3 px-3 text-[12px] leading-none font-medium text-label-2-on-material hover:bg-fill-2"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="text-[13px] leading-5 text-red-text">
                {error}
              </p>
            )}
            <Button variant="destructive" icon={TrashIcon} className="self-start" onClick={() => setConfirm(editing)} disabled={saving}>
              刪除參考圖
            </Button>
          </div>
        )}
      </Sheet>

      <Alert
        open={confirm != null}
        title="刪除這張參考圖？"
        message={band ? "樂團的每首歌之後都不會再參考它。已經提出的設計方向不受影響。" : "之後的設計不會再參考它。已經提出的設計方向不受影響。"}
        confirmLabel="刪除"
        destructive
        busy={deleting}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void doDelete()}
      />
    </section>
  );
}
