"use client";

// Menu and Popover (UI-AUDIT §3.3 Popover / Menu): project card ⋯, editor row ⋯, the appearance
// menu, "connect Claude" help. Popover API (top layer, light dismiss, Esc) + manual placement next
// to the trigger; the surface grows out of the trigger side: scale .97 + blur + opacity in 150 ms,
// opacity out in 100 ms (.ui-popover in globals.css). Surface: --material-thick (solid inside the
// console: no backdrop-filter over the stage preview), radius 10, padding 5, min width 200.
//
//   <Menu label="更多動作" placement="bottom-end"
//     trigger={(p) => <Button {...p} variant="quiet" size="icon-sm" aria-label="更多動作" icon={DotsThreeIcon} />}>
//     <MenuItem icon={PencilSimpleIcon} href={`/p/${id}/lyrics`}>編輯歌詞</MenuItem>
//     <MenuItem icon={ArrowClockwiseIcon} shortcut="Meta+R" onSelect={reprocess}>重新處理…</MenuItem>
//     <MenuSeparator />
//     <MenuItem icon={TrashIcon} destructive onSelect={askDelete}>刪除</MenuItem>
//   </Menu>
//
// Items: 32 px (28 in the console), 13 / 400, radius 6, 16 px label-2 icon, trailing Kbd; the
// highlight (hover and keyboard) is --tint-fill with white text, destructive items are red and
// highlight in --red-fill. Keys: ↑ ↓ Home End move, Enter / Space choose, Esc / Tab close (focus
// returns to the trigger), typing a letter jumps to the next item starting with it. On the
// trigger: Enter / Space / ↓ open on the first item, ↑ on the last.
//
//   <Popover label="連接 Claude" trigger={(p) => <Button {...p} variant="plain">連接 Claude</Button>}>
//     …any content…
//   </Popover>

import Link from "next/link";
import { createContext, useContext, useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { useAnchoredSurface } from "./Floating";
import { CheckIcon, type UiIcon } from "./Icon";
import { createTypeahead, rovingIndex, type Placement } from "./interaction";
import { Kbd } from "./Kbd";
import { renderIcon } from "./render-icon";

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

const SURFACE = cx(
  // --focus-ring is re-resolved here: portalled surfaces carry their own data-theme scope
  "ui-popover fixed [inset:auto] outline-none [--focus-ring:var(--tint)]",
  // over the console (and its WebGL preview) floating layers are solid: no backdrop-filter
  "data-[theme=console]:bg-elevated data-[theme=console]:[backdrop-filter:none] data-[theme=console]:[-webkit-backdrop-filter:none]",
  "in-data-[theme=console]:bg-elevated in-data-[theme=console]:[backdrop-filter:none] in-data-[theme=console]:[-webkit-backdrop-filter:none]",
);

export interface TriggerProps {
  ref: (el: HTMLElement | null) => void;
  "aria-haspopup": "menu" | "dialog";
  "aria-expanded": boolean;
  "aria-controls": string;
  onPointerDown: () => void;
  onClick: (e: { detail: number }) => void;
  onKeyDown: (e: { key: string; preventDefault: () => void }) => void;
}

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Menu({
  label,
  trigger,
  children,
  placement = "bottom-start",
  minWidth = 200,
  onOpenChange,
  className,
}: {
  /** accessible name of the menu */
  label: string;
  /** render the trigger; spread the props onto a Button */
  trigger: (props: TriggerProps) => ReactElement;
  children: ReactNode;
  placement?: Placement;
  minWidth?: number;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const id = useId();
  const typeahead = useRef(createTypeahead());
  const { hide, surfaceRef, layer, triggerProps } = useAnchoredSurface({ placement, onOpenChange, focusables: ITEM_SELECTOR });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the menu owns the keyboard while open
    const surface = surfaceRef.current;
    if (!surface) return;
    const items = Array.from(surface.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    const current = items.findIndex((el) => el === document.activeElement);
    if (e.key === "Tab") {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === " " && current >= 0 && items[current].tagName === "A") {
      e.preventDefault();
      items[current].click();
      return;
    }
    const next = rovingIndex(e.key, current, items.length, { orientation: "vertical" });
    if (next != null) {
      e.preventDefault();
      items[next]?.focus({ preventScroll: true });
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const labels = items.map((el) => el.dataset.text ?? el.textContent ?? "");
      const hit = typeahead.current.next(e.key, performance.now(), labels, current);
      if (hit != null) {
        e.preventDefault();
        items[hit].focus({ preventScroll: true });
      }
    }
  };

  return (
    <>
      {trigger({ ...triggerProps, "aria-haspopup": "menu", "aria-controls": id })}
      {layer &&
        createPortal(
          <MenuContext.Provider value={{ close: hide }}>
            <div
              ref={surfaceRef}
              id={id}
              popover="auto"
              role="menu"
              aria-label={label}
              tabIndex={-1}
              data-theme={layer.theme}
              onKeyDown={onKeyDown}
              onPointerLeave={(e) => e.currentTarget.focus({ preventScroll: true })}
              className={cx(SURFACE, className)}
              style={{ minWidth }}
            >
              {children}
            </div>
          </MenuContext.Provider>,
          layer.el,
        )}
    </>
  );
}

export function MenuItem({
  children,
  onSelect,
  href,
  icon,
  shortcut,
  destructive = false,
  disabled = false,
  textValue,
  checked,
  highlighted = false,
}: {
  children: ReactNode;
  onSelect?: () => void;
  /** navigation item (next/link) */
  href?: string;
  icon?: UiIcon | ReactNode;
  /** key combo shown as a Kbd (e.g. "Meta+S") */
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** label for type-to-select when children is not plain text */
  textValue?: string;
  /** a check-mark item (appearance menu); true shows the check */
  checked?: boolean;
  /** force the highlight (static previews only) */
  highlighted?: boolean;
}) {
  const ctx = useContext(MenuContext);
  const cls = cx(
    "group/item flex h-8 w-full min-w-0 items-center gap-2 rounded-xs px-2.5 text-left text-[13px] leading-[18px] outline-none select-none in-data-[theme=console]:h-7 data-[theme=console]:h-7",
    "focus:text-white focus-visible:outline-none",
    destructive ? "text-red-text focus:bg-red-fill" : "text-label focus:bg-tint-fill",
    highlighted && (destructive ? "bg-red-fill text-white!" : "bg-tint-fill text-white!"),
    disabled && "pointer-events-none opacity-35",
  );

  const inner = (
    <>
      {checked !== undefined && (
        <span aria-hidden="true" className={cx("flex w-3.5 shrink-0 group-focus/item:text-white", highlighted ? "text-white" : "text-tint", !checked && "invisible")}>
          <CheckIcon size={14} />
        </span>
      )}
      {icon != null && <span className={cx("flex shrink-0", destructive || highlighted ? "text-current" : "text-label-2 group-focus/item:text-white")}>{renderIcon(icon, 16)}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <Kbd keys={shortcut} className={cx("bg-transparent! shadow-none! group-focus/item:text-white", highlighted && "text-white!")} />}
    </>
  );
  const select = () => {
    onSelect?.();
    ctx?.close();
  };
  const common = {
    role: checked !== undefined ? "menuitemcheckbox" : "menuitem",
    "aria-checked": checked,
    tabIndex: -1,
    "aria-disabled": disabled || undefined,
    "data-text": textValue,
    onPointerMove: (e: { currentTarget: HTMLElement }) => {
      if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
    },
    className: cls,
  } as const;
  if (href && !disabled) {
    return (
      <Link href={href} {...common} role="menuitem" onClick={select}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" {...common} disabled={disabled} onClick={select}>
      {inner}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-2.5 my-[5px] h-(--hairline) bg-separator" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 text-[12px] leading-4 font-semibold text-label-2">{children}</div>;
}

/** Static surface for /ui-lab and docs: the menu as it looks open (not interactive as a menu). */
export function MenuPreview({ children, minWidth = 200, className }: { children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div
      role="presentation"
      className={cx(
        "relative w-max rounded-md p-[5px] text-label shadow-overlay material-thick in-data-[theme=console]:bg-elevated in-data-[theme=console]:[backdrop-filter:none]",
        className,
      )}
      style={{ minWidth }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Popover

export function Popover({
  label,
  trigger,
  children,
  placement = "bottom-start",
  width = 320,
  onOpenChange,
  className,
}: {
  label: string;
  trigger: (props: TriggerProps) => ReactElement;
  children: ReactNode;
  placement?: Placement;
  width?: number;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const id = useId();
  const { surfaceRef, layer, triggerProps } = useAnchoredSurface({ placement, onOpenChange, focusables: "a[href], button:not(:disabled), input, textarea, select, [tabindex='0']" });
  return (
    <>
      {trigger({ ...triggerProps, "aria-haspopup": "dialog", "aria-controls": id })}
      {layer &&
        createPortal(
          <div
            ref={surfaceRef}
            id={id}
            popover="auto"
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            data-theme={layer.theme}
            onKeyDown={(e) => {
              if (e.key === "Escape") return; // the browser closes it
              e.stopPropagation();
            }}
            className={cx(SURFACE, "p-4 text-[13px] leading-5", className)}
            style={{ width }}
          >
            {children}
          </div>,
          layer.el,
        )}
    </>
  );
}
