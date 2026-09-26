import { isValidElement, type ReactNode } from "react";
import type { UiIcon } from "./Icon";

/** An icon component from ./Icon rendered at `px`, or any node passed through unchanged. */
export function renderIcon(icon: UiIcon | ReactNode | undefined, px: number, className?: string): ReactNode {
  if (icon == null || icon === false) return null;
  if (isValidElement(icon) || typeof icon !== "function") return icon as ReactNode;
  const C = icon as UiIcon;
  return <C size={px} className={className} />;
}
