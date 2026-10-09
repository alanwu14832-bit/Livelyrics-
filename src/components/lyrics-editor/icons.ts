// Icons the lyrics editor needs that are not in the kit catalogue (src/components/ui/Icon.tsx).
// Same wrapper as the kit (house sizes and weights: <= 17 px bold, >= 20 px regular), Phosphor
// SSR deep imports so only these icons are compiled.

import { ArrowsDownUpIcon as PhArrowsDownUp } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { MagicWandIcon as PhMagicWand } from "@phosphor-icons/react/dist/ssr/MagicWand";
import { ArrowLineDownIcon as PhArrowLineDown } from "@phosphor-icons/react/dist/ssr/ArrowLineDown";
import { EarIcon as PhEar } from "@phosphor-icons/react/dist/ssr/Ear";
import { makeIcon } from "@/components/ui/icon-base";

export const SortByTimeIcon = /* @__PURE__ */ makeIcon(PhArrowsDownUp, "SortByTimeIcon");
export const MagicWandIcon = /* @__PURE__ */ makeIcon(PhMagicWand, "MagicWandIcon");
export const InsertBelowIcon = /* @__PURE__ */ makeIcon(PhArrowLineDown, "InsertBelowIcon");
/** 「AI 自動對時」: the AI listens to the song */
export const AiTimingIcon = /* @__PURE__ */ makeIcon(PhEar, "AiTimingIcon");
