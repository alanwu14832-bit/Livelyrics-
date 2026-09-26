"use client";

import { UploadFlow } from "@/components/upload/UploadFlow";
import { Brand } from "./Brand";
import { ProjectLibrary } from "./ProjectLibrary";
import { OfflineNotice, ServerStatusPill, useServerStatus } from "./ServerStatus";

export function HomeClient() {
  const { state, reload } = useServerStatus();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Brand />
          <ServerStatusPill state={state} onRetry={reload} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-10 px-6 pb-16 pt-8">
        <OfflineNotice state={state} onRetry={reload} />
        <section aria-labelledby="new-song-title" className="space-y-4">
          <div>
            <h1 id="new-song-title" className="text-2xl font-semibold tracking-tight text-fg">
              讓歌詞退居幕後，讓視覺托起樂團
            </h1>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">
              上傳一首歌，AI 以樂團專職舞台視覺設計師的角度研究歌曲與樂團，設計主視覺、每一段的畫面，以及歌詞如何跟著主視覺出場。
            </p>
          </div>
          <UploadFlow />
        </section>
        <ProjectLibrary />
      </main>
    </div>
  );
}
