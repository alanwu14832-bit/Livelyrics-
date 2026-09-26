"use client";

// ProjectHeading: the song thumbnail + title (+ subtitle) that sits right after 「‹ 作品庫」 on every
// project page (design overview, lyrics editor, console). One geometry everywhere (28 px thumb,
// 10 px gap, title), so the back link and the title do not move when the operator switches pages.
// Both parts carry the shared-element names of the library card, so the card morphs into it.
//
//   <AppHeader back heading={<ProjectHeading id={id} title="示範之歌" subtitle="示範樂團" palette={p} />} />

import { ViewTransition, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { ProjectArt } from "./ProjectArt";
import { artTransitionName, titleTransitionName } from "./transitions";

export function ProjectHeading({
  id,
  title,
  subtitle,
  palette,
  accessory,
  dense = false,
}: {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  palette?: readonly (string | null | undefined)[];
  /** next to the title, e.g. 「尚未儲存」 */
  accessory?: ReactNode;
  /** console type scale (13 / 12 px) instead of the page scale (15 / 13 px) */
  dense?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ViewTransition name={artTransitionName(id)} share="morph" default="none">
        <span className="block shrink-0">
          <ProjectArt id={id} palette={palette} placeholderIconSize={14} className="size-7 rounded-[7px]" />
        </span>
      </ViewTransition>
      <div className="flex min-w-0 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-2">
          <ViewTransition name={titleTransitionName(id)} share="morph" default="none">
            <h1 className={cx("min-w-0 truncate text-label", dense ? "text-c-headline" : "text-[15px] leading-5 font-semibold")}>{title}</h1>
          </ViewTransition>
          {accessory}
        </div>
        {subtitle != null && (
          <div className={cx("flex min-w-0 items-center truncate", dense ? "text-c-footnote text-label-2" : "text-[13px] leading-4 text-label-2-on-material")}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
