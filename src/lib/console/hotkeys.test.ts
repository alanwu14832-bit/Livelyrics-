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
  it("text fields and editors keep every key", () => {
    expect(targetOwnsKey({ tagName: "INPUT", type: "text" }, "KeyB")).toBe(true);
    expect(targetOwnsKey({ tagName: "TEXTAREA" }, "Space")).toBe(true);
    expect(targetOwnsKey({ tagName: "DIV", isContentEditable: true }, "KeyB")).toBe(true);
  });

  it("selects keep navigation keys but not letters or Space", () => {
    expect(targetOwnsKey({ tagName: "SELECT" }, "ArrowDown")).toBe(true);
    expect(targetOwnsKey({ tagName: "SELECT" }, "Enter")).toBe(true);
    expect(targetOwnsKey({ tagName: "SELECT" }, "KeyB")).toBe(false);
    expect(targetOwnsKey({ tagName: "SELECT" }, "Space")).toBe(false);
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

describe("phase 2b keys", () => {
  it("maps sections, hold, loop, GO and standby by physical key", () => {
    expect(hotkeyAction(key("PageDown"))).toEqual({ type: "section", delta: 1 });
    expect(hotkeyAction(key("PageUp"))).toEqual({ type: "section", delta: -1 });
    expect(hotkeyAction(key("Period", { key: "." }))).toEqual({ type: "section", delta: 1 });
    expect(hotkeyAction(key("Comma", { key: "," }))).toEqual({ type: "section", delta: -1 });
    expect(hotkeyAction(key("KeyH", { key: "h" }))).toEqual({ type: "hold" });
    expect(hotkeyAction(key("KeyR", { key: "r" }))).toEqual({ type: "loop" });
    expect(hotkeyAction(key("KeyG", { key: "g" }))).toEqual({ type: "go" });
    expect(hotkeyAction(key("KeyS", { key: "s" }))).toEqual({ type: "standby" });
    // a Chinese IME reports "Process" (注音 ㄘ on G, ㄋ on S): the physical key still counts
    expect(hotkeyAction(key("KeyG", { key: "Process" }))).toEqual({ type: "go" });
    expect(hotkeyAction(key("KeyS", { key: "ㄋ" }))).toEqual({ type: "standby" });
  });

  it("never repeats GO, standby, hold, loop or a section jump", () => {
    for (const code of ["KeyG", "KeyS", "KeyH", "KeyR", "PageDown", "PageUp", "Period", "Comma"]) {
      expect(hotkeyAction(key(code, { repeat: true }))).toBeNull();
    }
  });

  it("leaves modified and shifted variants alone", () => {
    expect(hotkeyAction(key("KeyS", { metaKey: true }))).toBeNull(); // ⌘S
    expect(hotkeyAction(key("KeyR", { ctrlKey: true }))).toBeNull(); // reload
    expect(hotkeyAction(key("KeyG", { shiftKey: true }))).toBeNull();
    expect(hotkeyAction(key("Period", { shiftKey: true, key: ">" }))).toBeNull();
  });

  it("does not collide with the existing keys", () => {
    const codes = ["Space", "ArrowRight", "ArrowLeft", "Enter", "KeyM", "KeyB", "KeyL", "KeyF", "Digit1", "BracketLeft", "KeyT", "KeyO", "Escape"];
    const types = codes.map((c) => hotkeyAction(key(c))?.type);
    for (const t of ["section", "hold", "loop", "go", "standby"]) expect(types).not.toContain(t);
  });

  it("a focused slider or select keeps Page Up / Down", () => {
    expect(targetOwnsKey({ tagName: "INPUT", type: "range" }, "PageDown")).toBe(true);
    expect(targetOwnsKey({ tagName: "SELECT" }, "PageUp")).toBe(true);
    expect(targetOwnsKey({ tagName: "BUTTON" }, "PageDown")).toBe(false);
  });
});
