"use client";

// One row of the setlist (Apple Music playlist row in edit mode): number or moment icon, artwork,
// title and a quiet subtitle, the running length, the song's readiness, the arc note when there is
// one, a ⋯ menu, and the iOS reorder grip on the right. Drag the grip, or focus it and use ↑ ↓
// (Alt+↑ ↓ from anywhere in the row) to move the item.

import { Reorder, useDragControls } from "motion/react";
import type { KeyboardEvent, ReactNode } from "react";
import { ProjectArt, validPalette } from "@/components/home/ProjectArt";
import { PUSH } from "@/components/home/transitions";
import { processHref } from "@/components/process/steps";
import { Button, Menu, MenuItem, MenuSeparator, Spinner, Tag, cx } from "@/components/ui";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CoffeeIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  HourglassIcon,
  MonitorPlayIcon,
  PencilSimpleIcon,
  SignInIcon,
  SignOutIcon,
  SparkleIcon,
  TrashIcon,
} from "@/components/ui/Icon";
import { spring } from "@/lib/motion";
import { ARC_ROLE_INFO, LOOK_KIND_INFO, SONG_STATUS_INFO, formatRunningTime, songStatus } from "@/lib/show";
import { SCENE_LABELS } from "@/lib/console/labels";
import { formatTimeShort } from "@/lib/timeline";
import type { LookItemKind, ProjectSummary, SetItem, SetLook, SongArcNote } from "@/lib/types";

export const LOOK_ICONS: Record<LookItemKind, typeof SignInIcon> = { "walk-in": SignInIcon, "walk-out": SignOutIcon, interlude: CoffeeIcon, standby: HourglassIcon };

/** A lightweight look thumbnail (no WebGL): the colorway as light on the background. */
export function LookThumb({ look, kind, className }: { look: SetLook; kind: LookItemKind; className?: string }) {
  const [bg, primary, accent] = look.colorway;
  const Icon = LOOK_ICONS[kind];
  return (
    <span
      aria-hidden="true"
      className={cx("relative flex items-center justify-center overflow-hidden", className)}
      style={{ background: `radial-gradient(120% 90% at 25% 20%, ${primary}99 0%, transparent 60%), radial-gradient(90% 80% at 85% 90%, ${accent}80 0%, transparent 65%), ${bg}` }}
    >
      <Icon size={16} className="text-white/85 drop-shadow" />
    </span>
  );
}

function consoleHref(id: string) {
  return `/p/${encodeURIComponent(id)}`;
}

export interface SetlistRowProps {
  item: SetItem;
  index: number;
  count: number;
  /** 1-based number among songs (songs only) */
  songNumber: number | null;
  song?: ProjectSummary;
  arc?: SongArcNote;
  /** this song is being re-designed by the arc pass */
  busy?: boolean;
  disabled?: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
  onEditLook?: () => void;
  onApplyArc?: () => void;
  onDragEnd: () => void;
}

export function SetlistRow({ item, index, count, songNumber, song, arc, busy, disabled, onMove, onRemove, onEditLook, onApplyArc, onDragEnd }: SetlistRowProps) {
  const controls = useDragControls();
  const isSong = item.kind === "song";
  const title = isSong ? (song?.title ?? "作品已刪除") : item.title;
  const status = isSong ? songStatus(song) : null;
  const seconds = isSong ? (song?.duration ?? 0) : (item.look.durationHint ?? 0);
  const label = isSong ? `第 ${songNumber} 首，${title}` : `${LOOK_KIND_INFO[item.kind].label}，${title}`;

  const subtitle: ReactNode = isSong ? (
    song ? (
      song.artist || "未填樂團"
    ) : (
      "這首歌已從作品庫刪除"
    )
  ) : (
    <>
      {LOOK_KIND_INFO[item.kind].label}，{SCENE_LABELS[item.look.scene]}
      {item.look.text ? `，「${item.look.text}」` : ""}
    </>
  );

  const onGripKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      onMove(index - 1);
    } else if (e.key === "ArrowDown" && index < count - 1) {
      e.preventDefault();
      onMove(index + 1);
    }
  };

  return (
    <Reorder.Item
      as="li"
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      transition={spring}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow-lift)", zIndex: 5 }}
      className="relative bg-surface first:rounded-t-lg last:rounded-b-lg"
      onKeyDown={(e: KeyboardEvent) => {
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) onGripKey(e);
      }}
      data-testid="setlist-row"
      aria-label={label}
    >
      <div className="relative flex min-h-[64px] min-w-0 items-center gap-3 px-(--row-pad-x) py-2.5 after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[92px] after:h-(--hairline) after:bg-separator [li:last-child>&]:after:hidden">
        <span className="w-6 shrink-0 text-center text-[15px] leading-5 text-label-2 tabular">{isSong ? songNumber : <span className="sr-only">{LOOK_KIND_INFO[item.kind].label}</span>}</span>
        {isSong ? (
          <ProjectArt id={item.projectId} palette={validPalette(song?.palette)} placeholderIconSize={16} className="size-11 shrink-0 rounded-[8px]" />
        ) : (
          <LookThumb look={item.look} kind={item.kind} className="size-11 shrink-0 rounded-[8px]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            {!isSong && onEditLook ? (
              <button type="button" onClick={onEditLook} className="press-fade min-w-0 truncate rounded-xs text-left text-[17px] leading-[22px] font-medium text-label hover:text-tint-text">
                {title}
              </button>
            ) : (
              <span className="min-w-0 truncate text-[17px] leading-[22px] font-semibold text-label">{title}</span>
            )}
            {arc && <Tag tone="tint">{ARC_ROLE_INFO[arc.role].label}</Tag>}
          </p>
          <p className="truncate text-[13px] leading-[18px] text-label-2">{subtitle}</p>
          {arc && (
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-label-2">
              <span aria-hidden="true" className="relative h-1 w-12 shrink-0 overflow-hidden rounded-full bg-fill-3">
                <span className="absolute inset-y-0 left-0 rounded-full bg-tint" style={{ width: `${Math.round(arc.energy * 100)}%` }} />
              </span>
              <span className="shrink-0 tabular">能量 {Math.round(arc.energy * 100)}%</span>
              <span className="min-w-0 truncate" title={arc.note}>
                {arc.note}
              </span>
              {arc.appliedAt && (
                <span className="flex shrink-0 items-center gap-1">
                  <CheckCircleIcon size={14} weight="fill" className="text-green" />
                  已依弧線設計
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {busy ? (
            <span className="flex items-center gap-1.5 text-[12px] leading-4 text-label-2">
              <Spinner size={14} />
              設計中…
            </span>
          ) : status && status !== "ready" ? (
            <Tag tone={SONG_STATUS_INFO[status].tone === "red" ? "red" : SONG_STATUS_INFO[status].tone === "orange" ? "orange" : "neutral"}>{SONG_STATUS_INFO[status].label}</Tag>
          ) : null}
          <span className="w-14 text-right text-[15px] leading-5 text-label-2 tabular max-sm:hidden">{seconds > 0 ? (isSong ? formatTimeShort(seconds) : formatRunningTime(seconds)) : ""}</span>
          <Menu
            label={`「${title}」的更多動作`}
            placement="bottom-end"
            trigger={(t) => <Button {...t} variant="quiet" size="icon-sm" icon={<DotsThreeIcon size={20} weight="bold" />} aria-label={`「${title}」的更多動作`} disabled={disabled} />}
          >
            {isSong && song && (
              <>
                <MenuItem icon={MonitorPlayIcon} href={consoleHref(item.projectId)} transitionTypes={PUSH}>
                  開啟控制台
                </MenuItem>
                <MenuItem icon={PencilSimpleIcon} href={processHref(item.projectId)} transitionTypes={PUSH}>
                  設計總覽
                </MenuItem>
                {onApplyArc && (
                  <MenuItem icon={SparkleIcon} onSelect={onApplyArc} disabled={busy}>
                    依弧線重新設計
                  </MenuItem>
                )}
                <MenuSeparator />
              </>
            )}
            {!isSong && onEditLook && (
              <>
                <MenuItem icon={PencilSimpleIcon} onSelect={onEditLook}>
                  編輯畫面…
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuItem icon={ArrowUpIcon} onSelect={() => onMove(index - 1)} disabled={index === 0}>
              上移
            </MenuItem>
            <MenuItem icon={ArrowDownIcon} onSelect={() => onMove(index + 1)} disabled={index === count - 1}>
              下移
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} destructive onSelect={onRemove}>
              從演出移除
            </MenuItem>
          </Menu>
          <button
            type="button"
            className="-mr-1.5 flex size-8 cursor-grab touch-none items-center justify-center rounded-sm text-label-3 hover:bg-fill-4 hover:text-label-2 active:cursor-grabbing"
            aria-label={`調整「${title}」的順序：拖曳，或按上下鍵`}
            aria-keyshortcuts="ArrowUp ArrowDown"
            disabled={disabled}
            onPointerDown={(e) => {
              if (!disabled) controls.start(e);
            }}
            onKeyDown={onGripKey}
          >
            <DotsSixVerticalIcon size={20} />
          </button>
        </div>
      </div>
    </Reorder.Item>
  );
}
