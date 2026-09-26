"use client";

import { Badge } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import type { Research } from "@/lib/types";
import { ExternalIcon } from "@/components/home/icons";
import { formatAbsoluteTime } from "@/components/home/relative-time";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ResearchPanel({ research, defaultOpen = false }: { research: Research; defaultOpen?: boolean }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-line bg-panel" open={defaultOpen}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-3 hover:bg-panel-2/50">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">研究簡報</span>
          <Badge tone={research.engine === "claude" ? "accent" : "neutral"}>
            {research.engine === "claude" ? `Claude${research.model ? ` · ${research.model}` : ""}` : "離線研究"}
          </Badge>
          {research.sources.length > 0 && <span className="text-xs text-faint">{research.sources.length} 個來源</span>}
        </span>
        <span className="text-xs text-faint">
          {formatAbsoluteTime(research.createdAt)}
          <span className="ml-2 inline-block transition-transform group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </span>
      </summary>
      <div className="grid gap-6 border-t border-line px-5 py-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Markdown>{research.brief || "（沒有內容）"}</Markdown>
        {research.sources.length > 0 && (
          <aside>
            <h3 className="mb-2 text-xs font-semibold text-muted">來源</h3>
            <ol className="space-y-1.5">
              {research.sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="group/link block rounded-md px-2 py-1.5 hover:bg-panel-2">
                    <span className="flex items-start gap-1.5 text-xs text-fg/90 group-hover/link:text-accent">
                      <span className="line-clamp-2">{s.title || hostname(s.url)}</span>
                      <ExternalIcon size={11} className="mt-0.5 shrink-0 opacity-60" />
                    </span>
                    <span className="block truncate text-[11px] text-faint">{hostname(s.url)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </details>
  );
}
