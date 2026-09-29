// ProjectNotFound: the one "this project does not exist" composition, used by the design overview,
// the lyrics editor and the console below their own 52 px header (only the theme differs). Centred
// in the space under the header; one 44 px label-2 icon, one tinted action without a chevron (the
// header's 「‹ 作品庫」 already carries it). Server-safe.
//
//   <div className="flex min-h-dvh flex-col"><AppHeader back width="full" title="找不到作品" /><ProjectNotFound /></div>

import { Button, EmptyState, cx } from "@/components/ui";
import { MagnifyingGlassIcon } from "@/components/ui/Icon";

export const NOT_FOUND_HEADER_TITLE = "找不到作品";

export function ProjectNotFound({ className }: { className?: string }) {
  return (
    <div className={cx("flex min-h-0 flex-1 items-center justify-center pb-[52px]", className)}>
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="找不到這個作品"
        description="它可能已經被刪除了。"
        action={
          <Button variant="tinted" href="/" transitionTypes={["pop"]}>
            回到作品庫
          </Button>
        }
      />
    </div>
  );
}
