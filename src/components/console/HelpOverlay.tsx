"use client";

// Shortcut help (UI-AUDIT §3.5 對話框): a Sheet opened with ? — a keyboard action, so it opens and
// closes instantly (no animation). Inset rows with Kbd caps; show hotkeys keep working while it
// is open (the console passes them through), ? or Esc closes it.

import type { KeyboardEvent } from "react";
import { Button, Kbd, Sheet } from "@/components/ui";
import { HOTKEY_HELP, type HotkeyHelpGroup } from "@/lib/console/hotkeys";
import { Group, GroupTitle } from "./ui";

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (k === "…" ? <span key={i} className="text-c-footnote text-label-2">到</span> : <Kbd key={i}>{k}</Kbd>))}
    </span>
  );
}

function HelpGroup({ group }: { group: HotkeyHelpGroup }) {
  return (
    <section aria-label={group.title}>
      <GroupTitle>{group.title}</GroupTitle>
      <Group className="mt-1">
        {group.entries.map((entry) => (
          <div
            key={entry.label}
            className="relative flex min-h-8 items-center justify-between gap-3 px-3 py-1.5 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-3 after:h-(--hairline) after:bg-separator last:after:hidden"
          >
            <span className="min-w-0 text-c-body text-label">{entry.label}</span>
            <Keys keys={entry.keys} />
          </div>
        ))}
      </Group>
    </section>
  );
}

export function HelpOverlay({ open, onClose, onKeyDown }: { open: boolean; onClose: () => void; onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void }) {
  const [playback, ...rest] = HOTKEY_HELP;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="快捷鍵"
      width={720}
      instant
      cancelLabel={null}
      action={
        <Button variant="plain" onClick={onClose} className="font-semibold">
          完成
        </Button>
      }
      onKeyDown={onKeyDown}
    >
      <p className="text-c-body text-label-2">在輸入框打字時快捷鍵會暫停。按 ? 或 Esc 關閉；黑場、歌詞、凍結與場景鍵在這裡也有效。</p>
      <div className="mt-4 grid grid-cols-2 items-start gap-4">
        {playback && <HelpGroup group={playback} />}
        <div className="flex flex-col gap-4">
          {rest.map((g) => (
            <HelpGroup key={g.title} group={g} />
          ))}
        </div>
      </div>
      <Group className="mt-4 flex flex-col gap-1 px-3 py-2.5 text-c-body text-label-2">
        <p>
          <span className="font-semibold text-label t-latin">TRACK</span>：跟著控制台播放的音檔時間自動換句。
        </p>
        <p>
          <span className="font-semibold text-label t-latin">LIVE</span>：由你逐句送出。時間會跳到該句開頭，停在下一句開始前。
        </p>
        <p>任何時候按 B 都能立刻淡出為全黑；投影視窗只顯示動畫與歌詞，所有資訊都留在這台電腦上。</p>
      </Group>
    </Sheet>
  );
}
