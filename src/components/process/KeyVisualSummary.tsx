"use client";

import { useMemo, useState } from "react";
import { Badge, cx } from "@/components/ui";
import { Markdown } from "@/components/ui/Markdown";
import { FONTS, fontStack } from "@/lib/fonts";
import { contrastRatio } from "@/lib/stage/color";
import { prepareMotifSvg, svgToDataUrl } from "@/lib/stage/motif";
import { formatTimeShort } from "@/lib/timeline";
import type { DesignPlan, Project, SectionDesign } from "@/lib/types";
import { CUE_KIND_LABEL, LYRIC_STYLE_LABEL, PLACEMENT_LABEL, SCENE_LABEL } from "./labels";
import { SectionPreview } from "./SectionPreview";

function isHex(v: string | undefined): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

/** Text color that stays readable on `bg`. */
function inkOn(bg: string): string {
  return contrastRatio("#ffffff", bg) >= contrastRatio("#0b0c10", bg) ? "#ffffff" : "#0b0c10";
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

export function KeyVisualSummary({ project }: { project: Project }) {
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
  const bg = palette[0]?.hex ?? "#0b0c10";
  const featured = plan.sections[featuredSection(plan)];
  const motifColor = featured && isHex(featured.lyricColor) ? featured.lyricColor : palette[palette.length - 1]?.hex ?? "#ffffff";
  const motif = motifUrl(plan, motifColor);
  const typo = kv.typography;
  const current = plan.sections[Math.min(selected, plan.sections.length - 1)];
  const cjk = FONTS[typo.cjkFont]?.label ?? typo.cjkFont;
  const latin = FONTS[typo.latinFont]?.label ?? typo.latinFont;

  return (
    <section aria-labelledby="kv-title" className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* live section preview through the real stage renderer */}
        <div className="border-b border-line bg-panel-2/40 p-4 xl:border-b-0 xl:border-r">
          <div className="relative overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
            <SectionPreview project={project} sectionIndex={selected} className="w-full" />
          </div>
          {current && <SectionDetail project={project} section={current} />}
        </div>

        <div className="space-y-5 p-6">
          <div>
            <p className="text-xs font-medium tracking-wider text-accent">主視覺</p>
            <h2 id="kv-title" className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {kv.title}
            </h2>
            <p className="mt-2 text-sm leading-7 text-fg/85">{kv.concept}</p>
            {kv.moodKeywords.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="情緒關鍵字">
                {kv.moodKeywords.map((k) => (
                  <li key={k} className="rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-xs text-muted">
                    {k}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold text-muted">色票</h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-6">
              {palette.map((c, i) => (
                <li key={`${c.hex}-${i}`} className="overflow-hidden rounded-lg border border-line bg-panel-2">
                  <div className="flex h-12 items-end px-2 pb-1 font-mono text-[10px]" style={{ background: c.hex, color: inkOn(c.hex) }}>
                    {c.hex}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-fg" title={c.name}>
                      {c.name}
                    </p>
                    <p className="truncate text-[11px] text-faint">{c.role}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div
              className="flex size-28 shrink-0 items-center justify-center rounded-xl border border-line"
              style={{ background: `radial-gradient(circle at 50% 45%, ${palette[1]?.hex ?? bg}55, ${bg} 70%)` }}
            >
              {motif ? (
                // eslint-disable-next-line @next/next/no-img-element -- data: URL of a sanitized inline SVG
                <img src={motif} alt="主視覺符號" className="size-20 object-contain" />
              ) : (
                <span className="text-xs text-faint">無符號</span>
              )}
            </div>
            <div className="min-w-0 space-y-2">
              {kv.motifs.length > 0 && (
                <p className="text-sm text-muted">
                  <span className="text-xs font-semibold text-muted">視覺符號　</span>
                  <span className="text-fg/85">{kv.motifs.join("、")}</span>
                </p>
              )}
              <div className="rounded-lg border border-line px-3 py-2" style={{ background: bg }}>
                <p
                  className="truncate text-xl"
                  style={{
                    fontFamily: fontStack(typo.cjkFont, typo.latinFont),
                    fontWeight: typo.weight,
                    letterSpacing: `${typo.letterSpacing}em`,
                    color: featured?.lyricColor ?? "#ffffff",
                  }}
                >
                  {sampleLine(project, featured)}
                </p>
              </div>
              <p className="text-xs leading-5 text-muted">
                <span className="text-fg/85">
                  {cjk} ＋ {latin} · 字重 {typo.weight}
                </span>
                {typo.rationale && ` — ${typo.rationale}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-line p-6">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">段落與歌詞呈現</h3>
          <span className="text-xs text-faint">
            {plan.sections.length} 個段落 · {plan.cues.length} 個操作提示
          </span>
        </div>
        <SectionStrip plan={plan} duration={duration} selected={selected} onSelect={setSelected} />
        <SectionTable plan={plan} selected={selected} onSelect={setSelected} />
      </div>

      {(plan.designerNotes || plan.cues.length > 0) && (
        <div className="grid gap-6 border-t border-line p-6 lg:grid-cols-2">
          {plan.designerNotes && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-fg">設計師筆記</h3>
              <Markdown>{plan.designerNotes}</Markdown>
            </div>
          )}
          {plan.cues.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-fg">現場操作提示</h3>
              <ol className="space-y-2">
                {plan.cues.map((c, i) => (
                  <li key={`${c.time}-${i}`} className="flex gap-3 rounded-lg border border-line bg-panel-2/50 px-3 py-2">
                    <span className="w-10 shrink-0 pt-0.5 font-mono text-xs text-muted tabular">{formatTimeShort(c.time)}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg">{c.title}</span>
                        <Badge tone={c.kind === "warning" ? "warn" : c.kind === "drop" || c.kind === "highlight" ? "accent" : "neutral"}>
                          {CUE_KIND_LABEL[c.kind] ?? c.kind}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px] text-faint">
        <span>{label}</span>
        <span className="font-mono tabular">{Math.round(v * 100)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-3">
        <div className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

function SectionDetail({ project, section: s }: { project: Project; section: SectionDesign }) {
  const plan = project.plan;
  const lines = project.lyrics.lines.filter((l) => l.start != null && l.start >= s.start && l.start < s.end);
  const notes = new Map((plan?.lines ?? []).map((l) => [l.lineId, l]));
  const styled = lines.filter((l) => notes.has(l.id));
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-fg">預覽：{s.label}</h3>
        <span className="font-mono text-xs text-faint tabular">
          {formatTimeShort(s.start)}–{formatTimeShort(s.end)}
        </span>
        <span className="ml-auto text-[11px] text-faint">點下方段落切換預覽（無聲）</span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
          <dt className="text-[11px] text-faint">畫面</dt>
          <dd className="font-medium text-fg">{SCENE_LABEL[s.scene] ?? s.scene}</dd>
        </div>
        <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
          <dt className="text-[11px] text-faint">歌詞</dt>
          <dd className="font-medium text-fg">{LYRIC_STYLE_LABEL[s.lyricStyle] ?? s.lyricStyle}</dd>
        </div>
        <div className="rounded-md border border-line bg-panel px-2.5 py-1.5">
          <dt className="text-[11px] text-faint">位置 · 大小</dt>
          <dd className="font-medium text-fg">
            {s.lyricStyle === "hidden" ? "—" : `${PLACEMENT_LABEL[s.lyricPlacement] ?? s.lyricPlacement} · ${Math.round(s.lyricScale * 100)}%`}
          </dd>
        </div>
      </dl>
      <div className="grid grid-cols-4 gap-3">
        <Meter label="能量" value={s.energy} />
        <Meter label="速度" value={s.sceneParams.speed} />
        <Meter label="密度" value={s.sceneParams.density} />
        <Meter label="音樂反應" value={s.sceneParams.audioReactivity} />
      </div>
      <p className="text-sm leading-6 text-fg/85">{s.rationale}</p>
      <p className="text-xs text-faint">
        {lines.length > 0 ? `這段有 ${lines.length} 句歌詞` : "這段沒有歌詞"}
        {styled.length > 0 && `，其中 ${styled.length} 句有特別處理`}
        {s.lyricStyle === "hidden" && lines.length > 0 && "（刻意不顯示，讓畫面與燈光當主角）"}
      </p>
      {styled.length > 0 && (
        <ul className="space-y-1">
          {styled.slice(0, 4).map((l) => {
            const d = notes.get(l.id)!;
            return (
              <li key={l.id} className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs">
                <span className="text-fg">{l.text}</span>
                {d.emphasis.length > 0 && <span className="ml-2 text-accent">強調：{d.emphasis.join("、")}</span>}
                {d.styleOverride && <span className="ml-2 text-muted">改用{LYRIC_STYLE_LABEL[d.styleOverride]}</span>}
                {d.note && <span className="mt-0.5 block text-faint">{d.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionStrip({ plan, duration, selected, onSelect }: { plan: DesignPlan; duration: number; selected: number; onSelect: (i: number) => void }) {
  const total = Math.max(1, duration || plan.sections[plan.sections.length - 1]?.end || 1);
  return (
    <div>
      <div className="flex h-16 w-full gap-0.5 overflow-hidden rounded-lg" role="listbox" aria-label="段落時間軸">
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
              title={`${s.label}（${formatTimeShort(s.start)}–${formatTimeShort(s.end)}）\n${SCENE_LABEL[s.scene]} · ${LYRIC_STYLE_LABEL[s.lyricStyle]}\n${s.rationale}`}
              className={cx(
                "relative min-w-0 overflow-hidden px-2 text-left transition-[filter,box-shadow] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-accent",
                i === selected ? "z-[1] shadow-[inset_0_0_0_2px_#fff]" : "hover:brightness-125",
              )}
              style={{ flexGrow: len, flexBasis: 0, background: `linear-gradient(135deg, ${c0} 10%, ${c1} 75%, ${c2})` }}
            >
              <span className="block truncate text-xs font-semibold" style={{ color: s.lyricColor, textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>
                {s.label}
              </span>
              <span className="block truncate text-[10px] text-white/80" style={{ textShadow: "0 1px 2px rgba(0,0,0,.7)" }}>
                {SCENE_LABEL[s.scene]}／{LYRIC_STYLE_LABEL[s.lyricStyle]}
              </span>
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 bg-white/35" style={{ height: `${Math.round(Math.min(1, Math.max(0, s.energy)) * 6) + 1}px` }} />
            </button>
          );
        })}
      </div>
      <div className="relative mt-1 h-4 font-mono text-[10px] text-faint tabular" aria-hidden="true">
        {plan.sections.map((s) => (
          <span key={s.id} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${(s.start / total) * 100}%` }}>
            {formatTimeShort(s.start)}
          </span>
        ))}
        <span className="absolute right-0">{formatTimeShort(total)}</span>
      </div>
    </div>
  );
}

function SectionTable({ plan, selected, onSelect }: { plan: DesignPlan; selected: number; onSelect: (i: number) => void }) {
  return (
    <details className="group rounded-lg border border-line" open>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted hover:text-fg">每段設計理由</summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[40rem] text-left text-xs">
          <thead className="bg-panel-2 text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">時間</th>
              <th className="px-3 py-2 font-medium">段落</th>
              <th className="px-3 py-2 font-medium">畫面</th>
              <th className="px-3 py-2 font-medium">歌詞呈現</th>
              <th className="px-3 py-2 font-medium">理由</th>
            </tr>
          </thead>
          <tbody>
            {plan.sections.map((s, i) => (
              <tr
                key={s.id}
                onClick={() => onSelect(i)}
                className={cx("cursor-pointer border-t border-line align-top transition-colors", i === selected ? "bg-accent/[0.07]" : "hover:bg-panel-2/60")}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-muted tabular">
                  {formatTimeShort(s.start)}–{formatTimeShort(s.end)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="flex overflow-hidden rounded-sm" aria-hidden="true">
                      {s.colorway.map((c, k) => (
                        <span key={k} className="size-3" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="font-medium text-fg">{s.label}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-fg/85">{SCENE_LABEL[s.scene] ?? s.scene}</td>
                <td className="whitespace-nowrap px-3 py-2 text-fg/85">
                  {LYRIC_STYLE_LABEL[s.lyricStyle] ?? s.lyricStyle}
                  {s.lyricStyle !== "hidden" && <span className="text-faint"> · {PLACEMENT_LABEL[s.lyricPlacement] ?? s.lyricPlacement}</span>}
                </td>
                <td className="px-3 py-2 leading-5 text-muted">{s.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
