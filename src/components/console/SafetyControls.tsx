"use client";

// LED 安全模式 in the console (phase 3). Festival LED walls are very bright: the brightness cap, the
// flash limiter and the source-level softening are on by default, and turning them off always asks
// first (SafetyOffAlert). Console chrome only: nothing here is drawn on the projection.
//
// - SafetyTile: the full-width row in the control tab's sticky 安全控制 block (next to 黑場), a
//   switch and the current cap; orange when off.
// - SafetySettings: presets (室內投影 100 %, LED 牆 70 %, 戶外強光 LED 55 %, 自訂), the cap and soften
//   sliders, the flash limiter and red-flash switches, and 「已抑制閃爍」 per section.
// - SafetyCapsule: 「LED 安全 70%」 in the top bar (orange 「LED 安全已關閉」 when off; 「已抑制閃爍」
//   while the limiter damps).
// - SafetyCheck: the pre-show check — which sections safe mode changes (design tab, export page).

import { useState, type ReactNode } from "react";
import { Alert, SegmentedControl, Slider, StatusCapsule, Switch, Tooltip, cx } from "@/components/ui";
import { ShieldCheckIcon, ShieldWarningIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { limiterView, useLimiterStats } from "@/lib/console/limiter-status";
import type { OutputStatus } from "@/lib/console/link";
import { formatTimeShort } from "@/lib/timeline";
import { SAFETY_PRESETS, activeSafety, normalizeSafety, safetyCapsuleLabel, safetyReport, type SafetyPatch } from "@/lib/stage/safety";
import type { OutputSafety, Project, SafetyPresetId } from "@/lib/types";
import { Footnote, Group, GroupTitle } from "./ui";

/** The project's LED safety settings (old files without them: safe mode on). */
export function safetyOf(project: Pick<Project, "output"> | null | undefined): OutputSafety {
  return normalizeSafety(project?.output?.safety);
}

export const SAFETY_OFF_TITLE = "關閉 LED 安全模式？";

/** The explicit confirm before safe mode goes off (the risk, in plain words). */
export function SafetyOffAlert({ open, onConfirm, onCancel, context = "live" }: { open: boolean; onConfirm: () => void; onCancel: () => void; context?: "live" | "export" | "venue" }) {
  return (
    <Alert
      open={open}
      title={context === "export" ? "匯出沒有 LED 安全保護的影片？" : SAFETY_OFF_TITLE}
      destructive
      confirmLabel={context === "export" ? "仍要匯出" : "仍要關閉"}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <div className="space-y-2 text-left" data-safety-alert="">
          <p>
            {context === "export" ? "影片會以設計的全亮度算出，" : "投影會回到設計的全亮度，"}
            閃白、光暈綻放與隨拍點的快速閃爍都不再受限。
          </p>
          <p>音樂祭的 LED 牆非常亮：強烈閃光會讓前排觀眾短暫看不見，每秒超過 3 次的閃爍也可能引發光敏性癲癇。</p>
          <p className="font-semibold text-label">
            {context === "export" ? "只有在確定播放的場地與畫面都安全時才這樣匯出。" : `只有在確定場地與畫面都安全時才關閉${context === "venue" ? "；歌單裡的每首歌套用後都會受影響" : ""}。`}
          </p>
        </div>
      }
    />
  );
}

/** Asks before turning safe mode off; turning it on never asks. */
export function useSafetyToggle(onChange: (patch: SafetyPatch) => void, context: "live" | "export" | "venue" = "live") {
  const [asking, setAsking] = useState(false);
  const request = (on: boolean) => {
    if (on) onChange({ enabled: true });
    else setAsking(true);
  };
  const alert = (
    <SafetyOffAlert
      open={asking}
      context={context}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        onChange({ enabled: false });
      }}
    />
  );
  return { request, alert };
}

/** The sticky row beside the blackout tiles. */
export function SafetyTile({ safety, damping, onToggle }: { safety: OutputSafety; damping: boolean; onToggle: (on: boolean) => void }) {
  const on = safety.enabled;
  const sub = on
    ? damping
      ? "正在抑制閃爍"
      : `最高亮度 ${Math.round(safety.brightness * 100)}%・${safety.flashLimit ? "閃爍每秒最多 3 次" : "閃爍限制關閉"}`
    : "已關閉：沒有亮度與閃爍保護";
  const Icon = on ? ShieldCheckIcon : ShieldWarningIcon;
  return (
    <div
      data-safety-tile={on ? "on" : "off"}
      className={cx("col-span-2 flex h-14 min-w-0 items-center gap-2.5 rounded-md px-2.5", on ? "bg-fill-3" : "bg-orange-soft shadow-[inset_0_0_0_1.5px_var(--orange)]")}
    >
      <Icon size={20} weight="fill" className={cx("shrink-0", on ? (damping ? "text-orange" : "text-green") : "text-orange")} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-c-body font-semibold text-label">LED 安全</span>
          {on && <span className="font-numeric text-c-footnote font-medium text-label-2 tabular">{Math.round(safety.brightness * 100)}%</span>}
        </span>
        <span className={cx("min-w-0 truncate text-c-footnote", on ? (damping ? "text-orange-text" : "text-label-2") : "text-orange-text")}>{sub}</span>
      </div>
      <Switch checked={on} onChange={onToggle} aria-label="LED 安全模式" data-safety-switch="" />
    </div>
  );
}

type PresetChoice = SafetyPresetId;

function SwitchRow({ label, hint, checked, onChange, disabled, id }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <label htmlFor={id} className={cx("flex min-w-0 flex-col", disabled && "opacity-40")}>
        <span className="text-c-body text-label">{label}</span>
        <span className="text-c-footnote text-label-2">{hint}</span>
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** The detailed settings (below the sticky block). */
export function SafetySettings({ project, onChange, output }: { project: Project; onChange: (patch: SafetyPatch) => void; output?: OutputStatus }) {
  const safety = safetyOf(project);
  const stats = useLimiterStats(project.id);
  const view = limiterView(stats, output);
  const sections = project.plan?.sections ?? [];
  const on = safety.enabled;
  const counted = Object.entries(view.bySection)
    .map(([i, n]) => ({ index: Number(i), n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.index - b.index);

  return (
    <section aria-labelledby="ctl-led" data-safety-settings="">
      <GroupTitle
        id="ctl-led"
        actions={
          <span className={cx("text-c-footnote tabular", on ? "text-label-2" : "text-orange-text")}>{on ? (view.damping ? "抑制中" : "保護中") : "已關閉"}</span>
        }
      >
        LED 安全模式
      </GroupTitle>
      <Group className="mt-1 flex flex-col gap-3 px-3 py-2.5">
        {!on && <p className="text-c-footnote text-orange-text">安全模式已關閉：以設計的全亮度輸出。用上方的「LED 安全」開關重新開啟。</p>}
        <div className={cx("flex flex-col gap-1.5", !on && "pointer-events-none opacity-40")} aria-disabled={!on || undefined}>
          <span className="text-c-footnote text-label-2">亮度預設</span>
          <SegmentedControl<PresetChoice>
            label="亮度預設"
            blurOnPointer
            fullWidth
            disabled={!on}
            value={safety.preset}
            onChange={(preset) => onChange(preset === "custom" ? { preset: "custom", brightness: safety.brightness } : { preset })}
            options={[
              ...SAFETY_PRESETS.map((p) => ({ value: p.id as PresetChoice, label: <span className="whitespace-nowrap">{p.short}</span>, ariaLabel: `${p.label} ${Math.round(p.brightness * 100)}%` })),
              { value: "custom" as PresetChoice, label: "自訂" },
            ]}
          />
          <span className="text-c-footnote text-label-2">{SAFETY_PRESETS.find((p) => p.id === safety.preset)?.detail ?? `自訂：最高亮度 ${Math.round(safety.brightness * 100)}%`}</span>
        </div>
        <div className={cx(!on && "pointer-events-none opacity-40")}>
          <Slider
            label="最高亮度"
            value={safety.brightness}
            min={0.2}
            max={1}
            step={0.05}
            disabled={!on}
            onChange={(brightness) => onChange({ brightness })}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="整個畫面（場景、素材、歌詞）的亮度上限"
          />
        </div>
        <div className={cx(!on && "pointer-events-none opacity-40")}>
          <Slider
            label="柔化亮部"
            value={safety.soften}
            min={0}
            max={1}
            step={0.05}
            resetValue={0.25}
            disabled={!on}
            onChange={(soften) => onChange({ soften })}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="壓低最亮的部分，降低大面積明暗反差"
          />
        </div>
        <SwitchRow id="led-safe-flash" label="閃爍限制" hint="任何一秒內最多 3 次大面積閃爍（WCAG 2.3.1）" checked={safety.flashLimit} onChange={(flashLimit) => onChange({ flashLimit })} disabled={!on} />
        <SwitchRow id="led-safe-red" label="紅閃保護" hint="飽和紅色的明暗變化另外計數並減弱" checked={safety.redProtect} onChange={(redProtect) => onChange({ redProtect })} disabled={!on} />
        {on && (
          <div className="rounded-sm bg-fill-4 px-2.5 py-2" data-limiter-status={view.damping ? "damping" : "idle"}>
            <p className={cx("text-c-footnote font-semibold", view.damping ? "text-orange-text" : "text-label")}>
              {view.damping ? "正在抑制閃爍" : view.engaged > 0 ? `已抑制閃爍 ${view.engaged} 次` : "目前沒有需要抑制的閃爍"}
            </p>
            {counted.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {counted.map(({ index, n }) => (
                  <li key={index} className="flex items-baseline justify-between gap-2 text-c-footnote text-label-2">
                    <span className="min-w-0 truncate">{sections[index]?.label || `段落 ${index + 1}`}</span>
                    <span className="shrink-0 tabular">{n} 次</span>
                  </li>
                ))}
              </ul>
            )}
            {view.degraded && <p className="mt-1 text-c-footnote text-orange-text">這台電腦無法執行閃爍限制，只套用亮度上限。</p>}
          </div>
        )}
      </Group>
      <Footnote>預設開啟。它降低亮度並依 WCAG 門檻限制閃爍，但不是正式的光敏性癲癇檢測；要在電視播出的影片請另做 Harding 類分析。</Footnote>
    </section>
  );
}

/** 「LED 安全 70%」 in the top bar. */
export function SafetyCapsule({ project, output, className }: { project: Pick<Project, "id" | "output"> | null; output?: OutputStatus; className?: string }) {
  const safety = safetyOf(project);
  const stats = useLimiterStats(project?.id);
  const view = limiterView(stats, output);
  const on = safety.enabled;
  const tip = on
    ? `LED 安全模式：最高亮度 ${Math.round(safety.brightness * 100)}%，${safety.flashLimit ? "閃爍每秒最多 3 次" : "閃爍限制關閉"}${view.engaged ? `，已抑制閃爍 ${view.engaged} 次` : ""}。在「控制」分頁調整。`
    : "LED 安全模式已關閉：沒有亮度上限與閃爍限制。在「控制」分頁重新開啟。";
  return (
    <Tooltip content={tip} placement="bottom-end">
      <span tabIndex={0} className={cx("inline-flex shrink-0 rounded-pill", className)} data-safety-capsule={on ? (view.damping ? "damping" : "on") : "off"}>
        <StatusCapsule tone={on ? (view.damping ? "orange" : "neutral") : "orange"} icon={on ? ShieldCheckIcon : ShieldWarningIcon}>
          {on ? (view.damping ? `${safetyCapsuleLabel(safety)}・已抑制閃爍` : safetyCapsuleLabel(safety)) : "LED 安全已關閉"}
        </StatusCapsule>
      </span>
    </Tooltip>
  );
}

const CHECK_ROWS = 6;

/** Pre-show check: the sections safe mode changes, and how. */
export function SafetyCheck({
  project,
  safety: override,
  className,
  title = "LED 安全檢查",
  footer,
  variant = "console",
}: {
  project: Project;
  safety?: OutputSafety;
  className?: string;
  title?: string;
  footer?: ReactNode;
  /** console pane (dense, dark) or a regular page such as the export page (inset-group look) */
  variant?: "console" | "page";
}) {
  const safety = override ?? safetyOf(project);
  const report = safetyReport(project.plan, activeSafety(safety), { bpm: project.analysis?.bpm ?? null });
  const on = safety.enabled;
  const [all, setAll] = useState(false);
  const shown = all ? report.sections : report.sections.slice(0, CHECK_ROWS);
  const byKind = new Map<string, number>();
  for (const sec of report.sections) for (const c of sec.changes) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  const summary = [
    byKind.get("transition") && `${byKind.get("transition")} 段閃白或光暈轉場改為淡入`,
    byKind.get("reactivity") && `${byKind.get("reactivity")} 段降低音樂反應`,
    byKind.get("red") && `${byKind.get("red")} 段大面積紅色`,
    byKind.get("impact") && `${byKind.get("impact")} 段巨字衝擊放慢`,
  ].filter(Boolean);
  const page = variant === "page";
  const t = page
    ? { row: "px-(--row-pad-x) py-2.5", label: "text-[15px] leading-5 text-label", note: "text-[13px] leading-5 text-label-2", strong: "text-[13px] leading-5 text-label", time: "text-[13px] leading-5 text-label-2" }
    : { row: "px-3 py-2", label: "text-c-body font-medium text-label", note: "text-c-footnote text-label-2", strong: "text-c-footnote text-label", time: "text-c-footnote text-label-2" };
  const count = <span className={cx("tabular", page ? "text-[13px] leading-5 text-label-2" : "text-c-footnote text-label-2")}>{on ? `${report.sections.length} 段會調整` : "未套用"}</span>;
  const note = footer ?? "安全模式開啟時，這些段落會以較柔和的方式呈現；亮度上限與閃爍限制套用在整首歌。";

  const body = !on ? (
    <p className={cx("flex items-start gap-2", t.row, page ? "text-[13px] leading-5 text-orange-text" : "text-c-footnote text-orange-text")}>
      <WarningCircleIcon size={14} className="mt-0.5 shrink-0" />
      LED 安全模式已關閉：閃白、光暈與快速閃爍都會照原設計輸出。
    </p>
  ) : report.sections.length === 0 && report.notes.length === 0 ? (
    <p className={cx("flex items-center gap-2", t.row, t.note)}>
      <ShieldCheckIcon size={14} className="shrink-0 text-green" />
      這首歌的設計不需要調整；亮度上限 {Math.round(safety.brightness * 100)}% 與閃爍限制照常運作。
    </p>
  ) : (
    <ul className="divide-y-hairline">
      {summary.length > 0 && (
        <li className={cx(t.row, t.strong)} data-safety-summary="">
          {summary.join("；")}。
        </li>
      )}
      {shown.map((sec) => (
        <li key={sec.index} className={t.row} data-safety-row={sec.index}>
          <p className="flex items-baseline justify-between gap-2">
            <span className={cx("min-w-0 truncate", t.label)}>{sec.label}</span>
            <span className={cx("shrink-0 font-numeric tabular", t.time)}>
              {formatTimeShort(sec.start)}～{formatTimeShort(sec.end)}
            </span>
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {sec.changes.map((c, i) => (
              <li key={i} className={t.note}>
                {c.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
      {report.sections.length > CHECK_ROWS && (
        <li className={cx(page ? "px-(--row-pad-x) py-2" : "px-3 py-1.5")}>
          <button type="button" className={cx("press-fade font-semibold text-tint-text", page ? "text-[13px] leading-5" : "text-c-footnote")} onClick={() => setAll((v) => !v)} aria-expanded={all} data-safety-more="">
            {all ? "只顯示前幾段" : `顯示全部 ${report.sections.length} 段`}
          </button>
        </li>
      )}
      {report.notes.map((n) => (
        <li key={n} className={cx(t.row, t.note)}>
          {n}
        </li>
      ))}
    </ul>
  );

  if (page) {
    return (
      <section className={cx("min-w-0", className)} aria-labelledby="safety-check" data-safety-check="">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 px-(--row-pad-x)">
          <h2 id="safety-check" className="text-[13px] leading-5 font-normal text-label-2">
            {title}
          </h2>
          {count}
        </div>
        <div className="overflow-hidden rounded-lg bg-surface">{body}</div>
        <p className="mt-1.5 px-(--row-pad-x) text-[12px] leading-4 text-label-2">{note}</p>
      </section>
    );
  }
  return (
    <section className={className} aria-labelledby="safety-check" data-safety-check="">
      <GroupTitle id="safety-check" actions={count}>
        {title}
      </GroupTitle>
      <Group className="mt-1">{body}</Group>
      <Footnote>{note}</Footnote>
    </section>
  );
}
