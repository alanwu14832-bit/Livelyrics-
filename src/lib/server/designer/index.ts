// STUB — owned by the DESIGNER module. Replace the implementation, keep the exports.
import type { AudioAnalysis, DesignPlan, Lyrics, Research, SongMeta } from "@/lib/types";

export interface DesignerInput {
  meta: SongMeta;
  lyrics: Lyrics;
  analysis: AudioAnalysis | null;
}

export interface DesignerCallbacks {
  onLog?: (message: string) => void;
  /** streaming text (research brief as it is written / designer progress notes) */
  onDelta?: (text: string) => void;
  /** a web search Claude issued */
  onSearch?: (query: string) => void;
  signal?: AbortSignal;
}

/** true when an Anthropic credential is configured (otherwise the offline designer is used) */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function modelName(): string {
  return process.env.LIVELYRICS_MODEL || "claude-opus-5";
}

/** Research the band and song as a dedicated stage-visual designer would. Never throws for Claude failures: falls back to offline. */
export async function researchSong(input: DesignerInput, cb: DesignerCallbacks = {}): Promise<Research> {
  void input;
  void cb;
  throw new Error("researchSong: not implemented");
}

/** Produce a validated, normalized DesignPlan. Never throws for Claude failures: falls back to offline. */
export async function designSong(
  input: DesignerInput & { research: Research | null; instruction?: string; previous?: DesignPlan | null },
  cb: DesignerCallbacks = {},
): Promise<DesignPlan> {
  void input;
  void cb;
  throw new Error("designSong: not implemented");
}
