// MIDI commands → console actions (phase 5a, 控制器): a mapped pad or fader runs exactly what its
// hotkey runs, through the same dispatch and the same HUD. Pure.

import { OFFSET_STEP, type ConsoleAction } from "@/lib/console/hotkeys";
import type { MidiButtonTarget, MidiCommand } from "./mapping";

export function buttonAction(target: MidiButtonTarget): ConsoleAction {
  switch (target) {
    case "selectNext":
      return { type: "select", delta: 1 };
    case "selectPrev":
      return { type: "select", delta: -1 };
    case "sectionNext":
      return { type: "section", delta: 1 };
    case "sectionPrev":
      return { type: "section", delta: -1 };
    case "offsetDown":
      return { type: "offset", delta: -OFFSET_STEP };
    case "offsetUp":
      return { type: "offset", delta: OFFSET_STEP };
    case "clearLine":
      return { type: "escape" };
    case "testPattern":
      return { type: "testPattern" };
    case "scene1":
    case "scene2":
    case "scene3":
    case "scene4":
    case "scene5":
    case "scene6":
    case "scene7":
    case "scene8":
    case "scene9":
      return { type: "scene", slot: Number(target.slice(5)) };
    default:
      return { type: target };
  }
}

export function commandAction(cmd: MidiCommand): ConsoleAction {
  switch (cmd.kind) {
    case "button":
      return buttonAction(cmd.target);
    case "value":
      return { type: "control", target: cmd.target, value: cmd.value };
    case "line":
      return { type: "cueLine", index: cmd.index };
    case "section":
      return { type: "jumpSection", index: cmd.index };
  }
}
