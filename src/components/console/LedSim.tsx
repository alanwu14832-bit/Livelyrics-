"use client";

// LED 模擬 (phase 3): the console preview drawn as an LED wall, so the operator can judge whether the
// lyrics stay legible at the wall's real resolution. Console only — the projection never gets it.
//
// The wall's LED count comes from its pixel pitch and width (P3.9 on a 4 m wall = 1026 LEDs
// across); the preview samples the stage once per LED (an SVG pixelate filter: one sample per cell,
// dilated to the cell), adds a soft bloom (LEDs glow into their neighbours) and draws the dark gaps
// between the dots with a CSS radial-gradient overlay. When an LED would be smaller than 2 preview
// pixels the cells are enlarged to 2 px and the label says the preview is magnified.
//
// Cost: a CSS overlay plus one SVG filter on the preview element only (the preview renders at half
// resolution anyway); off by default and remembered per browser.

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { SegmentedControl, Stepper, cx } from "@/components/ui";
import { GridNineIcon } from "@/components/ui/Icon";

export const LED_PITCHES = [2.6, 3.9, 4.8, 6] as const;
export type LedPitch = (typeof LED_PITCHES)[number];

export interface LedSimSettings {
  on: boolean;
  pitch: LedPitch;
  /** wall width in metres */
  wall: number;
  /** preview magnification (1, 2, 4): big enough to see the LEDs of a fine-pitch wall */
  zoom: 1 | 2 | 4;
}

const KEY = "livelyrics:led-sim";
const DEFAULT: LedSimSettings = { on: false, pitch: 3.9, wall: 4, zoom: 2 };
const ZOOMS = [1, 2, 4] as const;

function load(): LedSimSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<LedSimSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT };
    const pitch = LED_PITCHES.find((p) => p === raw.pitch) ?? DEFAULT.pitch;
    const wall = typeof raw.wall === "number" && raw.wall >= 1 && raw.wall <= 40 ? Math.round(raw.wall * 2) / 2 : DEFAULT.wall;
    const zoom = ZOOMS.find((z) => z === raw.zoom) ?? DEFAULT.zoom;
    return { on: raw.on === true, pitch, wall, zoom };
  } catch {
    return { ...DEFAULT };
  }
}

export function useLedSim(): [LedSimSettings, (patch: Partial<LedSimSettings>) => void] {
  // the preview only renders on the client once the project has loaded: storage is safe to read here
  const [s, setS] = useState<LedSimSettings>(() => (typeof window === "undefined" ? { ...DEFAULT } : load()));
  const update = (patch: Partial<LedSimSettings>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* private window: not remembered */
      }
      return next;
    });
  return [s, update];
}

/** LEDs across and down for a wall of `wall` metres at `pitch` mm, with the canvas aspect. */
export function ledGrid(pitch: number, wall: number, aspect: number): { cols: number; rows: number } {
  const cols = Math.max(8, Math.round((wall * 1000) / pitch));
  return { cols, rows: Math.max(4, Math.round(cols / (aspect > 0 ? aspect : 16 / 9))) };
}

export interface LedSimGeometry {
  cols: number;
  rows: number;
  /** preview CSS px per LED (≥ 2) */
  cell: number;
  /** the preview enlarges the LEDs (they would be smaller than 2 px) */
  magnified: number;
  /** where the zoomed stage's LED grid starts inside the frame (px), to align the dot overlay */
  offsetX: number;
  offsetY: number;
}

export function ledGeometry(s: LedSimSettings, aspect: number, previewWidth: number): LedSimGeometry {
  const { cols, rows } = ledGrid(s.pitch, s.wall, aspect);
  // the stage is laid out `zoom` times larger inside the preview frame
  const exact = previewWidth > 0 ? (previewWidth * s.zoom) / cols : 4;
  const cell = Math.max(2, Math.round(exact * 2) / 2);
  const h = previewWidth / (aspect > 0 ? aspect : 16 / 9);
  const mod = (x: number) => ((x % cell) + cell) % cell;
  return {
    cols,
    rows,
    cell,
    magnified: exact < 2 ? cell / Math.max(0.01, exact) : 1,
    offsetX: mod((-(s.zoom - 1) / 2) * previewWidth),
    offsetY: mod((-(s.zoom - 1) / 2) * h),
  };
}

/**
 * Wraps the preview stage: applies the pixelate + bloom filter to the stage and draws the LED gaps
 * over it. `children` is the StageView (or the shared stage's slot).
 */
export function LedSimStage({ settings, geometry, children }: { settings: LedSimSettings; geometry: LedSimGeometry | null; children: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const on = settings.on && geometry != null;
  const c = geometry?.cell ?? 4;
  const half = Math.floor(c / 2);
  const filterId = `led-sim-${id}`;
  const z = on ? settings.zoom : 1;
  // zoom by layout (not a transform), so the stage renders at the magnified size, centred
  const stageStyle: CSSProperties = on
    ? { filter: `url(#${filterId})`, width: `${z * 100}%`, height: `${z * 100}%`, left: `${-(z - 1) * 50}%`, top: `${-(z - 1) * 50}%`, right: "auto", bottom: "auto" }
    : {};
  return (
    <>
      {on && (
        <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
          <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            {/* one sample per LED cell … */}
            <feFlood x={half} y={half} width="1" height="1" floodColor="#fff" />
            <feComposite width={c} height={c} />
            <feTile result="grid" />
            <feComposite in="SourceGraphic" in2="grid" operator="in" />
            {/* … spread over the cell */}
            <feMorphology operator="dilate" radius={half} result="mosaic" />
            {/* bloom: bright LEDs glow into their neighbours */}
            <feGaussianBlur in="mosaic" stdDeviation={Math.max(1, c * 0.9)} result="blur" />
            <feComponentTransfer in="blur" result="glow">
              <feFuncR type="linear" slope="0.55" />
              <feFuncG type="linear" slope="0.55" />
              <feFuncB type="linear" slope="0.55" />
            </feComponentTransfer>
            <feBlend in="mosaic" in2="glow" mode="screen" />
          </filter>
        </svg>
      )}
      <div className="absolute inset-0" style={stageStyle} data-led-sim={on ? "on" : "off"}>
        {children}
      </div>
      {on && (
        <div
          aria-hidden="true"
          data-led-grid=""
          className="pointer-events-none absolute inset-0"
          style={{
            // the dark gaps between the LED dots
            backgroundImage: "radial-gradient(circle at 50% 50%, transparent 0, transparent 34%, rgba(0,0,0,0.55) 52%, rgba(0,0,0,0.92) 70%)",
            backgroundSize: `${c}px ${c}px`,
            backgroundPosition: `${geometry?.offsetX ?? 0}px ${geometry?.offsetY ?? 0}px`,
          }}
        />
      )}
    </>
  );
}

/** The toggle over the preview and, when on, the pitch and wall width. */
export function LedSimControls({ settings, geometry, onChange, className }: { settings: LedSimSettings; geometry: LedSimGeometry | null; onChange: (patch: Partial<LedSimSettings>) => void; className?: string }) {
  return (
    <div className={cx("pointer-events-auto flex flex-col-reverse items-end gap-1.5", className)}>
      <button
        type="button"
        aria-pressed={settings.on}
        onClick={(e) => {
          onChange({ on: !settings.on });
          // give the keyboard back to the show hotkeys
          if (e.detail > 0) e.currentTarget.blur();
        }}
        data-led-sim-toggle=""
        className={cx(
          "press-fade inline-flex h-6 items-center gap-1 rounded-pill px-2.5 text-c-footnote font-medium whitespace-nowrap",
          settings.on ? "bg-tint-fill text-on-tint" : "bg-black/60 text-label-2-on-material hover:bg-black/75",
        )}
      >
        <GridNineIcon size={13} weight="bold" />
        LED 模擬
      </button>
      {settings.on && (
        <div className="flex w-[420px] max-w-[calc(100cqw-16px)] flex-col gap-1.5 rounded-lg bg-black/75 p-1.5" data-led-sim-panel="">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <SegmentedControl<string>
                label="LED 間距"
                blurOnPointer
                value={String(settings.pitch)}
                onChange={(v) => onChange({ pitch: Number(v) as LedPitch })}
                fullWidth
                options={LED_PITCHES.map((p) => ({ value: String(p), label: <span className="t-latin tabular">P{p}</span>, ariaLabel: `間距 P${p}` }))}
              />
            </div>
            <div className="w-[156px] shrink-0">
              <SegmentedControl<string>
                label="放大"
                blurOnPointer
                value={String(settings.zoom)}
                onChange={(v) => onChange({ zoom: Number(v) as LedSimSettings["zoom"] })}
                fullWidth
                options={ZOOMS.map((z) => ({ value: String(z), label: `${z}×`, ariaLabel: `放大 ${z} 倍` }))}
              />
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 pl-1.5">
            <span className="flex items-center gap-1.5">
              <span className="text-c-footnote whitespace-nowrap text-label-2-on-material">牆寬</span>
              <Stepper
                label="LED 牆寬度（公尺）"
                value={settings.wall}
                min={1}
                max={40}
                step={0.5}
                showValue
                format={(v) => <span className="font-numeric text-c-footnote text-white tabular">{v.toFixed(1)} m</span>}
                onChange={(wall) => onChange({ wall })}
              />
            </span>
            {geometry && (
              <span className="min-w-0 truncate text-right font-numeric text-c-footnote text-label-2-on-material tabular" data-led-sim-res="" title={geometry.magnified > 1.05 ? `預覽中每顆 LED 再放大 ${geometry.magnified.toFixed(1)} 倍才看得見` : undefined}>
                {geometry.cols} × {geometry.rows} 顆{geometry.magnified > 1.05 ? `・顆粒 ×${geometry.magnified.toFixed(1)}` : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
