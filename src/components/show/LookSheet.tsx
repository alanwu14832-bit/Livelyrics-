"use client";

// 編輯畫面: a non-song moment of the show (進場, 串場, 待機, 散場). A live stage preview on top (the
// synthetic one-section plan from lookToPlan, in the show's canvas), then the scene, the three
// colours from the band's palette, band material, the text on screen and how long it runs.

import { useId, useMemo, useState } from "react";
import { Button, InsetGroup, Select, Sheet, Stepper, TextField, cx } from "@/components/ui";
import { MEDIA_TREATMENT_LABELS, SCENE_HINTS, SCENE_LABELS } from "@/lib/console/labels";
import { MEDIA_TREATMENTS, SCENE_IDS } from "@/lib/schema";
import { LOOK_KIND_INFO, colorwayFor, lookToProject } from "@/lib/show";
import type { Band, LookItemKind, MediaTreatment, ProjectOutput, SceneId, SectionMedia, SetItem, SetLook } from "@/lib/types";
import { LookStage } from "./LookStage";

type LookItem = Extract<SetItem, { kind: LookItemKind }>;

const SLOT_LABELS = ["背景", "主色", "點綴"] as const;

export function LookSheet({ item, band, output, showId, onClose, onSave }: { item: LookItem | null; band: Band; output: ProjectOutput; showId: string; onClose: () => void; onSave: (item: LookItem) => void }) {
  const [draft, setDraft] = useState<LookItem | null>(item);
  const [shown, setShown] = useState<LookItem | null>(item);
  if (item && item !== shown) {
    setShown(item);
    setDraft(item);
  }
  const current = draft ?? item;
  const ids = { title: useId(), text: useId(), media: useId(), treat: useId() };
  const palette = band.bible.palette.map((c) => c.hex);
  const swatches = palette.length ? palette : current ? [...new Set(current.look.colorway)] : [];

  const setLook = (patch: Partial<SetLook>) => setDraft((d) => (d ? { ...d, look: { ...d.look, ...patch } } : d));
  const project = useMemo(() => (current ? lookToProject(current, { band, output, showId }) : null), [current, band, output, showId]);
  const minutes = current?.look.durationHint ? Math.round(current.look.durationHint / 60) : 0;
  const media = current?.look.media ?? null;

  return (
    <Sheet
      open={item != null}
      onClose={onClose}
      title={current ? `編輯「${current.title}」` : "編輯畫面"}
      width={640}
      action={
        <Button
          variant="filled"
          onClick={() => {
            if (draft) onSave(draft);
          }}
        >
          完成
        </Button>
      }
    >
      {current && project && (
        <div className="flex flex-col gap-5 px-5 pt-2 pb-6">
          <div>
            <LookStage key={`${current.id}-${output.width}x${output.height}`} project={project} className="w-full rounded-lg" />
            <p className="mt-2 text-[12px] leading-4 text-label-2">{LOOK_KIND_INFO[current.kind].description}</p>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <label htmlFor={ids.title} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 text-label-2">名稱</span>
              <TextField id={ids.title} size="lg" value={current.title} maxLength={40} onChange={(e) => setDraft({ ...current, title: e.target.value })} />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] leading-5 text-label-2">長度</span>
              <div className="flex h-10 items-center">
                <Stepper
                  label="長度（分鐘）"
                  value={minutes}
                  min={0}
                  max={240}
                  step={1}
                  onChange={(m) => setLook({ durationHint: m > 0 ? Math.round(m) * 60 : undefined })}
                  showValue
                  valuePosition="after"
                  format={(m) => <span className="inline-block w-12">{m ? `${m} 分` : "不限"}</span>}
                  decrementLabel="少一分鐘"
                  incrementLabel="多一分鐘"
                />
              </div>
            </div>
          </div>

          <label htmlFor={ids.text} className="flex flex-col gap-1.5">
            <span className="text-[13px] leading-5 text-label-2">畫面文字</span>
            <TextField id={ids.text} size="lg" value={current.look.text ?? ""} maxLength={60} placeholder="例如：樂團名稱、「下一首是新歌」" onChange={(e) => setLook({ text: e.target.value || undefined })} />
            <span className="text-[12px] leading-4 text-label-2">用樂團的歌詞字體顯示在畫面中央；留空就只有畫面。</span>
          </label>

          <fieldset className="min-w-0">
            <legend className="mb-2 text-[13px] leading-5 text-label-2">場景</legend>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
              {SCENE_IDS.map((s) => {
                const selected = current.look.scene === s;
                const avoided = band.bible.sceneAvoid.includes(s);
                const preferred = band.bible.sceneAffinity.includes(s);
                return (
                  <label
                    key={s}
                    title={SCENE_HINTS[s]}
                    className={cx(
                      "press-tile relative flex min-h-11 cursor-pointer flex-col justify-center rounded-md bg-fill-4 px-3 py-2 hover:bg-fill-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-tint has-[:focus-visible]:outline-solid",
                      selected && "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)] hover:bg-tint-soft",
                    )}
                  >
                    <input type="radio" name={`look-scene-${current.id}`} className="sr-only" checked={selected} onChange={() => setLook({ scene: s as SceneId })} />
                    <span className={cx("truncate text-[13px] leading-[18px] font-medium", avoided ? "text-label-2" : "text-label")}>{SCENE_LABELS[s]}</span>
                    {(preferred || avoided) && <span className={cx("text-[11px] leading-4", avoided ? "text-red-text" : "text-tint-text")}>{avoided ? "聖經：避免" : "聖經：偏好"}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="mb-2 flex w-full items-center justify-between text-[13px] leading-5 text-label-2">
              <span>顏色{palette.length ? "（樂團色盤）" : ""}</span>
            </legend>
            <InsetGroup>
              {SLOT_LABELS.map((slot, i) => (
                <div key={slot} className="relative flex min-h-11 items-center gap-3 px-(--row-pad-x) py-2 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-(--row-pad-x) after:h-(--hairline) after:bg-separator last:after:hidden" role="radiogroup" aria-label={`${slot}顏色`}>
                  <span className="w-10 shrink-0 text-[13px] leading-5 text-label-2">{slot}</span>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {swatches.map((hex) => {
                      const on = current.look.colorway[i] === hex;
                      return (
                        <button
                          key={hex}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`${slot}：${band.bible.palette.find((c) => c.hex === hex)?.name ?? hex}`}
                          onClick={() => {
                            const cw = [...current.look.colorway] as [string, string, string];
                            cw[i] = hex;
                            setLook({ colorway: cw });
                          }}
                          className={cx("size-7 rounded-full shadow-[inset_0_0_0_1px_var(--separator)] transition-[box-shadow] duration-(--dur-fast) ease-[ease]", on && "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--tint)]")}
                          style={{ background: hex }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </InsetGroup>
            {palette.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(["primary", "accent", "highlight", "shadow"] as const).map((e) => (
                  <Button key={e} size="sm" variant="gray" onClick={() => setLook({ colorway: colorwayFor(palette, e) })}>
                    {{ primary: "以主色為主", accent: "以點綴色為主", highlight: "最亮", shadow: "暗部" }[e]}
                  </Button>
                ))}
              </div>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={ids.media} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 text-label-2">樂團素材</span>
              <Select
                id={ids.media}
                size="lg"
                value={media?.assetId ?? ""}
                onChange={(e) => {
                  const asset = band.assets.find((a) => a.id === e.target.value);
                  if (!asset) return setLook({ media: null });
                  const next: SectionMedia = {
                    assetId: asset.id,
                    treatment: media?.treatment ?? (asset.kind === "logo" ? "full" : asset.kind === "video" ? "blur-glow" : "slow-drift"),
                    fit: asset.kind === "logo" ? "contain" : "cover",
                    opacity: media?.opacity ?? (asset.kind === "logo" ? 0.85 : 0.7),
                    blend: asset.kind === "logo" ? "screen" : "normal",
                  };
                  setLook({ media: next });
                }}
              >
                <option value="">{band.assets.length ? "不使用" : "樂團素材庫是空的"}</option>
                {band.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </label>
            <label htmlFor={ids.treat} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-5 text-label-2">處理</span>
              <Select id={ids.treat} size="lg" value={media?.treatment ?? "full"} disabled={!media} onChange={(e) => media && setLook({ media: { ...media, treatment: e.target.value as MediaTreatment } })}>
                {MEDIA_TREATMENTS.map((t) => (
                  <option key={t} value={t}>
                    {MEDIA_TREATMENT_LABELS[t]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
      )}
    </Sheet>
  );
}
