"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { XIcon } from "./icons";

/**
 * Modal built on the native <dialog> (top layer, focus trapping and Esc for free).
 * `onClose` fires for Esc, the close button and a backdrop click.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** false while a destructive/async action is in flight */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onMouseDown={(e) => {
        // a click on the backdrop targets the <dialog> itself
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
      className={cx(
        "m-auto max-h-[85vh] w-[min(92vw,34rem)] overflow-hidden rounded-xl border border-line bg-panel p-0 text-fg shadow-2xl shadow-black/60",
        "backdrop:bg-black/65 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-fg">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!dismissible}
              aria-label="關閉"
              className="-mr-1 rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
            >
              <XIcon />
            </button>
          </header>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-panel-2/60 px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
