"use client";

// 視覺聖經 editor /b/[id]/bible: every field of the band's bible as iOS-style inset groups, with a
// live stage preview in the band's palette and fonts. 「從作品產生」 lets the designer rewrite it
// (asks first when there is something to lose); 「儲存」 is the one filled button and is only
// active with changes. Leaving with unsaved changes asks the browser to confirm.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { bandHref } from "@/components/home/BandShelf";
import { LookStage } from "@/components/show/LookStage";
import { Alert, AppHeader, Banner, Button, EmptyState, InsetGroup, ListRow, SegmentedControl, Skeleton, SkeletonGroup, Spinner, Switch, TextArea, TextField, cx } from "@/components/ui";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, SparkleIcon, UsersThreeIcon, XIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { useJobPolling } from "./use-job-polling";
import { LYRIC_POLICY_INFO, LYRIC_POLICY_MODES, MAX_PALETTE, MIN_PALETTE, bibleHasContent, normalizeBibleHex } from "@/lib/band";
import { MEDIA_TREATMENT_HINTS, MEDIA_TREATMENT_LABELS, SCENE_HINTS, SCENE_LABELS } from "@/lib/console/labels";
import { FONTS, fontStack } from "@/lib/font-meta";
import { FONT_IDS, MEDIA_TREATMENTS, SCENE_IDS, type FontId } from "@/lib/schema";
import { colorwayFor, lookToProject, moveItem, paletteRoles } from "@/lib/show";
import { contrastRatio } from "@/lib/server/designer/color";
import type { Band, BandBible, BandPaletteColor, LyricPolicyMode, SceneId } from "@/lib/types";

const ROLES = ["背景", "對比背景", "主色", "點綴", "歌詞", "高光", "輔色"];
const CJK_FONTS = FONT_IDS.filter((f) => FONTS[f].cjk);
const LATIN_FONTS = FONT_IDS.filter((f) => !FONTS[f].cjk);
const WEIGHTS = ["600", "700", "800", "900"] as const;

type Stance = "avoid" | "neutral" | "prefer";

function editable(b: BandBible): Omit<BandBible, "source"> {
  const rest: Partial<BandBible> = { ...b };
  delete rest.source;
  return rest as Omit<BandBible, "source">;
}

function Group({ title, footer, children, id }: { title: string; footer?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <InsetGroup header={title} footer={footer} headerLevel={2} id={id}>
      {children}
    </InsetGroup>
  );
}

export function BibleEditor({ id, initialName }: { id: string; initialName?: string }) {
  const [band, setBand] = useState<Band | null>(null);
  const [draft, setDraft] = useState<BandBible | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [genNote, setGenNote] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getBand(id)
      .then((b) => {
        if (!alive) return;
        setBand(b);
        setDraft(b.bible);
      })
      .catch((err: unknown) => alive && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  const dirty = useMemo(() => !!band && !!draft && JSON.stringify(editable(draft)) !== JSON.stringify(editable(band.bible)), [band, draft]);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  // cloud mode: a generation recorded on the band keeps running on the server (refresh, other tab)
  const jobRunning = band?.bibleJob?.status === "running";
  useJobPolling(jobRunning && !generating, async () => {
    const next = await api.getBand(id);
    if (next.bibleJob?.status === "running") return;
    setBand(next);
    // an edit in progress is kept (it shows as unsaved against the new bible)
    if (!dirtyRef.current) setDraft(next.bible);
    // (also replaces a "busy" answer this page got while the job ran)
    setGenError(next.bibleJob?.status === "error" ? next.bibleJob.message || "產生視覺聖經沒有完成，請重試。" : null);
  });
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const patch = useCallback((p: Partial<BandBible>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.updateBand(id, { bible: editable(draft) });
      setBand(saved);
      setDraft(saved.bible);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    setConfirmGenerate(false);
    setGenerating(true);
    setGenNote(null);
    setGenError(null);
    try {
      const res = await api.generateBible(id);
      setBand(res.band);
      setDraft(res.band.bible);
      setGenNote(res.logs[res.logs.length - 1] ?? null);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
      // it may be running elsewhere (cloud mode answers 409): pick up the band's recorded job
      void api
        .getBand(id)
        .then((b) => setBand((cur) => (cur ? { ...cur, bibleJob: b.bibleJob } : b)))
        .catch(() => {});
    } finally {
      setGenerating(false);
    }
  };

  const requestGenerate = () => (band && (bibleHasContent(band.bible) || dirty) ? setConfirmGenerate(true) : void generate());

  const back = {
    href: bandHref(id),
    label: band?.name ?? initialName ?? "樂團",
    onNavigate: (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (dirtyRef.current && !window.confirm("視覺聖經還沒儲存，確定要離開嗎？")) e.preventDefault();
    },
  };

  return (
    <div className="min-h-dvh">
      <AppHeader
        back={back}
        title="視覺聖經"
        subtitle={band?.name ?? initialName}
        titleAccessory={dirty ? <span className="text-[12px] leading-4 text-label-2">尚未儲存</span> : null}
        actions={
          draft && (
            <>
              <Button variant="gray" icon={SparkleIcon} onClick={requestGenerate} loading={generating || jobRunning} disabled={generating || jobRunning || saving}>
                從作品產生
              </Button>
              {dirty ? (
                <Button variant="filled" onClick={() => void save()} loading={saving}>
                  儲存
                </Button>
              ) : (
                <Button variant="plain" disabled>
                  已儲存
                </Button>
              )}
            </>
          )
        }
      />
      <main className="mx-auto w-full max-w-[1200px] px-(--page-gutter) pb-32">
        {loadError && <EmptyState icon={UsersThreeIcon} title="無法載入樂團" description={loadError} action={<Button href="/" variant="tinted" transitionTypes={["pop"]}>回到作品庫</Button>} className="pt-24" />}
        {!loadError && !draft && (
          <SkeletonGroup label="載入視覺聖經" className="grid gap-8 pt-10 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="grid gap-6">
              <Skeleton className="h-56 rounded-lg!" />
              <Skeleton className="h-40 rounded-lg!" />
            </div>
            <Skeleton className="aspect-video rounded-2xl!" />
          </SkeletonGroup>
        )}
        {draft && band && (
          <div className="grid min-w-0 gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-(--group-gap)">
              <div className="px-(--row-pad-x)">
                <h1 className="text-large-title text-label">視覺聖經</h1>
                <p className="mt-1 max-w-[40em] text-[15px] leading-[22px] text-label-2">
                  {band.name}所有的歌共用這個世界。研究與設計會把它當成硬性規範，只在必要時偏離，並寫下理由。
                </p>
              </div>
              {(generating || jobRunning) && <Banner icon={<Spinner size={20} />} title="設計師正在整理視覺聖經…" description="閱讀樂團每首歌的主視覺、配色、場景與研究簡報。完成後可以繼續修改。" />}
              {genNote && !generating && <Banner tone="success" title="已從作品產生" description={`${genNote}。檢查每一項，照樂團的想法修改後再儲存。`} />}
              {genError && !generating && !jobRunning && (
                <Banner tone="error" title="沒有產生視覺聖經" description={genError} actions={<Button onClick={requestGenerate}>重試</Button>} />
              )}
              {saveError && (
                <Banner tone="error" title="儲存失敗" description={saveError} actions={<Button onClick={() => void save()}>重試</Button>} />
              )}

              <SummaryGroup value={draft.summary} onChange={(summary) => patch({ summary })} />
              <PaletteGroup palette={draft.palette} onChange={(palette) => patch({ palette })} />
              <FontGroup fonts={draft.fonts} onChange={(fonts) => patch({ fonts })} />
              <SceneGroup affinity={draft.sceneAffinity} avoid={draft.sceneAvoid} onChange={(sceneAffinity, sceneAvoid) => patch({ sceneAffinity, sceneAvoid })} />
              <TreatmentGroup value={draft.treatments} onChange={(treatments) => patch({ treatments })} />
              <MotifGroup value={draft.motifs} onChange={(motifs) => patch({ motifs })} />
              <PolicyGroup value={draft.lyricPolicy} onChange={(lyricPolicy) => patch({ lyricPolicy })} />
              <DoDontGroup dos={draft.dos} donts={draft.donts} onChange={(dos, donts) => patch({ dos, donts })} />
            </div>
            <aside className="min-w-0 lg:sticky lg:top-[68px] lg:self-start" aria-label="預覽">
              <BiblePreview band={band} bible={draft} />
            </aside>
          </div>
        )}
      </main>
      <Alert
        open={confirmGenerate}
        title="從作品重新產生？"
        message="設計師會依樂團的歌重新整理視覺聖經，取代目前的內容（包括還沒儲存的修改）。"
        confirmLabel="重新產生"
        onConfirm={() => void generate()}
        onCancel={() => setConfirmGenerate(false)}
      />
    </div>
  );
}

function BiblePreview({ band, bible }: { band: Band; bible: BandBible }) {
  const hexes = bible.palette.map((c) => c.hex);
  const scene: SceneId = bible.sceneAffinity[0] ?? "nebula";
  // the preview follows the palette, fonts and first scene only (typing a summary does not re-render the stage)
  const paletteKey = hexes.join(",");
  const { cjkFont, latinFont, weight } = bible.fonts;
  const project = useMemo(() => {
    const colors = paletteKey ? paletteKey.split(",") : [];
    const previewBible: BandBible = { ...bible, palette: bible.palette.filter((c) => colors.includes(c.hex)), fonts: { cjkFont, latinFont, weight } };
    return lookToProject(
      { id: "bible", kind: "walk-in", title: "預覽", look: { scene, colorway: colorwayFor(colors), media: null, text: band.name.slice(0, 24), durationHint: 60 } },
      { band: { ...band, bible: previewBible } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band.id, band.name, scene, paletteKey, cjkFont, latinFont, weight]);
  const roles = hexes.length ? paletteRoles(hexes) : null;
  const ratio = roles ? contrastRatio(roles.lyric, roles.bg) : null;
  return (
    <div className="overflow-hidden rounded-2xl bg-surface">
      <LookStage project={project} className="w-full" />
      <div className="px-5 pt-4 pb-5">
        <p className="text-[15px] leading-5 font-semibold text-label">預覽</p>
        <p className="mt-1 text-[13px] leading-5 text-label-2">
          以{SCENE_LABELS[scene]}、樂團色盤與字體呈現樂團名稱。
          {ratio != null && `歌詞色與背景的對比 ${ratio.toFixed(1)}:1${ratio < 4.5 ? "，低於 4.5:1，設計時會自動調整。" : "。"}`}
        </p>
      </div>
    </div>
  );
}

function SummaryGroup({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fid = useId();
  return (
    <Group title="世界觀、氣質、禁忌" footer="Markdown：建議用「## 世界觀」「## 氣質」「## 禁忌」三段，寫具體的顏色、材質、光和物件。">
      <label htmlFor={fid} className="sr-only">
        世界觀、氣質、禁忌
      </label>
      <TextArea
        id={fid}
        rows={9}
        value={value}
        maxLength={6000}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"## 世界觀\n霧中的港口，只有一盞燈。\n\n## 氣質\n冷、克制、帶一點溫度。\n\n## 禁忌\n不要霓虹、不要彩虹色。"}
        className="rounded-none! bg-transparent! px-(--row-pad-x)! py-3! hover:bg-transparent!"
      />
    </Group>
  );
}

function PaletteGroup({ palette, onChange }: { palette: BandPaletteColor[]; onChange: (p: BandPaletteColor[]) => void }) {
  const set = (i: number, patch: Partial<BandPaletteColor>) => onChange(palette.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => {
    const used = new Set(palette.map((c) => c.hex));
    const pool = ["#0b0a14", "#3a4cc9", "#e0467c", "#f4f1e8", "#ffc857", "#1f6f8b", "#9fd8cb", "#141824"];
    const hex = pool.find((h) => !used.has(h)) ?? "#808080";
    onChange([...palette, { hex, role: ROLES[Math.min(palette.length, ROLES.length - 1)], name: "新顏色" }]);
  };
  const count = palette.length;
  return (
    <Group
      title="色盤"
      footer={
        count === 0
          ? "還沒有色盤：設計師會為每首歌各自配色。"
          : count < MIN_PALETTE
            ? `建議 ${MIN_PALETTE} 到 ${MAX_PALETTE} 色，目前 ${count} 色。第一色是最深的背景，並保留一個給歌詞的亮色。`
            : `${count} 色。第一色是最深的背景；歌詞會用對比最高的亮色。`
      }
    >
      {palette.map((c, i) => (
        <SwatchRow
          key={i}
          color={c}
          index={i}
          count={count}
          onChange={(p) => set(i, p)}
          onMove={(to) => onChange(moveItem(palette, i, to))}
          onRemove={() => onChange(palette.filter((_, j) => j !== i))}
        />
      ))}
      {count < MAX_PALETTE && <ListRow leading={PlusIcon} title={<span className="text-tint-text">加入顏色</span>} onClick={add} />}
    </Group>
  );
}

function SwatchRow({ color, index, count, onChange, onMove, onRemove }: { color: BandPaletteColor; index: number; count: number; onChange: (p: Partial<BandPaletteColor>) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const [hexText, setHexText] = useState(color.hex);
  const [shownHex, setShownHex] = useState(color.hex);
  if (color.hex !== shownHex) {
    setShownHex(color.hex);
    setHexText(color.hex);
  }
  const ids = { pick: useId(), hex: useId(), name: useId(), role: useId() };
  const commitHex = (v: string) => {
    const hex = normalizeBibleHex(v);
    if (hex) onChange({ hex });
    else setHexText(color.hex);
  };
  return (
    <div className="relative flex min-h-(--row-min-h) min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-(--row-pad-x) py-2 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[64px] after:h-(--hairline) after:bg-separator last:after:hidden">
      <label htmlFor={ids.pick} className="relative size-9 shrink-0 cursor-pointer rounded-full shadow-[inset_0_0_0_1px_var(--separator)]" style={{ background: color.hex }} title="選擇顏色">
        <span className="sr-only">第 {index + 1} 色，選擇顏色</span>
        <input id={ids.pick} type="color" value={color.hex} onChange={(e) => onChange({ hex: e.target.value })} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
      <div className="grid min-w-0 flex-1 grid-cols-[88px_minmax(0,1fr)_104px] items-center gap-2 max-sm:grid-cols-2">
        <TextField
          id={ids.hex}
          aria-label={`第 ${index + 1} 色色碼`}
          value={hexText}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
          }}
          className="font-mono tabular"
        />
        <TextField id={ids.name} aria-label={`第 ${index + 1} 色名稱`} value={color.name} maxLength={24} placeholder="顏色名稱" onChange={(e) => onChange({ name: e.target.value })} />
        <select
          id={ids.role}
          aria-label={`第 ${index + 1} 色角色`}
          value={ROLES.includes(color.role) ? color.role : "輔色"}
          onChange={(e) => onChange({ role: e.target.value })}
          className="h-8 w-full min-w-0 appearance-none rounded-sm bg-fill-3 px-2.5 text-[13px] text-label hover:bg-fill-2"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="flex shrink-0 items-center">
        <Button variant="quiet" size="icon-sm" icon={<ArrowUpIcon size={16} />} aria-label={`第 ${index + 1} 色往前移`} disabled={index === 0} onClick={() => onMove(index - 1)} />
        <Button variant="quiet" size="icon-sm" icon={<ArrowDownIcon size={16} />} aria-label={`第 ${index + 1} 色往後移`} disabled={index === count - 1} onClick={() => onMove(index + 1)} />
        <Button variant="quiet" size="icon-sm" icon={<XIcon size={16} />} aria-label={`移除第 ${index + 1} 色`} onClick={onRemove} />
      </div>
    </div>
  );
}

function FontTile({ id, selected, sample, onSelect, name }: { id: FontId; selected: boolean; sample: string; onSelect: () => void; name: string }) {
  const info = FONTS[id];
  return (
    <label className={cx("press-tile relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-md bg-fill-4 px-3 pt-2.5 pb-2 hover:bg-fill-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-tint has-[:focus-visible]:outline-solid", selected && "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)] hover:bg-tint-soft")}>
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      <span className="truncate text-[22px] leading-8 text-label" style={{ fontFamily: info.cjk ? fontStack(id) : `var(${info.cssVar})`, fontWeight: 700 }}>
        {sample}
      </span>
      <span className="truncate text-[12px] leading-4 text-label-2">{info.label}</span>
    </label>
  );
}

function FontGroup({ fonts, onChange }: { fonts: BandBible["fonts"]; onChange: (f: BandBible["fonts"]) => void }) {
  return (
    <Group title="字體" footer="大螢幕上字重 700 以上最穩。每首歌的歌詞都用這組字。">
      <div className="flex flex-col gap-4 px-(--row-pad-x) py-4">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-[13px] leading-5 text-label-2">中文字體</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {CJK_FONTS.map((f) => (
              <FontTile key={f} id={f} name="bible-cjk" sample="歌詞的聲音" selected={fonts.cjkFont === f} onSelect={() => onChange({ ...fonts, cjkFont: f })} />
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-[13px] leading-5 text-label-2">拉丁字體</legend>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {LATIN_FONTS.map((f) => (
              <FontTile key={f} id={f} name="bible-latin" sample="Live Tonight" selected={fonts.latinFont === f} onSelect={() => onChange({ ...fonts, latinFont: f })} />
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] leading-5 text-label-2">字重</span>
          <SegmentedControl
            label="字重"
            value={String(fonts.weight) as (typeof WEIGHTS)[number]}
            onChange={(v) => onChange({ ...fonts, weight: Number(v) })}
            options={WEIGHTS.map((w) => ({ value: w, label: w }))}
            className="w-64"
          />
        </div>
      </div>
    </Group>
  );
}

function SceneGroup({ affinity, avoid, onChange }: { affinity: SceneId[]; avoid: SceneId[]; onChange: (affinity: SceneId[], avoid: SceneId[]) => void }) {
  const stance = (s: SceneId): Stance => (affinity.includes(s) ? "prefer" : avoid.includes(s) ? "avoid" : "neutral");
  const set = (s: SceneId, v: Stance) => {
    const a = affinity.filter((x) => x !== s);
    const d = avoid.filter((x) => x !== s);
    if (v === "prefer") a.push(s);
    if (v === "avoid") d.push(s);
    onChange(a, d);
  };
  return (
    <Group title="場景" footer={`偏好 ${affinity.length} 個，避免 ${avoid.length} 個。偏好的場景會優先出現；避免的場景不會用在這個樂團的任何一首歌。`}>
      {SCENE_IDS.filter((s) => s !== "blackout").map((s) => (
        <ListRow
          key={s}
          title={SCENE_LABELS[s]}
          subtitle={SCENE_HINTS[s]}
          accessory={
            <SegmentedControl<Stance>
              label={`${SCENE_LABELS[s]}：偏好或避免`}
              value={stance(s)}
              onChange={(v) => set(s, v)}
              options={[
                { value: "avoid", label: "避免" },
                { value: "neutral", label: "不限" },
                { value: "prefer", label: "偏好" },
              ]}
              className="w-44 shrink-0"
            />
          }
        />
      ))}
    </Group>
  );
}

function TreatmentGroup({ value, onChange }: { value: BandBible["treatments"]; onChange: (v: BandBible["treatments"]) => void }) {
  return (
    <Group title="素材處理" footer="樂團素材（封面、照片、MV）偏好的處理方式。都不選時，設計師依每首歌決定。">
      {MEDIA_TREATMENTS.map((t) => {
        const on = value.includes(t);
        const sid = `treat-${t}`;
        return (
          <ListRow
            key={t}
            title={MEDIA_TREATMENT_LABELS[t]}
            subtitle={MEDIA_TREATMENT_HINTS[t]}
            htmlFor={sid}
            accessory={<Switch id={sid} checked={on} onChange={(c) => onChange(c ? [...value, t] : value.filter((x) => x !== t))} aria-label={MEDIA_TREATMENT_LABELS[t]} />}
          />
        );
      })}
    </Group>
  );
}

function MotifGroup({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const fid = useId();
  const add = () => {
    const t = text.trim();
    if (!t || value.includes(t) || value.length >= 8) return;
    onChange([...value, t]);
    setText("");
  };
  return (
    <Group title="視覺母題" footer="樂團反覆出現的符號與意象，例如「燈塔」「潮汐」「手寫的日期」。最多 8 個。">
      <div className="flex flex-col gap-3 px-(--row-pad-x) py-3">
        {value.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="視覺母題">
            {value.map((m) => (
              <li key={m} className="flex h-8 items-center gap-1 rounded-pill bg-fill-3 pr-1 pl-3 text-[13px] leading-5 text-label">
                {m}
                <button type="button" className="press-fade flex size-6 items-center justify-center rounded-full text-label-2 hover:bg-fill-2" aria-label={`移除「${m}」`} onClick={() => onChange(value.filter((x) => x !== m))}>
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label htmlFor={fid} className="sr-only">
            新的母題
          </label>
          <TextField id={fid} value={text} maxLength={40} placeholder="新的母題" onChange={(e) => setText(e.target.value)} disabled={value.length >= 8} />
          <Button type="submit" variant="gray" disabled={!text.trim() || value.length >= 8}>
            加入
          </Button>
        </form>
      </div>
    </Group>
  );
}

function PolicyGroup({ value, onChange }: { value: BandBible["lyricPolicy"]; onChange: (v: BandBible["lyricPolicy"]) => void }) {
  const fid = useId();
  return (
    <Group title="歌詞政策">
      <div className="flex flex-col gap-3 px-(--row-pad-x) py-4">
        <SegmentedControl<LyricPolicyMode>
          label="歌詞政策"
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          options={LYRIC_POLICY_MODES.map((m) => ({ value: m, label: LYRIC_POLICY_INFO[m].label, caption: LYRIC_POLICY_INFO[m].description }))}
          fullWidth
        />
        <label htmlFor={fid} className="mt-1 text-[13px] leading-5 text-label-2">
          補充說明
        </label>
        <TextField id={fid} value={value.note} maxLength={400} placeholder="例如：大合唱的歌例外，全曲都放歌詞。" onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </div>
    </Group>
  );
}

function ListText({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const fid = useId();
  const [text, setText] = useState(value.join("\n"));
  const [shown, setShown] = useState(value);
  if (value !== shown && value.join("\n") !== text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")) {
    setShown(value);
    setText(value.join("\n"));
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={fid} className="text-[13px] leading-5 text-label-2">
        {label}
      </label>
      <TextArea
        id={fid}
        rows={5}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const items = e.target.value
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 12);
          setShown(items);
          onChange(items);
        }}
      />
    </div>
  );
}

function DoDontGroup({ dos, donts, onChange }: { dos: string[]; donts: string[]; onChange: (dos: string[], donts: string[]) => void }) {
  return (
    <Group title="要與不要" footer="一行一條，最多 12 條。設計師會逐條遵守。">
      <div className="grid gap-4 px-(--row-pad-x) py-4 sm:grid-cols-2">
        <ListText label="要" value={dos} onChange={(v) => onChange(v, donts)} placeholder={"副歌才讓歌詞當主角\n開場與結尾回到燈塔符號"} />
        <ListText label="不要" value={donts} onChange={(v) => onChange(dos, v)} placeholder={"不要霓虹色\n不要和主唱搶戲"} />
      </div>
    </Group>
  );
}
