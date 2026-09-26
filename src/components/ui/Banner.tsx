// Banner (UI-AUDIT §3.3 Toast / Banner, in-page): processing finished, audio error, draft found.
// No coloured box: a --surface group (radius 12; --surface-2 inside the console) with a 20 px
// semantic icon, 15 / 600 title, 13 px label-2 description and buttons on the right. Server-safe.
//
//   <Banner tone="success" title="設計完成" description="…" actions={<Button variant="filled" href=…>進入控制台</Button>} />
//   <Banner tone="error" title="處理失敗" description={message} actions={<Button onClick={retry}>重試</Button>} />
//   <Banner tone="warning" | "info" … />   <Banner animateIn … />  250 ms entrance on first render
//
// role: error -> alert, the rest -> status (keeps e2e: role="status" with 「設計完成」 text).

import type { ReactNode } from "react";
import { cx } from "./cx";
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, WarningIcon } from "./Icon";

export type BannerTone = "success" | "error" | "warning" | "info";

const ICON: Record<BannerTone, ReactNode> = {
  success: <CheckCircleIcon size={20} weight="fill" className="text-green" />,
  error: <WarningCircleIcon size={20} weight="fill" className="text-red" />,
  warning: <WarningIcon size={20} weight="fill" className="text-orange" />,
  info: <InfoIcon size={20} weight="fill" className="text-label-2" />,
};

export function Banner({
  tone = "info",
  title,
  description,
  actions,
  icon,
  animateIn = false,
  role,
  className,
  children,
}: {
  tone?: BannerTone;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** replaces the semantic icon */
  icon?: ReactNode;
  animateIn?: boolean;
  role?: "status" | "alert" | "region";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      data-motion={animateIn ? "move" : undefined}
      className={cx(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 rounded-lg bg-surface px-4 py-3.5 in-data-[theme=console]:rounded-md in-data-[theme=console]:bg-surface-2",
        animateIn && "transition-[opacity,translate] duration-(--dur-toast) ease-out starting:-translate-y-2 starting:opacity-0",
        className,
      )}
    >
      <span className="flex shrink-0 self-start pt-px" aria-hidden="true">
        {icon ?? ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className={cx("text-[15px] leading-5 font-semibold", tone === "error" ? "text-red-text" : "text-label")}>{title}</p>
        {description && <div className="mt-0.5 text-[13px] leading-[18px] text-label-2">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
