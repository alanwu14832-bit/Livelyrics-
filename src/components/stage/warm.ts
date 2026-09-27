// Getting a project ready before it is on stage (show mode, phase 2b): its lyric fonts (the
// unicode-range slices of the CJK fonts that its text needs, loaded through the FontFaceSet with
// next/font's generated family names) and its band media (decoded images and buffered videos
// through a MediaSources of its own, with the same crossOrigin="anonymous" handling as the stage,
// so cloud Blob redirects stay CORS-clean and the stage's own loads hit the cache). Nothing here
// renders anything, and nothing throws.

import { stageAssets } from "@/lib/asset-scope";
import { resolveTypography } from "@/lib/stage/typography";
import type { Project } from "@/lib/types";
import { MediaSources } from "./MediaSources";

/** Every distinct character the project can show (lyrics, translations, a look's text), capped. */
export function projectText(project: Project, max = 3000): string {
  const parts: string[] = [];
  for (const line of project.lyrics?.lines ?? []) {
    parts.push(line.text ?? "");
    if (line.translation) parts.push(line.translation);
  }
  const unique = [...new Set([...parts.join("")])].filter((ch) => ch.trim()).join("");
  return [...unique].slice(0, max).join("");
}

/** A font-family list with each var(--x) replaced by its value on `el` (next/font defines them on <html>). */
export function resolveFontFamily(family: string, el: Element): string {
  let style: CSSStyleDeclaration | null = null;
  try {
    style = getComputedStyle(el);
  } catch {
    style = null;
  }
  return family.replace(/var\((--[\w-]+)\)/g, (_, name: string) => style?.getPropertyValue(name).trim() || "sans-serif");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Load the project's lyric fonts; resolves when they are in, or after `timeoutMs` at the latest. */
export async function warmFonts(project: Project, timeoutMs = 1500): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    const typography = resolveTypography(project.plan);
    const family = resolveFontFamily(typography.family, document.documentElement);
    const text = projectText(project) || project.meta?.title || "Livelyrics";
    const weights = new Set([typography.weight, 700]);
    const loads = [...weights].map((w) => document.fonts.load(`${w} 64px ${family}`, text).catch(() => []));
    await Promise.race([Promise.all(loads), sleep(timeoutMs)]);
  } catch {
    /* a font that cannot load falls back like any other */
  }
}

/** Keeps the next item's media warm (one project at a time; a new one replaces it). */
export class ProjectWarmer {
  private media = new MediaSources();
  private key = "";

  warm(project: Project): void {
    void warmFonts(project, 20000);
    const assets = stageAssets(project);
    const used = new Set<string>();
    for (const s of project.plan?.sections ?? []) if (s?.media?.assetId) used.add(s.media.assetId);
    const key = `${project.id}|${project.bandId ?? ""}|${[...used].sort().join(",")}`;
    if (key === this.key) return;
    this.key = key;
    this.media.setAssets(project, assets, used);
  }

  destroy(): void {
    this.media.destroy();
    this.key = "";
  }
}
