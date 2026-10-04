"use client";

// 專屬畫面 (phase 7) on the design overview: the song's own scene program — its key still (主視覺:
// one frame of the program at its key moment, with that moment's lyric in its composition), its
// name, concept and who wrote it, what each section does, and the escape hatches: 「重新產生畫面」
// (an optional instruction in 繁中; Claude rewrites it, or the offline composer draws another
// composition) and 「使用專屬畫面」 (off = the built-in scenes of each section; the program is kept).
// A program this computer cannot compile says so, with 「請 Claude 修正」.

import { useEffect, useId, useState } from "react";
import { Banner, Button, InsetGroup, ListRow, Sheet, Switch, Tag, TextArea } from "@/components/ui";
import { SparkleIcon } from "@/components/ui/Icon";
import { api } from "@/lib/api-client";
import { formatTimeShort } from "@/lib/timeline";
import type { Project, SceneProgram, TypeRelation } from "@/lib/types";
import { saveThumb, useKeyStill } from "./key-still";

const ENGINE_LABEL: Record<SceneProgram["engine"], string> = { claude: "Claude 撰寫", offline: "離線作曲器", example: "範例程式", manual: "手動貼上" };

/** 「Claude（claude-sonnet-5-5）」: the model that wrote a Claude program, when it was recorded. */
export function programAuthor(program: Pick<SceneProgram, "engine" | "model">): string {
  if (program.engine !== "claude") return ENGINE_LABEL[program.engine];
  const model = program.model?.trim();
  return model ? `Claude（${model}）` : "Claude";
}
const RELATION_LABEL: Record<TypeRelation, string> = { plain: "字在留白裡", knockout: "字切開畫面", behind: "字從形狀後面經過", lit: "畫面照亮字" };
const SUGGESTIONS = ["更安靜、留白更多", "主角形狀再小一點", "副歌的光再打開一些", "更貼近專輯封面的質感", "橋段換一個完全不同的規則"];

export interface SceneProgramActions {
  /** a pipeline run is in progress: the actions wait */
  disabled?: boolean;
  /** no Claude API for this project (免費研究 mode): regenerating draws another offline composition */
  offline?: boolean;
  /** run the scene step with an instruction */
  onRegenerate: (instruction: string) => void;
  /** the saved project after a switch */
  onProject?: (project: Project) => void;
}

export function SceneProgramPanel({ project, actions }: { project: Project; actions?: SceneProgramActions }) {
  const plan = project.plan;
  const program = plan?.sceneProgram ?? null;
  const still = useKeyStill(program ? project : null);
  // the rendered key still also becomes the song's picture in the library
  const readyStill = still.status === "ready" && still.still.program.state !== "failed" ? still.still : null;
  useEffect(() => {
    if (readyStill) void saveThumb(project, readyStill);
  }, [project, readyStill]);
  const [sheet, setSheet] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headId = useId();
  if (!plan) return null;

  const setEnabled = async (enabled: boolean) => {
    if (!program) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateProject(project.id, { plan: { ...plan, sceneProgram: { ...program, enabled } } });
      actions?.onProject?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const regenerate = (instruction: string) => {
    setSheet(false);
    actions?.onRegenerate(instruction.trim());
  };
  const failed = still.status === "ready" && still.still.program.state === "failed" ? still.still.program : null;
  const aspect = project.output && project.output.width > 0 ? project.output.width / project.output.height : 16 / 9;

  return (
    <section aria-labelledby={headId} className="min-w-0" data-testid="scene-panel">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headId} className="text-title-3 text-label">
          專屬畫面{program ? `「${program.title}」` : ""}
        </h3>
        {program && (
          // who wrote this program: the model for Claude (the customer knows what they paid for), 離線作曲器 otherwise
          <Tag tone={program.engine === "claude" ? "tint" : "neutral"} data-testid="scene-author" title={program.engine === "claude" ? `這支畫面程式由 ${programAuthor(program)} 撰寫` : undefined}>
            {program.engine === "claude" ? `${programAuthor(program)} 撰寫` : ENGINE_LABEL[program.engine]}
          </Tag>
        )}
        {program && program.enabled === false && <Tag tone="orange">目前用內建場景</Tag>}
      </div>
      {program ? (
        <>
          <p className="mt-2 max-w-[60em] text-[15px] leading-[22px] text-label-2">{program.concept}</p>
          <figure className="mt-4 min-w-0">
            <div className="overflow-hidden rounded-2xl bg-black shadow-[0_0_0_var(--hairline)_var(--separator)]" style={{ aspectRatio: String(aspect), maxWidth: aspect < 1 ? "22rem" : undefined }}>
              {still.status === "ready" ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL rendered in the browser
                <img src={still.still.url} alt={`專屬畫面「${program.title}」的主視覺`} className="block h-full w-full object-cover" data-testid="scene-still" />
              ) : still.status === "error" ? (
                <p className="flex h-full items-center justify-center px-6 text-center text-[13px] text-white/70">{still.error}</p>
              ) : (
                <div className="skeleton h-full w-full" aria-label="正在算出主視覺" />
              )}
            </div>
            <figcaption className="mt-2 px-1 text-[13px] leading-5 text-label-2">
              主視覺：{still.status === "ready" ? `${formatTimeShort(still.still.t)} 這一格` : "副歌裡的一格"}，畫面與歌詞一起構圖
            </figcaption>
          </figure>
          {failed && (
            <Banner
              tone="warning"
              className="mt-4"
              title="這台電腦無法編譯這個畫面，投影會改用每段的內建場景"
              description={failed.log ?? ""}
              actions={
                !actions?.offline && actions ? (
                  <Button variant="tinted" size="sm" disabled={actions.disabled} onClick={() => regenerate(`修正這個 GLSL 編譯錯誤，保留畫面的設計：${failed.log ?? ""}`.slice(0, 600))}>
                    請 Claude 修正
                  </Button>
                ) : undefined
              }
            >
              <span data-testid="scene-program-error" hidden />
            </Banner>
          )}
          <InsetGroup className="mt-5" footer={program.enabled === false ? "專屬畫面保留著，隨時可以切回來。" : "關掉後每一段改用設計方案裡的內建場景，歌詞排版回到整個畫面。"}>
            <ListRow
              title="使用專屬畫面"
              accessory={<Switch checked={program.enabled !== false} disabled={saving || actions?.disabled} onChange={(v) => void setEnabled(v)} aria-label="使用專屬畫面" data-testid="scene-toggle" />}
            />
          </InsetGroup>
          <details className="mt-4">
            <summary className="cursor-pointer px-1 text-[13px] leading-5 text-label-2">每一段的畫面與字</summary>
            <ul className="mt-2 space-y-1 px-1 text-[13px] leading-5 text-label-2">
              {plan.sections.map((s) => {
                const st = program.sections.find((x) => x.sectionId === s.id);
                return (
                  <li key={s.id}>
                    <span className="text-label">{s.label}</span>（{formatTimeShort(s.start)}）：{st?.note || "依段落種類"}｜{RELATION_LABEL[st?.relation ?? "plain"]}
                  </li>
                );
              })}
            </ul>
          </details>
        </>
      ) : (
        <p className="mt-2 text-[15px] leading-[22px] text-label-2">這個方案用每一段的內建場景。產生一個這首歌專屬的畫面，字會排進它的留白裡。</p>
      )}
      {error && <p className="mt-3 text-[13px] text-red-text">{error}</p>}
      {actions && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="tinted" disabled={actions.disabled} onClick={() => setSheet(true)} data-testid="scene-regenerate">
            <SparkleIcon size={16} />
            {program ? "重新產生畫面…" : "產生專屬畫面…"}
          </Button>
        </div>
      )}
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={program ? "重新產生專屬畫面" : "產生專屬畫面"}
        action={
          <Button variant="filled" onClick={() => regenerate(text)} data-testid="scene-regenerate-go">
            {program ? "重新產生" : "產生"}
          </Button>
        }
      >
        <div className="space-y-3 p-4">
          <p className="text-[13px] leading-5 text-label-2">
            {actions?.offline ? "沒有連接 Claude：離線作曲器會換一個構圖（形狀、質地與動態）。" : "Claude 會依這首歌、目前的設計方案與你的指示重寫畫面程式；指示可以留空。"}
          </p>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="例如：更安靜、留白更多；副歌的光再打開一些" aria-label="畫面指示" />
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="press rounded-pill bg-fill-3 px-3 py-1 text-[13px] text-label" onClick={() => setText(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </section>
  );
}
