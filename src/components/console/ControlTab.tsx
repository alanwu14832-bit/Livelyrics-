"use client";

// 控制: the show's safety controls and overrides (UI-AUDIT §3.5). A sticky 「安全控制」 row (thin
// material) keeps the four latching tiles in view while the rest scrolls; scene overrides are
// 44 px tiles with their number key; the plan's own scene / style carry a Check and 「目前段落」
// instead of a colour legend; the master sliders are iOS sliders.

import { memo, useMemo } from "react";
import { Button, Kbd, Slider, Tooltip, cx } from "@/components/ui";
import { CheckIcon, EyeSlashIcon, MoonIcon, SnowflakeIcon, SquareHalfIcon } from "@/components/ui/Icon";
import { ConsoleController, type OutputStatus } from "@/lib/console/controller";
import { selectOverrides, selectSectionIndex, useStageValue } from "@/lib/console/hooks";
import { LYRIC_STYLE_HINTS, LYRIC_STYLE_LABELS, SCENE_HINTS, SCENE_LABELS } from "@/lib/console/labels";
import { sceneBank } from "@/lib/console/plan-edit";
import { LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import type { StageOverrides, StageStore } from "@/lib/stage/protocol";
import type { Project, SceneId } from "@/lib/types";
import { limiterView, useLimiterStats } from "@/lib/console/limiter-status";
import type { SafetyPatch } from "@/lib/stage/safety";
import { OutputSettings } from "./OutputSettings";
import { SafetySettings, SafetyTile, safetyOf, useSafetyToggle } from "./SafetyControls";
import { Footnote, Group, GroupTitle, TINT_ON_SOFT, ToggleTile } from "./ui";

/** What the safety controls drive: a song's ConsoleController, or a show look's LookController. */
export interface OverrideControls {
  readonly store: StageStore;
  resetOverrides(): void;
  toggleBlackout(): void;
  toggleLyrics(): void;
  toggleFreeze(): void;
  toggleTestPattern(): void;
  setSceneOverride(scene: SceneId | null): void;
  setOverrides(patch: Partial<StageOverrides>): void;
  /** LED 安全模式 (the song's output settings, or the show's for a look) */
  updateSafety(patch: SafetyPatch): void;
}

/** 「目前段落」 (a song) / 「畫面設計」 (a show look) marker for the plan's own choice. */
function PlanMark({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 text-c-footnote text-label-2", className)}>
      <CheckIcon size={12} />
      {label}
    </span>
  );
}

function ControlTabImpl({
  controller,
  project,
  output,
  noun = "歌詞",
}: {
  controller: OverrideControls;
  project: Project;
  output?: OutputStatus;
  /** what the text layer is called: 歌詞 (songs) or 文字 (a show look's text) */
  noun?: "歌詞" | "文字";
}) {
  // a show look is one section long: its plan mark is the look's own design
  const planLabel = noun === "文字" ? "畫面設計" : "目前段落";
  const ov = useStageValue(controller.store, selectOverrides);
  const sectionIndex = useStageValue(controller.store, selectSectionIndex);
  const plan = project.plan;
  const bank = useMemo(() => sceneBank(plan), [plan]);
  const planScene = sectionIndex != null ? plan?.sections[sectionIndex]?.scene : undefined;
  const planStyle = sectionIndex != null ? plan?.sections[sectionIndex]?.lyricStyle : undefined;
  const others = SCENE_IDS.filter((s) => !bank.includes(s));
  const anyOverride =
    ov.blackout || !ov.lyricsVisible || ov.freeze || ov.scene != null || ov.lyricStyle != null || ov.testPattern || ov.intensity !== 1 || ov.lyricScale !== 1;
  const safety = safetyOf(project);
  const limiter = limiterView(useLimiterStats(project.id), output);
  const { request: toggleSafety, alert: safetyAlert } = useSafetyToggle((patch) => controller.updateSafety(patch));

  return (
    <div className="flex flex-col gap-5 px-3 pb-4">
      {/* UI-16: the safety controls stay in view while the rest of the tab scrolls */}
      <section aria-labelledby="ctl-safety" className="sticky top-0 z-10 -mx-3 material-thin px-3 pt-1 pb-3 scroll-edge">
        <GroupTitle
          id="ctl-safety"
         
          actions={
            <Button size="sm" variant="plain" onClick={() => controller.resetOverrides()} disabled={!anyOverride}>
              全部還原
            </Button>
          }
        >
          安全控制
        </GroupTitle>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <ToggleTile label="黑場" sub={ov.blackout ? "畫面已淡出為全黑" : "一鍵淡出為全黑"} hotkey="B" tone="red" icon={MoonIcon} active={ov.blackout} onClick={() => controller.toggleBlackout()} />
          <ToggleTile label={ov.lyricsVisible ? `${noun}顯示中` : `${noun}已隱藏`} sub={`只切換${noun}層`} hotkey="L" icon={EyeSlashIcon} active={!ov.lyricsVisible} onClick={() => controller.toggleLyrics()} />
          <ToggleTile label="凍結畫面" sub={ov.freeze ? `動畫停格，${noun}照常` : "停住背景動畫"} hotkey="F" icon={SnowflakeIcon} active={ov.freeze} onClick={() => controller.toggleFreeze()} />
          <ToggleTile label="測試圖" sub="安全區與對位檢查" icon={SquareHalfIcon} active={ov.testPattern} onClick={() => controller.toggleTestPattern()} />
          <SafetyTile safety={safety} damping={limiter.damping} onToggle={toggleSafety} />
        </div>
      </section>

      <SafetySettings project={project} output={output} onChange={(patch) => controller.updateSafety(patch)} />
      {safetyAlert}

      <section aria-labelledby="ctl-scene">
        <GroupTitle
          id="ctl-scene"
         
          actions={
            <Tooltip content="回到設計方案的場景" shortcut="0">
              <Button size="sm" variant={ov.scene == null ? "gray" : "plain"} aria-pressed={ov.scene == null} onClick={() => controller.setSceneOverride(null)}>
                跟隨設計
              </Button>
            </Tooltip>
          }
        >
          場景覆寫
        </GroupTitle>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {bank.map((scene, i) => {
            const active = ov.scene === scene;
            const inPlan = planScene === scene;
            return (
              <Tooltip key={scene} content={SCENE_HINTS[scene]} shortcut={String(i + 1)}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-keyshortcuts={String(i + 1)}
                  onClick={() => controller.setSceneOverride(active ? null : scene)}
                  className={cx(
                    "press-tile flex h-11 min-w-0 flex-col justify-center gap-0.5 rounded-sm px-2 text-left",
                    active ? cx("bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]", TINT_ON_SOFT) : "bg-fill-3 text-label hover:bg-fill-2",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Kbd className={cx(active && "bg-tint-soft")}>{i + 1}</Kbd>
                    <span className="min-w-0 truncate text-c-body font-medium">{SCENE_LABELS[scene]}</span>
                  </span>
                  {inPlan && <PlanMark label={planLabel} className={cx(active && TINT_ON_SOFT)} />}
                </button>
              </Tooltip>
            );
          })}
        </div>
        {others.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {others.map((scene: SceneId) => {
              const active = ov.scene === scene;
              return (
                <Tooltip key={scene} content={SCENE_HINTS[scene]}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => controller.setSceneOverride(active ? null : scene)}
                    className={cx(
                      "press h-7 rounded-sm px-2.5 text-c-footnote font-medium",
                      active ? cx("bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]", TINT_ON_SOFT) : "bg-fill-4 text-label hover:bg-fill-3",
                    )}
                  >
                    {SCENE_LABELS[scene]}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="ctl-style">
        <GroupTitle
          id="ctl-style"
         
          actions={
            <Button size="sm" variant={ov.lyricStyle == null ? "gray" : "plain"} aria-pressed={ov.lyricStyle == null} onClick={() => controller.setOverrides({ lyricStyle: null })}>
              跟隨設計
            </Button>
          }
        >
          {noun}呈現覆寫
        </GroupTitle>
        <div className="mt-1 grid grid-cols-3 gap-1.5">
          {LYRIC_STYLE_IDS.map((style) => {
            const active = ov.lyricStyle === style;
            const inPlan = planStyle === style;
            return (
              <Tooltip key={style} content={LYRIC_STYLE_HINTS[style]}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => controller.setOverrides({ lyricStyle: active ? null : style })}
                  className={cx(
                    "press-tile flex h-8 min-w-0 items-center gap-1 rounded-sm px-2 text-left text-c-body",
                    active ? cx("bg-tint-soft font-medium shadow-[inset_0_0_0_2px_var(--tint)]", TINT_ON_SOFT) : "bg-fill-3 text-label hover:bg-fill-2",
                  )}
                >
                  <span className="min-w-0 truncate">{LYRIC_STYLE_LABELS[style]}</span>
                  {inPlan && <CheckIcon size={12} aria-label={planLabel} className={cx("ml-auto shrink-0", active ? "" : "text-label-2")} />}
                </button>
              </Tooltip>
            );
          })}
        </div>
        <Footnote>{noun === "文字" ? "打勾的是這個畫面的設計。覆寫會一直套用，直到按下「跟隨設計」。" : "打勾的是目前段落的設計。覆寫會套用到所有段落，直到按下「跟隨設計」。"}</Footnote>
      </section>

      <section aria-labelledby="ctl-master">
        <GroupTitle id="ctl-master">
          主控
        </GroupTitle>
        <Group className="mt-1 flex flex-col gap-3 px-3 py-2.5">
          <Slider
            label="畫面強度"
            value={ov.intensity}
            min={0}
            max={1.5}
            step={0.05}
            resetValue={1}
            onChange={(intensity) => controller.setOverrides({ intensity })}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="降低可避免搶走舞台燈光；100% 為設計值"
          />
          <Slider
            label={`${noun}字級`}
            value={ov.lyricScale}
            min={0.5}
            max={2}
            step={0.05}
            resetValue={1}
            onChange={(lyricScale) => controller.setOverrides({ lyricScale })}
            format={(v) => `×${v.toFixed(2)}`}
            hint="現場螢幕太小或觀眾太遠時放大"
          />
        </Group>
      </section>

      {controller instanceof ConsoleController && output && <OutputSettings controller={controller} project={project} output={output} />}
    </div>
  );
}

export const ControlTab = memo(ControlTabImpl);
