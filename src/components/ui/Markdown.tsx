"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./index";

/** Renders research briefs / designer notes (Markdown, GFM). Links open in a new tab. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "text-sm leading-relaxed text-fg/90",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-fg",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-muted",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:text-fg",
        "[&_code]:rounded [&_code]:bg-panel-3 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted",
        "[&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
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
