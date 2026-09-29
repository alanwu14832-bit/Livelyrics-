import type { Metadata } from "next";
import { UiLab } from "./UiLab";

export const metadata: Metadata = {
  title: "元件實驗室｜Livelyrics",
  description: "開發用：操作介面元件在淺色、深色與控制台三種外觀下的所有狀態。",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Dev-only component gallery (not linked from any navigation). Every component of
 * src/components/ui in every state, light / dark / console side by side.
 *   ?theme=light|dark|console   one theme at full width
 *   ?section=<id>               a single section (for screenshots)
 */
export default async function UiLabPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <UiLab theme={one("theme")} section={one("section")} />;
}
