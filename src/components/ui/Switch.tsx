"use client";

// Switch (UI-AUDIT §3.3 Switch): the iOS toggle. 40 x 24 track (radius 12): off --fill, on
// --green-switch, colour 200 ms ease; a 20 px white knob that slides 16 px on the CSS spring and
// stretches to 24 px while pressed (towards the middle). role="switch" + aria-checked; Space /
// Enter toggle (it is a button). Hit area 32 x 48. Reduced motion: colour only, no slide.
//
//   <Switch checked={on} onChange={setOn} aria-label="表格跟著播放捲動" />
//   <ListRow title="使用 LRCLIB 的時間碼" htmlFor="lrc-times" accessory={<Switch id="lrc-times" … />} />
//     (the row is a <label>: clicking anywhere on it toggles)

import { useState, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export function Switch({
  checked,
  onChange,
  disabled,
  className,
  onClick,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked"> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const [pressed, setPressed] = useState(false);
  const x = checked ? (pressed ? 12 : 16) : 0;
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onChange(!checked);
      }}
      onPointerDown={(e) => {
        if (e.button === 0) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      className={cx(
        "relative inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition-[background-color] duration-200 ease-[ease]",
        "before:absolute before:-inset-x-1 before:-inset-y-1 before:content-['']",
        "disabled:pointer-events-none disabled:opacity-35",
        "forced-colors:border forced-colors:border-[ButtonText] forced-colors:aria-checked:bg-[Highlight]",
        className,
      )}
      style={{ backgroundColor: checked ? "var(--green-switch)" : "var(--fill)" }}
    >
      <span
        aria-hidden="true"
        className="block h-5 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-[transform,width] duration-(--dur-spring) ease-spring motion-reduce:transition-none forced-colors:bg-[ButtonText]"
        style={{ width: pressed ? 24 : 20, transform: `translateX(${x}px)` }}
      />
    </button>
  );
}
