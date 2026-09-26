import { describe, expect, it } from "vitest";
import { hotkeyAction, targetOwnsKey, type KeyLike } from "./hotkeys";

function key(code: string, over: Partial<KeyLike> = {}): KeyLike {
  return { code, key: over.key ?? code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over };
}

describe("hotkeyAction", () => {
  it("maps the documented keys", () => {
    expect(hotkeyAction(key("Space", { key: " " }))).toEqual({ type: "togglePlay" });
    expect(hotkeyAction(key("ArrowRight"))).toEqual({ type: "next" });
    expect(hotkeyAction(key("ArrowDown"))).toEqual({ type: "next" });
    expect(hotkeyAction(key("ArrowLeft"))).toEqual({ type: "prev" });
    expect(hotkeyAction(key("ArrowUp"))).toEqual({ type: "prev" });
    expect(hotkeyAction(key("Enter"))).toEqual({ type: "cueSelected" });
    expect(hotkeyAction(key("KeyB", { key: "b" }))).toEqual({ type: "blackout" });
    expect(hotkeyAction(key("KeyL", { key: "l" }))).toEqual({ type: "lyrics" });
    expect(hotkeyAction(key("KeyF", { key: "f" }))).toEqual({ type: "freeze" });
    expect(hotkeyAction(key("Digit3", { key: "3" }))).toEqual({ type: "scene", slot: 3 });
    expect(hotkeyAction(key("Numpad9", { key: "9" }))).toEqual({ type: "scene", slot: 9 });
    expect(hotkeyAction(key("Digit0", { key: "0" }))).toEqual({ type: "followPlan" });
    expect(hotkeyAction(key("BracketLeft", { key: "[" }))).toEqual({ type: "offset", delta: -0.05 });
    expect(hotkeyAction(key("BracketRight", { key: "]" }))).toEqual({ type: "offset", delta: 0.05 });
    expect(hotkeyAction(key("KeyT", { key: "t" }))).toEqual({ type: "tap" });
    expect(hotkeyAction(key("KeyO", { key: "o" }))).toEqual({ type: "openOutput" });
    expect(hotkeyAction(key("KeyM", { key: "m" }))).toEqual({ type: "mode" });
    expect(hotkeyAction(key("Slash", { key: "?", shiftKey: true }))).toEqual({ type: "help" });
    expect(hotkeyAction(key("Escape"))).toEqual({ type: "escape" });
  });

  it("works with an IME active (key = Process, code = physical key)", () => {
    expect(hotkeyAction(key("KeyB", { key: "Process" }))).toEqual({ type: "blackout" });
  });

  it("shift variants: selection and fine offset", () => {
    expect(hotkeyAction(key("ArrowDown", { shiftKey: true }))).toEqual({ type: "select", delta: 1 });
    expect(hotkeyAction(key("ArrowUp", { shiftKey: true }))).toEqual({ type: "select", delta: -1 });
    expect(hotkeyAction(key("BracketRight", { shiftKey: true }))).toEqual({ type: "offset", delta: 0.01 });
    expect(hotkeyAction(key("Digit1", { shiftKey: true }))).toBeNull();
    expect(hotkeyAction(key("KeyB", { shiftKey: true }))).toBeNull();
  });

  it("ignores modifier shortcuts and auto-repeat of toggles", () => {
    expect(hotkeyAction(key("KeyB", { ctrlKey: true }))).toBeNull();
    expect(hotkeyAction(key("KeyL", { metaKey: true }))).toBeNull();
    expect(hotkeyAction(key("KeyB", { repeat: true }))).toBeNull();
    expect(hotkeyAction(key("Space", { repeat: true }))).toBeNull();
    // arrows and offsets may repeat
    expect(hotkeyAction(key("ArrowRight", { repeat: true }))).toEqual({ type: "next" });
    expect(hotkeyAction(key("BracketLeft", { repeat: true }))).toEqual({ type: "offset", delta: -0.05 });
    expect(hotkeyAction(key("KeyQ"))).toBeNull();
  });
});

describe("targetOwnsKey", () => {
  it("text fields and selects keep every key", () => {
    expect(targetOwnsKey({ tagName: "INPUT", type: "text" }, "KeyB")).toBe(true);
    expect(targetOwnsKey({ tagName: "TEXTAREA" }, "Space")).toBe(true);
    expect(targetOwnsKey({ tagName: "SELECT" }, "ArrowDown")).toBe(true);
    expect(targetOwnsKey({ tagName: "DIV", isContentEditable: true }, "KeyB")).toBe(true);
  });

  it("sliders keep only their navigation keys", () => {
    expect(targetOwnsKey({ tagName: "INPUT", type: "range" }, "ArrowLeft")).toBe(true);
    expect(targetOwnsKey({ tagName: "INPUT", type: "range" }, "KeyB")).toBe(false);
    expect(targetOwnsKey({ tagName: "INPUT", type: "range" }, "Space")).toBe(false);
  });

  it("buttons keep Enter but not Space or letters", () => {
    expect(targetOwnsKey({ tagName: "BUTTON" }, "Enter")).toBe(true);
    expect(targetOwnsKey({ tagName: "BUTTON" }, "Space")).toBe(false);
    expect(targetOwnsKey({ tagName: "BUTTON" }, "KeyB")).toBe(false);
    expect(targetOwnsKey({ tagName: "DIV" }, "Enter")).toBe(false);
    expect(targetOwnsKey(null, "Enter")).toBe(false);
  });
});
