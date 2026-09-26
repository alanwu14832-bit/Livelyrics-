"use client";

import { memo, useMemo } from "react";
import { Button, cx } from "@/components/ui";
import type { ConsoleController } from "@/lib/console/controller";
import { selectOverrides, selectSectionIndex, useStageValue } from "@/lib/console/hooks";
import { LYRIC_STYLE_HINTS, LYRIC_STYLE_LABELS, SCENE_HINTS, SCENE_LABELS } from "@/lib/console/labels";
import { sceneBank } from "@/lib/console/plan-edit";
import { LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import type { Project, SceneId } from "@/lib/types";
import { SectionTitle, Slider, ToggleTile } from "./controls";

function ControlTabImpl({ controller, project }: { controller: ConsoleController; project: Project }) {
  const ov = useStageValue(controller.store, selectOverrides);
  const sectionIndex = useStageValue(controller.store, selectSectionIndex);
  const plan = project.plan;
  const bank = useMemo(() => sceneBank(plan), [plan]);
  const planScene = sectionIndex != null ? plan?.sections[sectionIndex]?.scene : undefined;
  const planStyle = sectionIndex != null ? plan?.sections[sectionIndex]?.lyricStyle : undefined;
  const others = SCENE_IDS.filter((s) => !bank.includes(s));
  const anyOverride =
    ov.blackout || !ov.lyricsVisible || ov.freeze || ov.scene != null || ov.lyricStyle != null || ov.testPattern || ov.intensity !== 1 || ov.lyricScale !== 1;

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <SectionTitle
          actions={
            <Button size="sm" variant="ghost" onClick={() => controller.resetOverrides()} disabled={!anyOverride}>
              全部還原
            </Button>
          }
        >
          安全控制
        </SectionTitle>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <ToggleTile label="黑場" sub={ov.blackout ? "畫面已淡出為全黑" : "一鍵淡出為全黑"} hotkey="B" tone="danger" active={ov.blackout} onClick={() => controller.toggleBlackout()} />
          <ToggleTile label={ov.lyricsVisible ? "歌詞顯示中" : "歌詞已隱藏"} sub="只顯示或隱藏歌詞層" hotkey="L" tone="warn" active={!ov.lyricsVisible} onClick={() => controller.toggleLyrics()} />
          <ToggleTile label="凍結畫面" sub={ov.freeze ? "動畫停格（歌詞照常）" : "停住背景動畫"} hotkey="F" tone="accent" active={ov.freeze} onClick={() => controller.toggleFreeze()} />
          <ToggleTile label="測試圖" sub="安全區與對位檢查" tone="ok" active={ov.testPattern} onClick={() => controller.toggleTestPattern()} />
        </div>
      </div>

      <div>
        <SectionTitle
          actions={
            <Button size="sm" variant={ov.scene == null ? "secondary" : "ghost"} active={ov.scene == null} onClick={() => controller.setSceneOverride(null)} title="回到設計方案（0）">
              <span className="font-mono text-[10px] text-faint">0</span> 跟隨設計
            </Button>
          }
        >
          場景覆寫
        </SectionTitle>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {bank.map((scene, i) => {
            const active = ov.scene === scene;
            const inPlan = planScene === scene;
            return (
              <button
                key={scene}
                type="button"
                aria-pressed={active}
                onClick={() => controller.setSceneOverride(active ? null : scene)}
                title={SCENE_HINTS[scene]}
                className={cx(
                  "relative flex h-12 flex-col justify-between rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                  active ? "border-accent bg-accent/20 text-fg" : "border-line bg-panel-2 text-muted hover:border-faint hover:text-fg",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-faint">{i + 1}</span>
                  {inPlan && <span className="text-[9px] text-ok">目前段落</span>}
                </span>
                <span className="truncate text-xs font-medium">{SCENE_LABELS[scene]}</span>
              </button>
            );
          })}
        </div>
        {others.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {others.map((scene: SceneId) => {
              const active = ov.scene === scene;
              return (
                <button
                  key={scene}
                  type="button"
                  aria-pressed={active}
                  title={SCENE_HINTS[scene]}
                  onClick={() => controller.setSceneOverride(active ? null : scene)}
                  className={cx(
                    "h-6 rounded border px-2 text-[11px] transition-colors",
                    active ? "border-accent bg-accent/20 text-fg" : "border-line text-faint hover:border-faint hover:text-fg",
                  )}
                >
                  {SCENE_LABELS[scene]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <SectionTitle
          actions={
            <Button size="sm" variant={ov.lyricStyle == null ? "secondary" : "ghost"} active={ov.lyricStyle == null} onClick={() => controller.setOverrides({ lyricStyle: null })}>
              跟隨設計
            </Button>
          }
        >
          歌詞呈現覆寫
        </SectionTitle>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {LYRIC_STYLE_IDS.map((style) => {
            const active = ov.lyricStyle === style;
            return (
              <button
                key={style}
                type="button"
                aria-pressed={active}
                title={LYRIC_STYLE_HINTS[style]}
                onClick={() => controller.setOverrides({ lyricStyle: active ? null : style })}
                className={cx(
                  "relative h-8 truncate rounded-md border px-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                  active ? "border-accent bg-accent/20 text-fg" : "border-line bg-panel-2 text-muted hover:border-faint hover:text-fg",
                  planStyle === style && !active && "border-ok/40",
                )}
              >
                {LYRIC_STYLE_LABELS[style]}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-faint">綠框＝目前段落的設計。覆寫會套用到所有段落，直到按下「跟隨設計」。</p>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle>主控</SectionTitle>
        <Slider
          label="畫面強度"
          value={ov.intensity}
          min={0}
          max={1.5}
          step={0.05}
          resetValue={1}
          onReset={() => controller.setOverrides({ intensity: 1 })}
          onChange={(intensity) => controller.setOverrides({ intensity })}
          format={(v) => `${Math.round(v * 100)}%`}
          hint="降低可避免搶走舞台燈光；100% 為設計值"
        />
        <Slider
          label="歌詞字級"
          value={ov.lyricScale}
          min={0.5}
          max={2}
          step={0.05}
          resetValue={1}
          onReset={() => controller.setOverrides({ lyricScale: 1 })}
          onChange={(lyricScale) => controller.setOverrides({ lyricScale })}
          format={(v) => `×${v.toFixed(2)}`}
          hint="現場螢幕太小或觀眾太遠時放大"
        />
      </div>
    </div>
  );
}

export const ControlTab = memo(ControlTabImpl);
