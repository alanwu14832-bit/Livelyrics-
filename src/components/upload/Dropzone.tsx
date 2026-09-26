"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { MusicIcon, UploadIcon } from "@/components/home/icons";
import { AUDIO_ACCEPT, AUDIO_FORMATS_LABEL, formatBytes, MAX_UPLOAD_BYTES } from "./accept";

/**
 * Large drag-and-drop target (click / keyboard opens the file picker). While `active`,
 * files dropped anywhere on the page are accepted too.
 */
export function Dropzone({ onFiles, active = true, error }: { onFiles: (files: File[]) => void; active?: boolean; error?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });

  // page-wide drop target
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setPageDrag(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setPageDrag(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setPageDrag(false);
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [active]);

  return (
    <>
      <label
        onDragEnter={() => setOver(true)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        className={cx(
          "group relative flex min-h-64 cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all",
          "focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-accent",
          over || pageDrag ? "border-accent bg-accent/[0.07]" : "border-line bg-panel/60 hover:border-faint hover:bg-panel",
          error && !over && "border-danger/50",
        )}
      >
        {/* stage-light glow */}
        <span
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute -top-32 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full blur-3xl transition-opacity",
            "bg-[radial-gradient(closest-side,rgba(255,90,54,0.28),rgba(139,108,255,0.14),transparent)]",
            over || pageDrag ? "opacity-100" : "opacity-60 group-hover:opacity-90",
          )}
        />
        <span
          className={cx(
            "relative flex size-16 items-center justify-center rounded-2xl border transition-transform",
            over || pageDrag ? "scale-110 border-accent/60 bg-accent/15 text-accent" : "border-line bg-panel-2 text-fg group-hover:-translate-y-0.5",
          )}
        >
          {over || pageDrag ? <MusicIcon size={28} /> : <UploadIcon size={28} />}
        </span>
        <span className="relative space-y-1.5">
          <span className="block text-xl font-semibold text-fg">{over || pageDrag ? "放開以上傳這首歌" : "拖放一首歌到這裡"}</span>
          <span className="block text-sm text-muted">
            或 <span className="font-medium text-accent underline-offset-4 group-hover:underline">點擊選擇音檔</span> · {AUDIO_FORMATS_LABEL} · 最大 {formatBytes(MAX_UPLOAD_BYTES)}
          </span>
        </span>
        <span className="relative text-xs text-faint">音訊分析在你的瀏覽器裡完成；音檔只存放在這台電腦上。</span>
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          aria-label="選擇音檔"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // allow re-picking the same file after an error
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
