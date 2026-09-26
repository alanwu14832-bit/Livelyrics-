"use client";

import { useEffect, useRef } from "react";
import { Kbd } from "@/components/ui";
import { HOTKEY_HELP } from "@/lib/console/hotkeys";
import { IconClose } from "./icons";

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="console-help-title"
        className="w-full max-w-3xl rounded-xl border border-line bg-panel p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="console-help-title" className="text-base font-semibold text-fg">
            快捷鍵
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-fg" aria-label="關閉">
            <IconClose />
          </button>
        </div>
        <p className="mt-1 text-xs text-faint">在輸入框打字時快捷鍵會暫停。按 ? 或 Esc 關閉。</p>
        <div className="mt-4 grid grid-cols-3 gap-5">
          {HOTKEY_HELP.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-faint">{group.title}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.entries.map((entry) => (
                  <li key={entry.label} className="flex items-start justify-between gap-3 text-xs">
                    <span className="text-muted">{entry.label}</span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {entry.keys.map((k) => (
                        <Kbd key={k} className="h-6 min-w-6 text-[11px] text-fg">
                          {k}
                        </Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-line bg-panel-2 p-3 text-[11px] leading-relaxed text-muted">
          <p>
            <span className="font-semibold text-fg">TRACK</span>：跟著控制台播放的音檔時間自動換句。<span className="font-semibold text-fg">LIVE</span>
            ：樂團現場時由你逐句送出——時間會跳到該句的開頭，走到下一句開始前停住，等你送出下一句。
          </p>
          <p className="mt-1">任何時候按 B 都能立刻淡出為全黑；投影視窗只顯示動畫與歌詞，所有資訊都留在這台電腦上。</p>
        </div>
      </div>
    </div>
  );
}
