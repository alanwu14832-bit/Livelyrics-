"use client";

// 演出清單 rail (phase 2b): the show console's left column, a flush --surface sidebar the height of
// the window. Top: the way back to the show page. Then the GO block — a large filled button that
// names the armed item and its kind (QLab's GO: obvious, hard to miss, double-GO protected by the
// controller) — with the take transition (淡出淡入 / 直接切換) and 「GO 後自動播放」. Then every item:
// kind colour swatch, title, length, readiness, arc role; the item on air is red (播出中, the
// on-air colour), the armed one has the tint ring (待命); a click arms an item. At the bottom the
// standby key: the show's safe screen, one press away at any time. 「跟隨時間碼換歌」 (phase 5a): with
// MTC or LTC as the sync source, the timecode entering a song's hour takes that song; each song
// row then shows its start timecode.

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Kbd, SegmentedControl, Switch, Tag, Tooltip, cx } from "@/components/ui";
import { SOFT_TEXT } from "@/components/ui/Tag";
import { BroadcastIcon, CaretLeftIcon, LifebuoyIcon, MusicNotesIcon, type UiIcon } from "@/components/ui/Icon";
import { LOOK_ICONS } from "@/components/show/SetlistRow";
import { useRafLoop } from "@/components/console/useRaf";
import { useSyncSnapshot } from "@/components/console/sync/hooks";
import { selectOverrides, useStageValue } from "@/lib/console/hooks";
import { AUTO_STANDBY_ID, arcRoleLabel, type RailItem } from "@/lib/console/show-live";
import type { ShowLiveController, ShowLiveSnapshot } from "@/lib/console/show-controller";
import { ARC_ROLE_INFO, LOOK_KIND_INFO, PALETTE_EMPHASIS_INFO, SONG_STATUS_INFO, arcDirectiveFor, formatRunningTime } from "@/lib/show";
import { createStageStore, initialStageState } from "@/lib/stage/protocol";
import { setlistSlots } from "@/lib/sync/chase";
import { formatTimeShort } from "@/lib/timeline";
import type { SetItemKind } from "@/lib/types";

const NO_STORE = createStageStore(initialStageState(""));

/** The icon of each item kind (a constant table: components are never made during render). */
export const KIND_ICONS: Record<SetItemKind, UiIcon> = { song: MusicNotesIcon, ...LOOK_ICONS };

export function kindLabel(kind: SetItemKind): string {
  return kind === "song" ? "歌曲" : LOOK_KIND_INFO[kind].label;
}

/**
 * The quiet line under a look's title: its kind when the title does not already say it, then its
 * text on screen (「進場」 with 「示範樂團」 reads 「示範樂團」, never 「進場・進場」).
 */
export function lookMeta(item: Pick<RailItem, "kind" | "title" | "text">): string {
  const kind = kindLabel(item.kind);
  const parts: string[] = [];
  if (item.title !== kind) parts.push(kind);
  if (item.text) parts.push(`「${item.text}」`);
  return parts.join("・") || kind;
}

/** "3:45" for a song, "5 分" for a look, "" when open-ended. */
export function itemLength(item: Pick<RailItem, "kind" | "seconds">): string {
  if (item.seconds == null || item.seconds <= 0) return "";
  return item.kind === "song" ? formatTimeShort(item.seconds) : formatRunningTime(item.seconds);
}

/** 「第 1 首・3:45」, 「串場・1 分」: the song number, or a look's kind when its title is not it, and the length. */
export function itemFacts(item: Pick<RailItem, "kind" | "title" | "songNumber" | "seconds">): string {
  const kind = item.kind === "song" || item.title === kindLabel(item.kind) ? "" : kindLabel(item.kind);
  return [item.songNumber != null ? `第 ${item.songNumber} 首` : kind, itemLength(item)].filter(Boolean).join("・");
}

/** The item's colours as a small tile with its kind icon (content colour, like the setlist thumbnails). */
function Swatch({ item, className }: { item: Pick<RailItem, "kind" | "swatch">; className?: string }) {
  const [a, b, c] = item.swatch;
  const Icon = KIND_ICONS[item.kind];
  const background =
    a && b
      ? `radial-gradient(120% 90% at 25% 20%, ${b}cc 0%, transparent 62%), radial-gradient(90% 80% at 85% 90%, ${(c ?? b) + "99"} 0%, transparent 65%), ${a}`
      : a
        ? a
        : "var(--fill-2)";
  return (
    <span aria-hidden="true" className={cx("relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[7px]", className)} style={{ background }}>
      <Icon size={14} className="text-white/85 drop-shadow" />
    </span>
  );
}

/** 2 px progress of the item on air (song: position, look: against its planned length), per frame. */
function OnAirProgress({ snap }: { snap: ShowLiveSnapshot }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onAir = snap.onAir;
  useRafLoop(() => {
    const el = ref.current;
    if (!el || !onAir) return;
    let p = 0;
    if (onAir.kind === "song") {
      const d = onAir.controller.getSnapshot().duration;
      p = d > 0 ? onAir.controller.songTime() / d : 0;
    } else {
      const hint = onAir.controller.durationHint;
      p = hint ? onAir.controller.elapsed() / hint : 0;
    }
    el.style.transform = `scaleX(${Math.min(1, Math.max(0, p)).toFixed(4)})`;
  });
  return (
    <span aria-hidden="true" className="pointer-events-none absolute right-2.5 bottom-1 left-[52px] h-0.5 overflow-hidden rounded-full bg-red/25">
      <span ref={ref} className="block h-full origin-left rounded-full bg-red" style={{ transform: "scaleX(0)" }} />
    </span>
  );
}

function RailRow({
  item,
  onAir,
  armed,
  past,
  snap,
  onArm,
  timecode,
  children,
}: {
  item: RailItem;
  onAir: boolean;
  armed: boolean;
  past: boolean;
  snap: ShowLiveSnapshot;
  onArm: () => void;
  /** 跟隨時間碼換歌: the song's start timecode */
  timecode?: string | null;
  children?: ReactNode;
}) {
  const length = itemLength(item);
  const role = arcRoleLabel(item.arcRole);
  const status = item.status && item.status !== "ready" ? SONG_STATUS_INFO[item.status] : null;
  // after 播出中 / 待命 a song needs no 「歌曲」: the icon and the number already say it
  const meta = [item.kind === "song" ? (onAir || armed ? "" : "歌曲") : lookMeta(item), role].filter(Boolean).join("・");
  return (
    <li data-item-id={item.id}>
      <button
        type="button"
        onClick={onArm}
        data-state={onAir ? "on-air" : armed ? "armed" : past ? "past" : undefined}
        aria-current={onAir ? "true" : undefined}
        aria-pressed={armed}
        aria-label={`${item.songNumber != null ? `第 ${item.songNumber} 首，` : `${kindLabel(item.kind)}，`}${item.title}${onAir ? "，播出中" : armed ? "，待命" : ""}`}
        className={cx(
          "relative flex min-h-[56px] w-full items-center gap-2.5 rounded-md py-2 pr-2.5 pl-2.5 text-left transition-none focus-inset",
          onAir ? "bg-red-soft shadow-[inset_3px_0_0_var(--red)]" : armed ? "bg-tint-soft shadow-[inset_0_0_0_2px_var(--tint)]" : "hover:bg-fill-4 active:bg-fill-3",
        )}
      >
        <Swatch item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            {item.songNumber != null && <span className={cx("shrink-0 text-c-footnote tabular", onAir || armed ? "text-label" : "text-label-2")}>{item.songNumber}</span>}
            <span className={cx("min-w-0 truncate text-c-body font-semibold", past && !onAir && !armed ? "text-label-2" : "text-label")}>{item.title}</span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center text-c-footnote text-label-2">
            {onAir ? (
              <span className={cx("inline-flex shrink-0 items-center gap-1 font-semibold", SOFT_TEXT.red)}>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
                播出中
              </span>
            ) : armed ? (
              <span className={cx("shrink-0 font-semibold", SOFT_TEXT.tint)}>待命</span>
            ) : null}
            {meta && (
              <span className="min-w-0 truncate">
                {onAir || armed ? "・" : ""}
                {meta}
              </span>
            )}
            {status && (
              <Tag tone={status.tone === "red" ? "red" : status.tone === "orange" ? "orange" : "neutral"} className="ml-1.5 min-w-0">
                <span className="truncate">{status.label}</span>
              </Tag>
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 self-start pt-0.5">
          {length && <span className="text-c-footnote text-label-2 tabular">{length}</span>}
          {timecode && (
            <span className="font-numeric text-[11px] leading-3 text-label-2 tabular" title={`時間碼 ${timecode} 開始`} data-rail-tc="">
              {timecode.endsWith(":00:00:00") ? `TC ${timecode.slice(0, 2)}` : timecode}
            </span>
          )}
        </span>
        {onAir && <OnAirProgress snap={snap} />}
      </button>
      {children}
    </li>
  );
}

/** The show-arc directive of the song on air: operator information only, quiet. */
function ArcNote({ snap, itemId }: { snap: ShowLiveSnapshot; itemId: string }) {
  const show = snap.show;
  const directive = show ? arcDirectiveFor(show, itemId) : null;
  if (!directive) return null;
  return (
    <div className="mx-2.5 mt-1 mb-1.5 rounded-sm bg-fill-4 px-2.5 py-2 text-c-footnote text-label-2">
      <p className="text-label">
        弧線：{ARC_ROLE_INFO[directive.role].label}・能量 {Math.round(directive.energy * 100)}%・{PALETTE_EMPHASIS_INFO[directive.emphasis].label}
      </p>
      {directive.note && <p className="mt-0.5 line-clamp-3">{directive.note}</p>}
    </div>
  );
}

function GoButton({ ctl, snap }: { ctl: ShowLiveController; snap: ShowLiveSnapshot }) {
  const armedId = snap.live.armed;
  const armed = armedId ? (snap.rail.find((r) => r.id === armedId) ?? (armedId === AUTO_STANDBY_ID && snap.standby ? standbyRow(snap) : null)) : null;
  const store = snap.onAir?.controller.store ?? NO_STORE;
  const blackout = useStageValue(store, selectOverrides).blackout && !!snap.onAir;
  const Icon = armed ? KIND_ICONS[armed.kind] : null;
  const loading = armed?.kind === "song" && !snap.nextReady;
  const ended = !armed && snap.live.current != null;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => ctl.go()}
        disabled={!armed}
        aria-keyshortcuts="G"
        aria-label={armed ? `GO：播出「${armed.title}」` : ended ? "GO：演出清單已播完" : "GO：沒有待命的項目"}
        className="press-tile relative flex min-h-[96px] w-full flex-col justify-between gap-1 rounded-lg bg-tint-fill px-4 pt-2.5 pb-3 text-left text-on-tint shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] hover:bg-tint-fill-hover disabled:pointer-events-none disabled:opacity-35"
      >
        <span className="flex w-full items-center justify-between">
          <span className="t-latin text-[30px] leading-9 font-bold">GO</span>
          <Kbd className="bg-white/20 text-white shadow-none">G</Kbd>
        </span>
        {armed && Icon ? (
          <>
            <span className="flex w-full min-w-0 items-center gap-1.5 text-[15px] leading-5 font-semibold">
              <Icon size={16} className="shrink-0" />
              <span className="min-w-0 truncate">{armed.title}</span>
            </span>
            <span className="min-w-0 truncate text-c-footnote font-medium">
              {[itemFacts(armed), loading ? "載入中…" : ""].filter(Boolean).join("・") || kindLabel(armed.kind)}
            </span>
          </>
        ) : (
          <span className="text-[15px] leading-5 font-semibold">{ended ? "演出清單已播完" : "沒有待命的項目"}</span>
        )}
      </button>
      {blackout && <p className={cx("px-1 text-c-footnote font-medium", SOFT_TEXT.red)}>黑場中：GO 之後仍是全黑，按 B 顯示。</p>}
    </div>
  );
}

function standbyRow(snap: ShowLiveSnapshot): RailItem | null {
  const s = snap.standby;
  if (!s) return null;
  return { id: s.id, kind: "standby", title: s.title, songNumber: null, seconds: null, status: null, arcRole: null, swatch: [...s.look.colorway] };
}

/** 「跟隨時間碼換歌」: only meaningful with MTC / LTC as the show's source. */
function FollowTimecodeRow({ ctl, snap }: { ctl: ShowLiveController; snap: ShowLiveSnapshot }) {
  const sync = useSyncSnapshot(ctl.sync);
  const timecode = sync.settings.source === "mtc" || sync.settings.source === "ltc";
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <label className="flex min-h-8 cursor-default items-center justify-between gap-2">
        <span className="text-c-body text-label">跟隨時間碼換歌</span>
        <Switch checked={snap.followTimecode} onChange={(v) => ctl.setFollowTimecode(v)} aria-label="跟隨時間碼換歌：時間碼進入某首歌的小時就播出那首歌" data-follow-timecode="" />
      </label>
      {snap.followTimecode && (
        <p className={cx("text-c-footnote", timecode ? "text-label-2" : "text-orange-text")}>
          {timecode ? "時間碼進入一首歌的小時就播出那首歌；畫面項目仍由 GO 播出。" : "先在「同步」選 MTC 或 LTC 作為同步來源。"}
        </p>
      )}
    </div>
  );
}

function SetlistRailImpl({ ctl, snap }: { ctl: ShowLiveController; snap: ShowLiveSnapshot }) {
  const show = snap.show;
  const starts = useMemo(() => new Map(setlistSlots(show?.items ?? []).map((s) => [s.itemId, s.start])), [show?.items]);
  const { current, armed } = snap.live;
  const listRef = useRef<HTMLOListElement>(null);
  const currentIndex = snap.rail.findIndex((r) => r.id === current);
  const total = snap.rail.reduce((n, r) => n + (r.seconds ?? 0), 0);
  const standby = snap.standby;
  const standbyOnAir = standby != null && current === standby.id;

  // keep the item on air and the armed one in view (instant: they follow GO and the keys)
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    for (const id of [armed, current]) {
      const el = id ? root.querySelector<HTMLElement>(`[data-item-id="${id}"]`) : null;
      if (!el) continue;
      if (el.offsetTop < root.scrollTop) root.scrollTop = el.offsetTop - 8;
      else if (el.offsetTop + el.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTop = el.offsetTop + el.offsetHeight - root.clientHeight + 8;
    }
  }, [armed, current]);

  return (
    <aside aria-label="演出清單" className="relative z-20 flex h-full w-[272px] shrink-0 flex-col bg-surface border-r-hairline">
      <header className="flex h-[52px] shrink-0 items-center px-(--header-gutter) border-b-hairline">
        {/* 「‹ 演出名」: the kit's BackLink look, with a long show name truncated */}
        <Link
          href={`/s/${encodeURIComponent(ctl.showId)}`}
          transitionTypes={["pop"]}
          onClick={(e) => {
            if (!ctl.confirmLeave()) e.preventDefault();
          }}
          className="press-fade -ml-1.5 inline-flex h-8 max-w-full min-w-0 items-center gap-0.5 rounded-sm pr-2 pl-0.5 text-[15px] leading-5 text-tint-text hover:bg-fill-4"
        >
          <CaretLeftIcon size={17} className="shrink-0" />
          <span className="min-w-0 truncate">{show?.name ?? "演出"}</span>
        </Link>
      </header>

      <section aria-label="GO" className="flex shrink-0 flex-col gap-2.5 p-3 pb-2">
        <GoButton ctl={ctl} snap={snap} />
        <SegmentedControl
          label="換場方式"
          fullWidth
          blurOnPointer
          value={snap.transition}
          onChange={(v) => ctl.setTransition(v)}
          options={[
            { value: "fade", label: "淡出淡入" },
            { value: "cut", label: "直接切換" },
          ]}
        />
        <label className="flex min-h-8 cursor-default items-center justify-between gap-2 px-1">
          <span className="text-c-body text-label">GO 後自動播放</span>
          <Switch checked={snap.autoPlay} onChange={(v) => ctl.setAutoPlay(v)} aria-label="GO 後自動播放（跟音檔模式的歌曲）" />
        </label>
        <FollowTimecodeRow ctl={ctl} snap={snap} />
      </section>

      <div className="flex shrink-0 items-baseline justify-between gap-2 px-4 pt-1.5 pb-1 text-c-footnote text-label-2">
        <h2 className="font-semibold">演出清單</h2>
        <span className="tabular">
          {snap.rail.length} 項{total > 0 ? `・${formatRunningTime(total)}` : ""}
        </span>
      </div>
      <ol ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {snap.rail.map((item, i) => (
          <RailRow
            key={item.id}
            item={item}
            onAir={item.id === current}
            armed={item.id === armed}
            past={currentIndex >= 0 && i < currentIndex}
            snap={snap}
            onArm={() => ctl.arm(item.id)}
            timecode={snap.followTimecode && item.kind === "song" ? starts.get(item.id) : null}
          >
            {item.id === current && item.kind === "song" && <ArcNote snap={snap} itemId={item.id} />}
          </RailRow>
        ))}
        {snap.rail.length === 0 && <li className="px-3 py-6 text-center text-c-body text-label-2">演出清單是空的。回到演出頁加入歌曲與畫面。</li>}
      </ol>

      <footer className="shrink-0 p-3 border-t-hairline">
        <Tooltip content={standby ? `隨時切到「${standby.title}」：畫面安全、沒有歌詞` : "待機畫面"} shortcut="S" placement="top-start">
          <button
            type="button"
            onClick={() => ctl.standby()}
            disabled={!standby}
            aria-keyshortcuts="S"
            aria-pressed={standbyOnAir}
            className={cx(
              "press-tile flex h-12 w-full items-center gap-2.5 rounded-md px-3 text-left disabled:pointer-events-none disabled:opacity-35",
              standbyOnAir ? "bg-red-soft shadow-[inset_3px_0_0_var(--red)]" : "bg-fill-3 hover:bg-fill-2",
            )}
          >
            {standbyOnAir ? <BroadcastIcon size={20} className="shrink-0 text-red" /> : <LifebuoyIcon size={20} className="shrink-0 text-label-2" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-c-body font-semibold text-label">{standbyOnAir ? "待機畫面播出中" : "切到待機畫面"}</span>
              <span className="block truncate text-c-footnote text-label-2">{standby ? (standby.id === AUTO_STANDBY_ID ? "樂團配色的安全畫面" : standby.title) : ""}</span>
            </span>
            <Kbd>S</Kbd>
          </button>
        </Tooltip>
      </footer>
    </aside>
  );
}

export const SetlistRail = memo(SetlistRailImpl);
