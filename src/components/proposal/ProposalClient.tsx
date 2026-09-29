"use client";

// 一頁提案 (phase 4): the band sign-off sheet. One A4 landscape page (297 × 210 mm, laid out in
// millimetres so the screen preview is the printed page): the song and band, each design
// direction with its style frames, palette, typography sample, pitch and rationale, the mood board
// references, and the sign-off area (選擇方向 A／B／C, 意見, 簽名／日期). 「列印／存成 PDF」 is
// window.print() with a named @page (globals.css `.proposal-paper`); no PDF library. The paper is
// always light (data-theme="light"); the page chrome follows the system appearance.
//
// 下載 PNG is not offered: rasterising this DOM (fonts, the rendered frames) needs a DOM-to-image
// library, and the project adds no dependencies. 「存成 PDF」 in the print dialog covers sharing.

import { useEffect, useMemo, useState } from "react";
import { AppHeader, Button, EmptyState, Spinner, cx } from "@/components/ui";
import { PrinterIcon, SwatchesIcon, WarningCircleIcon } from "@/components/ui/Icon";
import { useStyleFrames } from "@/components/directions/style-frames";
import { api } from "@/lib/api-client";
import { proposalSheet, type ProposalDirection } from "@/lib/directions";
import { FONTS, fontStack } from "@/lib/fonts";
import { mergedMoodboard } from "@/lib/moodboard";
import type { DesignDirection, Project } from "@/lib/types";

type Load = { kind: "loading" } | { kind: "ok"; project: Project; bandName?: string } | { kind: "error"; message: string };

function DirectionColumn({ project, direction, view, onReady }: { project: Project; direction: DesignDirection; view: ProposalDirection; onReady: (id: string, ready: boolean) => void }) {
  const frames = useStyleFrames(project, direction);
  const ready = frames.status !== "loading";
  useEffect(() => onReady(direction.id, ready), [direction.id, ready, onReady]);
  const list = frames.frames ?? [];
  const hero = list.find((f) => f.label === "第一次副歌") ?? list[1] ?? list[0];
  const rest = list.filter((f) => f !== hero).slice(0, 3);
  const t = direction.plan.keyVisual.typography;
  const bg = direction.plan.keyVisual.palette[0]?.hex ?? "#000";
  const fg = direction.plan.sections.find((s) => s.kind === "chorus")?.lyricColor ?? direction.plan.sections[0]?.lyricColor ?? "#fff";
  const selected = view.status === "selected";
  return (
    <section className={cx("flex min-h-0 min-w-0 flex-col gap-[1.6mm] overflow-hidden rounded-[2mm] p-[2mm]", selected ? "bg-[#eef4ff] shadow-[0_0_0_0.5mm_#0071e3]" : "bg-[#f5f5f7]")} data-testid="proposal-direction">
      <header className="flex min-w-0 items-center gap-[2mm]">
        <span className="flex size-[6.5mm] shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-[10pt] leading-none font-bold text-white">{view.letter}</span>
        <h2 className="min-w-0 flex-1 truncate text-[11.5pt] leading-[1.2] font-bold">{view.name}</h2>
        <span className={cx("shrink-0 rounded-[1mm] px-[1.4mm] py-[0.6mm] text-[6.5pt] leading-none font-semibold", selected ? "bg-[#0071e3] text-white" : view.status === "rejected" ? "bg-[#fde8e7] text-[#b3261e]" : "bg-[#e8e8ed] text-[#424245]")}>{view.statusLabel}</span>
      </header>
      <div className="relative h-[48mm] shrink-0 overflow-hidden rounded-[1.2mm] bg-black">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element -- a rendered still
          <img src={hero.url} alt={`方向 ${view.letter}：${hero.label}`} className="size-full object-cover" data-testid="proposal-frame" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[7pt] text-white/70">{frames.status === "error" ? frames.error : "正在算出畫面…"}</span>
        )}
        {hero && <span className="absolute bottom-[1mm] left-[1mm] rounded-[0.6mm] bg-black/65 px-[1mm] py-[0.4mm] text-[6pt] leading-none font-semibold text-white">{hero.label}</span>}
      </div>
      <div className="grid h-[15mm] shrink-0 gap-[1.2mm]" style={{ gridTemplateColumns: `repeat(${Math.max(1, rest.length || 3)}, minmax(0, 1fr))` }}>
        {(rest.length ? rest.map((_, i) => i) : [0, 1, 2]).map((i) => {
          const f = rest[i];
          return (
            <div key={i} className="relative min-w-0 overflow-hidden rounded-[0.8mm] bg-black">
              {f && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a rendered still */}
                  <img src={f.url} alt={`方向 ${view.letter}：${f.label}`} className="size-full object-cover" data-testid="proposal-frame" />
                  <span className="absolute bottom-[0.6mm] left-[0.6mm] rounded-[0.5mm] bg-black/65 px-[0.8mm] py-[0.3mm] text-[5pt] leading-none text-white">{f.label}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-[1.4mm]">
        {view.palette.map((c) => (
          <span key={c.hex} className="flex min-w-0 flex-col items-center gap-[0.4mm]">
            <span className="size-[4.6mm] rounded-full shadow-[0_0_0_0.2mm_rgba(0,0,0,0.15)]" style={{ background: c.hex }} />
            <span className="font-mono text-[4.8pt] leading-none text-[#6e6e73]">{c.hex}</span>
          </span>
        ))}
      </div>
      <div className="shrink-0 overflow-hidden rounded-[1mm] px-[2mm] py-[1.2mm]" style={{ background: bg, color: fg }}>
        <p className="truncate text-[12pt] leading-[1.25]" style={{ fontFamily: fontStack(t.cjkFont, t.latinFont), fontWeight: t.weight, letterSpacing: `${t.letterSpacing}em` }}>
          {view.fonts.sample}
        </p>
        <p className="truncate text-[5.5pt] leading-[1.3] opacity-75">
          {view.fonts.cjk}＋{view.fonts.latin}，字重 {view.fonts.weight}
        </p>
      </div>
      <p className="line-clamp-2 shrink-0 text-[8pt] leading-[1.35] font-semibold">{view.pitch}</p>
      <p className="line-clamp-4 min-h-0 text-[6.8pt] leading-[1.4] text-[#424245]">{view.rationale}</p>
      <dl className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-[1.5mm] gap-y-[0.5mm] text-[6.2pt] leading-[1.35]">
        <dt className="font-semibold text-[#6e6e73]">場景</dt>
        <dd className="line-clamp-1 min-w-0">{view.sceneTendency}</dd>
        <dt className="font-semibold text-[#6e6e73]">歌詞</dt>
        <dd className="line-clamp-1 min-w-0">{view.lyricTreatment}</dd>
        {view.references.length > 0 && (
          <>
            <dt className="font-semibold text-[#6e6e73]">參考</dt>
            <dd className="line-clamp-1 min-w-0">{view.references.map((r) => `圖 ${r.index} ${r.cue}`).join("；")}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span className={cx("inline-flex size-[3.6mm] items-center justify-center rounded-[0.6mm] border-[0.3mm] border-[#1d1d1f] align-[-0.6mm] text-[7pt] leading-none font-bold", checked && "bg-[#1d1d1f] text-white")} aria-hidden="true">
      {checked ? "✓" : ""}
    </span>
  );
}

export function ProposalClient({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    api
      .getProject(id)
      .then(async (project) => {
        const band = project.bandId ? await api.getBand(project.bandId).catch(() => null) : null;
        if (live) setLoad({ kind: "ok", project, bandName: band?.name });
      })
      .catch((err: unknown) => {
        if (live) setLoad({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
  }, [id]);

  const project = load.kind === "ok" ? load.project : null;
  const moodboard = useMemo(() => (project ? mergedMoodboard(project) : []), [project]);
  const sheet = useMemo(
    () => (project ? proposalSheet(project, { bandName: load.kind === "ok" ? load.bandName : undefined, moodboard, fontLabel: (f) => FONTS[f as keyof typeof FONTS]?.label ?? f }) : null),
    [project, load, moodboard],
  );
  const onReady = useMemo(() => (dir: string, r: boolean) => setReady((m) => (m[dir] === r ? m : { ...m, [dir]: r })), []);
  const directions = project?.directions?.directions ?? [];
  const allReady = directions.length > 0 && directions.every((d) => ready[d.id]);
  const backHref = `/p/${encodeURIComponent(id)}/process#directions`;

  const header = (
    <AppHeader
      back={{ href: backHref, label: "設計總覽" }}
      width="full"
      title="一頁提案"
      subtitle={sheet ? `${sheet.title}${sheet.band ? `，${sheet.band}` : ""}` : undefined}
      actions={
        <Button variant="filled" icon={PrinterIcon} onClick={() => window.print()} disabled={!allReady} data-testid="print-proposal">
          {allReady || !directions.length ? "列印／存成 PDF" : "畫面準備中…"}
        </Button>
      }
    />
  );

  if (load.kind === "loading") {
    return (
      <div className="min-h-dvh">
        <div className="print-hide">{header}</div>
        <div className="flex justify-center pt-24">
          <Spinner size={20} label="載入提案…" />
        </div>
      </div>
    );
  }
  if (load.kind === "error" || !project || !sheet) {
    return (
      <div className="min-h-dvh">
        <div className="print-hide">{header}</div>
        <EmptyState icon={WarningCircleIcon} title="無法載入這個作品" description={load.kind === "error" ? load.message : ""} className="mt-24" />
      </div>
    );
  }
  if (!directions.length) {
    return (
      <div className="min-h-dvh">
        <div className="print-hide">{header}</div>
        <EmptyState
          icon={SwatchesIcon}
          title="還沒有設計方向"
          description="先在設計總覽提出 2 到 3 個設計方向，這裡就會排成一頁給樂團確認。"
          action={
            <Button variant="tinted" href={backHref}>
              前往設計方向
            </Button>
          }
          className="mt-24"
        />
      </div>
    );
  }

  const cols = directions.length;
  return (
    <div className="min-h-dvh bg-bg print:bg-white">
      <div className="print-hide">{header}</div>
      <p className="print-hide mx-auto mt-4 max-w-[297mm] px-4 text-[13px] leading-5 text-label-2">
        A4 橫式一頁。在列印對話框選「儲存為 PDF」即可傳給樂團；請把「邊界」設為「無」或「預設」、開啟「背景圖形」。
      </p>
      <div className="overflow-x-auto px-4 pt-4 pb-16 print:overflow-visible print:p-0">
        <article
          data-theme="light"
          data-testid="proposal-sheet"
          className="proposal-paper mx-auto flex h-[210mm] w-[297mm] flex-col gap-[3.5mm] overflow-hidden bg-white p-[10mm] text-[#1d1d1f] shadow-[0_2px_24px_rgba(0,0,0,0.18)] print:shadow-none"
        >
          <header className="flex shrink-0 items-end justify-between gap-[6mm] border-b-[0.3mm] border-[#d2d2d7] pb-[2.5mm]">
            <div className="min-w-0">
              <p className="text-[7pt] leading-none font-semibold text-[#6e6e73]">舞台視覺設計方向提案</p>
              <h1 className="mt-[1.4mm] truncate text-[18pt] leading-[1.15] font-bold">〈{sheet.title}〉</h1>
              <p className="mt-[0.8mm] truncate text-[8.5pt] leading-[1.3] text-[#424245]">
                {sheet.band || sheet.artist}
                {sheet.band && sheet.artist && sheet.band !== sheet.artist ? `（${sheet.artist}）` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right text-[7pt] leading-[1.5] text-[#6e6e73]">
              <p>提案日期 {sheet.date}</p>
              <p>{sheet.engine === "claude" ? "Claude 設計師提案" : "離線設計師提案"}，Livelyrics</p>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-[4mm]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {directions.map((d) => {
              const view = sheet.directions.find((v) => v.id === d.id)!;
              return <DirectionColumn key={d.id} project={project} direction={d} view={view} onReady={onReady} />;
            })}
          </div>

          <footer className="grid h-[38mm] shrink-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-[5mm]">
            <section className="min-w-0 overflow-hidden rounded-[2mm] bg-[#f5f5f7] p-[2.5mm]">
              <h2 className="text-[7.5pt] leading-none font-semibold">參考圖</h2>
              {sheet.references.length ? (
                <ul className="mt-[1.8mm] grid grid-cols-6 gap-[1.6mm]">
                  {sheet.references.slice(0, 6).map((r) => {
                    const img = moodboard.find((m) => m.id === r.id)!;
                    const url = img.scope === "band" && project.bandId ? api.moodImageUrl({ kind: "band", id: project.bandId }, img.id) : api.moodImageUrl({ kind: "project", id: project.id }, img.id);
                    return (
                      <li key={r.id} className="min-w-0">
                        <span className="relative block h-[14mm] overflow-hidden rounded-[0.8mm] bg-[#e8e8ed]">
                          {/* eslint-disable-next-line @next/next/no-img-element -- stored reference image */}
                          <img src={url} crossOrigin="anonymous" alt={`圖 ${r.index}`} className="size-full object-cover" />
                          <span className="absolute top-[0.5mm] left-[0.5mm] rounded-[0.5mm] bg-black/65 px-[0.8mm] py-[0.3mm] text-[5pt] leading-none font-semibold text-white">圖 {r.index}</span>
                        </span>
                        <span className="mt-[0.6mm] block truncate text-[5.5pt] leading-[1.3] text-[#424245]">{r.note || r.name}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-[2mm] text-[7pt] leading-[1.4] text-[#6e6e73]">這次沒有提供參考圖。</p>
              )}
              {sheet.references.length > 6 && <p className="mt-[1mm] text-[5.5pt] text-[#6e6e73]">另有 {sheet.references.length - 6} 張參考圖。</p>}
            </section>
            <section className="flex min-w-0 flex-col rounded-[2mm] border-[0.3mm] border-[#1d1d1f] p-[2.5mm]" data-testid="signoff">
              <h2 className="text-[7.5pt] leading-none font-semibold">樂團確認</h2>
              <p className="mt-[2mm] flex flex-wrap items-center gap-x-[4mm] gap-y-[1mm] text-[8pt] leading-none">
                <span className="font-semibold">選擇方向</span>
                {sheet.choices.map((c) => (
                  <span key={c} className="inline-flex items-center gap-[1.2mm]">
                    <Box checked={sheet.selectedLetter === c} /> {c}
                  </span>
                ))}
                <span className="text-[6.5pt] text-[#6e6e73]">{sheet.selectedLetter ? `目前採用方向 ${sheet.selectedLetter}` : "請勾選一個"}</span>
              </p>
              <div className="mt-[2.4mm] min-h-0 flex-1">
                <p className="text-[7pt] leading-none font-semibold">意見</p>
                <div className="mt-[3.4mm] border-b-[0.25mm] border-[#86868b]" />
                <div className="mt-[4.2mm] border-b-[0.25mm] border-[#86868b]" />
              </div>
              <p className="flex items-end gap-[3mm] text-[7pt] leading-none">
                <span className="font-semibold">簽名</span>
                <span className="flex-1 border-b-[0.25mm] border-[#86868b]" />
                <span className="font-semibold">日期</span>
                <span className="w-[22mm] border-b-[0.25mm] border-[#86868b]" />
              </p>
            </section>
          </footer>
        </article>
      </div>
    </div>
  );
}
