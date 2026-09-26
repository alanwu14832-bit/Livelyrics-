"use client";

import { memo, useMemo, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import type { ConsoleController } from "@/lib/console/controller";
import { motifDataUrl, readableTextOn, withAlpha } from "@/lib/console/format";
import { selectSectionIndex, useStageValue } from "@/lib/console/hooks";
import {
  LYRIC_STYLE_HINTS,
  LYRIC_STYLE_LABELS,
  PLACEMENT_LABELS,
  SCENE_HINTS,
  SCENE_LABELS,
  SECTION_KIND_LABELS,
  TRANSITION_LABELS,
} from "@/lib/console/labels";
import { LYRIC_SCALE_MAX, LYRIC_SCALE_MIN } from "@/lib/console/plan-edit";
import { FONTS, fontStack } from "@/lib/fonts";
import { LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignPlan, LyricPlacement, LyricStyleId, Project, SceneId, SectionDesign } from "@/lib/types";
import { SectionTitle, SelectField, Slider } from "./controls";
import { IconSparkles } from "./icons";

const SCENE_OPTIONS = SCENE_IDS.map((id) => ({ value: id, label: SCENE_LABELS[id], title: SCENE_HINTS[id] }));
const STYLE_OPTIONS = LYRIC_STYLE_IDS.map((id) => ({ value: id, label: LYRIC_STYLE_LABELS[id], title: LYRIC_STYLE_HINTS[id] }));
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
  const bg = palette[0]?.hex ?? "#07080d";
  const lyricColor = plan.sections[0]?.lyricColor ?? palette.find((p) => /歌詞|lyric/i.test(p.role))?.hex ?? "#ffffff";
  const motifColor = palette[1]?.hex ?? palette[palette.length - 1]?.hex ?? "#ffffff";
  const motifSrc = useMemo(() => motifDataUrl(kv.motifSvg, motifColor), [kv.motifSvg, motifColor]);
  const typo = kv.typography;
  const cjk = FONTS[typo.cjkFont];
  const latin = FONTS[typo.latinFont];
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative overflow-hidden rounded-lg border border-line p-3"
        style={{
          background: `radial-gradient(120% 90% at 85% 10%, ${withAlpha(palette[1]?.hex ?? "#4455cc", 0.45)} 0%, transparent 60%), radial-gradient(90% 80% at 10% 100%, ${withAlpha(palette[2]?.hex ?? palette[1]?.hex ?? "#ff5a36", 0.35)} 0%, transparent 65%), ${bg}`,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: withAlpha(readableTextOn(bg), 0.6) }}>
              主視覺 KEY VISUAL
            </p>
            <h3 className="mt-1 text-lg leading-tight font-bold" style={{ color: readableTextOn(bg) }}>
              {kv.title || "未命名主視覺"}
            </h3>
          </div>
          {motifSrc && (
            // eslint-disable-next-line @next/next/no-img-element -- inline data: SVG, no optimization possible
            <img src={motifSrc} alt="主視覺符號" className="size-16 shrink-0 drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]" draggable={false} />
          )}
        </div>
        {kv.concept && (
          <p className="mt-2 text-xs leading-relaxed" style={{ color: withAlpha(readableTextOn(bg), 0.85) }}>
            {kv.concept}
          </p>
        )}
        {kv.moodKeywords?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {kv.moodKeywords.map((k) => (
              <span key={k} className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] text-white/90 ring-1 ring-white/15">
                {k}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>色盤</SectionTitle>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {palette.map((p, i) => (
            <button
              key={`${p.hex}-${i}`}
              type="button"
              onClick={() => copy(controller, p.hex)}
              title={`${p.name}（${p.role}）— 點擊複製 ${p.hex}`}
              className="group overflow-hidden rounded-md border border-line text-left hover:border-faint focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="flex h-9 items-end justify-end p-1" style={{ background: p.hex }}>
                <span className="font-mono text-[9px] opacity-80" style={{ color: readableTextOn(p.hex) }}>
                  {p.hex}
                </span>
              </span>
              <span className="block truncate bg-panel-2 px-1.5 pt-1 text-[11px] font-medium text-fg">{p.name || "—"}</span>
              <span className="block truncate bg-panel-2 px-1.5 pb-1 text-[10px] text-faint">{p.role}</span>
            </button>
          ))}
        </div>
      </div>

      {kv.motifs?.length > 0 && (
        <div>
          <SectionTitle>視覺符號</SectionTitle>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {kv.motifs.map((m) => (
              <Badge key={m} className="text-[11px]">
                {m}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>字體</SectionTitle>
        <div className="mt-1.5 overflow-hidden rounded-md border border-line">
          <div className="px-3 py-3" style={{ background: bg }}>
            <p
              className="line-clamp-2 text-[22px] leading-snug"
              style={{ fontFamily: fontStack(typo.cjkFont, typo.latinFont), fontWeight: typo.weight, letterSpacing: `${typo.letterSpacing}em`, color: lyricColor }}
            >
              {sampleText}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 bg-panel-2 px-2.5 py-1.5 text-[11px] text-muted">
            <span>
              中文 <span className="text-fg">{cjk?.label ?? typo.cjkFont}</span>
            </span>
            <span>
              西文 <span className="text-fg">{latin?.label ?? typo.latinFont}</span>
            </span>
            <span>
              字重 <span className="font-mono text-fg">{typo.weight}</span>
            </span>
            <span>
              字距 <span className="font-mono text-fg">{typo.letterSpacing}em</span>
            </span>
          </div>
          {typo.rationale && <p className="border-t border-line bg-panel-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-faint">{typo.rationale}</p>}
        </div>
      </div>

      {plan.designerNotes && (
        <div>
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            aria-expanded={notesOpen}
            className="flex w-full items-center justify-between text-left focus-visible:outline-2 focus-visible:outline-accent"
          >
            <SectionTitle>設計說明</SectionTitle>
            <span className="text-[11px] text-faint">{notesOpen ? "收合" : "展開"}</span>
          </button>
          {notesOpen && (
            <div className="mt-1 rounded-md border border-line bg-panel-2 px-3 py-1">
              <Markdown>{plan.designerNotes}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionCard({
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
  return (
    <article
      className={cx("rounded-lg border bg-panel-2/60 p-2.5 transition-colors", active ? "border-accent/70 bg-accent/5" : "border-line")}
      aria-current={active ? "true" : undefined}
    >
      <header className="flex items-center gap-2">
        <span className="flex shrink-0 overflow-hidden rounded-sm ring-1 ring-line" aria-hidden="true">
          {[bg, primary, accent].map((c, i) => (
            <span key={i} className="h-4 w-2.5" style={{ background: c ?? "#000" }} />
          ))}
        </span>
        <span className="truncate text-sm font-semibold text-fg">{section.label}</span>
        <span className="shrink-0 text-[10px] text-faint">{SECTION_KIND_LABELS[section.kind] ?? section.kind}</span>
        {active && (
          <Badge tone="accent" className="shrink-0">
            播放中
          </Badge>
        )}
        <button
          type="button"
          onClick={() => controller.jumpToSection(index)}
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] text-muted tabular hover:bg-panel-3 hover:text-fg"
          title="跳到這一段"
        >
          {formatTimeShort(section.start)}–{formatTimeShort(section.end)}
        </button>
      </header>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-faint">
        <span>能量</span>
        <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-panel-3">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(section.energy * 100)}%`, background: accent ?? "#ff5a36" }} />
        </span>
        <span>轉場 {TRANSITION_LABELS[section.transitionIn] ?? section.transitionIn}</span>
      </div>
      {section.rationale && <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{section.rationale}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <SelectField<SceneId>
          label="場景"
          value={section.scene}
          options={SCENE_OPTIONS}
          onChange={(scene) => controller.updateSection(index, { scene })}
          disabled={disabled}
          title={SCENE_HINTS[section.scene]}
        />
        <SelectField<LyricStyleId>
          label="歌詞呈現"
          value={section.lyricStyle}
          options={STYLE_OPTIONS}
          onChange={(lyricStyle) => controller.updateSection(index, { lyricStyle })}
          disabled={disabled}
          title={LYRIC_STYLE_HINTS[section.lyricStyle]}
        />
        <SelectField<LyricPlacement>
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
        />
      </div>
    </article>
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
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm text-muted">這首歌還沒有設計方案</p>
        <p className="text-xs leading-relaxed text-faint">投影仍可播放歌詞（使用預設畫面）。讓 AI 設計師研究這首歌後產生主視覺與逐段規劃。</p>
        <Button variant="primary" onClick={onRedesign} disabled={redesigning}>
          <IconSparkles />
          產生設計
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <KeyVisualCard controller={controller} plan={plan} sampleText={sampleText} />
      <div>
        <SectionTitle actions={<span className="text-[10px] text-faint">修改會即時套用到投影並自動儲存</span>}>段落設計（{plan.sections.length}）</SectionTitle>
        {redesigning && <p className="mt-1.5 rounded-md bg-accent/10 px-2 py-1 text-[11px] text-accent">重新設計進行中，完成前暫停手動修改。</p>}
        <div className="mt-1.5 flex flex-col gap-2">
          {plan.sections.map((s, i) => (
            <SectionCard key={s.id || i} controller={controller} section={s} index={i} active={i === sectionIndex} disabled={redesigning} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const DesignTab = memo(DesignTabImpl);
