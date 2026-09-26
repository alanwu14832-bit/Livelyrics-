"use client";

// 設計: the key visual (its palette gradient is content colour), palette, motifs, typography
// specimen, designer notes, and one inset group per section with quick edits (pop-up selects and
// the scale slider). Edits apply to the projection at once and save automatically.

import { memo, useMemo } from "react";
import { Button, Disclosure, Slider, Tag, Tooltip, cx } from "@/components/ui";
import { SparkleIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import type { ConsoleController } from "@/lib/console/controller";
import { motifDataUrl, readableTextOn, withAlpha } from "@/lib/console/format";
import { selectSectionIndex, useStageValue } from "@/lib/console/hooks";
import { LYRIC_STYLE_HINTS, LYRIC_STYLE_LABELS, PLACEMENT_LABELS, SCENE_HINTS, SCENE_LABELS, TRANSITION_LABELS } from "@/lib/console/labels";
import { LYRIC_SCALE_MAX, LYRIC_SCALE_MIN } from "@/lib/console/plan-edit";
import { FONTS, fontStack } from "@/lib/fonts";
import { LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignPlan, LyricPlacement, LyricStyleId, Project, SceneId, SectionDesign } from "@/lib/types";
import { sectionName } from "./Preview";
import { Footnote, Group, GroupTitle, KeyValues, PopupSelect } from "./ui";

const SCENE_OPTIONS = SCENE_IDS.map((id) => ({ value: id, label: SCENE_LABELS[id] }));
const STYLE_OPTIONS = LYRIC_STYLE_IDS.map((id) => ({ value: id, label: LYRIC_STYLE_LABELS[id] }));
const PLACEMENT_OPTIONS = LYRIC_PLACEMENTS.map((id) => ({ value: id, label: PLACEMENT_LABELS[id] }));

function copy(controller: ConsoleController, text: string) {
  try {
    void navigator.clipboard?.writeText(text).then(
      () => controller.notify(`已複製 ${text}`, "ok"),
      () => controller.notify("無法複製到剪貼簿", "warn"),
    );
  } catch {
    controller.notify("無法複製到剪貼簿", "warn");
  }
}

function KeyVisualCard({ controller, plan, sampleText }: { controller: ConsoleController; plan: DesignPlan; sampleText: string }) {
  const kv = plan.keyVisual;
  const palette = kv.palette ?? [];
  const bg = palette[0]?.hex ?? "";
  const ink = readableTextOn(bg);
  const lyricColor = plan.sections[0]?.lyricColor ?? palette.find((p) => /歌詞|lyric/i.test(p.role))?.hex ?? ink;
  const motifColor = palette[1]?.hex ?? palette[palette.length - 1]?.hex ?? ink;
  const motifSrc = useMemo(() => motifDataUrl(kv.motifSvg, motifColor), [kv.motifSvg, motifColor]);
  const typo: DesignPlan["keyVisual"]["typography"] = kv.typography ?? {
    cjkFont: "noto-sans-tc",
    latinFont: "space-grotesk",
    weight: 700,
    letterSpacing: 0,
    rationale: "",
  };
  const cjk = FONTS[typo.cjkFont];
  const latin = FONTS[typo.latinFont];
  const light = palette[1]?.hex;
  const glow = palette[2]?.hex ?? light;

  return (
    <div className="flex flex-col gap-5">
      {/* the key visual tile: its colours are the band's, not UI chrome */}
      <div
        className="relative overflow-hidden rounded-md p-3.5"
        style={{
          background: [
            light && `radial-gradient(120% 90% at 85% 10%, ${withAlpha(light, 0.45)} 0%, transparent 60%)`,
            glow && `radial-gradient(90% 80% at 10% 100%, ${withAlpha(glow, 0.35)} 0%, transparent 65%)`,
            bg || "var(--surface-2)",
          ]
            .filter(Boolean)
            .join(", "),
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-c-footnote font-semibold" style={{ color: withAlpha(ink, 0.72) }}>
              主視覺
            </p>
            <h3 className="mt-0.5 text-c-title" style={{ color: ink }}>
              {kv.title || "未命名主視覺"}
            </h3>
          </div>
          {motifSrc && (
            // eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, no optimization possible
            <img src={motifSrc} alt="主視覺符號" className="size-14 shrink-0" draggable={false} />
          )}
        </div>
        {kv.concept && (
          <p className="mt-2 text-c-body" style={{ color: withAlpha(ink, 0.86) }}>
            {kv.concept}
          </p>
        )}
        {kv.moodKeywords?.length > 0 && (
          <p className="mt-2 text-c-footnote" style={{ color: withAlpha(ink, 0.72) }}>
            {kv.moodKeywords.join("、")}
          </p>
        )}
      </div>

      {palette.length > 0 && (
        <section aria-labelledby="kv-palette">
          <GroupTitle id="kv-palette">色票</GroupTitle>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {palette.map((p, i) => (
              <Tooltip key={`${p.hex}-${i}`} content={`${p.name || "未命名"}（${p.role}），點擊複製 ${p.hex}`}>
                <button type="button" onClick={() => copy(controller, p.hex)} className="press-tile flex min-w-0 flex-col overflow-hidden rounded-sm bg-surface-2 text-left">
                  <span className="flex h-9 items-end justify-end px-1.5 pb-1" style={{ background: p.hex }}>
                    <span className="font-mono text-[11px] leading-none" style={{ color: withAlpha(readableTextOn(p.hex), 0.8) }}>
                      {p.hex}
                    </span>
                  </span>
                  <span className="block truncate px-2 pt-1 text-c-footnote font-medium text-label">{p.name || "未命名"}</span>
                  <span className="block truncate px-2 pb-1.5 text-c-footnote text-label-2">{p.role}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </section>
      )}

      {kv.motifs?.length > 0 && (
        <section aria-labelledby="kv-motifs">
          <GroupTitle id="kv-motifs">視覺符號</GroupTitle>
          <div className="mt-1 flex flex-wrap gap-1">
            {kv.motifs.map((m) => (
              <Tag key={m}>{m}</Tag>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="kv-type">
        <GroupTitle id="kv-type">字體</GroupTitle>
        <Group className="mt-1">
          <div className="px-3 py-3" style={{ background: bg || "var(--surface-3)" }}>
            <p
              className="line-clamp-2 text-[22px] leading-snug"
              style={{ fontFamily: fontStack(typo.cjkFont, typo.latinFont), fontWeight: typo.weight, letterSpacing: `${typo.letterSpacing}em`, color: lyricColor }}
            >
              {sampleText}
            </p>
          </div>
          <div className="px-3 py-2">
            <KeyValues
              items={[
                { key: "中文", value: cjk?.label ?? typo.cjkFont },
                { key: "西文", value: latin?.label ?? typo.latinFont },
                { key: "字重", value: <span className="tabular">{typo.weight}</span> },
                { key: "字距", value: <span className="tabular">{typo.letterSpacing}em</span> },
              ]}
            />
            {typo.rationale && <p className="mt-1.5 text-c-footnote text-label-2">{typo.rationale}</p>}
          </div>
        </Group>
      </section>

      {plan.designerNotes && (
        <Group>
          <Disclosure summary={<span className="text-c-body font-semibold text-label">設計說明</span>} summaryClassName="min-h-8 px-3" contentClassName="px-3 pb-2">
            <Markdown>{plan.designerNotes}</Markdown>
          </Disclosure>
        </Group>
      )}
    </div>
  );
}

function SectionGroup({
  controller,
  section,
  index,
  active,
  disabled,
}: {
  controller: ConsoleController;
  section: SectionDesign;
  index: number;
  active: boolean;
  disabled: boolean;
}) {
  const [bg, primary, accent] = section.colorway;
  const name = sectionName(section);
  const range = `${formatTimeShort(section.start)}-${formatTimeShort(section.end)}`;
  return (
    <Group aria-current={active ? "true" : undefined} aria-label={name.label} role="group">
      <div className={cx("flex min-h-9 items-center gap-2 px-3 py-1", active && "row-current")}>
        <span className="flex shrink-0 overflow-hidden rounded-[3px] ring-hairline" aria-hidden="true">
          {[bg, primary, accent].map((c, i) => (
            <span key={i} className="h-3.5 w-2" style={{ background: c ?? "var(--fill)" }} />
          ))}
        </span>
        <span className="min-w-0 truncate text-c-body font-semibold text-label">{name.label}</span>
        {name.kind && <Tag className="shrink-0">{name.kind}</Tag>}
        {active && (
          <Tag tone="tint" className="shrink-0">
            播放中
          </Tag>
        )}
        <Tooltip content="跳到這一段">
          <Button size="sm" variant="plain" className="-mr-1.5 ml-auto tabular" onClick={() => controller.jumpToSection(index)} aria-label={`跳到${name.label}（${range}）`}>
            {range}
          </Button>
        </Tooltip>
      </div>
      <div className="px-3 pb-3">
        {section.rationale && <p className="text-c-footnote text-label-2">{section.rationale}</p>}
        <KeyValues
          className="mt-1.5"
          items={[
            { key: "能量", value: `${Math.round(section.energy * 100)}%` },
            { key: "轉場", value: TRANSITION_LABELS[section.transitionIn] ?? section.transitionIn },
          ]}
        />
        <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-2.5">
          <Tooltip content={SCENE_HINTS[section.scene]}>
            <div className="min-w-0">
              <PopupSelect<SceneId> label="場景" value={section.scene} options={SCENE_OPTIONS} onChange={(scene) => controller.updateSection(index, { scene })} disabled={disabled} />
            </div>
          </Tooltip>
          <Tooltip content={LYRIC_STYLE_HINTS[section.lyricStyle]}>
            <div className="min-w-0">
              <PopupSelect<LyricStyleId>
                label="歌詞呈現"
                value={section.lyricStyle}
                options={STYLE_OPTIONS}
                onChange={(lyricStyle) => controller.updateSection(index, { lyricStyle })}
                disabled={disabled}
              />
            </div>
          </Tooltip>
          <PopupSelect<LyricPlacement>
            label="歌詞位置"
            value={section.lyricPlacement}
            options={PLACEMENT_OPTIONS}
            onChange={(lyricPlacement) => controller.updateSection(index, { lyricPlacement })}
            disabled={disabled}
          />
          <Slider
            label="字級"
            value={section.lyricScale}
            min={LYRIC_SCALE_MIN}
            max={LYRIC_SCALE_MAX}
            step={0.05}
            onChange={(lyricScale) => controller.updateSection(index, { lyricScale })}
            format={(v) => `×${v.toFixed(2)}`}
            disabled={disabled}
            className="-mt-1.5"
          />
        </div>
      </div>
    </Group>
  );
}

function DesignTabImpl({ controller, project, redesigning, onRedesign }: { controller: ConsoleController; project: Project; redesigning: boolean; onRedesign: () => void }) {
  const plan = project.plan;
  const sectionIndex = useStageValue(controller.store, selectSectionIndex);
  const sampleText = useMemo(() => {
    const lines = project.lyrics?.lines ?? [];
    const chorus = plan?.sections.find((s) => s.kind === "chorus");
    const inChorus = chorus ? lines.find((l) => l.start != null && l.start >= chorus.start && l.start < chorus.end && l.text.trim()) : undefined;
    return (inChorus ?? lines.find((l) => l.text.trim()))?.text.trim() || plan?.keyVisual.title || "舞台上的每一句歌詞";
  }, [project.lyrics, plan]);

  if (!plan) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <SparkleIcon size={32} className="mb-3 text-label-2" />
        <p className="text-c-headline text-label">這首歌還沒有設計方案</p>
        <p className="mt-1 text-c-body text-label-2">投影仍可播放歌詞（使用預設畫面）。讓 AI 設計師研究這首歌後產生主視覺與逐段規劃。</p>
        <Button variant="filled" className="mt-4" icon={SparkleIcon} onClick={onRedesign} loading={redesigning}>
          產生設計
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-3 pt-1 pb-4">
      <KeyVisualCard controller={controller} plan={plan} sampleText={sampleText} />
      <section aria-labelledby="design-sections">
        <GroupTitle id="design-sections">段落設計（{plan.sections.length}）</GroupTitle>
        {redesigning ? <Footnote className="mt-0 mb-1.5">重新設計進行中，完成前暫停手動修改。</Footnote> : <Footnote className="mt-0 mb-1.5">修改會即時套用到投影並自動儲存。</Footnote>}
        <div className="flex flex-col gap-2">
          {plan.sections.map((s, i) => (
            <SectionGroup key={s.id || i} controller={controller} section={s} index={i} active={i === sectionIndex} disabled={redesigning} />
          ))}
        </div>
      </section>
    </div>
  );
}

export const DesignTab = memo(DesignTabImpl);
