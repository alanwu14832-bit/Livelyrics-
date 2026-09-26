// InsetGroup, ListRow and FormRow (UI-AUDIT §3.3 InsetGroupedList / ListRow). Server-safe.
// Density follows the theme scope: pages get 44 px rows, 17 / 13 px text, 20 px icons on
// --surface groups (radius 12); inside data-theme="console" rows are 32 px, 13 / 12 px text,
// 16 px icons on --surface-2 groups (radius 10). No borders, no shadows: rows are separated by a
// hairline that starts where the text starts (not under the leading icon); the last row has none.
//
//   <InsetGroup header="歌曲資訊" footer="時間碼可稍後在歌詞編輯器調整。">
//     <ListRow title="歌名" value="示範之歌" />
//     <ListRow leading={MicrophoneIcon} title="現場音訊輸入" accessory={<Switch …/>} htmlFor="mic" />
//     <ListRow title="示範之歌" subtitle="示範樂團，示範專輯，3:29" accessory="check" onClick={…} />
//     <ListRow title="設計總覽" accessory="disclosure" href="/p/1/process" />
//     <ListRow title="刪除作品" destructive onClick={…} />
//     <ListRow title="第二句歌詞" state="current" />      the one current-row look (tint bar + soft fill)
//   </InsetGroup>
//
//   <FormRow label="歌名" htmlFor="title" error={err}><input id="title" className={rowInputClass} /></FormRow>
//
// Clickable rows: hover fill-4, pressed fill-3 at once (no transition, no scale: rows are hit a
// lot), inset focus ring. A row with `htmlFor` is a <label>, so clicking anywhere toggles the
// Switch / checkbox it names.

import Link from "next/link";
import { isValidElement, type CSSProperties, type HTMLAttributes, type MouseEventHandler, type ReactNode } from "react";
import { cx } from "./cx";
import { CaretRightIcon, CheckIcon, type UiIcon } from "./Icon";
import { renderIcon } from "./render-icon";

const CONSOLE = {
  group: "in-data-[theme=console]:rounded-md in-data-[theme=console]:bg-surface-2",
  header: "in-data-[theme=console]:text-[12px] in-data-[theme=console]:leading-4 in-data-[theme=console]:font-semibold",
  title: "in-data-[theme=console]:text-[13px] in-data-[theme=console]:leading-[18px]",
  subtitle: "in-data-[theme=console]:text-[12px] in-data-[theme=console]:leading-4",
  rowRadius: "first:rounded-t-lg last:rounded-b-lg in-data-[theme=console]:first:rounded-t-md in-data-[theme=console]:last:rounded-b-md",
};

export function InsetGroup({
  header,
  footer,
  headerLevel = 3,
  className,
  bodyClassName,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  header?: ReactNode;
  footer?: ReactNode;
  headerLevel?: 2 | 3 | 4;
  bodyClassName?: string;
}) {
  const H = `h${headerLevel}` as "h2" | "h3" | "h4";
  return (
    <section {...rest} className={cx("min-w-0", className)}>
      {header && <H className={cx("mb-1.5 px-(--row-pad-x) text-[13px] leading-5 font-normal text-label-2", CONSOLE.header)}>{header}</H>}
      <div className={cx("overflow-hidden rounded-lg bg-surface", CONSOLE.group, bodyClassName)}>{children}</div>
      {footer && <p className="mt-1.5 px-(--row-pad-x) text-[12px] leading-4 text-label-2">{footer}</p>}
    </section>
  );
}

/** Render an icon component at the page (20) and console (16) size, or pass a node through. */
function leadingNode(leading: UiIcon | ReactNode): ReactNode {
  if (leading == null || leading === false) return null;
  if (isValidElement(leading) || typeof leading !== "function") return leading as ReactNode;
  const C = leading as UiIcon;
  return (
    <>
      <C size={20} className="in-data-[theme=console]:hidden" />
      <C size={16} className="hidden in-data-[theme=console]:block" />
    </>
  );
}

export type RowAccessory = "disclosure" | "check" | ReactNode;

function accessoryNode(accessory: RowAccessory): ReactNode {
  if (accessory === "disclosure") return <CaretRightIcon size={14} className="shrink-0 text-label-3" />;
  if (accessory === "check") return <CheckIcon size={16} className="shrink-0 text-tint" aria-label="已選取" />;
  return accessory;
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** trailing value, label-2 */
  value?: ReactNode;
  /** leading icon (component from ./Icon, sized per density) or node */
  leading?: UiIcon | ReactNode;
  /** Settings-style colour tile behind the leading icon (pages only): any CSS colour */
  leadingTile?: string;
  accessory?: RowAccessory;
  destructive?: boolean;
  state?: "current" | "standby" | "selected";
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** render a <label> for this control id: the whole row toggles it */
  htmlFor?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
  role?: string;
  "aria-label"?: string;
  "aria-current"?: HTMLAttributes<HTMLElement>["aria-current"];
  "aria-selected"?: boolean;
}

export function ListRow({
  title,
  subtitle,
  value,
  leading,
  leadingTile,
  accessory,
  destructive = false,
  state,
  href,
  onClick,
  htmlFor,
  disabled = false,
  className,
  children,
  ...aria
}: ListRowProps) {
  const interactive = href != null || onClick != null || htmlFor != null;
  const hasLeading = leading != null && leading !== false;
  const sepInset = hasLeading ? (leadingTile ? "calc(var(--row-pad-x) + 40px)" : "calc(var(--row-pad-x) + var(--row-icon) + 12px)") : "var(--row-pad-x)";
  const cls = cx(
    "relative flex min-h-(--row-min-h) w-full min-w-0 items-center gap-3 px-(--row-pad-x) text-left text-label [--row-icon:20px] in-data-[theme=console]:[--row-icon:16px]",
    "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-(--sep-inset) after:h-(--hairline) after:bg-separator last:after:hidden",
    interactive && !disabled && cx("transition-none hover:bg-fill-4 active:bg-fill-3 focus-inset", CONSOLE.rowRadius),
    state === "current" && "row-current",
    state === "standby" && "row-standby",
    state === "selected" && "row-selected",
    disabled && "pointer-events-none opacity-35",
    className,
  );
  const style = { "--sep-inset": sepInset } as CSSProperties;
  const body = (
    <>
      {hasLeading &&
        (leadingTile ? (
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-white in-data-[theme=console]:size-5 in-data-[theme=console]:rounded-[5px]" style={{ background: leadingTile }}>
            {renderIcon(leading, 16)}
          </span>
        ) : (
          <span aria-hidden="true" className={cx("flex shrink-0 items-center", destructive ? "text-red-text" : "text-label-2")}>
            {leadingNode(leading)}
          </span>
        ))}
      <span className="flex min-w-0 flex-1 flex-col justify-center py-2.5 in-data-[theme=console]:py-1.5">
        <span className={cx("min-w-0 truncate text-[17px] leading-[22px]", CONSOLE.title, destructive && "text-red-text", state === "current" && "font-semibold")}>{title}</span>
        {subtitle && <span className={cx("min-w-0 text-[13px] leading-[18px] text-label-2", CONSOLE.subtitle)}>{subtitle}</span>}
        {children}
      </span>
      {value != null && <span className={cx("shrink-0 text-[17px] leading-[22px] text-label-2 tabular", CONSOLE.title)}>{value}</span>}
      {accessory != null && accessoryNode(accessory)}
    </>
  );

  if (href != null && !disabled) {
    return (
      <Link href={href} className={cls} style={style} onClick={onClick} {...aria}>
        {body}
      </Link>
    );
  }
  if (htmlFor != null) {
    return (
      <label htmlFor={htmlFor} className={cls} style={style} onClick={onClick} {...aria}>
        {body}
      </label>
    );
  }
  if (onClick != null) {
    return (
      <button type="button" disabled={disabled} className={cls} style={style} onClick={onClick} {...aria}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={style} {...aria}>
      {body}
    </div>
  );
}

/** Borderless input for a FormRow: the row draws the focus ring. */
export const rowInputClass =
  "min-w-0 flex-1 bg-transparent py-2 text-[15px] leading-[22px] text-label placeholder:text-label-2 focus-visible:outline-none in-data-[theme=console]:text-[13px] in-data-[theme=console]:leading-[18px]";

/**
 * A labelled field row: 13 px label-2 label on the left, a borderless control on the right; the
 * whole row gets an inset 2 px tint ring while the control has keyboard focus, and a red ring plus
 * a 12 px message when `error` is set (give the input aria-invalid and
 * aria-describedby={`${htmlFor}-error`}).
 */
export function FormRow({
  label,
  htmlFor,
  error,
  labelWidth = 96,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: ReactNode;
  labelWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "relative flex min-h-(--row-min-h) min-w-0 flex-col justify-center px-(--row-pad-x)",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-(--row-pad-x) after:h-(--hairline) after:bg-separator last:after:hidden",
        CONSOLE.rowRadius,
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-tint has-[:focus-visible]:outline-solid",
        error != null && error !== false && "outline-2 -outline-offset-2 outline-red outline-solid",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <label htmlFor={htmlFor} className="shrink-0 text-[13px] leading-5 text-label-2" style={{ width: labelWidth }}>
          {label}
        </label>
        {children}
      </div>
      {error != null && error !== false && (
        <p id={`${htmlFor}-error`} className="pb-2 text-[12px] leading-4 text-red-text" style={{ paddingLeft: labelWidth + 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
