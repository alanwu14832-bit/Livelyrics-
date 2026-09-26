import Link from "next/link";
import { cx } from "@/components/ui";

/** Livelyrics wordmark: a spotlight over two lyric lines, plus the name. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="ll-brand-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5a36" />
          <stop offset="1" stopColor="#8b6cff" />
        </linearGradient>
        <radialGradient id="ll-brand-beam" cx="0.5" cy="0" r="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="url(#ll-brand-bg)" />
      <path d="M13 5h6l5 16H8z" fill="url(#ll-brand-beam)" />
      <circle cx="16" cy="6" r="2" fill="#ffffff" />
      <rect x="7" y="19" width="18" height="3" rx="1.5" fill="#ffffff" />
      <rect x="10" y="24.5" width="12" height="2.4" rx="1.2" fill="#ffffff" fillOpacity="0.7" />
    </svg>
  );
}

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      className={cx("group inline-flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent", className)}
      aria-label="Livelyrics 作品庫"
    >
      <BrandMark size={compact ? 24 : 34} />
      <span className="flex flex-col leading-none">
        <span className={cx("font-semibold tracking-tight text-fg", compact ? "text-sm" : "text-xl")}>Livelyrics</span>
        {!compact && <span className="mt-1 text-xs text-muted">為樂團打造的舞台歌詞視覺</span>}
      </span>
    </Link>
  );
}
