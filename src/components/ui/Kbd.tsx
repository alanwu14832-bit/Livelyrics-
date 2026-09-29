// Kbd (UI-AUDIT §3.3 Kbd): a key cap. 20 px high, min 20 wide, radius 5, fill-3 with a 1 px
// bottom edge, 11 / 500 system font (not mono), secondary text (--label-2-on-material, which clears
// AA on the fill in light; plain label-2 would be 4.0:1). Server-safe.
//
//   <Kbd>B</Kbd>                 as written (legacy)
//   <Kbd keys="Shift+ArrowUp" /> glyphs: ⇧↑ (⌘ ⇧ ⌥ ⌃ ← → ↑ ↓ ⌫, "Space")
//   <Kbd keys="Meta+s" />        ⌘S

import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { keyLabel } from "./interaction";

export function Kbd({ keys, className, children, ...props }: HTMLAttributes<HTMLElement> & { keys?: string }) {
  return (
    <kbd
      {...props}
      className={cx(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-fill-3 px-[5px] font-sans text-[11px] leading-none font-medium text-label-2-on-material shadow-[inset_0_-1px_0_var(--separator)]",
        className,
      )}
    >
      {keys != null ? keyLabel(keys) : children}
    </kbd>
  );
}
