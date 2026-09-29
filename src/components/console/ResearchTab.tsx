"use client";

// 研究: the designer's brief (Markdown) and its sources as an inset list of links.

import { memo } from "react";
import { Button, EmptyState, Tag } from "@/components/ui";
import { ArrowSquareOutIcon, BooksIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { hostOf } from "@/lib/console/format";
import type { Project } from "@/lib/types";
import { Footnote, Group, GroupTitle } from "./ui";

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
      <EmptyState
        compact
        icon={BooksIcon}
        title="還沒有研究資料"
        description="研究會整理樂團的視覺歷史、歌曲意象與情緒弧線，作為設計的依據。"
        action={
          <Button size="sm" variant="tinted" href={`/p/${encodeURIComponent(project.id)}/process`} transitionTypes={["push"]}>
            前往設計總覽
          </Button>
        }
      />
    );
  }
  const sources = research.sources ?? [];
  return (
    <div className="flex flex-col gap-5 px-3 pt-1 pb-4">
      <div>
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          <Tag tone={research.engine === "claude" ? "tint" : "neutral"}>{research.engine === "claude" ? "Claude 研究" : "離線設計（未連網研究）"}</Tag>
          {research.model && <Tag className="t-latin">{research.model}</Tag>}
          {research.createdAt && <span className="text-c-footnote text-label-2 tabular">{formatDate(research.createdAt)}</span>}
        </div>
        {research.engine === "offline" && (
          <Footnote className="mt-1">這份簡報由離線設計師依音訊分析與歌詞產生，沒有查詢網路資料。設定 ANTHROPIC_API_KEY 後重新處理，即可得到樂團視覺歷史的完整研究。</Footnote>
        )}
      </div>
      <Group className="px-3 py-1">{research.brief.trim() ? <Markdown>{research.brief}</Markdown> : <p className="py-3 text-c-body text-label-2">研究內容是空的。</p>}</Group>
      {sources.length > 0 && (
        <section aria-labelledby="research-sources">
          <GroupTitle id="research-sources">參考來源（{sources.length}）</GroupTitle>
          <Group className="mt-1">
            <ul>
              {sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group relative flex min-h-(--row-min-h) items-center gap-2.5 px-3 py-1.5 transition-none after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[38px] after:h-(--hairline) after:bg-separator hover:bg-fill-4 focus-inset active:bg-fill-3 [li:last-child_&]:after:hidden"
                  >
                    <span className="w-4 shrink-0 text-c-footnote text-label-2 tabular">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-c-body text-label">{s.title || s.url}</span>
                      <span className="block truncate text-c-footnote text-label-2">{hostOf(s.url) || s.url}</span>
                    </span>
                    <ArrowSquareOutIcon size={14} className="shrink-0 text-label-3 group-hover:text-label-2" />
                  </a>
                </li>
              ))}
            </ul>
          </Group>
        </section>
      )}
    </div>
  );
}

export const ResearchTab = memo(ResearchTabImpl);
