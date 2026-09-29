"use client";

// The recipe picker's thumbnails: the selected line composed with every recipe of the catalogue
// (the same engine as the stage: composeProjectLine + the canvas painter in colour mode), on the
// section's background colour, at the output canvas's aspect. Repainted when the line, the system
// or the faces change; each tile is a button (big enough for a thumb).

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { TypePainter } from "@/components/stage/type/TypePainter";
import { loadFaces, resolveFamilies } from "@/components/stage/type/fonts";
import { ensureContrast, isHex } from "@/lib/stage/color";
import { DEFAULT_OUTPUT } from "@/lib/output";
import { TYPE_RECIPE_IDS } from "@/lib/schema";
import { sectionIndexForLine } from "@/lib/timeline";
import { setRecipe, type EditContext } from "@/lib/type/edit";
import { composeProjectLine } from "@/lib/type/prepare";
import { resolveSystem } from "@/lib/type/resolve";
import { RECIPES, SEAL_COLOR } from "@/lib/type/vocab";
import type { TypeClock } from "@/lib/type/animate";
import type { Project, TypeRecipeId, TypeSystem } from "@/lib/types";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** the composition settled: after its entrance, no motion, no exit */
const HOLD: TypeClock = { since: 8, exit: null, t: 0, beat: { phase: 0.5, index: 0, known: false }, safe: true, intensity: 0, speed: 0 };

export function RecipeThumbs({
  project,
  system,
  lineIndex,
  current,
  ctx,
  onPick,
}: {
  project: Project;
  system: TypeSystem;
  lineIndex: number;
  /** the recipe the line shows now */
  current: TypeRecipeId;
  ctx: EditContext;
  onPick: (recipe: TypeRecipeId) => void;
}) {
  const line = project.lyrics.lines[lineIndex];
  const latin = !CJK.test(line?.text ?? "");
  const recipes = useMemo(() => TYPE_RECIPE_IDS.filter((id) => !(latin && RECIPES[id].cjkOnly)), [latin]);
  const output = project.output ?? DEFAULT_OUTPUT;
  const tileW = 168;
  const tileH = Math.round(Math.min(168, Math.max(56, tileW / Math.max(0.3, output.width / Math.max(1, output.height)))));
  const refs = useRef(new Map<TypeRecipeId, HTMLCanvasElement>());
  const painter = useRef<TypePainter | null>(null);
  const [fontsReady, setFontsReady] = useState(0);

  const sys = resolveSystem(system);
  const fontsKey = `${sys.fonts.cjk}|${sys.fonts.latin}|${sys.weight}`;
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!painter.current) painter.current = new TypePainter();
    const fam = resolveFamilies(document.body, sys.fonts);
    painter.current.setFamilies(fam);
    let live = true;
    const text = project.lyrics.lines.map((l) => l.text).join("");
    void loadFaces(fam, [sys.weight, 700, 400], text).then(() => {
      if (!live) return;
      painter.current?.invalidate();
      setFontsReady((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // the faces follow the system's fonts and weight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsKey, project.lyrics]);

  useEffect(() => {
    const p = painter.current;
    const plan = project.plan;
    if (!p || !plan || !line) return;
    const si = sectionIndexForLine(plan, project.lyrics.lines, lineIndex, project.meta.duration);
    const section = si != null ? plan.sections[si] : plan.sections[0];
    const bg = isHex(section?.colorway?.[0]) ? section.colorway[0] : "#08080c";
    const ink = ensureContrast(isHex(section?.lyricColor) ? section.lyricColor : "#f5f3ef", bg, 4.5);
    const accent = ensureContrast(section?.colorway?.[2] ?? "#e0a458", bg, 3);
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const W = Math.round(tileW * dpr);
    const H = Math.round(tileH * dpr);
    const canvas = { width: output.width, height: output.height, safe: output.lyricSafe ?? DEFAULT_OUTPUT.lyricSafe };
    for (const id of recipes) {
      const el = refs.current.get(id);
      const c2 = el?.getContext("2d");
      if (!el || !c2) continue;
      if (el.width !== W || el.height !== H) {
        el.width = W;
        el.height = H;
      }
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.fillStyle = bg;
      c2.fillRect(0, 0, W, H);
      const variant = setRecipe(system, line.id, id, ctx);
      let composed = null;
      try {
        composed = composeProjectLine({ ...plan, typeSystem: variant }, project.lyrics.lines, lineIndex, canvas, p.measure, { duration: project.meta.duration, songTitle: project.meta.title });
      } catch (err) {
        console.warn("[Livelyrics] 構圖縮圖失敗：", err);
      }
      if (!composed) continue;
      p.resize(W, H);
      p.paint([{ comp: composed.comp, clock: HOLD, alpha: 1 }], W / output.width, "color", { ink, accent, spot: SEAL_COLOR });
      c2.drawImage(p.canvas, 0, 0);
    }
  }, [project, system, lineIndex, line, recipes, ctx, output.width, output.height, output.lyricSafe, tileW, tileH, fontsReady]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="構圖">
      {recipes.map((id) => {
        const on = id === current;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(id)}
            data-testid="recipe-thumb"
            data-recipe={id}
            className={cx(
              "press-fade group flex min-w-0 flex-col gap-1 rounded-md p-1 text-left focus-visible:outline-2 focus-visible:outline-tint",
              on ? "bg-tint-soft shadow-[0_0_0_2px_var(--tint)]" : "bg-fill-4 hover:bg-fill-3",
            )}
          >
            <canvas
              ref={(el) => {
                if (el) refs.current.set(id, el);
                else refs.current.delete(id);
              }}
              className="block w-full rounded-[5px] bg-black"
              style={{ aspectRatio: `${tileW} / ${tileH}` }}
              aria-hidden="true"
            />
            <span className={cx("truncate px-1 pb-0.5 text-[12px] leading-4", on ? "font-semibold text-tint-text" : "text-label")}>{RECIPES[id].label}</span>
          </button>
        );
      })}
    </div>
  );
}
