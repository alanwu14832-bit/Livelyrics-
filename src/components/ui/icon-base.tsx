// Shared wrapper for the kit's Phosphor icons (see ./Icon): size in px, weight from size.
import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps, IconWeight } from "@phosphor-icons/react/lib";
import type { ReactElement } from "react";

export type { IconWeight };
export type IconProps = Omit<PhosphorIconProps, "size"> & {
  /** px; default 16 */
  size?: number;
};
/** One of the icon components exported by ./Icon. */
export type UiIcon = ((props: IconProps) => ReactElement) & { displayName?: string };

/** House rule: small icons are bold (about 1.5 px strokes, like small SF Symbols), 20 px and up regular. */
export function iconWeight(size: number): IconWeight {
  return size <= 17 ? "bold" : "regular";
}

export function makeIcon(Component: PhosphorIcon, displayName: string, fixedWeight?: IconWeight): UiIcon {
  function UiIconComponent({ size = 16, weight, ...rest }: IconProps) {
    const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null || rest.alt != null;
    return <Component size={size} weight={weight ?? fixedWeight ?? iconWeight(size)} aria-hidden={labelled ? undefined : true} focusable="false" {...rest} />;
  }
  UiIconComponent.displayName = displayName;
  return UiIconComponent;
}
