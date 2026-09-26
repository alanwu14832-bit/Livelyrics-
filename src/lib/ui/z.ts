// z-index scale for the operator UI (UI-AUDIT §3.3 Toolbar). Popovers, menus, tooltips and dialogs
// use the top layer (Popover API / showModal) and need no z-index. The Tailwind classes used by
// the kit are the matching z-10 / z-20 / z-40 / z-50.
export const Z = {
  /** sticky list section headers (console lyrics) */
  stickyHeader: 10,
  /** AppHeader */
  header: 20,
  /** console HUD over the preview */
  hud: 40,
  /** toast stack */
  toast: 50,
} as const;
