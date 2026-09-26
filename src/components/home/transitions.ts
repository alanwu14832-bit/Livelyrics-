// View-transition vocabulary for the HOME pages (UI-AUDIT §3.4.1 item 1). The CSS lives in
// src/app/globals.css (::view-transition-*(.push | .pop | .morph)).
//
// Page wrappers: <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">.
// Links going deeper pass transitionTypes={PUSH}; 「‹ 作品庫」 (AppHeader's BackLink) passes ["pop"].
// Navigations without a type (router.push after upload, browser back) do not slide.

import type { ViewTransitionClass } from "react";

export const PAGE_TRANSITION: ViewTransitionClass = { push: "push", pop: "pop", default: "none" };

export const PUSH = ["push"];

/** Shared-element names: the library card art / title morph into the sub-page header. */
export const artTransitionName = (id: string) => `project-art-${id}`;
export const titleTransitionName = (id: string) => `project-title-${id}`;
