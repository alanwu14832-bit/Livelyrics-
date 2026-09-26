// Operator UI component kit (docs/UI-AUDIT.md §3.3, Apple website + iOS HIG). Server-safe barrel:
// this module has no "use client", so server components can import Button, Kbd, Tag, cx and the
// other hook-free parts; interactive parts are "use client" modules re-exported from here.
// Every component documents its API at the top of its file; /ui-lab shows each one in every state
// in light, dark and console themes. Icons: ./Icon (not re-exported here, to keep names short).
//
// Pre-redesign exports keep their signatures: Button (variant primary / secondary / ghost / danger
// still accepted), Panel, Badge, Kbd, cx; Markdown stays in ./Markdown.

export { cx } from "./cx";

// server-safe
export { Button, buttonClasses, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Kbd } from "./Kbd";
export { Tag, StatusCapsule, Badge, type TagTone, type CapsuleTone } from "./Tag";
export { Panel } from "./Panel";
export { Spinner } from "./Spinner";
export { ProgressBar } from "./ProgressBar";
export { InsetGroup, ListRow, FormRow, rowInputClass, type ListRowProps, type RowAccessory } from "./InsetGroup";
export { TextField, TextArea, Select } from "./Field";
export { Banner, type BannerTone } from "./Banner";
export { EmptyState } from "./EmptyState";
export { Skeleton, SkeletonText, SkeletonGroup } from "./Skeleton";
export { Disclosure } from "./Disclosure";
export { Z } from "./z";

// client
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { Switch } from "./Switch";
export { Slider } from "./Slider";
export { Stepper } from "./Stepper";
export { Alert, Sheet, type AlertProps, type SheetProps } from "./Dialog";
export { Menu, MenuItem, MenuSeparator, MenuLabel, MenuPreview, Popover, type TriggerProps } from "./Menu";
export { Tooltip, TooltipPreview } from "./Tooltip";
export { ToastStack, ToastPreview, useToasts, type ToastItem, type ToastTone } from "./Toast";
export { AppHeader, BackLink, pageContainerClass } from "./AppHeader";
export { HUD, HudPreview, type HudContent, type HudHandle } from "./HUD";
export { StatusCapsules, type CapsuleItem } from "./StatusCapsules";
export { IconProvider } from "./IconProvider";
