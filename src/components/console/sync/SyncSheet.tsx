"use client";

// The 同步 sheet (phase 5a) of the show console's look and pre-show views, which have no 同步 tab:
// the show's sync source and lock state, the MIDI input and the way into the 控制器 sheet. Opening
// 控制器 swaps one sheet for the other (never two modals at once). B still blacks out in both.

import type { KeyboardEvent } from "react";
import { Button, Sheet } from "@/components/ui";
import type { SyncEngine } from "@/lib/sync/engine";
import { ControllerSheet } from "./ControllerSheet";
import { MidiSection, SyncSourceSection } from "./SyncPanel";

export type SyncSheetView = "sync" | "controllers" | null;

export function SyncSheets({
  engine,
  view,
  onView,
  onBlackout,
  show = true,
}: {
  engine: SyncEngine;
  view: SyncSheetView;
  onView: (view: SyncSheetView) => void;
  onBlackout?: () => void;
  /** GO and standby rows in the 控制器 sheet */
  show?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.nativeEvent.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.code === "KeyB" && onBlackout) {
      e.preventDefault();
      onBlackout();
    }
  };
  return (
    <>
      <Sheet
        open={view === "sync"}
        onClose={() => onView(null)}
        title="同步與控制器"
        width={460}
        cancelLabel={null}
        action={
          <Button variant="plain" onClick={() => onView(null)} className="font-semibold">
            完成
          </Button>
        }
        onKeyDown={onKeyDown}
      >
        <div className="flex flex-col gap-5">
          <SyncSourceSection engine={engine} onManual={() => engine.setSource("manual")} />
          <MidiSection engine={engine} onOpenControllers={() => onView("controllers")} />
        </div>
      </Sheet>
      <ControllerSheet open={view === "controllers"} onClose={() => onView(null)} engine={engine} show={show} onBlackout={onBlackout} />
    </>
  );
}
