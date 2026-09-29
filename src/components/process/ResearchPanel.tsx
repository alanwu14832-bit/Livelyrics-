"use client";

// The stored research brief (UI-AUDIT §3.5 處理頁, UI-31): a --surface group whose header is a
// Disclosure row (the Apple › turns 90°, the content fades and drops 4 px, the height animates on
// this page only). Sources are rows with an ArrowSquareOut.

import { Disclosure, Tag } from "@/components/ui";
import { ArrowSquareOutIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import type { Research } from "@/lib/types";
import { researchEngineLabel } from "@/lib/research-labels";
import { formatAbsoluteTime } from "@/components/home/relative-time";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchPanel({ research, defaultOpen = false }: { research: Research; defaultOpen?: boolean }) {
  const engine = researchEngineLabel(research);
  return (
    <section aria-label="研究簡報" className="min-w-0 rounded-lg bg-surface">
      <Disclosure
        defaultOpen={defaultOpen}
        animateHeight
        summaryClassName="min-h-12! gap-2! rounded-lg px-5 text-[15px]! leading-5! font-semibold! hover:bg-fill-4"
        contentClassName="grid min-w-0 gap-x-8 gap-y-5 px-5 pt-1 pb-5 lg:grid-cols-[minmax(0,1fr)_15rem]"
        summary={
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">研究簡報</span>
            <Tag className="min-w-0">
              <span className="truncate">{engine}</span>
            </Tag>
            {research.sources.length > 0 && <span className="shrink-0 text-[13px] font-normal text-label-2">{research.sources.length} 個來源</span>}
            <span className="ml-auto shrink-0 text-[13px] font-normal text-label-2 tabular max-sm:hidden">{formatAbsoluteTime(research.createdAt)}</span>
          </span>
        }
      >
        <Markdown className="min-w-0">{research.brief || "（沒有內容）"}</Markdown>
        {research.sources.length > 0 && (
          <aside className="min-w-0">
            <h3 className="mb-1.5 text-[13px] leading-5 text-label-2">來源</h3>
            <ol className="overflow-hidden rounded-md bg-fill-4">
              {research.sources.map((s, i) => (
                <li
                  key={`${s.url}-${i}`}
                  className="relative after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-3 after:h-(--hairline) after:bg-separator last:after:hidden"
                >
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="focus-inset flex min-w-0 items-start gap-2 px-3 py-2 hover:bg-fill-4 active:bg-fill-3">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] leading-[18px] text-label">{s.title || hostname(s.url)}</span>
                      <span className="block truncate text-[12px] leading-4 text-label-2">{hostname(s.url)}</span>
                    </span>
                    <ArrowSquareOutIcon size={14} className="mt-0.5 shrink-0 text-label-2" />
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </Disclosure>
    </section>
  );
}
