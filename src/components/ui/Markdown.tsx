"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./index";

/**
 * Renders research briefs / designer notes (Markdown, GFM). Links open in a new tab.
 * 15 / 22 on pages, 13 / 20 inside the console; tint links, hairline tables, no boxes.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "text-[15px] leading-[22px] text-label in-data-[theme=console]:text-[13px] in-data-[theme=console]:leading-5",
        "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:leading-6 [&_h1]:font-semibold",
        "[&_h2]:mt-5 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:leading-[22px] [&_h2]:font-semibold",
        "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-[13px] [&_h3]:leading-5 [&_h3]:font-semibold [&_h3]:text-label-2",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li]:marker:text-label-2",
        "[&_a]:text-tint-text [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-label",
        "[&_code]:rounded-xs [&_code]:bg-fill-3 [&_code]:px-1 [&_code]:text-[0.9em]",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-separator [&_blockquote]:pl-3 [&_blockquote]:text-label-2",
        "[&_hr]:my-4 [&_hr]:border-0 [&_hr]:h-(--hairline) [&_hr]:bg-separator",
        "[&_table]:my-2 [&_table]:w-full [&_table]:text-[13px] [&_th]:border-b-hairline [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-label-2 [&_td]:border-b-hairline [&_td]:px-2 [&_td]:py-1.5",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, title, children }) => (
            <a href={href} title={title} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
