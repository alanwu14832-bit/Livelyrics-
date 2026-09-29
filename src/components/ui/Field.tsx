// Text fields and the pop-up button (select). Server-safe. Filled, borderless controls (iOS
// search field look: fill-3, radius 8); placeholder label-2; the focus ring hugs the field.
//
//   <TextField value={q} onChange={…} placeholder="搜尋歌名" />         md 32 px / 13 px (console)
//   <TextField size="lg" … />                                            lg 40 px / 15 px (pages)
//   <TextField invalid aria-describedby="title-error" … />              red ring, aria-invalid
//   <TextArea rows={4} … />                                              15 / 22, resizes vertically
//   <Select value={v} onChange={…}><option …/></Select>                  native select, CaretUpDown

import type { ComponentProps } from "react";
import { cx } from "./cx";
import { CaretUpDownIcon } from "./kit-icons";

const BASE =
  "w-full min-w-0 bg-fill-3 text-label placeholder:text-label-2 transition-[background-color,box-shadow] duration-(--dur-fast) ease-[ease] hover:bg-fill-2 focus-visible:outline-offset-0 disabled:pointer-events-none disabled:opacity-35";
const INVALID = "outline-2 outline-offset-0 outline-red outline-solid";

export function TextField({ size = "md", invalid = false, className, ...props }: Omit<ComponentProps<"input">, "size"> & { size?: "md" | "lg"; invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cx(BASE, "rounded-sm", size === "lg" ? "h-10 px-3 text-[15px]" : "h-8 px-2.5 text-[13px]", invalid && INVALID, className)}
    />
  );
}

export function TextArea({ invalid = false, className, ...props }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cx(BASE, "resize-y rounded-md px-3 py-2.5 text-[15px] leading-[22px] in-data-[theme=console]:text-[13px] in-data-[theme=console]:leading-[18px]", invalid && INVALID, className)}
    />
  );
}

export function Select({ size = "md", className, children, ...props }: Omit<ComponentProps<"select">, "size"> & { size?: "md" | "lg" }) {
  return (
    <span className={cx("relative inline-flex min-w-0", className)}>
      <select {...props} className={cx(BASE, "appearance-none truncate rounded-sm pr-7", size === "lg" ? "h-10 pl-3 text-[15px]" : "h-8 pl-2.5 text-[13px]")}>
        {children}
      </select>
      <CaretUpDownIcon size={14} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-label-2" />
    </span>
  );
}
