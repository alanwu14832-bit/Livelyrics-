"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui";
import { SparklesIcon } from "@/components/home/icons";

const SUGGESTIONS = ["副歌更熱血一點", "整體更安靜、留白多一點", "主歌用直排歌詞", "更貼近專輯封面的色調", "減少歌詞，讓畫面當主角", "最後一次副歌要最炸"];

/** Free-text art direction for a re-design. */
export function RedesignBox({
  disabled,
  hasResearch,
  offline,
  onRedesign,
}: {
  disabled?: boolean;
  hasResearch: boolean;
  offline: boolean;
  onRedesign: (instruction: string, withResearch: boolean) => void;
}) {
  const [text, setText] = useState("");
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div>
        <h2 id={id} className="text-sm font-semibold text-fg">
          重新設計
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-muted">
          像跟設計師開會一樣給指示；沒寫也可以直接重新設計。
          {offline && " 離線設計師只看得懂簡單的指示（例如「更熱血」「更安靜」「直排」）。"}
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={4000}
        disabled={disabled}
        aria-label="給設計師的指示"
        placeholder="例如：副歌的畫面要更有爆發力，主歌讓歌詞退到下方，不要蓋住主唱。"
        className="block w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-faint focus:border-accent disabled:opacity-50"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !disabled) {
            e.preventDefault();
            onRedesign(text.trim(), false);
          }
        }}
      />
      <ul className="flex flex-wrap gap-1.5" aria-label="常用指示">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setText((t) => (t.trim() ? `${t.trim()}；${s}` : s))}
              className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:border-faint hover:text-fg disabled:opacity-40"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={() => onRedesign(text.trim(), false)}>
          <SparklesIcon size={14} />
          重新設計
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => onRedesign(text.trim(), true)} title={hasResearch ? "重新上網研究後再設計" : "先研究再設計"}>
          重新研究並設計
        </Button>
      </div>
    </section>
  );
}
