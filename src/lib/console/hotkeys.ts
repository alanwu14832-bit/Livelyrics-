// Console keyboard map (docs/ARCHITECTURE.md → CONSOLE → Hotkeys). Pure: maps a
// keyboard-event-like object to an action. Physical key codes are used for letters and
// digits so the shortcuts keep working while a Chinese IME (注音/倉頡) is active.

export type HotkeyAction =
  | { type: "togglePlay" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "cueSelected" }
  | { type: "select"; delta: 1 | -1 }
  | { type: "blackout" }
  | { type: "lyrics" }
  | { type: "freeze" }
  | { type: "scene"; slot: number }
  | { type: "followPlan" }
  | { type: "offset"; delta: number }
  | { type: "tap" }
  | { type: "openOutput" }
  | { type: "mode" }
  | { type: "help" }
  | { type: "escape" };

export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
}

export const OFFSET_STEP = 0.05;
export const OFFSET_FINE_STEP = 0.01;

const DIGIT = /^(?:Digit|Numpad)([0-9])$/;

/** Returns the action for a key press, or null when the key is not a console hotkey. */
export function hotkeyAction(e: KeyLike): HotkeyAction | null {
  // leave browser / OS shortcuts alone
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const repeat = !!e.repeat;
  const code = e.code;
  const key = e.key;

  if (key === "?" || (code === "Slash" && e.shiftKey)) return repeat ? null : { type: "help" };
  if (code === "Escape" || key === "Escape") return { type: "escape" };

  switch (code) {
    case "Space":
      return repeat ? null : { type: "togglePlay" };
    case "ArrowRight":
    case "ArrowDown":
      return e.shiftKey ? { type: "select", delta: 1 } : { type: "next" };
    case "ArrowLeft":
    case "ArrowUp":
      return e.shiftKey ? { type: "select", delta: -1 } : { type: "prev" };
    case "Enter":
    case "NumpadEnter":
      return repeat ? null : { type: "cueSelected" };
    case "BracketLeft":
      return { type: "offset", delta: e.shiftKey ? -OFFSET_FINE_STEP : -OFFSET_STEP };
    case "BracketRight":
      return { type: "offset", delta: e.shiftKey ? OFFSET_FINE_STEP : OFFSET_STEP };
    default:
      break;
  }
  if (repeat) return null;

  const digit = DIGIT.exec(code);
  if (digit && !e.shiftKey) {
    const n = Number(digit[1]);
    return n === 0 ? { type: "followPlan" } : { type: "scene", slot: n };
  }
  if (e.shiftKey) return null;
  switch (code) {
    case "KeyB":
      return { type: "blackout" };
    case "KeyL":
      return { type: "lyrics" };
    case "KeyF":
      return { type: "freeze" };
    case "KeyT":
      return { type: "tap" };
    case "KeyO":
      return { type: "openOutput" };
    case "KeyM":
      return { type: "mode" };
    default:
      return null;
  }
}

/** Keys a focused range slider handles itself. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  role?: string | null;
}

/** Keys a focused <select> handles itself (letters stay hotkeys: B must always work). */
const SELECT_KEYS = new Set([...SLIDER_KEYS, "Enter", "NumpadEnter"]);

/**
 * Whether a key press on `target` belongs to that element instead of the console:
 * text fields / editors swallow everything; sliders and selects keep their navigation
 * keys; buttons, links and checkboxes keep Enter (Space always stays the transport).
 */
export function targetOwnsKey(target: TargetLike | null | undefined, code: string): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return SELECT_KEYS.has(code);
  if (tag === "INPUT") {
    const type = (target.type ?? "text").toLowerCase();
    if (type === "range") return SLIDER_KEYS.has(code);
    if (type === "checkbox" || type === "radio" || type === "button" || type === "submit" || type === "reset") {
      return code === "Enter" || code === "NumpadEnter";
    }
    return true;
  }
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || target.role === "button" || target.role === "tab") {
    return code === "Enter" || code === "NumpadEnter";
  }
  return false;
}

export interface HotkeyHelpEntry {
  keys: string[];
  label: string;
}

export interface HotkeyHelpGroup {
  title: string;
  entries: HotkeyHelpEntry[];
}

export const HOTKEY_HELP: HotkeyHelpGroup[] = [
  {
    title: "播放與提詞",
    entries: [
      { keys: ["Space"], label: "播放／暫停（LIVE 模式：下一句）" },
      { keys: ["→", "↓"], label: "下一句" },
      { keys: ["←", "↑"], label: "上一句" },
      { keys: ["Shift", "↑↓"], label: "移動待命選取（不跳轉）" },
      { keys: ["Enter"], label: "送出待命的歌詞，並前進到下一行" },
      { keys: ["M"], label: "切換 TRACK／LIVE 模式" },
      { keys: ["Esc"], label: "關閉視窗；LIVE 模式下清除目前歌詞" },
    ],
  },
  {
    title: "畫面控制",
    entries: [
      { keys: ["B"], label: "一鍵黑場" },
      { keys: ["L"], label: "歌詞顯示／隱藏" },
      { keys: ["F"], label: "凍結畫面" },
      { keys: ["1", "…", "9"], label: "場景覆寫（場景庫第 1–9 格）" },
      { keys: ["0"], label: "回到設計方案的場景" },
      { keys: ["O"], label: "開啟／聚焦投影視窗" },
    ],
  },
  {
    title: "同步",
    entries: [
      { keys: ["["], label: "偏移 −0.05 秒（Shift：−0.01）" },
      { keys: ["]"], label: "偏移 +0.05 秒（Shift：+0.01）" },
      { keys: ["T"], label: "Tap tempo（跟著拍子連按）" },
      { keys: ["?"], label: "顯示／隱藏快捷鍵說明" },
    ],
  },
];
