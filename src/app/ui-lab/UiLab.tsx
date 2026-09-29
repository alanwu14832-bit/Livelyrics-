"use client";

// /ui-lab: the component kit (src/components/ui) in every state, light / dark / console side by
// side. Dev-only; not linked from the app. Each column is its own data-theme scope, so the same
// component code renders with that scope's tokens (the console column sits in a pane, as in the
// console). Live demos (dialogs, menus, tooltips, toasts, HUD) open inside their column's scope.

import { useId, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/home/Brand";
import {
  Alert,
  AppHeader,
  Badge,
  Banner,
  Button,
  cx,
  Disclosure,
  EmptyState,
  FormRow,
  HUD,
  HudPreview,
  InsetGroup,
  Kbd,
  ListRow,
  Menu,
  MenuItem,
  MenuLabel,
  MenuPreview,
  MenuSeparator,
  Popover,
  ProgressBar,
  rowInputClass,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Slider,
  Spinner,
  StatusCapsule,
  StatusCapsules,
  Stepper,
  Switch,
  Tag,
  TextArea,
  TextField,
  ToastPreview,
  ToastStack,
  Tooltip,
  TooltipPreview,
  useToasts,
  type HudHandle,
} from "@/components/ui";
import {
  ALL_ICONS,
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CircleHalfIcon,
  DotsThreeIcon,
  EyeSlashIcon,
  FilmSlateIcon,
  GearIcon,
  HandPalmIcon,
  InfoIcon,
  MicrophoneIcon,
  MinusIcon,
  MoonIcon,
  MusicNotesIcon,
  MusicNotesPlusIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  ProjectorScreenIcon,
  QuestionIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SnowflakeIcon,
  SparkleIcon,
  SpeakerHighIcon,
  TimerIcon,
  TrashIcon,
  UploadSimpleIcon,
  WaveformIcon,
  XIcon,
} from "@/components/ui/Icon";

type ThemeId = "light" | "dark" | "console";
const THEMES: Array<{ id: ThemeId; label: string; note: string }> = [
  { id: "light", label: "淺色", note: "首頁、處理頁、歌詞編輯器（預設）" },
  { id: "dark", label: "深色", note: "同上，系統深色時" },
  { id: "console", label: "控制台", note: "永遠深色，桌面密度" },
];

const SECTIONS: Array<{ id: string; title: string; render: (t: ThemeId) => ReactNode }> = [
  { id: "button", title: "Button 按鈕", render: (t) => <ButtonDemo theme={t} /> },
  { id: "segmented", title: "SegmentedControl 分段控制", render: () => <SegmentedDemo /> },
  { id: "switch", title: "Switch 開關", render: () => <SwitchDemo /> },
  { id: "slider", title: "Slider 滑桿", render: () => <SliderDemo /> },
  { id: "stepper", title: "Stepper 步進器", render: () => <StepperDemo /> },
  { id: "list", title: "InsetGroup / ListRow 群組列表", render: (t) => <ListDemo theme={t} /> },
  { id: "fields", title: "TextField / TextArea / Select 欄位", render: () => <FieldDemo /> },
  { id: "dialog", title: "Alert / Sheet 對話框", render: () => <DialogDemo /> },
  { id: "menu", title: "Menu / Popover 選單", render: () => <MenuDemo /> },
  { id: "tooltip", title: "Tooltip 工具提示", render: () => <TooltipDemo /> },
  { id: "tags", title: "Tag / 狀態膠囊 / Badge / Kbd", render: () => <TagDemo /> },
  { id: "progress", title: "ProgressBar / Spinner 進度", render: () => <ProgressDemo /> },
  { id: "toast", title: "Toast / Banner 通知", render: () => <ToastDemo /> },
  { id: "empty", title: "EmptyState / Skeleton 空狀態與骨架", render: (t) => <EmptyDemo theme={t} /> },
  { id: "header", title: "AppHeader 頂欄", render: (t) => <HeaderDemo theme={t} /> },
  { id: "disclosure", title: "Disclosure 展開", render: () => <DisclosureDemo /> },
  { id: "hud", title: "HUD 鍵盤回饋（只在控制台）", render: () => <HudDemo /> },
  { id: "icons", title: "Icon 圖示（Phosphor）", render: () => <IconDemo /> },
];

export function UiLab({ theme, section }: { theme?: string; section?: string }) {
  const themes = THEMES.filter((t) => !theme || t.id === theme);
  const sections = SECTIONS.filter((s) => !section || s.id === section);
  return (
    <div className="min-h-screen bg-bg pb-24 text-label">
      <div className="px-4 pt-10 pb-6">
        <h1 className="text-title-1">元件實驗室</h1>
        <p className="mt-1 max-w-[60em] text-[15px] leading-[22px] text-label-2">
          src/components/ui 的每一個元件與狀態。三欄分別是淺色、深色與控制台外觀；互動示範（對話框、選單、提示、通知、HUD）會在所屬的欄位外觀中打開。
        </p>
        <nav aria-label="區段" className="mt-4 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-pill bg-fill-3 px-2.5 py-1 text-[12px] leading-4 font-medium text-label-2-on-material hover:bg-fill-2 hover:text-label">
              {s.title.split(" ")[0]}
            </a>
          ))}
        </nav>
      </div>
      <div className="sticky top-0 z-30 grid gap-3 bg-bg/90 px-4 py-2 backdrop-blur-md" style={{ gridTemplateColumns: `repeat(${themes.length}, minmax(0, 1fr))` }}>
        {themes.map((t) => (
          <div key={t.id} className="min-w-0">
            <p className="text-[13px] leading-5 font-semibold">{t.label}</p>
            <p className="truncate text-[12px] leading-4 text-label-2">{t.note}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-10 px-4 pt-4">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-16">
            <h2 id={`${s.id}-title`} className="mb-3 text-[17px] leading-6 font-semibold">
              {s.title}
            </h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${themes.length}, minmax(0, 1fr))` }}>
              {themes.map((t) => (
                <div key={t.id} data-theme={t.id} data-lab-cell={`${s.id}-${t.id}`} className="relative min-w-0 overflow-hidden rounded-2xl bg-bg p-4 text-label ring-hairline">
                  {t.id === "console" ? <div className="rounded-lg bg-surface p-3">{s.render(t.id)}</div> : s.render(t.id)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[12px] leading-4 font-medium text-label-2">{children}</p>;
}

function Block({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-5 last:mb-0", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

// ---------------------------------------------------------------- Button

function ButtonDemo({ theme }: { theme: ThemeId }) {
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <>
      <Block label="變體（md 32）">
        <Wrap>
          <Button variant="filled">進入控制台</Button>
          <Button variant="tinted" icon={SparkleIcon}>
            重新設計
          </Button>
          <Button variant="gray">匯出</Button>
          <Button variant="plain">重新搜尋</Button>
          <Button variant="quiet">略過</Button>
          <Button variant="destructive" icon={TrashIcon}>
            刪除
          </Button>
        </Wrap>
      </Block>
      <Block label="尺寸：sm 28、md 32、lg 44 膠囊（首頁與 sheet 主要動作）">
        <Wrap>
          <Button size="sm" variant="gray">
            sm
          </Button>
          <Button size="md" variant="gray">
            md
          </Button>
          {theme !== "console" && (
            <Button size="lg" variant="filled">
              開始製作
            </Button>
          )}
          {theme !== "console" && (
            <Button size="lg" variant="gray">
              選擇音檔
            </Button>
          )}
        </Wrap>
      </Block>
      <Block label="狀態：hover、按下（scale .97）、停用（.35）、載入中">
        <Wrap>
          <Button variant="filled" className="bg-tint-fill-hover!">
            hover
          </Button>
          <Button variant="filled" style={{ transform: "scale(0.97)", filter: "brightness(0.94)" }}>
            按下
          </Button>
          <Button variant="gray" className="bg-fill-2!">
            hover
          </Button>
          <Button variant="gray" style={{ transform: "scale(0.97)" }}>
            按下
          </Button>
          <Button variant="plain" style={{ opacity: 0.6 }} data-lab-sim>
            按下（淡出）
          </Button>
          <Button variant="filled" disabled>
            儲存
          </Button>
          <Button variant="gray" disabled>
            匯出
          </Button>
          <Button
            variant="filled"
            loading={saving}
            onClick={() => {
              setSaving(true);
              setTimeout(() => setSaving(false), 1600);
            }}
          >
            儲存
          </Button>
        </Wrap>
      </Block>
      <Block label="圖示：icon-sm 28、icon 32、圓形 36（播放鈕）">
        <Wrap>
          <Button variant="quiet" size="icon-sm" aria-label="關閉" icon={XIcon} />
          <Button variant="quiet" size="icon" aria-label="說明" icon={QuestionIcon} />
          <Button variant="gray" size="icon" aria-label="上一句" icon={SkipBackIcon} />
          <Button size="circle" aria-label={playing ? "暫停" : "播放"} icon={playing ? PauseIcon : PlayIcon} onClick={() => setPlaying((p) => !p)} />
          <Button variant="gray" size="icon" aria-label="下一句" icon={SkipForwardIcon} />
          <Button variant="tinted" size="icon" aria-label="重新設計" icon={SparkleIcon} />
          <Button variant="gray" size="icon" aria-label="停用" icon={GearIcon} disabled />
        </Wrap>
      </Block>
      <Block label="連結模式（href，next/link，外觀與焦點環相同）">
        <Wrap>
          <Button href="#button" variant="filled" trailingIcon={ArrowSquareOutIcon}>
            設計總覽
          </Button>
          <Button href="#button" variant="gray">
            編輯歌詞
          </Button>
          <Button href="#button" variant="plain" disabled>
            停用連結
          </Button>
        </Wrap>
      </Block>
      <Block label="destructive-filled（只在 Alert 裡）">
        <Wrap>
          <Button variant="destructive-filled">刪除</Button>
          <Button variant="destructive-filled" disabled>
            刪除
          </Button>
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- SegmentedControl

function SegmentedDemo() {
  const [mode, setMode] = useState<"track" | "live">("track");
  const [source, setSource] = useState<"auto" | "paste" | "later">("auto");
  const [tab, setTab] = useState<"design" | "research" | "control" | "sync">("design");
  const [speed, setSpeed] = useState<"0.5" | "0.75" | "1">("1");
  const [zoom, setZoom] = useState<"out" | "all" | "in">("all");
  return (
    <>
      <Block label="TRACK / LIVE（LIVE 前 6px 靜態紅點）">
        <SegmentedControl
          label="模式"
          value={mode}
          onChange={setMode}
          options={[
            { value: "track", label: "TRACK" },
            {
              value: "live",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
                  LIVE
                </span>
              ),
              ariaLabel: "LIVE",
            },
          ]}
        />
      </Block>
      <Block label="歌詞來源（提示在下方 caption，隨選取更新）">
        <SegmentedControl
          label="歌詞來源"
          value={source}
          onChange={setSource}
          options={[
            { value: "auto", label: "自動搜尋", caption: "從 LRCLIB 找同步歌詞，找不到時用純文字平均分配。" },
            { value: "paste", label: "貼上歌詞", caption: "貼上純文字或 LRC，之後可在歌詞編輯器對拍。" },
            { value: "later", label: "之後再處理", caption: "先做設計，歌詞稍後再加。" },
          ]}
        />
      </Block>
      <Block label="側欄分頁（tablist，滿寬）">
        <SegmentedControl
          kind="tabs"
          fullWidth
          label="側欄"
          value={tab}
          onChange={setTab}
          getTabId={(v) => `lab-tab-${v}`}
          options={[
            { value: "design", label: "設計" },
            { value: "research", label: "研究" },
            { value: "control", label: "控制" },
            { value: "sync", label: "同步" },
          ]}
        />
      </Block>
      <Block label="播放速度、時間軸縮放、停用項">
        <Wrap className="gap-3">
          <SegmentedControl
            label="播放速度"
            value={speed}
            onChange={setSpeed}
            options={[
              { value: "0.5", label: "0.5×" },
              { value: "0.75", label: "0.75×" },
              { value: "1", label: "1×" },
            ]}
          />
          <SegmentedControl
            label="縮放"
            value={zoom}
            onChange={setZoom}
            options={[
              { value: "out", label: <MinusIcon size={14} />, ariaLabel: "縮小" },
              { value: "all", label: "全曲" },
              { value: "in", label: <PlusIcon size={14} />, ariaLabel: "放大" },
            ]}
          />
          <SegmentedControl
            label="匯入方式"
            value="paste"
            onChange={() => {}}
            options={[
              { value: "paste", label: "貼上" },
              { value: "file", label: "檔案" },
              { value: "lrclib", label: "LRCLIB", disabled: true },
            ]}
          />
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Switch

function SwitchDemo() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(true);
  const [mic, setMic] = useState(false);
  const id = useId();
  return (
    <>
      <Block label="關、開、停用">
        <Wrap className="gap-4">
          <Switch checked={a} onChange={setA} aria-label="示範開關一" />
          <Switch checked={b} onChange={setB} aria-label="示範開關二" />
          <Switch checked={false} onChange={() => {}} disabled aria-label="停用（關）" />
          <Switch checked onChange={() => {}} disabled aria-label="停用（開）" />
        </Wrap>
      </Block>
      <Block label="整列可點（ListRow htmlFor）">
        <InsetGroup>
          <ListRow leading={MicrophoneIcon} title="現場音訊輸入" subtitle={mic ? "麥克風已啟用" : "使用麥克風帶動畫面反應"} htmlFor={`${id}-mic`} accessory={<Switch id={`${id}-mic`} checked={mic} onChange={setMic} />} />
          <ListRow title="表格跟著播放捲動" htmlFor={`${id}-follow`} accessory={<Switch id={`${id}-follow`} checked={b} onChange={setB} />} />
        </InsetGroup>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Slider

function SliderDemo() {
  const [v, setV] = useState(1);
  const [s, setS] = useState(1.3);
  return (
    <>
      <Block label="預設、改動過（數值變 label、出現重設）、停用">
        <div className="flex flex-col gap-3">
          <Slider label="亮度" value={v} min={0} max={1.5} step={0.05} onChange={setV} format={(x) => `${Math.round(x * 100)}%`} resetValue={1} />
          <Slider label="歌詞字級" value={s} min={0.6} max={1.6} step={0.05} onChange={setS} format={(x) => `${x.toFixed(2)}×`} resetValue={1} hint="只影響投影；Shift + 方向鍵一次十步。" />
          <Slider label="速度" value={0.5} min={0} max={1} step={0.01} onChange={() => {}} disabled format={(x) => `${Math.round(x * 100)}%`} />
        </div>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Stepper

function StepperDemo() {
  const [offset, setOffset] = useState(0.15);
  const [nudge, setNudge] = useState(0);
  return (
    <>
      <Block label="偏移 ±0.05 秒（Shift 0.01，按住自動重複）">
        <Stepper label="偏移" value={offset} onChange={setOffset} step={0.05} fineStep={0.01} min={-2} max={2} showValue format={(x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)} 秒`} />
      </Block>
      <Block label="編輯器 ±0.1 秒、到達下限時停用一側">
        <Wrap className="gap-4">
          <Stepper label="時間" value={nudge} onChange={setNudge} step={0.1} min={0} max={5} showValue valuePosition="after" format={(x) => `${x.toFixed(1)} 秒`} />
          <Stepper label="停用" value={0} onChange={() => {}} disabled />
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- List

function ListDemo({ theme }: { theme: ThemeId }) {
  const [picked, setPicked] = useState(0);
  const [title, setTitle] = useState("");
  const id = useId();
  return (
    <>
      <Block label="群組標題、值、配件、註腳">
        <InsetGroup header="歌曲資訊" footer="時間碼可稍後在歌詞編輯器調整。">
          <ListRow title="長度" value="3:29" />
          <ListRow leading={WaveformIcon} title="段落" value="8" />
          {theme !== "console" && <ListRow leading={SparkleIcon} leadingTile="var(--tint-fill)" title="設計總覽" accessory="disclosure" href="#list" />}
          <ListRow leading={PencilSimpleIcon} title="編輯歌詞" accessory="disclosure" onClick={() => {}} />
          <ListRow title="刪除作品" destructive onClick={() => {}} />
        </InsetGroup>
      </Block>
      <Block label="選擇（Check 配件）">
        <InsetGroup header="LRCLIB 結果">
          {[
            ["示範之歌", "示範樂團，示範專輯，3:29"],
            ["示範之歌 (Live)", "示範樂團，現場專輯，4:02"],
          ].map(([t, s], i) => (
            <ListRow key={t} title={t} subtitle={s} accessory={picked === i ? "check" : undefined} onClick={() => setPicked(i)} aria-current={picked === i ? "true" : undefined} />
          ))}
        </InsetGroup>
      </Block>
      <Block label="目前列（全站同一個）、待命列、鍵盤選取">
        <InsetGroup>
          <ListRow title="夜色慢慢落在城市的邊緣" value="0:16.00" />
          <ListRow title="我們把燈都關了" value="0:20.40" state="current" />
          <ListRow title="只留下歌聲" value="0:24.10" state="standby" />
          <ListRow title="一路唱到天亮" value="0:28.80" state="selected" />
        </InsetGroup>
      </Block>
      <Block label="欄位列（聚焦時整列內嵌 tint 環；錯誤時紅環與紅字）">
        <InsetGroup>
          <FormRow label="歌名" htmlFor={`${id}-title`} error={title ? undefined : "請填寫歌名（研究與歌詞搜尋都需要它）。"}>
            <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="示範之歌" aria-invalid={!title} aria-describedby={title ? undefined : `${id}-title-error`} className={rowInputClass} />
          </FormRow>
          <FormRow label="樂團／演出者" htmlFor={`${id}-artist`}>
            <input id={`${id}-artist`} defaultValue="示範樂團" className={rowInputClass} />
          </FormRow>
        </InsetGroup>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Fields

function FieldDemo() {
  return (
    <div className="flex flex-col gap-3">
      <TextField placeholder="搜尋歌名或樂團" aria-label="搜尋" />
      <TextField size="lg" defaultValue="示範之歌" aria-label="歌名" />
      <TextField invalid defaultValue="" placeholder="必填" aria-label="必填欄位" />
      <TextField disabled defaultValue="停用" aria-label="停用欄位" />
      <TextArea rows={3} placeholder="例如：副歌更熱血、換成冷色調" aria-label="設計指示" />
      <Select aria-label="場景" defaultValue="stars">
        <option value="stars">粒子星空</option>
        <option value="waves">光之波浪</option>
        <option value="grid">霓虹格線</option>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------- Dialog

function DialogDemo() {
  const [alert, setAlert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [help, setHelp] = useState(false);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Block label="Alert（靜態預覽）">
        <div className="flex flex-col items-center gap-3">
          <Alert preview open title="刪除「示範之歌」？" message="音檔、歌詞與設計會一起刪除，無法復原。" confirmLabel="刪除" destructive onConfirm={() => {}} onCancel={() => {}} />
          <Alert preview open title="重新處理？" message="會重新研究並取代目前的設計。" confirmLabel="重新處理" onConfirm={() => {}} onCancel={() => {}} />
        </div>
      </Block>
      <Block label="Sheet（靜態預覽，內容捲動後標題列出現 hairline）">
        <Sheet preview previewScrolled open onClose={() => {}} title="重新設計" width={640} action={<Button variant="filled">開始</Button>}>
          <p className="text-[13px] leading-5 text-label-2">用一句話告訴舞台視覺設計師想怎麼改，會保留研究結果、只重做設計方案。</p>
          <TextArea rows={2} className="mt-3" placeholder="例如：副歌更熱血" aria-label="設計指示（預覽）" />
        </Sheet>
      </Block>
      <Block label="打開真的對話框（Esc 關閉、焦點歸還、關閉動畫期間內容仍在）">
        <Wrap>
          <Button variant="gray" onClick={() => setAlert(true)} data-lab="open-alert">
            打開 Alert
          </Button>
          <Button variant="gray" onClick={() => setSheet(true)} data-lab="open-sheet">
            打開 Sheet
          </Button>
          <Button variant="gray" onClick={() => setHelp(true)} data-lab="open-help">
            快捷鍵說明（瞬間）
          </Button>
        </Wrap>
      </Block>
      <Alert
        open={alert}
        title="刪除「示範之歌」？"
        message="音檔、歌詞與設計會一起刪除，無法復原。"
        confirmLabel="刪除"
        destructive
        busy={busy}
        onCancel={() => setAlert(false)}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setAlert(false);
          }, 900);
        }}
      />
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="重新設計"
        width={640}
        initialFocus={textRef}
        action={
          <Button variant="filled" onClick={() => setSheet(false)}>
            開始
          </Button>
        }
      >
        <p className="text-[13px] leading-5 text-label-2">往下拖標題列可以關閉；快速下滑即使不到一半也會關閉。</p>
        <TextArea ref={textRef} rows={3} className="mt-3" value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：副歌更熱血、主歌更安靜" aria-label="設計指示" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 32 }, (_, i) => (
            <p key={i} className="text-[13px] leading-5 text-label-2">
              第 {i + 1} 段：捲動內文，標題列下方會出現 hairline。
            </p>
          ))}
        </div>
      </Sheet>
      <Sheet open={help} onClose={() => setHelp(false)} title="快捷鍵" instant cancelLabel={null} action={<Button variant="plain" onClick={() => setHelp(false)}>完成</Button>}>
        <InsetGroup>
          {[
            ["播放／暫停", "Space"],
            ["黑場", "B"],
            ["歌詞開關", "L"],
            ["凍結畫面", "F"],
            ["偏移 +0.05 秒", "]"],
          ].map(([t, k]) => (
            <ListRow key={t} title={t} accessory={<Kbd keys={k} />} />
          ))}
        </InsetGroup>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------- Menu

function MenuDemo() {
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  const [last, setLast] = useState("尚未選擇");
  return (
    <>
      <Block label="Menu（靜態預覽：高亮、快捷鍵、分隔、破壞性項目）">
        <MenuPreview>
          <MenuItem icon={PencilSimpleIcon}>編輯歌詞</MenuItem>
          <MenuItem icon={SparkleIcon} highlighted shortcut="Meta+D">
            設計總覽
          </MenuItem>
          <MenuItem icon={ArrowClockwiseIcon}>重新處理…</MenuItem>
          <MenuSeparator />
          <MenuItem icon={TrashIcon} destructive>
            刪除
          </MenuItem>
        </MenuPreview>
      </Block>
      <Block label="互動（↑↓ Enter Esc、字首跳轉、焦點歸還）">
        <Wrap>
          <Menu
            label="更多動作"
            placement="bottom-end"
            trigger={(p) => <Button {...p} variant="quiet" size="icon" aria-label="更多動作" icon={DotsThreeIcon} data-lab="menu-trigger" />}
          >
            <MenuItem icon={PencilSimpleIcon} onSelect={() => setLast("編輯歌詞")} textValue="edit">
              編輯歌詞
            </MenuItem>
            <MenuItem icon={SparkleIcon} onSelect={() => setLast("設計總覽")} shortcut="Meta+D" textValue="design">
              設計總覽
            </MenuItem>
            <MenuItem icon={ArrowClockwiseIcon} onSelect={() => setLast("重新處理")} textValue="reprocess">
              重新處理…
            </MenuItem>
            <MenuItem icon={UploadSimpleIcon} disabled>
              匯出（停用）
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} destructive onSelect={() => setLast("刪除")} textValue="delete">
              刪除
            </MenuItem>
          </Menu>
          <Menu label="外觀" trigger={(p) => <Button {...p} variant="gray" icon={CircleHalfIcon}>外觀</Button>}>
            <MenuLabel>外觀</MenuLabel>
            {(
              [
                ["system", "跟隨系統"],
                ["light", "淺色"],
                ["dark", "深色"],
              ] as const
            ).map(([v, l]) => (
              <MenuItem key={v} checked={appearance === v} onSelect={() => setAppearance(v)}>
                {l}
              </MenuItem>
            ))}
          </Menu>
          <Popover label="連接 Claude" trigger={(p) => <Button {...p} variant="plain" icon={InfoIcon}>連接 Claude</Button>}>
            <p className="font-semibold">連接 Claude</p>
            <p className="mt-1 text-label-2">在專案根目錄的 .env.local 加上金鑰，再重新啟動 npm run dev。</p>
            <pre className="mt-2 rounded-sm bg-fill-3 px-2.5 py-2 text-[12px] leading-4">ANTHROPIC_API_KEY=sk-…</pre>
            <div className="mt-3 flex justify-end">
              <Button variant="tinted" size="sm">
                重新檢查
              </Button>
            </div>
          </Popover>
        </Wrap>
        <p className="mt-2 text-[12px] leading-4 text-label-2" data-lab="menu-last">
          最後選擇：{last}
        </p>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Tooltip

function TooltipDemo() {
  return (
    <>
      <Block label="外觀（material thick；控制台內為實色）">
        <Wrap className="gap-3">
          <TooltipPreview content="黑場" shortcut="B" />
          <TooltipPreview content="開啟投影視窗" shortcut="O" />
          <TooltipPreview content="偏移 −0.05 秒" shortcut="[" />
        </Wrap>
      </Block>
      <Block label="互動：第一次 400ms；之後 600ms 內移到相鄰按鈕立即顯示、無動畫">
        <Wrap>
          <Tooltip content="黑場" shortcut="B">
            <Button variant="gray" size="icon" aria-label="黑場" icon={MoonIcon} data-lab="tip-a" />
          </Tooltip>
          <Tooltip content="凍結畫面" shortcut="F">
            <Button variant="gray" size="icon" aria-label="凍結畫面" icon={SnowflakeIcon} data-lab="tip-b" />
          </Tooltip>
          <Tooltip content="歌詞開關" shortcut="L">
            <Button variant="gray" size="icon" aria-label="歌詞開關" icon={EyeSlashIcon} />
          </Tooltip>
          <Tooltip content="開啟投影視窗" shortcut="O" placement="top">
            <Button variant="gray" icon={ProjectorScreenIcon}>
              開啟
            </Button>
          </Tooltip>
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Tags

function TagDemo() {
  const [blackout, setBlackout] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <Block label="Tag（中繼資料）">
        <Wrap>
          <Tag>副歌</Tag>
          <Tag>粒子星空</Tag>
          <Tag tone="tint">同步歌詞</Tag>
          <Tag tone="orange">長度不同</Tag>
          <Tag tone="red">錯誤</Tag>
        </Wrap>
      </Block>
      <Block label="狀態膠囊（只在控制台頂欄；黑場是唯一的實心）">
        <Wrap>
          <StatusCapsule tone="blackout">黑場</StatusCapsule>
          <StatusCapsule tone="orange" icon={SnowflakeIcon}>
            凍結
          </StatusCapsule>
          <StatusCapsule tone="orange" icon={EyeSlashIcon}>
            歌詞隱藏
          </StatusCapsule>
          <StatusCapsule tone="tint" icon={FilmSlateIcon}>
            場景：粒子星空
          </StatusCapsule>
          <StatusCapsule tone="orange" icon={HandPalmIcon}>
            等待下一句
          </StatusCapsule>
          <StatusCapsule tone="red">儲存失敗</StatusCapsule>
        </Wrap>
      </Block>
      <Block label="最多 3 個，其餘收成 +n（0ms 出現、150ms 淡出）">
        <StatusCapsules
          items={[
            blackout && { id: "b", tone: "blackout", label: "黑場" },
            frozen && { id: "f", tone: "orange", icon: SnowflakeIcon, label: "凍結" },
            hidden && { id: "l", tone: "orange", icon: EyeSlashIcon, label: "歌詞隱藏" },
            { id: "s", tone: "tint", icon: FilmSlateIcon, label: "場景：粒子星空" },
            { id: "w", tone: "orange", icon: HandPalmIcon, label: "等待下一句" },
          ]}
        />
        <Wrap className="mt-2">
          <Button size="sm" variant={blackout ? "tinted" : "gray"} onClick={() => setBlackout((x) => !x)}>
            B 黑場
          </Button>
          <Button size="sm" variant={frozen ? "tinted" : "gray"} onClick={() => setFrozen((x) => !x)}>
            F 凍結
          </Button>
          <Button size="sm" variant={hidden ? "tinted" : "gray"} onClick={() => setHidden((x) => !x)}>
            L 歌詞
          </Button>
        </Wrap>
      </Block>
      <Block label="Badge（舊 API，對應到 Tag）">
        <Wrap>
          <Badge>neutral</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="ok">可上台</Badge>
          <Badge tone="warn">warn</Badge>
          <Badge tone="danger">danger</Badge>
        </Wrap>
      </Block>
      <Block label="Kbd（系統字，符號鍵）">
        <Wrap>
          <Kbd keys="b" />
          <Kbd keys="Space" />
          <Kbd keys="Shift+ArrowUp" />
          <Kbd keys="Meta+s" />
          <Kbd keys="ArrowLeft" />
          <Kbd keys="Backspace" />
          <Kbd keys="Escape" />
          <Kbd>1</Kbd>
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Progress

function ProgressDemo() {
  const [p, setP] = useState(0.35);
  return (
    <>
      <Block label="確定進度（transform，240ms linear）">
        <div className="flex flex-col gap-3">
          <ProgressBar value={0} label="等待中" showValue />
          <ProgressBar value={p} label="分析中…" showValue />
          <ProgressBar value={1} label="完成" showValue />
          <Wrap>
            <Button size="sm" variant="gray" onClick={() => setP((x) => Math.max(0, Math.round((x - 0.2) * 100) / 100))}>
              −20%
            </Button>
            <Button size="sm" variant="gray" onClick={() => setP((x) => Math.min(1, Math.round((x + 0.2) * 100) / 100))}>
              +20%
            </Button>
          </Wrap>
        </div>
      </Block>
      <Block label="不確定：Spinner（iOS 活動指示器，唯一允許的循環）">
        <Wrap className="gap-4">
          <Spinner />
          <Spinner size={20} />
          <Spinner label="處理中…" />
          <Button variant="filled" loading>
            上傳中…
          </Button>
          <Button variant="gray" loading>
            搜尋
          </Button>
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Toast

function ToastDemo() {
  const toasts = useToasts();
  const n = useRef(0);
  const samples = [
    { tone: "error", message: "投影視窗沒有回應，請確認它還開著。" },
    { tone: "warn", message: "另一個控制台也在控制這個投影。" },
    { tone: "ok", message: "設計已更新並送到投影。" },
    { tone: "info", message: "已切到 LIVE 模式：由你逐句送出。" },
  ] as const;
  return (
    <>
      <Block label="Toast（靜態預覽）">
        <div className="flex flex-col gap-2">
          {samples.map((s) => (
            <ToastPreview key={s.tone} toast={s} />
          ))}
          <ToastPreview toast={{ tone: "info", message: "音檔已替換。", action: { label: "復原", onClick: () => {} } }} />
        </div>
      </Block>
      <Block label="互動：新通知從上方出現、其餘讓位；滑鼠停留暫停；往右滑掉">
        <Wrap>
          <Button
            variant="gray"
            data-lab="push-toast"
            onClick={() => {
              const s = samples[n.current++ % samples.length];
              toasts.push({ ...s, duration: 6000 });
            }}
          >
            推送通知
          </Button>
          <Button variant="plain" onClick={toasts.clear}>
            全部清除
          </Button>
        </Wrap>
        <div className="relative mt-3 h-56 overflow-hidden rounded-lg bg-fill-4">
          <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} className="absolute! top-2! right-2! w-[min(360px,calc(100%-16px))]!" />
        </div>
      </Block>
      <Block label="頁內 Banner（不做彩色底框）">
        <div className="flex flex-col gap-2">
          <Banner tone="success" title="設計完成" description="主視覺與 8 個段落的畫面都已準備好。" actions={<Button variant="filled">進入控制台</Button>} />
          <Banner tone="error" title="處理失敗" description="研究步驟逾時。已完成的步驟都已儲存。" actions={<Button variant="gray">重試</Button>} />
          <Banner tone="warning" title="發現未儲存的草稿" description="上次編輯到第 12 行。" actions={<Button variant="plain">還原</Button>} />
          <Banner tone="info" title="免費研究模式" description="查詢 MusicBrainz 與維基百科的公開資料，再分析歌詞與音訊，不需要 API 金鑰。" />
        </div>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Empty and Skeleton

function EmptyDemo({ theme }: { theme: ThemeId }) {
  const [show, setShow] = useState(true);
  return (
    <>
      <Block label="EmptyState">
        <div className="rounded-lg bg-surface in-data-[theme=console]:bg-surface-2">
          <EmptyState compact={theme === "console"} icon={theme === "console" ? MusicNotesIcon : MusicNotesPlusIcon} title="還沒有作品" description="把一首歌拖到上方，AI 會研究並設計它的舞台視覺。" action={<Button variant="tinted">選擇音檔</Button>} />
        </div>
      </Block>
      <Block label="Skeleton（靜態、300ms 後才出現、形狀對應最終版面）">
        <Button size="sm" variant="gray" className="mb-3" onClick={() => setShow((s) => !s)}>
          {show ? "隱藏" : "重新顯示（300ms 延遲）"}
        </Button>
        {show && (
          <SkeletonGroup label="載入作品庫" className="grid grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="aspect-[16/10] rounded-xl" />
                <SkeletonText lines={2} />
              </div>
            ))}
          </SkeletonGroup>
        )}
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- AppHeader

function Backdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex flex-col gap-2 px-4 pt-7">
      <div className="h-7 w-3/4 rounded-sm bg-orange" />
      <div className="h-7 w-1/2 rounded-sm bg-tint" />
      <div className="h-7 w-2/3 rounded-sm bg-green" />
    </div>
  );
}

function HeaderDemo({ theme }: { theme: ThemeId }) {
  const [mode, setMode] = useState<"track" | "live">("track");
  if (theme === "console") {
    return (
      <Block label="控制台版：實色 surface、底部 hairline、無材質">
        <div className="-mx-3 overflow-hidden rounded-md bg-bg">
          <AppHeader
            variant="console"
            anchor={false}
            back
            title="示範之歌"
            subtitle="離線設計・歌詞已對時"
            center={
              <>
                <Button variant="quiet" size="icon" aria-label="上一句" icon={SkipBackIcon} />
                <Button size="circle" aria-label="播放" icon={PlayIcon} />
                <Button variant="quiet" size="icon" aria-label="下一句" icon={SkipForwardIcon} />
              </>
            }
            actions={<span className="text-c-clock font-numeric">0:42</span>}
          />
          <div className="flex items-center gap-1.5 px-3 py-2">
            <SegmentedControl
              label="模式"
              value={mode}
              onChange={setMode}
              options={[
                { value: "track", label: "TRACK" },
                { value: "live", label: "LIVE" },
              ]}
            />
            <StatusCapsule tone="blackout">黑場</StatusCapsule>
            <StatusCapsule tone="orange" icon={HandPalmIcon}>
              等待下一句
            </StatusCapsule>
          </div>
        </div>
      </Block>
    );
  }
  return (
    <>
      <Block label="頁面版：在頂端時透明">
        <div className="-mx-4 bg-bg">
          <AppHeader anchor={false} back title="示範之歌" subtitle="示範樂團" width="full" scrolled={false} actions={<Button variant="gray">編輯歌詞</Button>} />
        </div>
      </Block>
      <Block label="頁面版：內容捲到下方時（material regular + scroll edge）">
        <div className="relative -mx-4 h-[104px] overflow-hidden">
          <Backdrop />
          <div className="absolute inset-x-0 top-0">
            <AppHeader anchor={false} back title="示範之歌" subtitle="示範樂團" width="full" scrolled actions={<Button variant="filled">進入控制台</Button>} />
          </div>
        </div>
      </Block>
      <Block label="首頁：品牌在左">
        <div className="-mx-4">
          <AppHeader
            anchor={false}
            width="full"
            scrolled={false}
            leading={
              <span className="flex items-center gap-2 text-[17px] leading-6 font-semibold">
                <BrandMark size={28} />
                Livelyrics
              </span>
            }
            actions={
              <Button variant="quiet" size="sm" icon={InfoIcon}>
                免費研究模式
              </Button>
            }
          />
        </div>
      </Block>
      <Block label="歌詞編輯器：標題旁「尚未儲存」、工具列">
        <div className="-mx-4">
          <AppHeader
            anchor={false}
            width="full"
            scrolled={false}
            back
            title="示範之歌"
            titleAccessory={<span className="shrink-0 text-[12px] leading-4 text-label-2">尚未儲存</span>}
            actions={
              <>
                <Button variant="quiet" size="icon" aria-label="復原" icon={ArrowUUpLeftIcon} />
                <Button variant="quiet" size="icon" aria-label="重做" icon={ArrowUUpRightIcon} />
                <Button variant="filled">儲存</Button>
              </>
            }
          />
        </div>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Disclosure

function DisclosureDemo() {
  return (
    <div className="flex flex-col gap-1">
      <Disclosure summary="設計說明">
        <p className="pb-2 pl-[18px] text-[13px] leading-5 text-label-2">主歌用冷色與留白讓樂團站在前面；副歌才把光推滿。</p>
      </Disclosure>
      <Disclosure summary="段落理由（預設展開、動畫高度）" defaultOpen animateHeight>
        <p className="pb-2 pl-[18px] text-[13px] leading-5 text-label-2">0:24-0:40 副歌：歌詞放大置中，粒子隨低頻脈動。</p>
      </Disclosure>
    </div>
  );
}

// ---------------------------------------------------------------- HUD

function HudDemo() {
  const hud = useRef<HudHandle>(null);
  const [black, setBlack] = useState(false);
  const [offset, setOffset] = useState(0);
  return (
    <>
      <Block label="外觀（靜態預覽）">
        <div className="flex flex-col items-start gap-2">
          <HudPreview content={{ icon: MoonIcon, label: "黑場", value: "開", tone: "red" }} />
          <HudPreview content={{ icon: FilmSlateIcon, label: "場景 3", value: "粒子星空" }} />
          <HudPreview content={{ icon: TimerIcon, label: "偏移", value: "+0.15 秒" }} />
        </div>
      </Block>
      <Block label="互動：0ms 出現、停 900ms、250ms 淡出；連按只更新內容">
        <div className="relative mb-3 aspect-video overflow-hidden rounded-md" style={{ background: "radial-gradient(120% 90% at 30% 20%, color-mix(in srgb, var(--tint) 45%, black), black 65%)" }}>
          <HUD ref={hud} />
        </div>
        <Wrap>
          <Button
            size="sm"
            variant="gray"
            data-lab="hud-b"
            onClick={() => {
              const on = !black;
              setBlack(on);
              hud.current?.show({ icon: MoonIcon, label: "黑場", value: on ? "開" : "關", tone: on ? "red" : "default" });
            }}
          >
            B 黑場
          </Button>
          <Button
            size="sm"
            variant="gray"
            onClick={() => {
              const next = Math.round((offset + 0.05) * 100) / 100;
              setOffset(next);
              hud.current?.show({ icon: TimerIcon, label: "偏移", value: `${next >= 0 ? "+" : ""}${next.toFixed(2)} 秒` });
            }}
          >
            ] 偏移
          </Button>
          <Button size="sm" variant="gray" onClick={() => hud.current?.show({ icon: SpeakerHighIcon, label: "拍速", value: "121 BPM" })}>
            T 拍速
          </Button>
        </Wrap>
      </Block>
    </>
  );
}

// ---------------------------------------------------------------- Icons

function IconDemo() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1 text-label">
      {Object.entries(ALL_ICONS).map(([name, I]) => (
        <span key={name} title={name.replace(/Icon$/, "")} className="flex h-9 items-center justify-center rounded-sm hover:bg-fill-4">
          <I size={20} />
        </span>
      ))}
      {Object.entries(ALL_ICONS)
        .slice(0, 24)
        .map(([name, I]) => (
          <span key={`${name}-16`} className="flex h-7 items-center justify-center text-label-2">
            <I size={16} />
          </span>
        ))}
    </div>
  );
}
