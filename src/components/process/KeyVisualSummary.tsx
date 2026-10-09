"use client";

// The key-visual showcase, the hero of the finished design overview (UI-AUDIT §3.5 處理頁, UI-30,
// 3.4.1 item 6). An apple.com product page, not a dashboard: the key visual's name as a large
// title and its concept; the live 16:9 preview through the real stage renderer with the section
// strip under it as the chapter picker; the selected section's four numbers as a plain stats row
// (no meters with tracks); the palette as round swatches (click copies the hex); motif and type
// specimen tiles; then the per-section rationale, designer notes and live cues as inset groups.
// `reveal` (only right after the design finished on this page): the blocks fade up 40 ms apart
// (at most 12), the swatches open from the centre, the strip grows from the left.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { InsetGroup, ListRow, Tag, cx } from "@/components/ui";
import { CheckIcon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { FONTS, fontStack } from "@/lib/fonts";
import { STAGGER_MAX, staggerDelay } from "@/lib/motion";
import { prepareMotifSvg, svgToDataUrl } from "@/lib/stage/motif";
import { formatTimeShort } from "@/lib/timeline";
import { shownEmphasis } from "@/lib/type/resolve";
import type { DesignPlan, Project, SectionDesign } from "@/lib/types";
import { CUE_KIND_LABEL, LYRIC_STYLE_LABEL, PLACEMENT_LABEL, SCENE_LABEL, SECTION_KIND_LABEL } from "./labels";
import { SectionPreview } from "./SectionPreview";
import { SceneProgramPanel, type SceneProgramActions } from "./SceneProgramPanel";

function isHex(v: string | undefined): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

function motifUrl(plan: DesignPlan, color: string): string | null {
  const svg = prepareMotifSvg(plan.keyVisual.motifSvg, color, 256);
  return svg ? svgToDataUrl(svg) : null;
}

/** The section to preview first: the first chorus, else the most energetic one. */
function featuredSection(plan: DesignPlan): number {
  const chorus = plan.sections.findIndex((s) => s.kind === "chorus" && s.lyricStyle !== "hidden");
  if (chorus >= 0) return chorus;
  let best = 0;
  plan.sections.forEach((s, i) => {
    if (s.energy > plan.sections[best].energy) best = i;
  });
  return best;
}

function sampleLine(project: Project, section: SectionDesign | undefined): string {
  if (section) {
    const line = project.lyrics.lines.find((l) => l.start != null && l.start >= section.start && l.start < section.end);
    if (line) return line.text;
  }
  return project.lyrics.lines[0]?.text || project.meta.title;
}

const range = (s: SectionDesign) => `${formatTimeShort(s.start)}-${formatTimeShort(s.end)}`;
const kindLabel = (s: SectionDesign) => {
  const k = SECTION_KIND_LABEL[s.kind];
  return k && k !== s.label ? k : null;
};

/** Stagger props for block `i` of the one-shot reveal. */
function revealAt(on: boolean, i: number): { className?: string; style?: CSSProperties; "data-motion"?: "move" } {
  if (!on) return {};
  return {
    "data-motion": "move",
    className: "animate-[ui-reveal_var(--dur-spring)_var(--ease-spring)_backwards]",
    style: { animationDelay: `${staggerDelay(Math.min(i, STAGGER_MAX - 1))}s` },
  };
}

export function KeyVisualSummary({ project, reveal = false, scene }: { project: Project; reveal?: boolean; scene?: SceneProgramActions }) {
  const plan = project.plan;
  const [selected, setSelected] = useState(() => (plan ? featuredSection(plan) : 0));
  const duration = useMemo(() => {
    if (!plan) return 0;
    const planEnd = plan.sections.reduce((m, s) => Math.max(m, s.end), 0);
    return project.meta.duration || project.analysis?.duration || planEnd;
  }, [plan, project.meta.duration, project.analysis?.duration]);

  if (!plan) return null;
  const kv = plan.keyVisual;
  const palette = kv.palette.filter((p) => isHex(p.hex));
  const bg = palette[0]?.hex ?? "black";
  const featured = plan.sections[featuredSection(plan)];
  const motifColor = featured && isHex(featured.lyricColor) ? featured.lyricColor : palette[palette.length - 1]?.hex ?? "white";
  const motif = motifUrl(plan, motifColor);
  const typo = kv.typography;
  const current = plan.sections[Math.min(selected, plan.sections.length - 1)];
  const cjk = FONTS[typo.cjkFont]?.label ?? typo.cjkFont;
  const latin = FONTS[typo.latinFont]?.label ?? typo.latinFont;
  let block = 0;
  const next = () => revealAt(reveal, block++);

  return (
    <section aria-labelledby="kv-title" className="min-w-0 space-y-12">
      <Reveal {...next()}>
        <h2 id="kv-title" className="text-large-title text-label">
          {kv.title}
        </h2>
        <p className="mt-3 max-w-[60em] text-[17px] leading-[26px] text-label-2">{kv.concept}</p>
        {kv.moodKeywords.length > 0 && <p className="mt-2 text-[15px] leading-[22px] text-label-2">情緒：{kv.moodKeywords.join("、")}</p>}
      </Reveal>

      <div className="min-w-0">
        <Reveal {...next()}>
          <div className="overflow-hidden rounded-2xl bg-black shadow-[0_0_0_var(--hairline)_var(--separator),0_24px_60px_-28px_rgba(0,0,0,0.5)]">
            <SectionPreview project={project} sectionIndex={selected} className="w-full" />
          </div>
        </Reveal>
        <Reveal {...next()} className="mt-4">
          <SectionStrip plan={plan} duration={duration} selected={selected} onSelect={setSelected} grow={reveal} />
        </Reveal>
        {current && (
          <Reveal {...next()} className="mt-6">
            <SectionDetail project={project} section={current} />
          </Reveal>
        )}
      </div>

      <Reveal {...next()}>
        <SceneProgramPanel project={project} actions={scene} />
      </Reveal>

      {palette.length > 0 && (
        <Reveal {...next()}>
          <h3 className="text-title-3 text-label">色票</h3>
          <Palette colors={palette} reveal={reveal} />
        </Reveal>
      )}

      <Reveal {...next()} className="grid min-w-0 gap-6 sm:grid-cols-2">
        <figure className="min-w-0">
          <div
            className={cx("flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl", reveal && "[clip-path:circle(75%_at_50%_50%)] transition-[clip-path] duration-[600ms] ease-out starting:[clip-path:circle(0%_at_50%_50%)] motion-reduce:transition-none")}
            style={{ background: `radial-gradient(circle at 50% 45%, ${palette[1]?.hex ?? bg}55, ${bg} 70%)` }}
          >
            {motif ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL of a sanitized inline SVG
              <img src={motif} alt="主視覺符號" className="size-1/2 object-contain" />
            ) : (
              <span className="text-[13px] text-white/70">沒有視覺符號</span>
            )}
          </div>
          <figcaption className="mt-3 px-1">
            <p className="text-[13px] leading-5 text-label-2">視覺符號</p>
            <p className="text-[15px] leading-[22px] text-label">{kv.motifs.length > 0 ? kv.motifs.join("、") : "主視覺符號"}</p>
          </figcaption>
        </figure>
        <figure className="min-w-0">
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl px-6" style={{ background: bg }}>
            <p
              className="line-clamp-2 text-center text-[28px] leading-[1.35]"
              style={{
                fontFamily: fontStack(typo.cjkFont, typo.latinFont),
                fontWeight: typo.weight,
                letterSpacing: `${typo.letterSpacing}em`,
                color: featured?.lyricColor ?? "white",
              }}
            >
              {sampleLine(project, featured)}
            </p>
          </div>
          <figcaption className="mt-3 px-1">
            <p className="text-[13px] leading-5 text-label-2">字體</p>
            <p className="text-[15px] leading-[22px] text-label">
              {cjk} ＋ {latin}，字重 {typo.weight}
            </p>
            {typo.rationale && <p className="mt-1 text-[13px] leading-5 text-label-2">{typo.rationale}</p>}
          </figcaption>
        </figure>
      </Reveal>

      <Reveal {...next()}>
        <InsetGroup header="每段設計理由" footer={`${plan.sections.length} 個段落。點一列切換上方的預覽。`}>
          {plan.sections.map((s, i) => (
            <SectionRow key={s.id} section={s} selected={i === selected} onSelect={() => setSelected(i)} />
          ))}
        </InsetGroup>
      </Reveal>

      {(plan.designerNotes || plan.cues.length > 0) && (
        <Reveal {...next()} className="grid min-w-0 gap-8 lg:grid-cols-2">
          {plan.designerNotes && (
            <InsetGroup header="設計師筆記">
              <div className="px-4 py-3">
                <Markdown className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{plan.designerNotes}</Markdown>
              </div>
            </InsetGroup>
          )}
          {plan.cues.length > 0 && (
            <InsetGroup header="現場操作提示" footer={`${plan.cues.length} 個提示，控制台會在時間到之前倒數。`}>
              {plan.cues.map((c, i) => (
                <div
                  key={`${c.time}-${i}`}
                  className="relative flex min-w-0 gap-3 px-4 py-3 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:h-(--hairline) after:bg-separator last:after:hidden"
                >
                  <span className="w-10 shrink-0 text-[13px] leading-5 text-label-2 tabular">{formatTimeShort(c.time)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] leading-5 font-medium text-label">{c.title}</span>
                      <Tag tone={c.kind === "warning" ? "orange" : c.kind === "drop" || c.kind === "highlight" ? "tint" : "neutral"}>{CUE_KIND_LABEL[c.kind] ?? c.kind}</Tag>
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-[18px] text-label-2">{c.detail}</span>
                  </span>
                </div>
              ))}
            </InsetGroup>
          )}
        </Reveal>
      )}
    </section>
  );
}

function Reveal({ className, style, children, ...rest }: { className?: string; style?: CSSProperties; children: ReactNode; "data-motion"?: "move" }) {
  return (
    <div {...rest} className={cx("min-w-0", className)} style={style}>
      {children}
    </div>
  );
}

function Palette({ colors, reveal }: { colors: DesignPlan["keyVisual"]["palette"]; reveal: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const center = (colors.length - 1) / 2;
  const copy = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <ul className="mt-5 flex flex-wrap gap-x-7 gap-y-5" aria-label="主視覺色票">
      {colors.map((c, i) => (
        <li
          key={`${c.hex}-${i}`}
          data-motion={reveal ? "move" : undefined}
          className={cx("w-20 min-w-0", reveal && "animate-[ui-reveal_var(--dur-spring)_var(--ease-spring)_backwards]")}
          style={reveal ? { animationDelay: `${0.12 + Math.abs(i - center) * 0.04}s` } : undefined}
        >
          <button
            type="button"
            onClick={() => copy(c.hex)}
            aria-label={`${c.name}（${c.role}），點擊複製 ${c.hex}`}
            title={`${c.name}（${c.role}），點擊複製 ${c.hex}`}
            className="press-tile relative flex size-11 items-center justify-center rounded-full shadow-[inset_0_0_0_var(--hairline)_var(--separator)]"
            style={{ background: c.hex }}
          >
            {copied === c.hex && (
              <span className="flex size-6 items-center justify-center rounded-full bg-black/45 text-white transition-opacity duration-(--dur-fast) ease-out starting:opacity-0">
                <CheckIcon size={14} />
              </span>
            )}
          </button>
          <p className="mt-2 truncate text-[12px] leading-4 font-semibold text-label" title={c.name}>
            {c.name}
          </p>
          <p className="truncate text-[12px] leading-4 text-label-2" title={c.role}>
            {copied === c.hex ? `已複製 ${c.hex}` : c.role}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="text-[12px] leading-4 text-label-2">{label}</dt>
      <dd className="text-[20px] leading-7 font-semibold text-label tabular">
        {Math.round(v * 100)}
        <span aria-hidden="true" className="mt-1 mb-1 block h-[3px] rounded-full bg-tint" style={{ width: `${Math.max(3, v * 56)}px` }} />
      </dd>
    </div>
  );
}

function SectionDetail({ project, section: s }: { project: Project; section: SectionDesign }) {
  const plan = project.plan;
  const all = project.lyrics.lines;
  const duration = project.meta.duration || project.analysis?.duration || plan?.sections[plan.sections.length - 1]?.end || 0;
  const lines = all.filter((l) => l.start != null && l.start >= s.start && l.start < s.end);
  // 強調 from the composition the type system actually uses (edits included), the rest from the plan's line design
  const notes = new Map(
    (plan?.lines ?? []).map((l) => {
      const index = all.findIndex((x) => x.id === l.lineId);
      return [l.lineId, { ...l, emphasis: index >= 0 ? shownEmphasis(plan, all, index, duration, project.meta.title) : l.emphasis }];
    }),
  );
  const styled = lines.filter((l) => notes.has(l.id));
  const kind = kindLabel(s);
  return (
    <div className="grid min-w-0 gap-x-10 gap-y-6 md:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
      <div className="min-w-0">
        <p className="text-[13px] leading-5 text-label-2 tabular">
          預覽 {range(s)}（無聲）
        </p>
        <h3 className="mt-0.5 flex flex-wrap items-center gap-2 text-title-3 text-label">
          {s.label}
          {kind && <Tag>{kind}</Tag>}
        </h3>
        <p className="mt-2 text-[15px] leading-[22px] text-label-2">{s.rationale}</p>
        <dl className="mt-5 grid max-w-md grid-cols-4 gap-4">
          <Stat label="能量" value={s.energy} />
          <Stat label="速度" value={s.sceneParams.speed} />
          <Stat label="密度" value={s.sceneParams.density} />
          <Stat label="音樂反應" value={s.sceneParams.audioReactivity} />
        </dl>
      </div>
      <div className="min-w-0 space-y-4">
        <InsetGroup>
          <ListRow title="畫面" value={SCENE_LABEL[s.scene] ?? s.scene} />
          <ListRow title="歌詞" value={LYRIC_STYLE_LABEL[s.lyricStyle] ?? s.lyricStyle} />
          <ListRow title="位置" value={s.lyricStyle === "hidden" ? "不顯示" : `${PLACEMENT_LABEL[s.lyricPlacement] ?? s.lyricPlacement}，${Math.round(s.lyricScale * 100)}%`} />
        </InsetGroup>
        <p className="px-4 text-[12px] leading-4 text-label-2">
          {lines.length > 0 ? `這段有 ${lines.length} 句歌詞` : "這段沒有歌詞"}
          {styled.length > 0 && `，其中 ${styled.length} 句有特別處理`}
          {s.lyricStyle === "hidden" && lines.length > 0 && "（刻意不顯示，讓畫面與燈光當主角）"}
        </p>
        {styled.length > 0 && (
          <InsetGroup>
            {styled.slice(0, 4).map((l) => {
              const d = notes.get(l.id)!;
              return (
                <div
                  key={l.id}
                  className="relative px-4 py-2.5 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:h-(--hairline) after:bg-separator last:after:hidden"
                >
                  <p className="text-[15px] leading-5 text-label">{l.text}</p>
                  <p className="mt-0.5 text-[12px] leading-4 text-label-2">
                    {[d.emphasis.length > 0 ? `強調：${d.emphasis.join("、")}` : null, d.styleOverride ? `改用${LYRIC_STYLE_LABEL[d.styleOverride]}` : null, d.note || null]
                      .filter(Boolean)
                      .join("。")}
                  </p>
                </div>
              );
            })}
          </InsetGroup>
        )}
      </div>
    </div>
  );
}

function SectionStrip({ plan, duration, selected, onSelect, grow }: { plan: DesignPlan; duration: number; selected: number; onSelect: (i: number) => void; grow: boolean }) {
  const total = Math.max(1, duration || plan.sections[plan.sections.length - 1]?.end || 1);
  return (
    <div className="min-w-0">
      <div
        className={cx(
          "flex h-14 w-full gap-0.5 overflow-hidden rounded-lg",
          grow && "[clip-path:inset(0_0_0_0_round_12px)] transition-[clip-path] duration-[600ms] ease-out starting:[clip-path:inset(0_100%_0_0_round_12px)] motion-reduce:transition-none",
        )}
        role="listbox"
        aria-label="段落時間軸"
      >
        {plan.sections.map((s, i) => {
          const [c0, c1, c2] = s.colorway;
          const len = Math.max(0.5, s.end - s.start);
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === selected}
              onClick={() => onSelect(i)}
              title={`${s.label}（${range(s)}）\n${SCENE_LABEL[s.scene]}，${LYRIC_STYLE_LABEL[s.lyricStyle]}`}
              className={cx(
                "relative min-w-0 overflow-hidden px-2 text-left transition-[filter] duration-(--dur-fast) ease-[ease] focus-inset",
                i === selected ? "z-[1] shadow-[inset_0_0_0_2px_white]" : "hover:brightness-110",
              )}
              style={{ flexGrow: len, flexBasis: 0, background: `linear-gradient(135deg, ${c0} 10%, ${c1} 75%, ${c2})` }}
            >
              <span className="block truncate text-[12px] leading-4 font-semibold" style={{ color: s.lyricColor, textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>
                {s.label}
              </span>
              <span className="block truncate text-[12px] leading-4 text-white/85" style={{ textShadow: "0 1px 2px rgba(0,0,0,.7)" }}>
                {SCENE_LABEL[s.scene]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative mt-1.5 h-4 text-[12px] leading-4 text-label-2 tabular" aria-hidden="true">
        {plan.sections.map((s, i) => {
          const left = (s.start / total) * 100;
          // skip ticks that would collide with the previous one or the end label
          const prev = i > 0 ? (plan.sections[i - 1].start / total) * 100 : -100;
          if (left - prev < 5 || left > 92) return null;
          return (
            <span key={s.id} className={cx("absolute", i === 0 ? "" : "-translate-x-1/2")} style={{ left: `${left}%` }}>
              {formatTimeShort(s.start)}
            </span>
          );
        })}
        <span className="absolute right-0">{formatTimeShort(total)}</span>
      </div>
    </div>
  );
}

function SectionRow({ section: s, selected, onSelect }: { section: SectionDesign; selected: boolean; onSelect: () => void }) {
  const kind = kindLabel(s);
  const [c0, c1, c2] = s.colorway;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "relative flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-none hover:bg-fill-4 active:bg-fill-3 focus-inset",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-14 after:h-(--hairline) after:bg-separator last:after:hidden",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 size-7 shrink-0 rounded-[7px] shadow-[inset_0_0_0_var(--hairline)_var(--separator)]" style={{ background: `linear-gradient(135deg, ${c0}, ${c1} 70%, ${c2})` }} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-[15px] leading-5 font-medium text-label">{s.label}</span>
          {kind && <Tag className="self-center">{kind}</Tag>}
          <span className="ml-auto shrink-0 text-[13px] leading-5 text-label-2 tabular">{range(s)}</span>
        </span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-label">
          {SCENE_LABEL[s.scene] ?? s.scene}，{LYRIC_STYLE_LABEL[s.lyricStyle] ?? s.lyricStyle}
          {s.lyricStyle !== "hidden" && `，${PLACEMENT_LABEL[s.lyricPlacement] ?? s.lyricPlacement}`}
        </span>
        <span className="mt-1 block text-[13px] leading-[18px] text-label-2">{s.rationale}</span>
      </span>
      <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center">
        {selected && <CheckIcon size={16} className="text-tint" />}
      </span>
    </button>
  );
}
