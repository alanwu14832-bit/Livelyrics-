// EmptyState (UI-AUDIT §3.3 Empty state): centred; 44 px label-2 icon, 17 / 600 title, 15 / 22
// label-2 description (max 32em), at most one action (plain or tinted). Server-safe.
//
//   <EmptyState icon={MusicNotesIcon} title="還沒有作品" description="把一首歌拖到上方，AI 會研究並設計它的舞台視覺。" />
//   <EmptyState … action={<Button variant="tinted">重新載入</Button>} />

import type { ReactNode } from "react";
import { cx } from "./cx";
import type { UiIcon } from "./icon-base";
import { renderIcon } from "./render-icon";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: UiIcon | ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** console panes: 32 px icon, 15 / 13 px text */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 text-center", compact ? "py-8" : "py-14", className)}>
      {icon != null && <span className="mb-3 text-label-2" aria-hidden="true">{renderIcon(icon, compact ? 32 : 44)}</span>}
      <p className={cx("font-semibold text-label", compact ? "text-[15px] leading-5" : "text-[17px] leading-6")}>{title}</p>
      {description && <div className={cx("mt-1 max-w-[32em] text-label-2", compact ? "text-[13px] leading-[18px]" : "text-[15px] leading-[22px]")}>{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
