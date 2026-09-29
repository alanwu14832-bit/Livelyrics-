"use client";

// 「重新設計」 (UI-AUDIT §3.5 處理頁): free-text art direction for a re-design, as a group under the
// steps. A text area, suggestion tags that fill it, a tinted 「重新設計」 and a gray
// 「重新研究並設計」 (the page's one filled button is 「進入控制台」). ⌘/Ctrl + Enter submits.
// With Claude connected, a switch runs this one without the API (免費研究 + the offline designer).

import { useId, useState } from "react";
import { Button, Switch, TextArea } from "@/components/ui";
import { SparkleIcon } from "@/components/ui/Icon";

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
  onRedesign: (instruction: string, withResearch: boolean, free?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [free, setFree] = useState(false);
  const id = useId();
  const hintId = useId();
  const freeId = useId();
  const noApi = offline || free;
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="mb-1.5 px-4 text-[13px] leading-5 text-label-2">
        重新設計
      </h2>
      <div className="rounded-lg bg-surface p-4">
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          disabled={disabled}
          aria-label="給設計師的指示"
          aria-describedby={hintId}
          placeholder="例如：副歌的畫面要更有爆發力，主歌讓歌詞退到下方，不要蓋住主唱。"
          className="block"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !disabled) {
              e.preventDefault();
              onRedesign(text.trim(), false, free && !offline);
            }
          }}
        />
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="常用指示">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setText((t) => (t.trim() ? `${t.trim()}；${s}` : s))}
                className="press-fade inline-flex h-7 items-center rounded-pill bg-fill-3 px-3 text-[12px] leading-none font-medium text-label-2-on-material hover:bg-fill-2 disabled:pointer-events-none disabled:opacity-35"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
        {!offline && (
          <div className="mt-3 flex min-h-8 items-center justify-between gap-3">
            <label htmlFor={freeId} className="min-w-0 text-[13px] leading-5 text-label">
              這次用免費研究（不呼叫 Claude API）
            </label>
            <Switch id={freeId} checked={free} onChange={setFree} disabled={disabled} data-testid="redesign-free" />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="tinted" icon={SparkleIcon} disabled={disabled} onClick={() => onRedesign(text.trim(), false, free && !offline)}>
            重新設計
          </Button>
          <Button variant="gray" disabled={disabled} onClick={() => onRedesign(text.trim(), true, free && !offline)} title={noApi ? "免費研究：查詢公開資料、分析歌詞與音訊後再設計" : hasResearch ? "重新上網研究後再設計" : "先研究再設計"}>
            重新研究並設計
          </Button>
        </div>
      </div>
      <p id={hintId} className="mt-1.5 px-4 text-[12px] leading-4 text-label-2">
        像跟設計師開會一樣給指示；沒寫也可以直接重新設計。
        {noApi && "離線設計師只看得懂簡單的指示，例如「更熱血」「更安靜」「直排」。"}
      </p>
    </section>
  );
}
