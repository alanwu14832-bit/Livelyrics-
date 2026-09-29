"use client";

// 輸出畫面 (控制 tab): the canvas the show is designed for. A preset pop-up (1080p, 4K, 32:9
// ultra-wide, 3:1 strip, portrait, 5:4, custom), width / height fields for a custom wall, and
// the lyric safe area (margins kept free of lyrics) as one quick SegmentedControl plus per-side
// Steppers. Changes go to the projection at once and are saved after a short pause.

import { useId, useState } from "react";
import { Button, SegmentedControl, Stepper, TextField, cx } from "@/components/ui";
import { ExportIcon } from "@/components/ui/Icon";
import type { ConsoleController, OutputStatus } from "@/lib/console/controller";
import { CUSTOM_PRESET, DEFAULT_OUTPUT, OUTPUT_MAX_PX, OUTPUT_MIN_PX, OUTPUT_PRESETS, SAFE_MAX, aspectLabel } from "@/lib/output";
import type { LyricSafeArea, Project } from "@/lib/types";
import { Footnote, Group, GroupTitle, PopupSelect } from "./ui";

const PRESET_OPTIONS = [
  ...OUTPUT_PRESETS.map((p) => ({ value: p.id, label: `${p.label}（${p.width} × ${p.height}）` })),
  { value: CUSTOM_PRESET, label: "自訂尺寸" },
];

type SafeQuick = "0" | "5" | "10" | "custom";

function quickOf(s: LyricSafeArea): SafeQuick {
  const v = [s.top, s.right, s.bottom, s.left];
  if (v.every((x) => x === 0)) return "0";
  if (v.every((x) => Math.abs(x - 0.05) < 1e-6)) return "5";
  if (v.every((x) => Math.abs(x - 0.1) < 1e-6)) return "10";
  return "custom";
}

function SizeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const id = useId();
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n >= OUTPUT_MIN_PX && n <= OUTPUT_MAX_PX) onCommit(n);
    else setText(String(value));
  };
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1">
      <span className="text-c-footnote text-label-2">{label}</span>
      <TextField
        id={id}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
          // keep show hotkeys from firing while typing a number
          e.stopPropagation();
        }}
        className="tabular"
        aria-describedby={`${id}-unit`}
      />
      <span id={`${id}-unit`} className="sr-only">
        像素
      </span>
    </label>
  );
}

const SIDES: Array<{ key: keyof LyricSafeArea; label: string }> = [
  { key: "top", label: "上" },
  { key: "bottom", label: "下" },
  { key: "left", label: "左" },
  { key: "right", label: "右" },
];

export function OutputSettings({ controller, project, output }: { controller: ConsoleController; project: Project; output: OutputStatus }) {
  const o = project.output ?? DEFAULT_OUTPUT;
  const quick = quickOf(o.lyricSafe);
  const setSafe = (v: number) => controller.updateOutput({ lyricSafe: { top: v, right: v, bottom: v, left: v } });
  const windowSize = output.connected && output.width > 0 ? `${output.width} × ${output.height}` : null;
  const exact = windowSize != null && output.width === o.width && output.height === o.height;

  return (
    <section aria-labelledby="ctl-output">
      <GroupTitle id="ctl-output" actions={<span className="text-c-footnote text-label-2 tabular">{o.width} × {o.height}（{aspectLabel(o.width, o.height)}）</span>}>
        輸出畫面
      </GroupTitle>
      <Group className="mt-1 flex flex-col gap-3 px-3 py-2.5">
        <PopupSelect<string>
          label="畫面尺寸"
          value={o.preset}
          options={PRESET_OPTIONS}
          onChange={(preset) => (preset === CUSTOM_PRESET ? controller.updateOutput({ preset: CUSTOM_PRESET, width: o.width, height: o.height }) : controller.updateOutput({ preset }))}
        />
        {o.preset === CUSTOM_PRESET && (
          <div className="grid grid-cols-2 gap-2">
            <SizeField key={`w${o.width}`} label="寬（像素）" value={o.width} onCommit={(width) => controller.updateOutput({ width })} />
            <SizeField key={`h${o.height}`} label="高（像素）" value={o.height} onCommit={(height) => controller.updateOutput({ height })} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-c-footnote text-label-2">歌詞安全區（四周留白）</span>
          <SegmentedControl<SafeQuick>
            label="歌詞安全區"
            blurOnPointer
            fullWidth
            value={quick}
            onChange={(v) => {
              if (v === "custom") return;
              setSafe(Number(v) / 100);
            }}
            options={[
              { value: "0", label: "0%" },
              { value: "5", label: "5%" },
              { value: "10", label: "10%" },
              { value: "custom", label: "自訂", disabled: quick !== "custom" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {SIDES.map(({ key, label }) => (
            <div key={key} className="flex min-w-0 items-center justify-between gap-2">
              <span className="text-c-body text-label">{label}</span>
              <Stepper
                label={`${label}方留白`}
                value={Math.round(o.lyricSafe[key] * 100)}
                min={0}
                max={SAFE_MAX * 100}
                step={1}
                showValue
                format={(v) => <span className="text-c-body font-medium">{v}%</span>}
                onChange={(v) => controller.updateOutput({ lyricSafe: { [key]: Math.round(v) / 100 } })}
              />
            </div>
          ))}
        </div>
      </Group>
      <Footnote>
        投影視窗會照這個比例顯示，多出來的地方是黑邊。
        {windowSize ? (
          <span className={cx(exact ? "" : "text-orange-text")}>
            {exact ? `投影視窗是 ${windowSize}，逐像素輸出。` : `投影視窗目前是 ${windowSize}；調成 ${o.width} × ${o.height} 即可逐像素輸出。`}
          </span>
        ) : (
          `把投影視窗調成 ${o.width} × ${o.height} 即可逐像素輸出。`
        )}
        開啟測試圖可以檢查安全區。
      </Footnote>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-c-footnote text-label-2">音樂祭要預先算好的影片時，照這個尺寸匯出。</span>
        <Button variant="gray" size="sm" icon={ExportIcon} onClick={() => controller.openExport()}>
          匯出影片
        </Button>
      </div>
    </section>
  );
}
