"use client";

// 研究: the designer's brief (Markdown) and its sources as an inset list of links.

import { memo } from "react";
import { Button, EmptyState, Tag } from "@/components/ui";
import { ArrowSquareOutIcon, BooksIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { hostOf } from "@/lib/console/format";
import { FREE_RESEARCH_LABEL, isClaudeResearch } from "@/lib/research-labels";
import type { Project, Research } from "@/lib/types";
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

const TAG_LABEL: Record<Research["engine"], string> = {
  claude: "Claude 研究",
  "manual-claude": "claude.ai 研究（手動貼上）",
  free: FREE_RESEARCH_LABEL,
  offline: "離線設計（未連網研究）",
};

/** What the brief is based on, for the briefs that are not a Claude API research. */
const FOOTNOTE: Partial<Record<Research["engine"], string>> = {
  free: "這份簡報由免費研究產生：查詢 MusicBrainz 與維基百科的公開資料，加上歌詞意象、情緒與音訊分析，沒有使用 Claude。想要更完整的樂團視覺研究，可以到設計總覽用 claude.ai 研究（不需要 API 金鑰）。",
  "manual-claude": "這份簡報是從你在 claude.ai 的對話貼上的，內容與來源請自行確認。",
  offline: "這份簡報由離線設計師依音訊分析與歌詞產生，沒有查詢網路資料。重新處理會改用免費研究（MusicBrainz、維基百科），也可以到設計總覽用 claude.ai 研究。",
};

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
          <Tag tone={isClaudeResearch(research) ? "tint" : "neutral"}>{TAG_LABEL[research.engine] ?? TAG_LABEL.offline}</Tag>
          {research.model && <Tag className="t-latin">{research.model}</Tag>}
          {research.createdAt && <span className="text-c-footnote text-label-2 tabular">{formatDate(research.createdAt)}</span>}
        </div>
        {FOOTNOTE[research.engine] && <Footnote className="mt-1">{FOOTNOTE[research.engine]}</Footnote>}
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
