"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StageView, type StageStats } from "@/components/stage/StageView";
import { Badge, Button, Kbd, Panel, cx } from "@/components/ui";
import { LYRIC_PLACEMENTS, LYRIC_STYLE_IDS, SCENE_IDS } from "@/lib/schema";
import { DEMO_COLORWAYS, createDemoProject } from "@/lib/stage/demo";
import { DEFAULT_OVERRIDES, createStageStore, initialStageState, type StageOverrides, type StageState } from "@/lib/stage/protocol";
import { isLyricStyleId, isPlacement, isSceneId } from "@/lib/stage/resolve";
import { SCENE_LABELS } from "@/lib/stage/scenes";
import { formatTime, lineIndexAt, sectionIndexAt } from "@/lib/timeline";
import type { LyricPlacement, LyricStyleId, Project, SceneId } from "@/lib/types";

export interface StageLabInitial {
  scene?: string;
  style?: string;
  placement?: string;
  t?: string;
  play?: string;
  cw?: string;
  chrome?: string;
  guides?: string;
  tp?: string;
  gl?: string;
  aq?: string;
  intensity?: string;
  scale?: string;
  blackout?: string;
  freeze?: string;
  lyrics?: string;
}

const STYLE_LABELS: Record<LyricStyleId, string> = {
  karaoke: "卡拉 OK 填色",
  "line-fade": "整行淡入",
  "word-pop": "逐字跳出",
  typewriter: "打字機",
  stack: "詩句堆疊",
  vertical: "直排",
  impact: "巨型標語",
  subtitle: "字幕",
  hidden: "不顯示",
};

const PLACEMENT_LABELS: Record<LyricPlacement, string> = {
  center: "置中",
  "lower-third": "下三分之一",
  "upper-third": "上三分之一",
  left: "靠左",
  right: "靠右",
  "vertical-right": "右側直排",
  "vertical-left": "左側直排",
};

const flag = (v: string | undefined, fallback: boolean) => (v == null ? fallback : v === "1" || v === "true");
const num = (v: string | undefined, fallback: number, lo: number, hi: number) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function applyDesignOverrides(base: Project, placement: LyricPlacement | null, colorway: [string, string, string] | null): Project {
  if (!base.plan || (!placement && !colorway)) return base;
  return {
    ...base,
    plan: {
      ...base.plan,
      sections: base.plan.sections.map((s) => ({
        ...s,
        ...(placement ? { lyricPlacement: placement } : {}),
        ...(colorway ? { colorway: [...colorway] } : {}),
      })),
    },
  };
}

export function StageLab({ initial }: { initial: StageLabInitial }) {
  const baseProject = useMemo(() => createDemoProject(), []);
  const duration = baseProject.meta.duration;

  const [scene, setScene] = useState<SceneId | null>(isSceneId(initial.scene) ? initial.scene : null);
  const [style, setStyle] = useState<LyricStyleId | null>(isLyricStyleId(initial.style) ? initial.style : null);
  const [placement, setPlacement] = useState<LyricPlacement | null>(isPlacement(initial.placement) ? initial.placement : null);
  const [cw, setCw] = useState<string>(DEMO_COLORWAYS.some((c) => c.id === initial.cw) ? initial.cw! : "plan");
  const [intensity, setIntensity] = useState(() => num(initial.intensity, 1, 0, 1.5));
  const [lyricScale, setLyricScale] = useState(() => num(initial.scale, 1, 0.5, 2));
  const [freeze, setFreeze] = useState(() => flag(initial.freeze, false));
  const [blackout, setBlackout] = useState(() => flag(initial.blackout, false));
  const [lyricsVisible, setLyricsVisible] = useState(() => flag(initial.lyrics, true));
  const [testPattern, setTestPattern] = useState(() => flag(initial.tp, false));
  const [guides, setGuides] = useState(() => flag(initial.guides, false));
  const [playing, setPlaying] = useState(() => flag(initial.play, true));
  const [displayT, setDisplayT] = useState(() => num(initial.t, 0, 0, duration));
  const [stats, setStats] = useState<StageStats | null>(null);
  const chrome = flag(initial.chrome, true);
  const forceWebGL1 = flag(initial.gl, false);
  const adaptive = flag(initial.aq, true);

  const colorway = useMemo(() => {
    const preset = DEMO_COLORWAYS.find((c) => c.id === cw);
    return preset && preset.id !== "plan" ? preset.colors : null;
  }, [cw]);
  const project = useMemo(() => applyDesignOverrides(baseProject, placement, colorway), [baseProject, placement, colorway]);

  const [store] = useState(() => createStageStore({ ...initialStageState(baseProject.id), t: num(initial.t, 0, 0, duration) }));
  // `at` is re-anchored on the first publish (Date.now() is impure during render)
  const clock = useRef({ t: num(initial.t, 0, 0, duration), at: 0, playing: flag(initial.play, true) });

  const overrides: StageOverrides = useMemo(
    () => ({ ...DEFAULT_OVERRIDES, scene, lyricStyle: style, intensity, lyricScale, freeze, blackout, lyricsVisible, testPattern }),
    [scene, style, intensity, lyricScale, freeze, blackout, lyricsVisible, testPattern],
  );
  const overridesRef = useRef(overrides);
  const projectRef = useRef(project);

  const currentTime = useCallback(() => {
    const c = clock.current;
    if (!c.at) c.at = Date.now();
    return c.playing ? c.t + (Date.now() - c.at) / 1000 : c.t;
  }, []);

  const publish = useCallback(() => {
    const c = clock.current;
    const now = Date.now();
    let t = currentTime();
    if (t >= duration) {
      t = 0;
      c.t = 0;
      c.at = now;
    }
    const p = projectRef.current;
    const lineIndex = lineIndexAt(p.lyrics, t, duration);
    const prev = store.get();
    const next: StageState = {
      ...prev,
      t,
      playing: c.playing,
      sentAt: now,
      lineIndex,
      lineStartedAt: lineIndex !== prev.lineIndex ? now : prev.lineStartedAt,
      sectionIndex: sectionIndexAt(p.plan, t),
      overrides: overridesRef.current,
    };
    store.set(next);
    return t;
  }, [currentTime, duration, store]);

  useEffect(() => {
    overridesRef.current = overrides;
    projectRef.current = project;
    publish();
  }, [overrides, project, publish]);

  // 30 Hz publisher (like the console) + 10 Hz UI readout
  useEffect(() => {
    let ticks = 0;
    const id = window.setInterval(() => {
      const t = publish();
      if (++ticks % 3 === 0) setDisplayT(t);
    }, 33);
    return () => window.clearInterval(id);
  }, [publish]);

  const seek = useCallback(
    (t: number) => {
      const c = clock.current;
      c.t = Math.min(duration, Math.max(0, t));
      c.at = Date.now();
      setDisplayT(c.t);
      publish();
    },
    [duration, publish],
  );

  const togglePlay = useCallback(() => {
    const c = clock.current;
    c.t = currentTime();
    c.at = Date.now();
    c.playing = !c.playing;
    setPlaying(c.playing);
    publish();
  }, [currentTime, publish]);

  const lines = project.lyrics.lines;
  const jumpLine = useCallback(
    (delta: number) => {
      const t = currentTime();
      const cur = lineIndexAt(project.lyrics, t, duration);
      let idx: number;
      if (cur == null) {
        const nextIdx = lines.findIndex((l) => (l.start ?? 0) > t);
        idx = delta > 0 ? (nextIdx < 0 ? lines.length - 1 : nextIdx) : Math.max(0, (nextIdx < 0 ? lines.length : nextIdx) - 1);
      } else idx = Math.min(lines.length - 1, Math.max(0, cur + delta));
      const s = lines[idx]?.start;
      if (s != null) seek(s + 0.01);
    },
    [currentTime, duration, lines, project.lyrics, seek],
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        togglePlay();
      } else if (k === "b") setBlackout((v) => !v);
      else if (k === "f") setFreeze((v) => !v);
      else if (k === "l") setLyricsVisible((v) => !v);
      else if (k === "g") setGuides((v) => !v);
      else if (k === "arrowright") jumpLine(1);
      else if (k === "arrowleft") jumpLine(-1);
      else if (k === "0") setScene(null);
      else if (/^[1-9]$/.test(k)) setScene(SCENE_IDS[Number(k) - 1] ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpLine, togglePlay]);

  // mirror the configuration in the URL (shareable, screenshot-friendly)
  useEffect(() => {
    if (!chrome) return;
    const id = window.setTimeout(() => {
      const q = new URLSearchParams();
      if (scene) q.set("scene", scene);
      if (style) q.set("style", style);
      if (placement) q.set("placement", placement);
      if (cw !== "plan") q.set("cw", cw);
      q.set("t", clock.current.t.toFixed(2));
      q.set("play", playing ? "1" : "0");
      if (guides) q.set("guides", "1");
      if (testPattern) q.set("tp", "1");
      if (intensity !== 1) q.set("intensity", String(intensity));
      if (lyricScale !== 1) q.set("scale", String(lyricScale));
      window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    }, 400);
    return () => window.clearTimeout(id);
  }, [chrome, scene, style, placement, cw, playing, guides, testPattern, intensity, lyricScale]);

  const sectionIdx = sectionIndexAt(project.plan, displayT);
  const section = sectionIdx != null ? project.plan?.sections[sectionIdx] : null;
  const lineIdx = lineIndexAt(project.lyrics, displayT, duration);

  const stage = (
    <StageView
      project={project}
      store={store}
      showGuides={guides}
      forceWebGL1={forceWebGL1}
      adaptiveQuality={adaptive}
      onStats={setStats}
      className={chrome ? "w-full" : "absolute inset-0"}
      style={chrome ? undefined : { aspectRatio: "auto" }}
    />
  );

  if (!chrome) return <div className="fixed inset-0 bg-black">{stage}</div>;

  const fullHref = (() => {
    const q = new URLSearchParams();
    if (scene) q.set("scene", scene);
    if (style) q.set("style", style);
    if (placement) q.set("placement", placement);
    if (cw !== "plan") q.set("cw", cw);
    q.set("t", displayT.toFixed(2));
    q.set("play", "1");
    q.set("chrome", "0");
    return `/stage-lab?${q}`;
  })();

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-bg p-3 text-fg lg:flex-row lg:p-4">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold">舞台實驗室</h1>
            <span className="text-xs text-muted">
              {project.meta.title} · {project.meta.artist} · 示範專案
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {stats ? (
              <>
                <Badge tone={stats.backend === "webgl2" || stats.backend === "webgl1" ? "ok" : "warn"}>{stats.backend.toUpperCase()}</Badge>
                <Badge tone={stats.fps >= 50 ? "ok" : stats.fps >= 30 ? "warn" : "danger"}>
                  <span className="tabular">{stats.fps.toFixed(0)} fps</span>
                </Badge>
                <Badge>
                  <span className="tabular">
                    {stats.width}×{stats.height}
                    {stats.quality < 1 ? ` · ${Math.round(stats.quality * 100)}%` : ""}
                  </span>
                </Badge>
              </>
            ) : (
              <Badge>初始化中…</Badge>
            )}
            <Link href={fullHref} className="ml-1 rounded-md px-2 py-1 text-muted hover:bg-panel-3 hover:text-fg" target="_blank">
              全螢幕預覽 ↗
            </Link>
          </div>
        </header>

        <div className="overflow-hidden rounded-lg border border-line bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">{stage}</div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
          <Button variant="primary" size="sm" onClick={togglePlay} aria-label={playing ? "暫停" : "播放"} className="w-16">
            {playing ? "暫停" : "播放"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => jumpLine(-1)} aria-label="上一句">
            ← 上一句
          </Button>
          <Button size="sm" variant="ghost" onClick={() => jumpLine(1)} aria-label="下一句">
            下一句 →
          </Button>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={displayT}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="時間軸"
            className="min-w-40 flex-1 accent-[var(--color-accent)]"
          />
          <span className="tabular w-32 text-right font-mono text-xs text-muted">
            {formatTime(displayT)} / {formatTime(duration)}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {project.plan?.sections.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => seek(s.start + 0.01)}
              className={cx(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                i === sectionIdx ? "border-accent bg-accent/15 text-fg" : "border-line bg-panel text-muted hover:text-fg",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ background: s.colorway[1] }} />
              {s.label}
              <span className="text-faint">{SCENE_LABELS[s.scene]}</span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-line bg-panel px-3 py-2 text-sm">
          <div className="text-xs text-muted">
            {section ? `${section.label} · ${STYLE_LABELS[style ?? section.lyricStyle]} · ${PLACEMENT_LABELS[placement ?? section.lyricPlacement]}` : "—"}
          </div>
          <div className="mt-1 min-h-6 text-base">{lineIdx != null ? lines[lineIdx].text : <span className="text-faint">（間奏）</span>}</div>
          {section && <p className="mt-1 text-xs text-muted">{section.rationale}</p>}
        </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-3 lg:max-h-[calc(100vh-2rem)] lg:w-[360px] lg:overflow-y-auto">
        <Panel title="場景">
          <ChipGrid>
            <Chip active={scene == null} onClick={() => setScene(null)}>
              依設計 <Kbd>0</Kbd>
            </Chip>
            {SCENE_IDS.map((id, i) => (
              <Chip key={id} active={scene === id} onClick={() => setScene(id)} title={id}>
                {SCENE_LABELS[id]}
                {i < 9 && <Kbd>{i + 1}</Kbd>}
              </Chip>
            ))}
          </ChipGrid>
        </Panel>

        <Panel title="歌詞樣式">
          <ChipGrid>
            <Chip active={style == null} onClick={() => setStyle(null)}>
              依設計
            </Chip>
            {LYRIC_STYLE_IDS.map((id) => (
              <Chip key={id} active={style === id} onClick={() => setStyle(id)} title={id}>
                {STYLE_LABELS[id]}
              </Chip>
            ))}
          </ChipGrid>
        </Panel>

        <Panel title="歌詞位置">
          <ChipGrid>
            <Chip active={placement == null} onClick={() => setPlacement(null)}>
              依設計
            </Chip>
            {LYRIC_PLACEMENTS.map((id) => (
              <Chip key={id} active={placement === id} onClick={() => setPlacement(id)} title={id}>
                {PLACEMENT_LABELS[id]}
              </Chip>
            ))}
          </ChipGrid>
        </Panel>

        <Panel title="配色">
          <div className="grid grid-cols-2 gap-1.5 p-2">
            {DEMO_COLORWAYS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCw(c.id)}
                aria-pressed={cw === c.id}
                className={cx(
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                  cw === c.id ? "border-accent bg-accent/10 text-fg" : "border-line bg-panel-2 text-muted hover:text-fg",
                )}
              >
                <span className="flex overflow-hidden rounded">
                  {c.colors.map((hex) => (
                    <span key={hex} className="h-4 w-3" style={{ background: hex }} />
                  ))}
                </span>
                {c.label}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="控制">
          <div className="flex flex-col gap-3 p-3 text-xs">
            <Slider label="強度" value={intensity} min={0} max={1.5} step={0.05} onChange={setIntensity} />
            <Slider label="歌詞大小" value={lyricScale} min={0.5} max={2} step={0.05} onChange={setLyricScale} />
            <div className="flex flex-wrap gap-1.5">
              <Toggle on={blackout} onClick={() => setBlackout((v) => !v)} k="B">
                全黑
              </Toggle>
              <Toggle on={freeze} onClick={() => setFreeze((v) => !v)} k="F">
                凍結
              </Toggle>
              <Toggle on={lyricsVisible} onClick={() => setLyricsVisible((v) => !v)} k="L">
                歌詞
              </Toggle>
              <Toggle on={guides} onClick={() => setGuides((v) => !v)} k="G">
                安全框
              </Toggle>
              <Toggle on={testPattern} onClick={() => setTestPattern((v) => !v)}>
                測試畫面
              </Toggle>
            </div>
            <p className="leading-relaxed text-faint">
              <Kbd>Space</Kbd> 播放／暫停　<Kbd>←</Kbd>
              <Kbd>→</Kbd> 上／下一句　<Kbd>1</Kbd>–<Kbd>9</Kbd> 場景
            </p>
          </div>
        </Panel>
      </aside>
    </main>
  );
}

function ChipGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5 p-2">{children}</div>;
}

function Chip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        active ? "border-accent bg-accent/15 text-fg" : "border-line bg-panel-2 text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onClick, children, k }: { on: boolean; onClick: () => void; children: ReactNode; k?: string }) {
  return (
    <Button size="sm" active={on} onClick={onClick} aria-pressed={on}>
      {children}
      {k && <Kbd>{k}</Kbd>}
    </Button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(1)}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="tabular w-10 text-right font-mono text-muted">{value.toFixed(2)}</span>
    </label>
  );
}
