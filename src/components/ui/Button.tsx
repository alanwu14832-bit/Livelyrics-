// Button (UI-AUDIT §3.3 Button). Server-safe; with `href` it renders next/link with the same
// look and focus ring (no more hand-made link buttons).
//
//   <Button variant="filled" size="lg">開始製作</Button>       at most one filled per screen
//   <Button variant="tinted" icon={SparkleIcon}>重新設計</Button>
//   <Button variant="gray">取消</Button>                       default
//   <Button variant="plain">重新搜尋</Button>                  link-style, tint text
//   <Button variant="quiet" size="icon" aria-label="關閉" icon={XIcon} />  icon-only, label-2
//   <Button variant="destructive">刪除</Button>                plain red; "destructive-filled" only in an Alert
//   <Button size="circle" aria-label="播放" icon={PlayIcon} /> the 36 px white play button
//   <Button href="/p/1" transitionTypes={["push"]}>進入控制台</Button>
//   <Button loading>儲存</Button>                              icon becomes a Spinner, aria-busy
//
// Variants: filled | tinted | gray | plain | quiet | destructive | destructive-filled; the old
// names still work (primary -> filled, secondary -> gray, ghost -> quiet, danger -> destructive).
// Sizes: sm 28 | md 32 (default) | lg 44 capsule | icon-sm 28 | icon 32 | circle 36.
// `icon` / `trailingIcon` take an icon component from ./Icon (sized for the button) or a node.
// Press: scale .97 in 80 ms, springs back (filled also dims); plain, quiet and icon-only fade to
// .6 instead. Disabled: opacity .35, label unchanged (put the reason in the text around it).
// `type` defaults to "button": pass type="submit" in forms.

import Link from "next/link";
import { type ButtonHTMLAttributes, type ComponentProps, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import type { UiIcon } from "./Icon";
import { renderIcon } from "./render-icon";
import { Spinner } from "./Spinner";

export type ButtonVariant = "filled" | "tinted" | "gray" | "plain" | "quiet" | "destructive" | "destructive-filled";
/** @deprecated names from the pre-redesign kit */
export type LegacyButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon" | "circle";

const LEGACY: Record<LegacyButtonVariant, ButtonVariant> = { primary: "filled", secondary: "gray", ghost: "quiet", danger: "destructive" };

interface ButtonOwnProps {
  variant?: ButtonVariant | LegacyButtonVariant;
  size?: ButtonSize;
  /** latched "on" state (tinted look); prefer aria-pressed on a toggle */
  active?: boolean;
  /** replaces the icon with a Spinner and sets aria-busy; the label stays */
  loading?: boolean;
  icon?: UiIcon | ReactNode;
  trailingIcon?: UiIcon | ReactNode;
  className?: string;
  children?: ReactNode;
}

type LinkProps = ComponentProps<typeof Link>;
export type ButtonAsButton = ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & { href?: undefined; ref?: Ref<HTMLButtonElement> };
export type ButtonAsLink = ButtonOwnProps & Omit<LinkProps, keyof ButtonOwnProps | "href"> & { href: LinkProps["href"]; disabled?: boolean };
export type ButtonProps = ButtonAsButton | ButtonAsLink;

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 rounded-sm px-2.5 text-[12px] leading-4",
  md: "h-8 rounded-sm px-3 text-[13px] leading-[18px]",
  lg: "h-11 rounded-pill px-[22px] text-[17px] leading-6",
  "icon-sm": "size-7 rounded-sm",
  icon: "size-8 rounded-sm",
  circle: "size-9 rounded-full",
};

const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 20, "icon-sm": 16, icon: 20, circle: 20 };

const VARIANT: Record<ButtonVariant, string> = {
  filled: "bg-tint-fill text-on-tint hover:bg-tint-fill-hover active:brightness-[.94]",
  tinted: "bg-tint-soft text-tint-text-on-soft hover:bg-[color-mix(in_srgb,var(--tint-soft)_93%,var(--tint))]",
  gray: "bg-fill-3 text-label hover:bg-fill-2",
  plain: "text-tint-text hover:bg-fill-4",
  quiet: "text-label-2 hover:bg-fill-4 hover:text-label",
  destructive: "text-red-text hover:bg-red-soft",
  "destructive-filled": "bg-red-fill text-white hover:brightness-110 active:brightness-[.94]",
};

/** Resolve the look: legacy names, the circle, and which press feedback applies. */
export function buttonClasses({ variant = "gray", size = "md", active = false, className }: Pick<ButtonOwnProps, "variant" | "size" | "active" | "className">): { className: string; variant: ButtonVariant } {
  const v: ButtonVariant = variant in LEGACY ? LEGACY[variant as LegacyButtonVariant] : (variant as ButtonVariant);
  const iconOnly = size === "icon" || size === "icon-sm";
  const fades = v === "plain" || v === "quiet" || v === "destructive" || (iconOnly && v !== "filled" && v !== "tinted");
  const weight = size === "lg" ? "font-normal" : v === "filled" || v === "destructive-filled" ? "font-semibold" : "font-medium";
  return {
    variant: v,
    className: cx(
      "ui-button relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none no-underline",
      "disabled:pointer-events-none disabled:opacity-35 aria-disabled:pointer-events-none aria-disabled:opacity-35",
      SIZE[size],
      weight,
      size === "circle" ? "bg-label text-bg hover:opacity-90" : active ? "bg-tint-soft text-tint-text-on-soft" : VARIANT[v],
      fades ? "press-fade" : "press",
      className,
    ),
  };
}

export function Button(props: ButtonProps) {
  const { variant, size = "md", active, loading = false, icon, trailingIcon, className, children, ...rest } = props;
  const look = buttonClasses({ variant, size, active, className });
  const px = ICON_PX[size];
  const lead = loading ? <Spinner size={px} inheritColor /> : renderIcon(icon, px);
  const content = (
    <>
      {lead}
      {children}
      {renderIcon(trailingIcon, px)}
    </>
  );

  if ("href" in rest && rest.href != null) {
    const { href, disabled, ...linkRest } = rest as Omit<ButtonAsLink, keyof ButtonOwnProps>;
    if (disabled) {
      return (
        <span role="link" aria-disabled="true" data-variant={look.variant} data-size={size} className={look.className}>
          {content}
        </span>
      );
    }
    return (
      <Link href={href} data-variant={look.variant} data-size={size} aria-busy={loading || undefined} {...linkRest} className={look.className}>
        {content}
      </Link>
    );
  }

  const { type = "button", ...buttonRest } = rest as Omit<ButtonAsButton, keyof ButtonOwnProps>;
  return (
    <button type={type} data-variant={look.variant} data-size={size} aria-busy={loading || undefined} {...buttonRest} className={look.className}>
      {content}
    </button>
  );
}
