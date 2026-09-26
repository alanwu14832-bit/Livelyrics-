"use client";

// The dropzone is the home page's hero object (UI-AUDIT §3.5 首頁, UI-14, UI-29): a --surface
// tile (radius 28, min 320 px), no dashed frame and no glow at rest. A centred 88 px tint-soft
// circle holds the music icon, a 22 / 700 title, the one filled capsule 「選擇音檔」 and a 12 px
// footnote. While a file is dragged over the page: tint-soft wash, a 2 px dashed tint frame, the
// tile grows to 1.01 and the icon lifts (translateY(-2px) scale(1.06)) on the spring; the idle and
// drop icons cross-fade in the same cell with a 2 px blur (150 ms). Clicking anywhere on the tile
// (or Enter / Space on the focused file input) opens the picker.

import { useEffect, useRef, useState } from "react";
import { buttonClasses, cx } from "@/components/ui";
import { DownloadSimpleIcon, MusicNotesPlusIcon } from "@/components/ui/Icon";
import { AUDIO_ACCEPT, AUDIO_FORMATS_LABEL, formatBytes, MAX_UPLOAD_BYTES } from "./accept";

/** The shared hero tile: idle, analysing and failed use the same frame, so nothing jumps. */
export const heroTileClass = "relative flex min-h-[320px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-3xl bg-surface px-8 py-12 text-center";

/** Phase content enters with opacity + translateY(8px) on the spring (opacity only with reduced motion). */
export const phaseEnterClass = "transition-[opacity,translate] duration-(--dur-spring) ease-spring starting:translate-y-2 starting:opacity-0";

const FOCUS_ON_BUTTON =
  "group-has-[input:focus-visible]/drop:outline-2 group-has-[input:focus-visible]/drop:outline-offset-2 group-has-[input:focus-visible]/drop:outline-solid group-has-[input:focus-visible]/drop:outline-(--focus-ring)";

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

  const dragging = over || pageDrag;
  const filled = buttonClasses({ variant: "filled", size: "lg" }).className;

  return (
    <div className="min-w-0">
      <label
        onDragEnter={() => setOver(true)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        data-dragging={dragging || undefined}
        data-motion="move"
        className={cx(heroTileClass, "group/drop transition-transform duration-(--dur-spring) ease-spring data-dragging:scale-[1.01]")}
      >
        {/* drag-over wash and dashed frame (opacity only, so they fade rather than jump) */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-tint-soft opacity-0 transition-opacity duration-(--dur-fast) ease-[ease] group-data-dragging/drop:opacity-100" />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 rounded-[18px] border-2 border-dashed border-tint opacity-0 transition-opacity duration-(--dur-fast) ease-[ease] group-data-dragging/drop:opacity-100"
        />
        <span
          aria-hidden="true"
          data-motion="move"
          className="relative grid size-[88px] place-items-center rounded-full bg-tint-soft text-tint transition-transform duration-(--dur-spring) ease-spring group-data-dragging/drop:-translate-y-0.5 group-data-dragging/drop:scale-[1.06]"
        >
          <MusicNotesPlusIcon
            size={44}
            className="col-start-1 row-start-1 transition-[opacity,filter] duration-(--dur-fast) ease-out group-data-dragging/drop:opacity-0 group-data-dragging/drop:blur-[2px]"
          />
          <DownloadSimpleIcon
            size={44}
            className="col-start-1 row-start-1 opacity-0 blur-[2px] transition-[opacity,filter] duration-(--dur-fast) ease-out group-data-dragging/drop:opacity-100 group-data-dragging/drop:blur-[0px]"
          />
        </span>
        <span className="relative mt-6 block text-title-2 text-label">
          {dragging ? "放開以加入這首歌" : "拖放一首歌到這裡"}
        </span>
        <span aria-hidden="true" className={cx(filled, "relative mt-6", FOCUS_ON_BUTTON)}>
          選擇音檔
        </span>
        <span className="relative mt-5 block text-[12px] leading-[18px] text-label-2">
          <span className="block">
            {AUDIO_FORMATS_LABEL}，最大 {formatBytes(MAX_UPLOAD_BYTES)}。
          </span>
          <span className="block">音訊分析在你的瀏覽器完成，音檔只存在這台電腦。</span>
        </span>
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
        <p role="alert" className="mt-3 text-center text-[13px] leading-5 text-red-text">
          {error}
        </p>
      )}
    </div>
  );
}
