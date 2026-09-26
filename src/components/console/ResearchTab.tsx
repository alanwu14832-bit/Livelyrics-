"use client";

import Link from "next/link";
import { memo } from "react";
import { Badge } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { hostOf } from "@/lib/console/format";
import type { Project } from "@/lib/types";
import { SectionTitle } from "./controls";
import { IconExternal } from "./icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString();
  }
}

function ResearchTabImpl({ project }: { project: Project }) {
  const research = project.research;
  if (!research) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-muted">還沒有研究資料</p>
        <p className="text-xs leading-relaxed text-faint">研究會整理樂團的視覺歷史、歌曲意象與情緒弧線，作為設計的依據。</p>
        <Link href={`/p/${encodeURIComponent(project.id)}/process`} className="rounded-md border border-line bg-panel-3 px-3 py-1.5 text-xs text-fg hover:bg-line">
          前往處理頁面
        </Link>
      </div>
    );
  }
  const sources = research.sources ?? [];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={research.engine === "claude" ? "accent" : "neutral"}>{research.engine === "claude" ? "Claude 研究" : "離線設計（未連網研究）"}</Badge>
        {research.model && <Badge className="font-mono">{research.model}</Badge>}
        {research.createdAt && <span className="text-[11px] text-faint">{formatDate(research.createdAt)}</span>}
      </div>
      {research.engine === "offline" && (
        <p className="rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[11px] leading-relaxed text-faint">
          這份簡報由離線設計師依音訊分析與歌詞產生，沒有查詢網路資料。設定 ANTHROPIC_API_KEY 後重新處理，即可得到樂團視覺歷史的完整研究。
        </p>
      )}
      <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-1">
        {research.brief.trim() ? <Markdown>{research.brief}</Markdown> : <p className="py-3 text-xs text-faint">研究內容是空的。</p>}
      </div>
      {sources.length > 0 && (
        <div>
          <SectionTitle>參考來源（{sources.length}）</SectionTitle>
          <ul className="mt-1.5 flex flex-col gap-1">
            {sources.map((s, i) => (
              <li key={`${s.url}-${i}`}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-start gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 hover:border-faint focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="mt-0.5 font-mono text-[10px] text-faint tabular">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-fg group-hover:text-accent">{s.title || s.url}</span>
                    <span className="block truncate text-[10px] text-faint">{hostOf(s.url) || s.url}</span>
                  </span>
                  <IconExternal size={12} className="mt-0.5 shrink-0 text-faint" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const ResearchTab = memo(ResearchTabImpl);
