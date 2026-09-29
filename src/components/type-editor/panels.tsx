"use client";

// The 排版 editor's panels: 整首 (the song's typographic voice, its parameters, fonts, colour
// treatment, ornaments, 「重新生成全部構圖」), 段落 (a section's overrides) and 這一句 (the selected
// line: recipe thumbnails, 換一個構圖, tapped emphasis, orientation, motion word, entrance and
// exit, position / size / rotation, colour role, lock, reset), plus the line list. Everything is
// Traditional Chinese with thumb-sized targets (44 px on a phone).

import type { ReactNode } from "react";
import { Button, InsetGroup, SegmentedControl, Select, Slider, Switch, Tag, TextField, cx } from "@/components/ui";
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CrosshairIcon,
  LockSimpleIcon,
  ShuffleIcon,
  SparkleIcon,
} from "@/components/ui/Icon";
import { FONTS } from "@/lib/font-meta";
import { FONT_IDS, TYPE_COLOR_ROLES, TYPE_COLOR_TREATMENTS, TYPE_ENTER_IDS, TYPE_EXIT_IDS, TYPE_ORNAMENT_IDS, TYPE_RECIPE_IDS, TYPE_VOICE_IDS } from "@/lib/schema";
import { formatTimeShort } from "@/lib/timeline";
import { effectiveOrientation } from "@/lib/type/compose";
import { emphasizedUnits, tapUnits, type EditContext } from "@/lib/type/edit";
import type { LineResolution } from "@/lib/type/resolve";
import { findMotionWord, motionKindOf } from "@/lib/type/motion-words";
import { COLOR_ROLES, COLOR_TREATMENTS, ENTERS, EXITS, MOTION_LABELS, ORNAMENTS, PARAM_INFO, RECIPES, VOICES } from "@/lib/type/vocab";
import type { FontId, Project, SectionDesign, TypeColorRole, TypeColorTreatment, TypeEnterId, TypeExitId, TypeOrientation, TypeParams, TypeRecipeId, TypeSection, TypeSystem, TypeVoiceId } from "@/lib/types";
import { RecipeThumbs } from "./RecipeThumbs";

const PARAM_KEYS = Object.keys(PARAM_INFO) as Array<keyof TypeParams>;
const CJK_FONTS = FONT_IDS.filter((id) => FONTS[id].cjk);
const LATIN_FONTS = FONT_IDS.filter((id) => !FONTS[id].cjk);
const ORIENT_LABEL: Record<TypeOrientation, string> = { h: "橫排", v: "直排", mixed: "直橫交錯" };

function Group({ title, footer, children, className }: { title: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <InsetGroup header={title} footer={footer} className={className} bodyClassName="p-3 flex flex-col gap-3">
      {children}
    </InsetGroup>
  );
}

function Chip({ on, onClick, children, testId, title }: { on: boolean; onClick: () => void; children: ReactNode; testId?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={cx(
        "press-fade inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-[15px] leading-5 lg:min-h-8 lg:text-[13px]",
        on ? "bg-tint-fill text-on-tint" : "bg-fill-3 text-label hover:bg-fill-2",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 整首
// ---------------------------------------------------------------------------

export interface SongActions {
  voice: (v: TypeVoiceId) => void;
  param: (k: keyof TypeParams, v: number, done: boolean) => void;
  fonts: (f: { cjk?: FontId; latin?: FontId }) => void;
  weight: (w: number) => void;
  color: (c: TypeColorTreatment) => void;
  ornament: (o: (typeof TYPE_ORNAMENT_IDS)[number]) => void;
  seal: (s: string) => void;
  regenerate: () => void;
}

export function SongPanel({ system, actions }: { system: TypeSystem; actions: SongActions }) {
  return (
    <div className="flex flex-col gap-5" data-testid="song-panel">
      <Group title="字體語言" footer="換字體語言會用新的語法重排每一句（鎖定的句子不變）；可以復原。">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="字體語言">
          {TYPE_VOICE_IDS.map((id) => {
            const on = system.voice === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => actions.voice(id)}
                data-testid="voice-option"
                data-voice={id}
                className={cx(
                  "press-fade flex min-h-11 flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left",
                  on ? "bg-tint-soft shadow-[0_0_0_2px_var(--tint)]" : "bg-fill-4 hover:bg-fill-3",
                )}
              >
                <span className={cx("text-[15px] leading-5 font-semibold", on ? "text-tint-text" : "text-label")}>{VOICES[id].label}</span>
                <span className="line-clamp-2 text-[12px] leading-4 text-label-2">{VOICES[id].description}</span>
              </button>
            );
          })}
        </div>
        <Button variant="tinted" icon={SparkleIcon} onClick={actions.regenerate} className="min-h-11 lg:min-h-8" data-testid="regenerate-all">
          重新生成全部構圖
        </Button>
      </Group>

      <Group title="參數">
        {PARAM_KEYS.map((k) => {
          const info = PARAM_INFO[k];
          const int = info.integer;
          return (
            <Slider
              touch
              key={k}
              label={info.label}
              value={system.params[k]}
              min={int ? int[0] : 0}
              max={int ? int[1] : 1}
              step={int ? 1 : 0.01}
              onChange={(v) => actions.param(k, v, false)}
              format={(v) => (int ? `${Math.round(v)} 欄` : `${Math.round(v * 100)}`)}
              resetValue={VOICES[system.voice].params[k]}
              onReset={() => actions.param(k, VOICES[system.voice].params[k], true)}
              hint={`${info.low} ↔ ${info.high}`}
            />
          );
        })}
      </Group>

      <Group title="字體">
        <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
          <span className="shrink-0 text-label-2">中文</span>
          <Select value={system.fonts.cjk} onChange={(e) => actions.fonts({ cjk: e.target.value as FontId })} className="w-44" aria-label="中文字體">
            {CJK_FONTS.map((id) => (
              <option key={id} value={id}>
                {FONTS[id].label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
          <span className="shrink-0 text-label-2">拉丁</span>
          <Select value={system.fonts.latin} onChange={(e) => actions.fonts({ latin: e.target.value as FontId })} className="w-44" aria-label="拉丁字體">
            {LATIN_FONTS.map((id) => (
              <option key={id} value={id}>
                {FONTS[id].label}
              </option>
            ))}
          </Select>
        </label>
        <SegmentedControl
          touch
          label="字重"
          value={String(system.weight)}
          onChange={(v) => actions.weight(Number(v))}
          options={[600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))}
          fullWidth
        />
      </Group>

      <Group title="配色處理" footer={COLOR_TREATMENTS[system.color].description}>
        <SegmentedControl<TypeColorTreatment>
          touch
          label="配色處理"
          value={system.color}
          onChange={actions.color}
          options={TYPE_COLOR_TREATMENTS.map((id) => ({ value: id, label: COLOR_TREATMENTS[id].label }))}
          fullWidth
        />
      </Group>

      <Group title="裝飾">
        <div className="flex flex-wrap gap-2">
          {TYPE_ORNAMENT_IDS.map((id) => (
            <Chip key={id} on={system.ornaments.includes(id)} onClick={() => actions.ornament(id)} testId="ornament-chip">
              {ORNAMENTS[id]}
            </Chip>
          ))}
        </div>
        {(system.voice === "ink" || system.ornaments.includes("seal")) && (
          <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
            <span className="shrink-0 text-label-2">印章文字</span>
            <TextField value={system.seal} onChange={(e) => actions.seal(e.target.value)} maxLength={8} placeholder="1–4 個字" className="w-32" size="lg" aria-label="印章文字" />
          </label>
        )}
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 段落
// ---------------------------------------------------------------------------

export function SectionPanel({
  sections,
  selected,
  onSelect,
  override,
  onChange,
}: {
  sections: readonly SectionDesign[];
  selected: string | null;
  onSelect: (id: string) => void;
  override: TypeSection | null;
  onChange: (patch: Partial<Omit<TypeSection, "sectionId">>, done: boolean) => void;
}) {
  const sec = sections.find((s) => s.id === selected) ?? null;
  return (
    <div className="flex flex-col gap-5" data-testid="section-panel">
      <Group title="段落">
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <Chip key={s.id} on={s.id === selected} onClick={() => onSelect(s.id)} testId="section-chip">
              {s.label}
              <span className="text-[12px] opacity-70">{formatTimeShort(s.start)}</span>
            </Chip>
          ))}
        </div>
      </Group>
      {sec && (
        <Group title={`${sec.label}的覆寫`} footer="段落覆寫會套用到這一段的每一句；「依每一句」就是照每一句自己的構圖。">
          <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
            <span className="shrink-0 text-label-2">構圖</span>
            <Select value={override?.recipe ?? ""} onChange={(e) => onChange({ recipe: (e.target.value || null) as TypeRecipeId | null }, true)} className="w-44" aria-label="段落構圖">
              <option value="">依每一句</option>
              {TYPE_RECIPE_IDS.map((id) => (
                <option key={id} value={id}>
                  {RECIPES[id].label}
                </option>
              ))}
            </Select>
          </label>
          <SegmentedControl
            touch
            label="段落排列"
            value={override?.orientation ?? "auto"}
            onChange={(v) => onChange({ orientation: v === "auto" ? null : (v as TypeOrientation) }, true)}
            options={[{ value: "auto", label: "依每一句" }, ...(["h", "v", "mixed"] as const).map((o) => ({ value: o, label: ORIENT_LABEL[o] }))]}
            fullWidth
          />
          <Slider touch label="大小" value={override?.scale ?? 1} min={0.6} max={1.6} step={0.01} onChange={(v) => onChange({ scale: v }, false)} format={(v) => `${Math.round(v * 100)}%`} resetValue={1} onReset={() => onChange({ scale: null }, true)} />
          <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]" htmlFor="section-motion-own">
            <span className="text-label">自訂這一段的動態幅度</span>
            <Switch id="section-motion-own" checked={override?.motion != null} onChange={(on) => onChange({ motion: on ? 0.5 : null }, true)} />
          </label>
          {override?.motion != null && (
            <Slider touch label="動態幅度" value={override.motion} min={0} max={1} step={0.01} onChange={(v) => onChange({ motion: v }, false)} format={(v) => `${Math.round(v * 100)}`} resetValue={0.5} />
          )}
        </Group>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 這一句
// ---------------------------------------------------------------------------

export interface LineActions {
  recipe: (r: TypeRecipeId) => void;
  reroll: () => void;
  emphasis: (unitIndex: number) => void;
  orientation: (o: TypeOrientation | null) => void;
  motion: (w: string | null) => void;
  enter: (e: TypeEnterId) => void;
  exit: (e: TypeExitId) => void;
  nudge: (dx: number, dy: number, done: boolean) => void;
  scale: (s: number, done: boolean) => void;
  rotate: (d: number, done: boolean) => void;
  color: (c: TypeColorRole | "auto") => void;
  lock: (on: boolean) => void;
  reset: () => void;
}

/** What 「自動」 orientation gives this line on the output canvas (a tall canvas stands a display word up). */
function autoOrientationNote(h: LineResolution["hint"], cjk: boolean, project: Project): string {
  const eff = effectiveOrientation(h, cjk, (project.output?.width || 1920) / (project.output?.height || 1080));
  return `自動：${ORIENT_LABEL[eff]}${eff !== h.orientation ? "（直式畫面把巨字立起來）" : ""}`;
}

/** Motion word candidates of a line: every table word it contains (longest first), the emphasis words. */
function motionCandidates(text: string, emphasis: readonly string[]): string[] {
  const out: string[] = [];
  let rest = text;
  for (let i = 0; i < 6; i++) {
    const w = findMotionWord(rest);
    if (!w) break;
    if (!out.includes(w)) out.push(w);
    rest = rest.split(w).join(" ");
  }
  for (const e of emphasis) if (e && !out.includes(e) && Array.from(e).length <= 4) out.push(e);
  return out.slice(0, 6);
}

export function LinePanel({
  project,
  system,
  ctx,
  lineIndex,
  res,
  locked,
  edited,
  repeats,
  isFirst,
  actions,
}: {
  project: Project;
  system: TypeSystem;
  ctx: EditContext;
  lineIndex: number;
  res: LineResolution;
  locked: boolean;
  edited: boolean;
  repeats: number;
  isFirst: boolean;
  actions: LineActions;
}) {
  const line = project.lyrics.lines[lineIndex];
  const h = res.hint;
  const units = tapUnits(line.text);
  const on = emphasizedUnits(line.text, h.emphasis);
  const cjk = /[\p{Script=Han}]/u.test(line.text);
  const candidates = motionCandidates(line.text, h.emphasis);
  const own = system.lines.find((l) => l.lineId === line.id);
  const motionEdit = own?.edit?.motionWord;
  const motionMode = motionEdit === undefined ? "auto" : motionEdit === "" ? "none" : motionEdit;
  const pad = "size-11 lg:size-9";
  return (
    <div className="flex flex-col gap-5" data-testid="line-panel">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2.5 rounded-md bg-fill-4 px-3 text-[15px] leading-5 lg:min-h-8 lg:text-[13px]" htmlFor="line-lock">
          <LockSimpleIcon size={16} />
          鎖定這一句
          <Switch id="line-lock" checked={locked} onChange={actions.lock} />
        </label>
        <Button variant="gray" icon={ArrowCounterClockwiseIcon} onClick={actions.reset} disabled={!edited} className="min-h-11 lg:min-h-8" data-testid="line-reset">
          重設為生成的
        </Button>
        {repeats > 1 && <Tag>{isFirst ? `重複 ${repeats} 次：其他次會跟著這一句` : `重複 ${repeats} 次：這裡只改這一次`}</Tag>}
      </div>

      <Group title="構圖" footer={RECIPES[h.recipe].description}>
        <RecipeThumbs project={project} system={system} lineIndex={lineIndex} current={h.recipe} ctx={ctx} onPick={actions.recipe} />
        <Button variant="tinted" icon={ShuffleIcon} onClick={actions.reroll} className="min-h-11 lg:min-h-8" data-testid="reroll">
          換一個構圖
        </Button>
      </Group>

      <Group title="強調字" footer="點字切換強調：強調字會放大或換成點綴色。相鄰的字會連成一個詞。">
        <div className="flex flex-wrap gap-1.5" data-testid="emphasis-units">
          {units.map((u, i) => (
            <button
              key={`${u.from}-${u.text}`}
              type="button"
              aria-pressed={on[i]}
              onClick={() => actions.emphasis(i)}
              data-testid="emphasis-unit"
              className={cx(
                "press-fade inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-[20px] leading-6 font-semibold lg:min-h-9 lg:min-w-9 lg:text-[17px]",
                on[i] ? "bg-tint-fill text-on-tint" : "bg-fill-3 text-label hover:bg-fill-2",
              )}
            >
              {u.text}
            </button>
          ))}
        </div>
      </Group>

      <Group title="排列" footer={own?.edit?.orientation ? undefined : autoOrientationNote(h, cjk, project)}>
        <SegmentedControl
          touch
          label="排列"
          value={own?.edit?.orientation ?? "auto"}
          onChange={(v) => actions.orientation(v === "auto" ? null : (v as TypeOrientation))}
          options={[
            { value: "auto", label: "自動" },
            ...(["h", "v", "mixed"] as const).map((o) => ({ value: o, label: ORIENT_LABEL[o], disabled: !cjk && o !== "h" })),
          ]}
          fullWidth
        />
      </Group>

      <Group title="動態意象" footer={h.motionWord ? `「${h.motionWord}」：${MOTION_LABELS[motionKindOf(h.motionWord)]}` : "這一句靜止（只有進出場）"}>
        <div className="flex flex-wrap gap-2">
          <Chip on={motionMode === "auto"} onClick={() => actions.motion(null)} testId="motion-chip">
            自動
          </Chip>
          <Chip on={motionMode === "none"} onClick={() => actions.motion("")} testId="motion-chip">
            不要動態
          </Chip>
          {candidates.map((w) => (
            <Chip key={w} on={motionMode === w} onClick={() => actions.motion(w)} testId="motion-chip" title={MOTION_LABELS[motionKindOf(w)]}>
              {w}
              <span className="text-[12px] opacity-70">{MOTION_LABELS[motionKindOf(w)]}</span>
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="進場與出場">
        <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
          <span className="shrink-0 text-label-2">進場</span>
          <Select value={own?.edit?.enter ?? "auto"} onChange={(e) => actions.enter(e.target.value as TypeEnterId)} className="w-44" aria-label="進場" size="lg">
            {TYPE_ENTER_IDS.map((id) => (
              <option key={id} value={id}>
                {ENTERS[id]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center justify-between gap-3 text-[15px] leading-5 lg:text-[13px]">
          <span className="shrink-0 text-label-2">出場</span>
          <Select value={own?.edit?.exit ?? "auto"} onChange={(e) => actions.exit(e.target.value as TypeExitId)} className="w-44" aria-label="出場" size="lg">
            {TYPE_EXIT_IDS.map((id) => (
              <option key={id} value={id}>
                {EXITS[id]}
              </option>
            ))}
          </Select>
        </label>
      </Group>

      <Group title="位置、大小與角度" footer="電腦上可以直接拖曳預覽移動這一句。">
        <div className="flex items-center gap-4">
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="移動">
            <span />
            <Button variant="gray" size="icon" className={pad} aria-label="往上" icon={<ArrowUpIcon size={18} />} onClick={() => actions.nudge(h.dx, h.dy - 0.02, true)} data-testid="nudge-up" />
            <span />
            <Button variant="gray" size="icon" className={pad} aria-label="往左" icon={<ArrowLeftIcon size={18} />} onClick={() => actions.nudge(h.dx - 0.02, h.dy, true)} data-testid="nudge-left" />
            <Button variant="gray" size="icon" className={pad} aria-label="回到原位" icon={<CrosshairIcon size={18} />} onClick={() => actions.nudge(0, 0, true)} />
            <Button variant="gray" size="icon" className={pad} aria-label="往右" icon={<ArrowRightIcon size={18} />} onClick={() => actions.nudge(h.dx + 0.02, h.dy, true)} data-testid="nudge-right" />
            <span />
            <Button variant="gray" size="icon" className={pad} aria-label="往下" icon={<ArrowDownIcon size={18} />} onClick={() => actions.nudge(h.dx, h.dy + 0.02, true)} data-testid="nudge-down" />
            <span />
          </div>
          <p className="min-w-0 text-[13px] leading-5 text-label-2 tabular-nums">
            水平 {h.dx >= 0 ? "+" : ""}
            {Math.round(h.dx * 100)}%<br />
            垂直 {h.dy >= 0 ? "+" : ""}
            {Math.round(h.dy * 100)}%
          </p>
        </div>
        <Slider touch label="大小" value={h.scale} min={0.5} max={2} step={0.01} onChange={(v) => actions.scale(v, false)} format={(v) => `${Math.round(v * 100)}%`} resetValue={1} onReset={() => actions.scale(1, true)} />
        <Slider touch label="角度" value={h.rotate} min={-30} max={30} step={0.5} onChange={(v) => actions.rotate(v, false)} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}°`} resetValue={0} onReset={() => actions.rotate(0, true)} />
      </Group>

      <Group title="顏色" footer={COLOR_ROLES[h.color].description}>
        <SegmentedControl<TypeColorRole | "auto">
          touch
          label="顏色"
          value={h.color}
          onChange={actions.color}
          options={(["auto", ...TYPE_COLOR_ROLES] as const).map((id) => ({ value: id, label: COLOR_ROLES[id].label }))}
          fullWidth
        />
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// the line list
// ---------------------------------------------------------------------------

export interface LineRow {
  index: number;
  id: string;
  text: string;
  start: number | null;
  recipe: TypeRecipeId;
  locked: boolean;
  edited: boolean;
  section: string | null;
}

export function LineList({ rows, selected, onSelect }: { rows: readonly LineRow[]; selected: number | null; onSelect: (index: number) => void }) {
  return (
    <ol className="flex flex-col gap-0.5" aria-label="歌詞" data-testid="line-list">
      {rows.map((r, i) => {
        const header = i === 0 || rows[i - 1].section !== r.section ? r.section : null;
        const on = r.index === selected;
        return (
          <li key={r.id}>
            {header && <p className="px-2 pt-3 pb-1 text-[12px] leading-4 font-semibold text-label-2">{header}</p>}
            <button
              type="button"
              onClick={() => onSelect(r.index)}
              aria-current={on ? "true" : undefined}
              data-testid="line-row"
              data-line={r.index}
              className={cx("press-fade flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left lg:min-h-9", on ? "row-current" : "hover:bg-fill-4")}
            >
              <span className="w-10 shrink-0 text-[12px] leading-4 text-label-2 tabular-nums">{r.start != null ? formatTimeShort(r.start) : "—"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-5 text-label lg:text-[13px] lg:leading-[18px]">{r.text}</span>
                <span className="block truncate text-[12px] leading-4 text-label-2">{RECIPES[r.recipe].label}</span>
              </span>
              {r.edited && <span className="size-1.5 shrink-0 rounded-full bg-tint" aria-label="已調整" />}
              {r.locked && <LockSimpleIcon size={14} className="shrink-0 text-label-2" aria-label="已鎖定" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
